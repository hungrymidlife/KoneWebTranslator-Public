"""Persistent isolated Hayai child (keeps OCR server dependency versions intact)."""
import base64
import io
import json
import queue
import subprocess
import threading
from pathlib import Path

_bridge = None
_bridge_lock = threading.Lock()

def get_hayai_bridge(root):
    global _bridge
    with _bridge_lock:
        if _bridge is None:
            _bridge = HayaiBridge(Path(root))
        return _bridge

class HayaiBridge:
    def __init__(self, root):
        self.root = root
        self.proc = None
        self.lines = queue.Queue()
        self.call_lock = threading.Lock()

    def _start(self):
        python = self.root / '.venv-hayai' / 'Scripts' / 'python.exe'
        if not python.is_file():
            raise RuntimeError('Hayai is not installed; run Install_Hayai_OCR.bat first')
        self.lines = queue.Queue()
        self.proc = subprocess.Popen([str(python), '-u', str(self.root / 'hayai_worker.py')],
                                     cwd=str(self.root),stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                     stderr=None,encoding='utf-8',errors='strict',bufsize=1)
        threading.Thread(target=self._reader,daemon=True).start()

    def _reader(self):
        try:
            for line in self.proc.stdout:
                self.lines.put(line)
        finally:
            self.lines.put(None)

    def recognize(self, crop, patches):
        with self.call_lock:
            if self.proc is None or self.proc.poll() is not None:
                self._start()
            b=io.BytesIO()
            crop.convert('RGB').save(b, format='PNG')
            request={'patches':patches,'image':base64.b64encode(b.getvalue()).decode('ascii')}
            try:
                self.proc.stdin.write(json.dumps(request)+'\n')
                self.proc.stdin.flush()
                line=self.lines.get(timeout=900)
                if line is None:
                    raise RuntimeError('Hayai worker closed; see OCR server logs')
                result=json.loads(line)
                if not result.get('ok'):
                    raise RuntimeError(result.get('error','Hayai failed'))
                return str(result['text']).strip()
            except Exception:
                if self.proc is not None and self.proc.poll() is not None:
                    self.proc = None
                raise
