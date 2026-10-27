from pathlib import Path
import hashlib, urllib.request, os, sys
ROOT=Path(__file__).resolve().parent
TARGET=ROOT/'local-server'/'models'/'comictextdetector.pt.onnx'
URL='https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx'
SHA256='1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f'
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def main():
    TARGET.parent.mkdir(parents=True,exist_ok=True)
    if TARGET.exists():
        if digest(TARGET)==SHA256:
            print('[OK] Model already present and verified:',TARGET);return
        raise RuntimeError('Existing model has unexpected SHA-256. Refusing to overwrite: '+str(TARGET))
    temp=TARGET.with_suffix(TARGET.suffix+'.part')
    if temp.exists(): temp.unlink()
    try:
        req=urllib.request.Request(URL,headers={'User-Agent':'KoneWebTranslator-Model-Installer/1.0'})
        with urllib.request.urlopen(req,timeout=90) as response,temp.open('wb') as output:
            total=int(response.headers.get('Content-Length','0'))
            done=0
            while True:
                chunk=response.read(1024*1024)
                if not chunk: break
                output.write(chunk);done+=len(chunk)
                if total: print(f'\rDownloading: {done*100//total}% ({done//1048576} MiB)',end='',flush=True)
        print()
        if digest(temp)!=SHA256: raise RuntimeError('SHA-256 mismatch. Download discarded.')
        os.replace(temp,TARGET)
        print('[OK] Verified model:',TARGET)
    finally:
        if temp.exists(): temp.unlink()
if __name__=='__main__':
    try: main()
    except Exception as exc: print('[ERROR]',exc,file=sys.stderr);sys.exit(1)
