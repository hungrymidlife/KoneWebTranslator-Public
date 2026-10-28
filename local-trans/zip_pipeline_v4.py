"""KWT_ZIP_CONTINUOUS_STREAM_V4_0.

Binary ZIP -> existing V3.1 ordered stream -> continuous OCR/Gemma -> bounded
LaMa / CPU-encoding pipeline -> single ordered ZIP writer.
The original zip_pipeline.process_zip remains available as a fallback.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import threading
import time
import urllib.parse
import urllib.request
import uuid
import zipfile

from PIL import Image

HERE = Path(__file__).resolve().parent
CONFIG = HERE / 'zip_pipeline_v4_settings.json'
API = 'http://127.0.0.1:8765'
MARKER = 'KWT_ZIP_CONTINUOUS_STREAM_V4_0'
MAX_IMAGE = 18 * 1024 * 1024
MAX_PIXELS = 35_000_000
STREAM_LIMIT = 100
DONE = {'completed', 'completed_with_errors', 'failed'}
DEFAULTS = {
    'schema_version': 1,
    'enabled': True,
    'overlap_lama_with_ai': True,
    'encode_workers': 2,
    'max_inflight_pages': 4,
    'poll_interval_seconds': 0.35,
}


def load_settings():
    if CONFIG.is_file():
        value = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
    else:
        value = DEFAULTS.copy()
    if not isinstance(value, dict) or set(value) != set(DEFAULTS) or value.get('schema_version') != 1:
        raise ValueError('ZIP V4 설정 형식이 잘못되었습니다')
    for key in ('enabled', 'overlap_lama_with_ai'):
        if type(value[key]) is not bool:
            raise ValueError('ZIP V4 설정은 true/false가 필요합니다: ' + key)
    for key, lo, hi in [('encode_workers', 1, 4), ('max_inflight_pages', 2, 8)]:
        if type(value[key]) is not int or not lo <= value[key] <= hi:
            raise ValueError(f'ZIP V4 설정 {key}: {lo}~{hi}')
    pause = value['poll_interval_seconds']
    if isinstance(pause, bool) or not isinstance(pause, (int, float)) or not 0.15 <= pause <= 2:
        raise ValueError('ZIP V4 polling 설정: 0.15~2초')
    return dict(value)


def _http(path, payload=None, *, raw=None, timeout=45):
    if raw is not None and payload is not None:
        raise ValueError('payload와 raw를 동시에 전달할 수 없습니다')
    data = raw if raw is not None else (json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None)
    headers = {'Content-Type': 'application/octet-stream' if raw is not None else 'application/json'} if data is not None else {}
    req = urllib.request.Request(API + path, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)


def _send_json(path, payload=None, timeout=45):
    return _http(path, payload, timeout=timeout)


def _send_binary(path, data, timeout=120):
    return _http(path, raw=data, timeout=timeout)


def _abort(job_id):
    try:
        _send_json('/api/v1/images/stream/abort', {'job_id': job_id}, timeout=5)
    except Exception:
        pass


def _chunked(items, count):
    for pos in range(0, len(items), count):
        yield pos, items[pos:pos + count]


def _upload(source, chunk, job_id, cancelled):
    """Separate thread; bounded by the server's 3-item queue. No Base64 copies."""
    with zipfile.ZipFile(source, 'r') as zin:
        for local, info in enumerate(chunk):
            if cancelled():
                raise InterruptedError('ZIP 작업이 취소되었습니다')
            try:
                if info.file_size > MAX_IMAGE:
                    raise ValueError('Image exceeds 18MB limit')
                raw = zin.read(info)
                if not raw or len(raw) > MAX_IMAGE:
                    raise ValueError('Empty or oversized image')
                # Match legacy file validation, including protection against
                # absurd dimensions before handing the page to the OCR worker.
                with Image.open(io.BytesIO(raw)) as im:
                    im.verify()
                with Image.open(io.BytesIO(raw)) as im:
                    if im.width * im.height > MAX_PIXELS:
                        raise ValueError('Image exceeds pixel limit')
            except Exception as exc:
                _send_json('/api/v1/images/stream/fail', {
                    'job_id': job_id, 'index': local,
                    'error': f'{type(exc).__name__}: {exc}'[:450],
                }, timeout=120)
                continue
            # Send exactly the input bytes as HTTP request body. Stream indexes
            # are local to one <=100-page server job.
            _send_binary('/api/v1/images/stream/item?job_id=' + job_id + '&index=' + str(local), raw)
    return True


def _render(source, info, global_index, page, target, render_cfg, text_color_mode, cancelled, progress, report, total):
    if cancelled():
        raise InterruptedError('ZIP 작업이 취소되었습니다')
    # Import lazily so the legacy pipeline and its module initialization remain
    # untouched. zip_pipeline has already been imported by Studio.
    from zip_pipeline import typeset
    with zipfile.ZipFile(source, 'r') as zin:
        raw = zin.read(info)
    if not raw or len(raw) > MAX_IMAGE:
        raise ValueError('Image size invalid during rendering')
    if page is None or page.get('error'):
        raise RuntimeError((page or {}).get('error') or 'OCR result missing')
    regions = page.get('texts') or []
    if not isinstance(regions, list):
        raise RuntimeError('OCR regions invalid')
    if cancelled():
        raise InterruptedError('ZIP 작업이 취소되었습니다')
    progress(stage='한국어 식질 중', page=global_index + 1, total=total, name=info.filename,
             image=raw, image_kind='source', detail=f'{global_index + 1}/{total}')
    cache_dir = Path(str(target) + '.layers') / f'page_{global_index+1:04d}'
    render_started = time.monotonic()
    im, placements, inpaint_meta = typeset(raw, regions, report, text_color_mode=text_color_mode,
                                           cache_dir=cache_dir, render_cfg=render_cfg)
    inpaint_meta['cache_path'] = str(cache_dir)
    return {'image': im, 'regions': regions, 'placements': placements,
            'inpainting': inpaint_meta, 'sha256': hashlib.sha256(raw).hexdigest(),
            'width': im.width, 'height': im.height,
            'render_seconds': round(time.monotonic() - render_started, 4),
            'translation_incomplete': any(r.get('text') and not str(r.get('translated_text') or '').strip()
                                          for r in regions)}


def _encode_after_render(render_future, suffix, quality):
    """CPU-side Pillow encoder; runs independently from the single LaMa worker."""
    result = render_future.result()
    im = result.pop('image')
    try:
        encode_started = time.monotonic()
        fmt = 'JPEG' if suffix in ('.jpg', '.jpeg') else 'PNG' if suffix == '.png' else 'WEBP'
        buf = io.BytesIO()
        if fmt == 'PNG':
            im.save(buf, format=fmt)
        else:
            im.save(buf, format=fmt, quality=quality)
        result['data'] = buf.getvalue()
        result['encoding_seconds'] = round(time.monotonic() - encode_started, 4)
        return result
    finally:
        im.close()


def process_zip_continuous(source, output_dir, report=lambda *args: None, cancelled=lambda: False,
                           progress=None, text_color_mode='auto'):
    if text_color_mode not in ('auto', 'black', 'white'):
        raise ValueError('Invalid text color mode')
    from zip_pipeline import entries, load_render_settings, _kwt_batch_snapshot
    settings = load_settings()
    progress = progress or (lambda **kw: None)
    source = Path(source).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / (source.stem + '_ko.zip')
    metadata_path = output_dir / (source.stem + '_ko.metadata.json')
    if source in (target, metadata_path):
        raise ValueError('Output path must differ from source')
    if target.exists() or metadata_path.exists():
        raise FileExistsError(f'Output exists; refusing overwrite: {target}')
    temp_target = target.with_suffix('.zip.part')
    render_cfg = load_render_settings()
    batch_pages, batch_raw_bytes = _kwt_batch_snapshot()  # metadata compatibility
    with zipfile.ZipFile(source, 'r') as zin:
        pages = entries(zin)
    if not pages:
        raise ValueError('No supported images in ZIP')
    total = len(pages)
    # All task results flow to a single ordered ZIP writer. Bounded in-flight
    # slots prevent unbounded decoded images / Pillow buffers in memory.
    limit = settings['max_inflight_pages']
    slots = threading.BoundedSemaphore(limit)
    cv = threading.Condition()
    enc_futures = {}
    metadata = [None] * total
    stop = threading.Event()
    producer_error = [None]
    current_job = [None]
    stats = {'ocr': 0, 'translation': 0, 'written': 0}
    started = time.monotonic()

    def is_cancelled():
        return stop.is_set() or cancelled()

    def monitor(render_pool, encode_pool, upload_pool):
        """Submit pages as soon as Gemma marks them translated, not at batch boundaries."""
        try:
            deferred = []  # AI-priority mode delays GPU LaMa until all OCR/Gemma work is done.
            for offset, chunk in _chunked(pages, STREAM_LIMIT):
                if is_cancelled():
                    raise InterruptedError('ZIP 작업이 취소되었습니다')
                unique = uuid.uuid4().hex
                # The existing V3.1 endpoint validates HTTP(S) identifiers but
                # never fetches these URLs. ZIP entry names remain in metadata.
                urls = [f'https://kwt-zip.invalid/{unique}/{offset + i}' for i in range(len(chunk))]
                payload = {'source_url': 'local-zip:' + source.name + ':' + unique,
                           'selector': '', 'image_urls': urls}
                started_job = _send_json('/api/v1/images/stream/start', payload, timeout=45)
                job_id = started_job['job_id']
                current_job[0] = job_id
                upload_future = upload_pool.submit(_upload, source, chunk, job_id, is_cancelled)
                next_local = 0
                last_status = (-1, -1)
                deadline = time.monotonic() + max(900, 120 * len(chunk))
                while next_local < len(chunk):
                    if is_cancelled():
                        raise InterruptedError('ZIP 작업이 취소되었습니다')
                    if upload_future.done():
                        upload_future.result()  # surface a failed upload immediately
                    if time.monotonic() > deadline:
                        raise TimeoutError('ZIP V4 OCR/translation timeout: ' + job_id)
                    job = _send_json('/api/v1/jobs/' + job_id, timeout=35)
                    if job.get('status') == 'failed':
                        raise RuntimeError(job.get('error') or 'ZIP V4 OCR job failed')
                    ocr_count = int(job.get('completed') or 0)
                    trans_count = int(job.get('translation_completed') or 0)
                    if (ocr_count, trans_count) != last_status:
                        last_status = (ocr_count, trans_count)
                        stats['ocr'] = offset + min(ocr_count, len(chunk))
                        stats['translation'] = offset + min(trans_count, len(chunk))
                        progress(stage='OCR / Gemma 연속 처리', page=min(total, offset + ocr_count), total=total,
                                 detail=f'OCR {stats["ocr"]}/{total} | 번역 {stats["translation"]}/{total} | 저장 {stats["written"]}/{total}')
                    by_index = {r.get('index'): r for r in job.get('results', [])}
                    all_done = job.get('status') in DONE and job.get('translation_status') in DONE
                    while next_local < len(chunk):
                        page = by_index.get(next_local)
                        if page is None:
                            if all_done:
                                page = {'error': 'Missing OCR result', 'texts': []}
                            else:
                                break
                        if not all_done and not (page.get('translation_timing') or {}).get('finished_at'):
                            break
                        index = offset + next_local
                        info = chunk[next_local]
                        if not settings['overlap_lama_with_ai']:
                            deferred.append((index, info, dict(page), job_id))
                        else:
                            while not slots.acquire(timeout=0.25):
                                if is_cancelled():
                                    raise InterruptedError('ZIP 작업이 취소되었습니다')
                            rf = render_pool.submit(_render, source, info, index, page, target,
                                                    render_cfg, text_color_mode, is_cancelled, progress, report, total)
                            ef = encode_pool.submit(_encode_after_render, rf, Path(info.filename).suffix.lower(),
                                                    render_cfg['output_image_quality'])
                            with cv:
                                enc_futures[index] = (ef, job_id)
                                cv.notify_all()
                        next_local += 1
                    if next_local < len(chunk):
                        time.sleep(settings['poll_interval_seconds'])
                upload_future.result()
                current_job[0] = None
            # In AI-priority mode the full OCR/Gemma pass finishes before GPU
            # LaMa starts; CPU encoding still overlaps successive LaMa renders.
            for index, info, page, job_id in deferred:
                while not slots.acquire(timeout=0.25):
                    if is_cancelled():
                        raise InterruptedError('ZIP 작업이 취소되었습니다')
                rf = render_pool.submit(_render, source, info, index, page, target,
                                        render_cfg, text_color_mode, is_cancelled, progress, report, total)
                ef = encode_pool.submit(_encode_after_render, rf, Path(info.filename).suffix.lower(),
                                        render_cfg['output_image_quality'])
                with cv:
                    enc_futures[index] = (ef, job_id)
                    cv.notify_all()
            return True
        except BaseException as exc:
            stop.set()
            if current_job[0]:
                _abort(current_job[0])
            with cv:
                producer_error[0] = exc
                cv.notify_all()
            raise

    progress(stage='시작', page=0, total=total,
             detail=f'연속 바이너리 OCR / 번역 / 식질 / 인코딩: {total}장')
    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix='kwt-v4-upload') as upload_pool, \
             ThreadPoolExecutor(max_workers=1, thread_name_prefix='kwt-v4-lama') as render_pool, \
             ThreadPoolExecutor(max_workers=settings['encode_workers'], thread_name_prefix='kwt-v4-encode') as encode_pool, \
             ThreadPoolExecutor(max_workers=1, thread_name_prefix='kwt-v4-monitor') as monitor_pool:
            monitor_future = monitor_pool.submit(monitor, render_pool, encode_pool, upload_pool)

            try:
                with zipfile.ZipFile(source, 'r') as zin, \
                     zipfile.ZipFile(temp_target, 'w', compression=zipfile.ZIP_DEFLATED,
                                     compresslevel=render_cfg['zip_compression_level']) as zout:
                    for i, info in enumerate(pages):
                        if cancelled():
                            stop.set()
                            if current_job[0]: _abort(current_job[0])
                            raise InterruptedError('User cancelled')
                        with cv:
                            while i not in enc_futures and producer_error[0] is None:
                                cv.wait(timeout=0.25)
                            if producer_error[0] is not None:
                                raise RuntimeError('ZIP V4 producer failed') from producer_error[0]
                            ef, job_id = enc_futures.pop(i)
                        rec = {'entry_name': info.filename, 'index': i, 'status': 'pending', 'job_id': job_id}
                        try:
                            data = ef.result()
                            rec.update(status='completed', regions=data['regions'],
                                       typesetting=data['placements'], inpainting=data['inpainting'],
                                       render_settings=render_cfg.copy(), width=data['width'], height=data['height'],
                                       sha256=data['sha256'])
                            if data['translation_incomplete']:
                                rec['translation_incomplete'] = True
                            raw_encoded = data['data']
                            zip_write_started = time.monotonic()
                            zout.writestr(info.filename, raw_encoded)
                            rec['performance_timing'] = {
                                'render_seconds': data['render_seconds'],
                                'encoding_seconds': data['encoding_seconds'],
                                'zip_write_seconds': round(time.monotonic() - zip_write_started, 4),
                            }
                            progress(stage='페이지 완료', page=i+1, total=total, name=info.filename,
                                     record=rec, image=raw_encoded, image_kind='result',
                                     detail=f'OCR {stats["ocr"]}/{total} | 번역 {stats["translation"]}/{total} | 저장 {i+1}/{total}')
                        except InterruptedError:
                            raise
                        except Exception as exc:
                            rec.update(status='failed', error=f'{type(exc).__name__}: {exc}')
                            raw_original = zin.read(info)
                            rec['sha256'] = hashlib.sha256(raw_original).hexdigest()
                            zout.writestr(info.filename, raw_original)
                            report(f'Page error: {info.filename} - {exc}')
                            progress(stage='페이지 오류 (원본 보존)', page=i+1, total=total,
                                     detail=f'{i+1}/{total}: {exc}')
                        finally:
                            metadata[i] = rec
                            stats['written'] = i + 1
                            slots.release()
                    monitor_future.result()
                    used = {p.filename for p in pages}
                    for info in zin.infolist():
                        name = info.filename.replace('\\', '/')
                        parts = name.split('/')
                        if (info.is_dir() or info.filename in used or name.startswith('/') or
                            any(p in ('', '.', '..') for p in parts) or ':' in parts[0]):
                            continue
                        if info.file_size > 64 * 1024 * 1024:
                            continue
                        zout.writestr(name, zin.read(info))
            finally:
                stop.set()
                if current_job[0]:
                    _abort(current_job[0])
        progress(stage='ZIP 검증 및 메타데이터 저장', page=total, total=total)
        with zipfile.ZipFile(temp_target) as check:
            bad = check.testzip()
            if bad is not None:
                raise RuntimeError('Output ZIP integrity verification failed: ' + bad)
        document = {
            'schema_version': 1, 'source_kind': 'zip', 'source_zip_name': source.name,
            'source_zip_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'images': metadata, 'typesetting_method': 'lama_tiled_v06',
            'pipeline': 'continuous_binary_v4_lama_tiled_v06',
            'batch_pages': batch_pages, 'batch_raw_mb': batch_raw_bytes // (1024 * 1024),
            'text_color_mode': text_color_mode,
            'continuous_stream': True, 'binary_transfer': True,
            'encoding_workers': settings['encode_workers'],
            'overlap_lama_with_ai': settings['overlap_lama_with_ai'],
            'elapsed_seconds': round(time.monotonic() - started, 3),
        }
        document['performance_totals'] = {
            key: round(sum((rec or {}).get('performance_timing', {}).get(key, 0) for rec in metadata), 3)
            for key in ('render_seconds', 'encoding_seconds', 'zip_write_seconds')
        }
        metadata_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding='utf-8')
        temp_target.replace(target)
        progress(stage='ZIP 저장 완료', page=total, total=total)
        return target, metadata_path
    except BaseException:
        stop.set()
        if current_job[0]:
            _abort(current_job[0])
        raise
    finally:
        if temp_target.exists():
            temp_target.unlink()
