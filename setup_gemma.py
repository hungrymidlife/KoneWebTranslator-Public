import argparse, hashlib, http.client, json, os, re, shutil, tempfile, time, urllib.error, urllib.request, zipfile
from pathlib import Path

ROOT = Path(r'C:\AI\Gemma4MTP') if os.name == 'nt' else Path('/tmp/Gemma4MTP')
REPO = 'HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced'
MAIN = 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf'
MAIN_SHA = '59656d7494d6376ca97e9e20b64ea2e16cd97f12ec6d47bfccba91cb785b5134'
MTP = 'mtp-gemma-4-12B-it.gguf'
HEADERS = {'User-Agent':'KoneWebTranslator-Installer/1.1'}

def request(url, headers=None):
    return urllib.request.Request(url, headers={**HEADERS, **(headers or {})})


def _time_left(seconds):
    if seconds is None or seconds < 0:
        return '--'
    seconds = int(seconds)
    if seconds >= 3600:
        return f'{seconds // 3600}h {(seconds % 3600) // 60}m'
    if seconds >= 60:
        return f'{seconds // 60}m {seconds % 60}s'
    return f'{seconds}s'


def _progress(received, total, start_time, start_bytes, label):
    elapsed = max(time.monotonic() - start_time, 0.001)
    speed = max(received - start_bytes, 0) / elapsed / (1024 ** 2)
    pct = f'{received / total * 100:.1f}%' if total else 'unknown%'
    size = f'{received / 1024 ** 3:.2f}' + (f'/{total / 1024 ** 3:.2f} GiB' if total else ' GiB')
    eta = (total - received) / (speed * 1024 ** 2) if total and speed > 0.01 else None
    print(f'[PROGRESS] {label} | {pct} | {size} | {speed:.2f} MiB/s | ETA {_time_left(eta)}', flush=True)


def download(url, target, sha=None):
    """Streaming download with visible throughput and safe HTTP Range resume.

    Partial downloads remain as *.part on network failure so the next attempt
    can resume. A server that ignores Range forces a clean restart, never an
    append to the full response. Final SHA256 verification is unchanged.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size > 1024:
        if not sha or file_hash(target) == sha:
            print('[SKIP] Already present:', target, flush=True)
            return
        raise RuntimeError('Existing file hash mismatch; refusing to overwrite: ' + str(target))
    part = target.with_name(target.name + '.part')
    label = target.name
    print('[GET]', url, flush=True)
    last_error = None
    for attempt in range(1, 4):
        offset = part.stat().st_size if part.is_file() else 0
        headers = {'Range': f'bytes={offset}-'} if offset else {}
        if offset:
            print(f'[RESUME] {label}: {offset / 1024 ** 3:.2f} GiB already downloaded', flush=True)
        try:
            with urllib.request.urlopen(request(url, headers), timeout=90) as response:
                status = response.getcode()
                if offset and status == 206:
                    content_range = str(response.headers.get('Content-Range', ''))
                    match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+|\*)', content_range)
                    if not match or int(match.group(1)) != offset:
                        raise RuntimeError('Server returned invalid Content-Range: ' + content_range)
                    total = int(match.group(3)) if match.group(3) != '*' else 0
                    mode = 'ab'
                elif status == 200:
                    if offset:
                        print('[INFO] Server does not support resume; restarting this file from zero.', flush=True)
                    offset = 0
                    total = int(response.headers.get('Content-Length', '0'))
                    mode = 'wb'
                elif status == 206:
                    raise RuntimeError('Unexpected partial response without a Range request')
                else:
                    raise RuntimeError(f'Unexpected download HTTP status: {status}')
                if not total:
                    length = int(response.headers.get('Content-Length', '0'))
                    total = offset + length if length else 0
                received = offset
                started = time.monotonic()
                last_report = started
                _progress(received, total, started, offset, label)
                with part.open(mode) as out:
                    while True:
                        block = response.read(1024 * 1024)
                        if not block:
                            break
                        out.write(block)
                        received += len(block)
                        now = time.monotonic()
                        if now - last_report >= 3.0 or (total and received == total):
                            _progress(received, total, started, offset, label)
                            last_report = now
                if total and received != total:
                    raise OSError(f'Incomplete download: {received}/{total} bytes')
            if part.stat().st_size < 1024:
                raise RuntimeError('Downloaded file is too small')
            if sha:
                print('[VERIFY] SHA256 checking:', label, flush=True)
                if file_hash(part) != sha:
                    part.unlink(missing_ok=True)
                    raise RuntimeError('SHA256 mismatch for ' + str(target) + '; corrupt .part deleted')
            part.replace(target)
            print('[OK]', target, flush=True)
            return
        except urllib.error.HTTPError as exc:
            if exc.code not in (408, 416, 429, 500, 502, 503, 504):
                raise
            if exc.code == 416:
                # A fully downloaded .part may have survived a crash before rename.
                size_header = str(exc.headers.get('Content-Range', ''))
                full = re.fullmatch(r'bytes \*/(\d+)', size_header)
                if full and part.is_file() and part.stat().st_size == int(full.group(1)):
                    print('[VERIFY] Completed partial file found; checking SHA256:', label, flush=True)
                    if sha and file_hash(part) != sha:
                        part.unlink(missing_ok=True)
                        raise RuntimeError('SHA256 mismatch for ' + str(target))
                    part.replace(target)
                    print('[OK]', target, flush=True)
                    return
                part.unlink(missing_ok=True)
            last_error = exc
        except (urllib.error.URLError, TimeoutError, OSError, http.client.IncompleteRead) as exc:
            last_error = exc
        if attempt < 3:
            print(f'[RETRY] {label}: attempt {attempt}/3 failed ({last_error}); '
                  'retaining partial file when possible.', flush=True)
            time.sleep(min(attempt * 2, 5))
    raise RuntimeError(f'Download failed after 3 attempts; partial file kept at {part}: {last_error}')

def file_hash(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''): h.update(b)
    return h.hexdigest()

def github_release_assets():
    """Find a *real* official Windows x64 CUDA 12.4 build.

    GitHub /releases/latest may point to a version tag (e.g. v0.7.0)
    containing no Windows binaries. Search release pages for a complete
    main + CUDA-runtime pair instead of assuming that tag is installable.
    """
    main_pattern = re.compile(r'llama-(?:b[0-9]+|v[0-9]+(?:\.[0-9]+)+)-bin-win-cuda-12\.4-x64\.zip', re.I)
    cudart_name = 'cudart-llama-bin-win-cuda-12.4-x64.zip'
    checked = []
    for page in range(1, 4):
        url = f'https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30&page={page}'
        with urllib.request.urlopen(request(url), timeout=45) as f:
            releases = json.load(f)
        if not isinstance(releases, list):
            raise RuntimeError('GitHub release API did not return a release list (possibly rate limited).')
        if not releases:
            break
        for release in releases:
            if not isinstance(release, dict) or release.get('draft'):
                continue
            tag = str(release.get('tag_name', ''))
            assets = release.get('assets') or []
            mains = [a for a in assets if isinstance(a, dict) and
                     main_pattern.fullmatch(str(a.get('name', '')))]
            runtimes = [a for a in assets if isinstance(a, dict) and
                        str(a.get('name', '')).lower() == cudart_name]
            if len(mains) != 1 or len(runtimes) != 1:
                checked.append(tag)
                continue
            selected = [mains[0], runtimes[0]]
            prefix = 'https://github.com/ggml-org/llama.cpp/releases/download/'
            if any(not str(a.get('browser_download_url', '')).startswith(prefix)
                   for a in selected):
                raise RuntimeError('Unexpected download URL in official llama.cpp release: ' + tag)
            print('[INFO] Selected official llama.cpp release:', tag, flush=True)
            for asset in selected:
                print('[INFO] Asset:', asset['name'], flush=True)
            return tag, selected
    raise RuntimeError('No complete Windows x64 CUDA 12.4 llama.cpp binaries found '
                       'in the latest 90 official releases. Checked tags: ' +
                       ', '.join(checked[:12]))


def asset_sha256(asset):
    """Use GitHub's published asset checksum where available."""
    digest = str(asset.get('digest') or '')
    if not digest:
        return None
    if not re.fullmatch(r'sha256:[0-9a-fA-F]{64}', digest):
        raise RuntimeError('Unsupported or invalid GitHub asset digest: ' + str(asset.get('name')))
    return digest[7:].lower()

def install_llama():
    dest=ROOT/'llama-bin'/'llama-server.exe'
    if dest.exists(): print('[SKIP] llama-server already installed:',dest); return
    tag,archives=github_release_assets()
    with tempfile.TemporaryDirectory() as tmp:
        tmp=Path(tmp)
        staging=tmp/'bin';staging.mkdir()
        for a in archives:
            z=tmp/a['name'];download(a['browser_download_url'],z,asset_sha256(a))
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
