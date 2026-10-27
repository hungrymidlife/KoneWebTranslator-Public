import argparse, hashlib, json, os, shutil, tempfile, urllib.request, zipfile
from pathlib import Path

ROOT = Path(r'C:\AI\Gemma4MTP') if os.name == 'nt' else Path('/tmp/Gemma4MTP')
REPO = 'HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced'
MAIN = 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf'
MAIN_SHA = '59656d7494d6376ca97e9e20b64ea2e16cd97f12ec6d47bfccba91cb785b5134'
MTP = 'mtp-gemma-4-12B-it.gguf'
HEADERS = {'User-Agent':'KoneWebTranslator-Installer/1.1'}

def request(url):
    return urllib.request.Request(url, headers=HEADERS)

def download(url, target, sha=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size > 1024:
        if not sha or file_hash(target) == sha:
            print('[SKIP] Already present:', target, flush=True); return
        raise RuntimeError('Existing file hash mismatch; refusing to overwrite: '+str(target))
    part = target.with_name(target.name+'.part')
    if part.exists(): part.unlink()
    print('[GET]',url, flush=True)
    try:
        with urllib.request.urlopen(request(url),timeout=90) as response, part.open('wb') as out:
            total=int(response.headers.get('Content-Length','0'))
            received=0
            while True:
                block=response.read(1024*1024)
                if not block: break
                out.write(block); received+=len(block)
                if received % (128*1024*1024) < len(block): print(f'  {received/1024**3:.2f} GiB'+(f' / {total/1024**3:.2f} GiB' if total else ''),flush=True)
        if part.stat().st_size < 1024: raise RuntimeError('Downloaded file is too small')
        if sha and file_hash(part) != sha: raise RuntimeError('SHA256 mismatch for '+str(target))
        part.replace(target)
    except Exception:
        part.unlink(missing_ok=True)
        raise
    print('[OK]',target,flush=True)

def file_hash(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''): h.update(b)
    return h.hexdigest()

def github_release_assets():
    url='https://api.github.com/repos/ggml-org/llama.cpp/releases/latest'
    with urllib.request.urlopen(request(url),timeout=30) as f: data=json.load(f)
    return data['tag_name'],data['assets']

def install_llama():
    dest=ROOT/'llama-bin'/'llama-server.exe'
    if dest.exists(): print('[SKIP] llama-server already installed:',dest); return
    tag,assets=github_release_assets()
    def find(pattern):
        matches=[a for a in assets if pattern(a['name'].lower())]
        if len(matches)!=1: raise RuntimeError('Could not unambiguously find llama.cpp Windows CUDA 12 assets for '+tag+': '+str([a['name'] for a in matches]))
        return matches[0]
    main=find(lambda n:n.endswith('.zip') and 'win' in n and 'cuda' in n and ('12.4' in n or 'cu12' in n) and 'cudart' not in n)
    # llama.cpp Windows CUDA packages commonly ship a separate cudart archive.
    cuda=[a for a in assets if a['name'].lower().endswith('.zip') and 'cudart' in a['name'].lower() and ('12.4' in a['name'] or '12' in a['name'])]
    archives=[main]+cuda[:1]
    with tempfile.TemporaryDirectory() as tmp:
        tmp=Path(tmp)
        staging=tmp/'bin';staging.mkdir()
        for a in archives:
            z=tmp/a['name'];download(a['browser_download_url'],z)
            with zipfile.ZipFile(z) as arc:
                for member in arc.infolist():
                    if member.is_dir():continue
                    name=Path(member.filename).name
                    if not name or not name.lower().endswith(('.exe','.dll')):continue
                    with arc.open(member) as src, (staging/name).open('wb') as dst:shutil.copyfileobj(src,dst)
        if not (staging/'llama-server.exe').exists():raise RuntimeError('llama-server.exe not found in release ZIP')
        (ROOT/'llama-bin').mkdir(parents=True,exist_ok=True)
        for f in staging.iterdir():shutil.copy2(f,ROOT/'llama-bin'/f.name)
    print('[OK] llama.cpp',tag)

def main():
    p=argparse.ArgumentParser();p.add_argument('--mtp',action='store_true');p.add_argument('--check',action='store_true');a=p.parse_args()
    model=ROOT/'models'/MAIN
    server=ROOT/'llama-bin'/'llama-server.exe'
    if a.check:
        print('Install root:',ROOT)
        print('llama-server:',server.exists())
        print('Main GGUF:',model.exists())
        print('Main SHA256:',file_hash(model)==MAIN_SHA if model.exists() else False)
        print('MTP:',(ROOT/'models'/MTP).exists())
        if not server.exists() or not model.exists() or file_hash(model)!=MAIN_SHA:raise SystemExit(1)
        return
    print('Installation root:',ROOT)
    print('Main GGUF: ~7.4 GB; Windows NVIDIA CUDA 12 llama.cpp release')
    install_llama()
    download(f'https://huggingface.co/{REPO}/resolve/main/{MAIN}',model,MAIN_SHA)
    if a.mtp:download(f'https://huggingface.co/{REPO}/resolve/main/{MTP}',ROOT/'models'/MTP)
    print('[OK] Gemma installation complete. Run RUN_GEMMA.bat from the project root.')

if __name__=='__main__':
    try:main()
    except Exception as e:
        print('[ERROR]',type(e).__name__,str(e),flush=True)
        raise SystemExit(1)
