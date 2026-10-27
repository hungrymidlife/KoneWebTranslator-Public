"""Studio desktop exit: notify the local Bridge to close owned AI servers.

Does not enumerate or kill arbitrary ports/listeners. A desktop instance may
exit while another web Studio remains open; the Bridge checks GUI sessions.
"""
# KWT_EDITOR_FOCUS_SHUTDOWN_V1_5_1
from __future__ import annotations
import json
import urllib.request

URL='http://127.0.0.1:18765/api/manager/gui-session'


def main():
    payload=json.dumps({'action':'desktop-exit','session_id':'desktop-bat-exit'}).encode('utf-8')
    req=urllib.request.Request(URL,data=payload,method='POST',headers={
        'Content-Type':'application/json','X-KWT-Studio':'1'})
    try:
        # Bridge might already be gone: do not attempt to kill other processes.
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req,timeout=4) as response:
            print('[Studio exit] Bridge notified of desktop window closing:',response.status)
        return 0
    except Exception as exc:
        print('[Studio exit] Bridge notification unavailable:',exc)
        return 1


if __name__=='__main__':
    raise SystemExit(main())
