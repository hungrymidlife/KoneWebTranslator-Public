"""Read-only Studio first-launch diagnostics, stored in gitignored .studio_runtime."""
from __future__ import annotations

import datetime
import os
from pathlib import Path
import platform
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'studio-bridge' / '.studio_runtime' / 'diagnostics'
FETCH = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(url: str) -> str:
    try:
        req = urllib.request.Request(url, headers={'Accept': 'text/html,application/javascript,application/json'})
        with FETCH.open(req, timeout=8) as r:
            kind = r.headers.get('Content-Type', '')
            body = r.read(2048)
            excerpt = body[:140].decode('utf-8', 'replace').replace('\n', ' ')
            return f'HTTP {r.status}; type={kind}; bytes_read={len(body)}; prefix={excerpt!r}'
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        return f'ERROR: {type(exc).__name__}: {exc}'


def command(*args: str) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, errors='replace', timeout=8,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return f'code={result.returncode}; {(result.stdout or result.stderr).strip()[:350]}'
    except (OSError, subprocess.TimeoutExpired) as exc:
        return f'ERROR: {type(exc).__name__}: {exc}'


def main() -> int:
    now = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    lines = [f'KWT STUDIO COLDBOOT DIAGNOSTIC {now}', f'root={ROOT}',
             f'platform={platform.platform()} python={sys.version.split()[0]}',
             f'node: {command("node", "--version")}',
             f'npm: {command("npm.cmd" if os.name == "nt" else "npm", "--version")}',
             f'index.html exists={(ROOT / "studio/index.html").is_file()}',
             f'vite.config.ts exists={(ROOT / "studio/vite.config.ts").is_file()}',
             f'Bridge 18765: {request("http://127.0.0.1:18765/api/health")}']
    for path in ('/', '/src/main.tsx', '/src/App.tsx', '/src/ChatCenter.tsx', '/src/ControlCenter.tsx'):
        lines.append(f'Vite 1420 {path}: {request("http://127.0.0.1:1420" + path)}')
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f'coldboot_{now}.txt'
    dest.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))
    print(f'\n[INFO] Diagnostic saved: {dest}')
    print('[INFO] If the UI is blank, collect this report while the blank Studio window is open.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
