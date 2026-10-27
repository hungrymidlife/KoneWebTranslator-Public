"""Start only a compatible KoneWebTranslator Studio bridge.

This prevents RUN_STUDIO.bat from silently reusing an old listener on 18765.
If a compatible bridge is already up, reuse it. Replacing an old instance
requires explicit user confirmation and verification of its command line.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
SERVER = (ROOT / 'studio-bridge' / 'studio_server.py').resolve()
PORT = int(os.environ.get('KWT_STUDIO_PORT', '18765'))
HOST = 'http://127.0.0.1:' + str(PORT)
EXT_PATH = '/api/extension/studio/state'


def http_get(route: str):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(HOST + route, headers={'X-KWT-Studio': '1', 'Accept': 'application/json'})
    try:
        with opener.open(req, timeout=0.9) as reply:
            return reply.status, json.load(reply)
    except urllib.error.HTTPError as exc:
        try:
            body = json.load(exc)
        except Exception:
            body = {'error': str(exc)}
        return exc.code, body
    except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
        return None, None


def probe():
    """Returns compatible, old/foreign, unavailable (doesn't mutate anything)."""
    status, data = http_get(EXT_PATH)
    # KWT_STUDIO_INSTALLER_V2_0_0: a bridge without installer APIs is obsolete.
    if status == 200 and isinstance(data, dict) and 'paired' in data and 'revision' in data:
        installer_status, installer_data = http_get('/api/installer/status')
        if installer_status == 200 and isinstance(installer_data, dict) and 'items' in installer_data:
            return 'compatible'
    health_status, _ = http_get('/api/health')
    if status is not None or health_status is not None:
        return 'incompatible'
    return 'unavailable'


def listener_owner():
    if os.name != 'nt':
        return None
    # Query the PID actually listening on the loopback port. Never rely on window title.
    script = f"""
$procs = @(Get-NetTCPConnection -LocalPort {PORT} -State Listen -ErrorAction SilentlyContinue |
  Where-Object {{ $_.LocalAddress -eq '127.0.0.1' }} |
  Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($id in $procs) {{
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
  if ($null -ne $p) {{
    [PSCustomObject]@{{ pid = [int]$p.ProcessId; command = [string]$p.CommandLine }} |
      ConvertTo-Json -Compress
  }}
}}
"""
    try:
        completed = subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script],
            capture_output=True, text=True, errors='replace', timeout=9,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        if completed.returncode:
            return None
        for line in completed.stdout.splitlines():
            if line.strip().startswith('{'):
                item = json.loads(line)
                if isinstance(item.get('pid'), int):
                    return item
    except (OSError, ValueError, subprocess.TimeoutExpired):
        pass
    return None


def is_our_bridge(owner):
    if not owner:
        return False
    command = str(owner.get('command', '')).lower().replace('/', '\\')
    target = str(SERVER).lower().replace('/', '\\')
    return bool(target and target in command)


def wait_for(state: str, loops=26):
    for _ in range(loops):
        now = probe()
        if now == state:
            return True
        time.sleep(0.25)
    return False


def start_new():
    if os.name != 'nt':
        raise RuntimeError('Studio BAT launcher is Windows-only.')
    if not SERVER.is_file():
        raise RuntimeError(f'Studio bridge source missing: {SERVER}')
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    proc = subprocess.Popen(
        [sys.executable, '-u', str(SERVER)], cwd=str(ROOT), creationflags=flags,
    )
    if not wait_for('compatible'):
        if proc.poll() is not None:
            raise RuntimeError(f'Studio Bridge exited (code={proc.returncode}); inspect its console.')
        raise RuntimeError('New Studio Bridge failed to become ready. Check port 18765.')
    print(f'[OK] Studio V1.3 extension API ready (PID {proc.pid})')


def ensure():
    state = probe()
    if state == 'compatible':
        print('[OK] Compatible Studio Bridge already running. Reusing it; no duplicate process.')
        return
    if state == 'unavailable':
        print('[INFO] No Studio Bridge running. Starting current version...')
        start_new()
        return
    print('[WARNING] Port %s is occupied by an older or incompatible Studio Bridge.' % PORT)
    owner = listener_owner()
    if not is_our_bridge(owner):
        raise RuntimeError(
            f'The process using port {PORT} could not be verified as this project Studio Bridge.\n'
            'No process was terminated. Close the conflicting process manually; retry RUN_STUDIO.bat.'
        )
    pid = owner['pid']
    print(f'[INFO] Verified this project Studio Bridge PID={pid}')
    print('[WARNING] Restarting the Bridge interrupts active ZIP jobs or unsaved Studio work.')
    confirm = input('Restart this Bridge process? [y/N]: ').strip().lower()
    if confirm not in ('y', 'yes'):
        raise RuntimeError('Cancelled; old Bridge left untouched.')
    if os.name == 'nt':
        # Only the specifically verified PID is targeted, not its process tree.
        os.kill(pid, signal.SIGTERM)
    if not wait_for('unavailable', loops=20):
        raise RuntimeError('Old bridge did not release port. Check Windows process manager.')
    print('[INFO] Old Bridge stopped. Starting current version...')
    start_new()


def main():
    arg = sys.argv[1].lower() if len(sys.argv)>1 else 'check'
    if arg == 'check':
        state = probe()
        print(f'Studio bridge {HOST}: {state}')
        if state == 'incompatible':
            owner = listener_owner()
            print('Listener PID:', owner.get('pid') if owner else 'unknown')
            print('Verified project bridge:', is_our_bridge(owner))
        return 0 if state == 'compatible' else 2
    if arg == 'ensure':
        ensure()
        return 0
    raise RuntimeError('Use: bridge_launcher.py check|ensure')


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError, EOFError) as err:
        print('[ERROR]', err, file=sys.stderr)
        raise SystemExit(1)
