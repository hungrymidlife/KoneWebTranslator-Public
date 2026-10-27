"""KoneWebTranslator Studio: stop only recognized local Kone servers on desktop exit.

Targets listener PIDs on ports 18080 and 8765, independently of the PID
that Studio Bridge originally created. This accounts for Launch.ps1 spawning
llama-server.exe and for Python venv launcher processes.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.resolve()
GEMMA_SETTINGS = ROOT / 'local-server' / 'gemma_manager_settings.json'


def configured_gemma_dir():
    try:
        obj = json.loads(GEMMA_SETTINGS.read_text(encoding='utf-8'))
        return Path(str(obj.get('gemma_dir') or r'C:\AI\Gemma4MTP')).resolve()
    except (OSError, ValueError, TypeError):
        return Path(r'C:\AI\Gemma4MTP')


def normalized(s):
    return os.path.normcase(os.path.normpath(str(s))).casefold()


def under(path, root):
    try:
        return os.path.commonpath((normalized(path), normalized(root))) == normalized(root)
    except (ValueError, OSError):
        return False


def get_listeners():
    # Read-only Windows query. Never trust stale saved PIDs or names alone.
    script = r'''$ErrorActionPreference='Stop'
$ports=@(18080,8765)
$out=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1','::1') -and $_.LocalPort -in $ports } | ForEach-Object {
 $p=Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.OwningProcess) -ErrorAction SilentlyContinue
 if($null -ne $p){[pscustomobject]@{port=[int]$_.LocalPort;pid=[int]$p.ProcessId;exe=[string]$p.ExecutablePath;cmd=[string]$p.CommandLine}}
})
ConvertTo-Json -InputObject $out -Compress -Depth 3
'''
    proc = subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],
                          capture_output=True, text=True, timeout=25,
                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if proc.returncode:
        raise RuntimeError('Port inspection failed: ' + (proc.stderr or '')[:500])
    entries = json.loads(proc.stdout.strip() or '[]')
    return entries if isinstance(entries,list) else [entries]


def recognized(item):
    try:
        port = int(item['port'])
        exe = str(item.get('exe') or '').strip().strip('"')
        cmd = str(item.get('cmd') or '')
        pid = int(item['pid'])
        if pid <= 4 or not exe or not cmd:
            return False
        if port == 18080:
            return (Path(exe).name.casefold() == 'llama-server.exe'
                    and under(exe, configured_gemma_dir())
                    and '--port 18080' in cmd.lower().replace('=',' ')
                    and '--host 127.0.0.1' in cmd.lower().replace('=',' '))
        if port == 8765:
            return (Path(exe).name.casefold() in ('python.exe','pythonw.exe')
                    and normalized(ROOT / 'local-server' / 'server.py') in normalized(cmd)
                    and 'server.py' in cmd.lower())
    except (ValueError, TypeError, KeyError, OSError):
        pass
    return False


def cleanup():
    if os.name != 'nt':
        print('[Studio exit] Windows only; no processes stopped.')
        return 0
    try:
        listeners = get_listeners()
    except (OSError, subprocess.TimeoutExpired, ValueError, RuntimeError) as exc:
        print('[Studio exit] Cannot inspect listeners; nothing stopped:', exc)
        return 1
    seen = set()
    for item in listeners:
        pid = int(item.get('pid') or 0)
        if pid in seen:
            continue
        seen.add(pid)
        if not recognized(item):
            print('[Studio exit] Skipping unrecognized listener:', item.get('port'), pid)
            continue
        # Recheck the listener and its command line just before killing, to
        # avoid terminating a recycled PID or a newly started unrelated server.
        try:
            current = get_listeners()
            if not any(int(v.get('pid') or 0)==pid and int(v.get('port') or 0)==int(item['port'])
                       and recognized(v) and normalized(v.get('exe'))==normalized(item.get('exe'))
                       and v.get('cmd')==item.get('cmd') for v in current):
                print('[Studio exit] Listener changed, skip:', pid)
                continue
            result = subprocess.run(['taskkill','/PID',str(pid),'/T','/F'],capture_output=True,
                                    text=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            print(f'[Studio exit] {item["port"]} PID {pid}: '+ ('stopped' if result.returncode==0 else 'not stopped ('+str(result.returncode)+')'))
        except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
            print(f'[Studio exit] PID {pid}: {exc}')
    return 0


if __name__ == '__main__':
    sys.exit(cleanup())
