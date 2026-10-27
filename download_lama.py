from pathlib import Path
from urllib.request import Request, urlopen
import hashlib, os, sys

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'local-trans' / 'models' / 'big-lama.pt'
PART = DEST.with_suffix('.pt.part')
URL = 'https://huggingface.co/signature-ai/big-lama/resolve/main/big-lama.pt'
EXPECTED = '344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9'

def sha256(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def main():
    DEST.parent.mkdir(parents=True, exist_ok=True)
    if DEST.exists():
        if sha256(DEST)==EXPECTED:
            print('[OK] LaMa model already verified:',DEST);return
        raise RuntimeError('Existing big-lama.pt does not match expected SHA-256; refusing overwrite: '+str(DEST))
    if PART.exists():PART.unlink()
    print('[INFO] Downloading LaMa from:',URL,flush=True)
    try:
        req=Request(URL,headers={'User-Agent':'KoneWebTranslator-model-installer/1.0'})
        with urlopen(req,timeout=90) as response, PART.open('wb') as out:
            while True:
                data=response.read(1024*1024)
                if not data:break
                out.write(data)
        digest=sha256(PART)
        if digest!=EXPECTED:raise RuntimeError('SHA-256 mismatch: '+digest)
        os.replace(PART,DEST)
        print('[OK] Verified LaMa model:',DEST)
    finally:
        if PART.exists():PART.unlink()

if __name__=='__main__':
    try:main()
    except Exception as e:print('[ERROR]',e,file=sys.stderr);sys.exit(1)
