"""KWT Studio Bridge V1.8.1 - restart worker with durable diagnostics.

Wait for the OLD LISTENER to release the port, not for the entire old Python
process to disappear: non-daemon threads can keep that process alive after
HTTPServer.shutdown() and server_close(). Never terminate arbitrary PIDs.
"""
from __future__ import annotations
import json
import os
import socket
import subprocess
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
LOG = BASE / '.studio_runtime' / 'bridge_restart.log'


def log(message):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open('a', encoding='utf-8') as f:
        f.write(datetime.now().isoformat(timespec='seconds') + ' ' + str(message) + '\n')


def listener_released(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=.25):
            return False
    except OSError:
        return True


def health(port):
    opener = build_opener(ProxyHandler({}))
    req = Request(f'http://127.0.0.1:{port}/api/health', headers={'Accept':'application/json'})
    try:
        with opener.open(req, timeout=.5) as resp:
            if resp.status != 200:
                return None
            value = json.load(resp)
        return value if isinstance(value,dict) else None
    except Exception:
        return None


def main():
    old_pid = int(sys.argv[1]); port=int(sys.argv[2]); started=time.monotonic()
    if not (1 <= port <= 65535):
        raise ValueError('Invalid port')
    log(f'v1.8.1 restart begin old_pid={old_pid} port={port} python={sys.executable}')
    # A lingering old process can be harmless if its listening socket closed.
    for _ in range(160):  # up to ~40 seconds
        if listener_released(port):
            break
        time.sleep(.25)
    else:
        log('FAILED: old listener did not release the port. No PID was killed.')
        return 3
    server = BASE/'studio_server.py'
    if not server.is_file():
        log(f'FAILED: missing server {server}')
        return 2
    flags = (getattr(subprocess,'DETACHED_PROCESS',0) |
             getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0))
    kwargs = {'creationflags':flags} if os.name=='nt' else {'start_new_session':True}
    # Keep persistent stdout/err diagnostics instead of silently discarding all exceptions.
    bridge_log = BASE/'.studio_runtime'/'bridge_restart_server.log'
    bridge_log.parent.mkdir(parents=True,exist_ok=True)
    with bridge_log.open('ab') as output:
        proc = subprocess.Popen([sys.executable,'-u',str(server)],cwd=str(ROOT),
                                stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,
                                close_fds=True,**kwargs)
    log(f'spawned new bridge pid={proc.pid} after={time.monotonic()-started:.1f}s')
    for _ in range(120):  # 30 seconds
        if proc.poll() is not None:
            log(f'FAILED: new bridge exited code={proc.returncode}; see {bridge_log}')
            return 4
        value=health(port)
        if value and value.get('ok') and int(value.get('bridge_pid',-1))==proc.pid:
            log(f'SUCCESS: new bridge responsive pid={proc.pid}')
            return 0
        time.sleep(.25)
    log(f'FAILED: bridge pid={proc.pid} did not respond in time; see {bridge_log}')
    return 5


if __name__=='__main__':
    try:
        raise SystemExit(main())
    except Exception:
        log('FAILED with exception:\n' + traceback.format_exc())
        raise
