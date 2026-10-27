import sys
import base64
import hashlib
import io
import json
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from PIL import Image, ImageOps, UnidentifiedImageError
import uvicorn

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
MAX_IMAGE_BYTES = 18 * 1024 * 1024
MAX_REQUEST_BYTES = 35 * 1024 * 1024
MAX_PIXELS = 35_000_000
MAX_BATCH = 100
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
app = FastAPI(title='KoneWebTranslator Local OCR', version='0.9.1')
from worker_runtime import worker_count  # KWT_UNIFIED_WORKERS_V1_2
executor = ThreadPoolExecutor(max_workers=worker_count('ocr_workers', 2), thread_name_prefix='kwt-ocr')
lock = threading.RLock()
jobs = {}
ocr_engine = None
ocr_lock = threading.Lock()
OCR_MODE_SETTINGS = ROOT / 'hayai_ocr_settings.json'
WINDOWS_OCR_THRESHOLD = 3  # advisory score; no automatic replacement

class ImageItem(BaseModel):
    index: int
    url: str = ''
    alt: str = ''
    mime_type: str = 'image/png'
    image_base64: str

class Batch(BaseModel):
    source_url: str = ''
    selector: str = ''
    images: list[ImageItem] = Field(min_length=1, max_length=MAX_BATCH)
    pad_x_percent: float = Field(default=12, ge=0, le=40)
    pad_y_percent: float = Field(default=8, ge=0, le=40)

@app.middleware('http')
async def local_only(request: Request, call_next):
    from fastapi.responses import JSONResponse
    host = request.headers.get('host', '').split(':')[0].strip('[]').lower()
    if host not in ('127.0.0.1', 'localhost', '::1'):
        return JSONResponse({'detail': 'Invalid Host'}, status_code=403)
    origin = request.headers.get('origin', '')
    if origin and not (re.fullmatch(r'chrome-extension://[a-p]{32}', origin) or origin in ('http://127.0.0.1:8765','http://localhost:8765')):
        return JSONResponse({'detail': 'Origin not allowed'}, status_code=403)
    response = await call_next(request)
    if origin.startswith('chrome-extension://'):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    return response

@app.options('/{path:path}')
async def preflight(path: str):
    return {'ok': True}

@app.get('/health')
def health():
    return {'ok': True, 'service': 'KoneWebTranslator Local OCR', 'ocr_engine': current_ocr_settings()['mode'], 'engine_loaded': ocr_engine is not None, 'version': '0.9.1'}


# KWT_OCR_SAFE_LOG_V1

# KWT_LOG_V1_2_2: force UTF-8 at the producer; do not touch OCR return values.
def _kwt_configure_log_streams():
    for _stream in (sys.stdout, sys.stderr):
        if hasattr(_stream, 'reconfigure'):
            try:
                _stream.reconfigure(encoding='utf-8', errors='backslashreplace', write_through=True)
            except (OSError, ValueError, TypeError):
                pass

_kwt_configure_log_streams()

def safe_ocr_print(*args, **kwargs):
    """Do not abort OCR when the Windows console cannot encode Japanese text."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        # Retain full information in ASCII Unicode escapes, even with CP949 stdout.
        message = ' '.join(str(value) for value in args)
        escaped = message.encode('ascii', errors='backslashreplace').decode('ascii')
        try:
            print(escaped, flush=True)
        except (UnicodeError, OSError):
            pass
    except (BrokenPipeError, OSError):
        # Logging is best effort. Recognition results must not be discarded.
        pass

def current_ocr_settings():
    # Read for each NEW job: no server restart required for a mode change.
    try:
        cfg = json.loads(OCR_MODE_SETTINGS.read_text(encoding='utf-8'))
        mode = str(cfg.get('mode', 'hayai'))
        patches = int(cfg.get('patches', 384))
        if mode != 'hayai' or patches not in (256, 384, 512):
            raise ValueError('Invalid OCR settings')
        return {'mode': mode, 'patches': patches}
    except (OSError, ValueError, TypeError, AttributeError):
        return {'mode': 'hayai', 'patches': 384}


def ocr_identity(cfg):
    return 'hayai-v2.5-nova-%s-%s' % (cfg['mode'], cfg['patches'])


def process_job(job_id, items, pad_x_percent, pad_y_percent):
    with lock:
        jobs[job_id]['status'] = 'running'
    outputs = []
    try:
        # Fail fast before processing the entire batch if either model cannot initialize.
        from detector_bridge import detect_regions
        from detector_bridge import MODEL
        if not MODEL.is_file():
            raise RuntimeError('Detector ONNX model missing. Run setup_detector.bat')
        cfg = jobs[job_id].get('ocr_settings', {'mode':'hayai', 'patches':384})
        from hayai_bridge import get_hayai_bridge
        hayai = get_hayai_bridge(ROOT)
        # Initialize detector using the first valid page below.
    except Exception as exc:
        with lock:
            jobs[job_id]['status'] = 'failed'
            jobs[job_id]['error'] = f'{type(exc).__name__}: {exc}'
        return

    # KWT_PAGE_STREAM_V1: start progress counters before processing images.
    with lock:
        jobs[job_id].update(translation_status='running', translation_completed=0, translation_errors=0, translation_ocr_done=False)
    for item in items:
        try:
            with Image.open(io.BytesIO(item['data'])) as opened:
                im = ImageOps.exif_transpose(opened).convert('RGB')
                width, height = im.size
                # KWT_UNIFIED_WORKERS_V1_2: detector lazy-init / shared ONNX session guard.
                with ocr_lock:
                    regions = detect_regions(im)
                texts = []
                for idx, reg in enumerate(regions, 1):
                    x1, y1 = max(0, reg.x), max(0, reg.y)
                    x2, y2 = min(width, reg.x + reg.width), min(height, reg.y + reg.height)
                    if x2 - x1 < 4 or y2 - y1 < 4:
                        continue
                    # OCR-only expansion; detector bbox remains unchanged.
                    # Percent is applied to EACH side of the detected region.
                    pad_x = max(0, round((x2-x1) * pad_x_percent / 100))
                    pad_y = max(0, round((y2-y1) * pad_y_percent / 100))
                    cx1, cy1 = max(0, x1-pad_x), max(0, y1-pad_y)
                    cx2, cy2 = min(width, x2+pad_x), min(height, y2+pad_y)
                    crop = im.crop((cx1, cy1, cx2, cy2))
                    hayai_text = ''
                    hayai_error = ''
                    if hayai is not None:
                        try:
                            hayai_text = hayai.recognize(crop, cfg['patches'])
                        except Exception as exc:
                            hayai_error = f'{type(exc).__name__}: {exc}'
                            raise
                    text = hayai_text
                    # Run conditional Windows OCR using Hayai text and status symbols.
                    # Detector box aspect ratio is deliberately ignored.
                    from windows_ocr import should_use_windows, recognize_windows
                    use_windows, reasons = should_use_windows(text, (x2-x1, y2-y1))
                    windows_result = {'status':'skipped','text':'','reason':'숫자+기호 합계 6개 미만'}
                    if use_windows:
                        windows_result = recognize_windows(crop)
                    windows_raw_text = str(windows_result.get('text') or '').strip()
                    horizontal_lines = windows_result.get('horizontal_lines') or []
                    windows_sorted_text = '\n'.join(str(line.get('text') or '') for line in horizontal_lines).strip()
                    # Reorder the selected Windows OCR output by horizontal word coordinates.
                    # If word geometry is unavailable, retain the raw result.
                    windows_text = windows_sorted_text or windows_raw_text
                    windows_ok = windows_result.get('status') == 'ok' and bool(windows_text)
                    selected_engine = 'windows' if use_windows and windows_ok else 'hayai'
                    final_text = windows_text if selected_engine == 'windows' else text
                    # Keep Japanese or alphanumeric OCR output; do not discard a valid
                    # Windows OCR result simply because it contains numbers and symbols.
                    if not has_translatable_text(final_text) and not (windows_ok and final_text):
                        continue
                    safe_ocr_print(f'[OCR] job={job_id} image={item["index"]} region={idx} '
                          f'box={x2-x1}x{y2-y1} ratio={(x2-x1)/max(1,y2-y1):.2f} '
                          f'windows_trigger={use_windows} reasons={reasons}',flush=True)
                    safe_ocr_print(f'[OCR][HAYAI] job={job_id} image={item["index"]} region={idx} text={text!r}',flush=True)
                    safe_ocr_print(f'[OCR][WINDOWS] job={job_id} image={item["index"]} region={idx} '
                          f'status={windows_result.get("status")} raw={windows_raw_text!r} sorted={windows_sorted_text!r} '
                          f'error={windows_result.get("error","")!r}',flush=True)
                    safe_ocr_print(f'[OCR][SELECTED] job={job_id} image={item["index"]} region={idx} '
                          f'engine={selected_engine} text={final_text!r}',flush=True)
                    texts.append({
                        'id': idx, 'text': final_text, 'hayai_ocr_text': hayai_text, 'hayai_ocr_error': hayai_error, 'hayai_patches': cfg['patches'] if hayai is not None else None, 'ocr_mode': cfg['mode'],
                        'windows_ocr': windows_result, 'windows_ocr_raw_text': windows_raw_text, 'windows_ocr_sorted_text': windows_sorted_text, 'windows_ocr_score': None,
                        'windows_ocr_reasons': reasons, 'selected_engine': selected_engine,
                        'confidence': None,  # Hayai OCR does not provide a calibrated confidence.
                        'detection_confidence': round(float(reg.confidence), 4),
                        'polygon': [[x1,y1],[x2,y1],[x2,y2],[x1,y2]],
                        'bbox': [x1, y1, x2-x1, y2-y1],
                        'ocr_crop_bbox': [cx1, cy1, cx2-cx1, cy2-cy1]
                    })
            result = {'index': item['index'], 'url': item['url'],
                      'sha256': item['sha256'], 'width': width, 'height': height,
                      'texts': texts, 'ocr_profile': ocr_identity(cfg), 'detection': 'comic_text_detector_onnx', 'secondary_ocr': 'windows-status-count-coordinate-v4'}
        except Exception as exc:
            result = {'index': item['index'], 'url': item['url'],
                      'sha256': item['sha256'], 'error': f'{type(exc).__name__}: {exc}', 'texts': []}
        outputs.append(result)
        with lock:
            jobs[job_id]['completed'] = len(outputs)
            jobs[job_id]['results'] = outputs.copy()
        # Submit this page to the independent Gemma translation queue immediately.
        from stream_translate import submit_page
        submit_page(job_id, item['index'], jobs, lock, persist_job_snapshot)
        # KWT_STREAM_DIAG_V2: record individual OCR completion, even while later images run.
        with lock:
            page=next((p for p in jobs[job_id]['results'] if p.get('index')==item['index']),None)
            if page is not None:
                page['ocr_finished_at']=datetime.now(timezone.utc).isoformat()
            jobs[job_id]['stream_revision']=int(jobs[job_id].get('stream_revision',0))+1
            jobs[job_id]['last_stream_event']={'type':'ocr','image_index':item['index'],'at':datetime.now(timezone.utc).isoformat()}
            print(f"[KWT_STREAM] ocr_done job={job_id} image={item['index']} rev={jobs[job_id]['stream_revision']}",flush=True)
        with lock:
            persist_job_snapshot(dict(jobs[job_id]))
    # Persist FINAL status as well as all OCR results; old code only updated RAM.
    with lock:
        current = jobs[job_id]
        current['status'] = 'completed' if all('error' not in r for r in outputs) else 'completed_with_errors'
        # KWT_UNIFIED_WORKERS_V1_2: persist under the shared job lock.
        persist_job_snapshot(dict(current))

    from stream_translate import complete_ocr
    complete_ocr(job_id, jobs, lock, persist_job_snapshot)

def persist_job_snapshot(job):
    # Atomic replacement prevents an interrupted write from corrupting OCR metadata.
    job_id = str(job['job_id'])
    if not re.fullmatch(r'[0-9a-f]{16}', job_id):
        raise ValueError('Invalid job ID')
    tmp = DATA / f'{job_id}.{uuid.uuid4().hex}.tmp'
    tmp.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(tmp, DATA / f'{job_id}.json')

def normalize_persisted_job(job):
    """Recover fully stored OCR snapshots written with status=running.

    Never assume a job is complete based on its ID or completed counter alone.
    Preserve original OCR regions and all other metadata fields.
    """
    if not isinstance(job, dict):
        return job, False
    if job.get('status') not in ('running','queued'):
        return job, False
    results = job.get('results')
    total = job.get('total')
    if not isinstance(total, int) or isinstance(total, bool) or total <= 0 or total > MAX_BATCH:
        return job, False
    if job.get('completed') != total or not isinstance(results, list) or len(results) != total:
        return job, False
    indices = [r.get('index') for r in results if isinstance(r, dict)]
    if len(indices) != total or set(indices) != set(range(total)):
        return job, False
    if any('texts' not in r or not isinstance(r['texts'], list) for r in results):
        return job, False
    recovered = dict(job)
    recovered['status'] = 'completed_with_errors' if any('error' in r for r in results) else 'completed'
    return recovered, True

def find_disk_job(job_id):
    if not re.fullmatch(r'[0-9a-f]{16}', str(job_id)):
        return None
    path = DATA / f'{job_id}.json'
    if not path.is_file():
        return None
    try:
        job = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if not isinstance(job, dict) or job.get('job_id') != job_id:
        return None
    normalized, changed = normalize_persisted_job(job)
    if changed:
        persist_job_snapshot(normalized)
    return normalized

def get_saved_or_memory_job(job_id):
    # The running in-memory job may be ahead of the last saved snapshot.
    live = jobs.get(job_id)
    if live:
        normalized, changed = normalize_persisted_job(live)
        if changed:
            jobs[job_id] = normalized
            persist_job_snapshot(normalized)
        return normalized
    saved = find_disk_job(job_id)
    if saved:
        jobs[job_id] = saved
    return saved

def has_translatable_text(value: str) -> bool:
    """Ignore punctuation, symbols, numbers and whitespace-only OCR results.

    Keep Japanese kana/kanji, Hangul and Latin letters (including fullwidth).
    """
    import unicodedata
    return any(unicodedata.category(ch).startswith('L') for ch in (value or ''))


def filter_ocr_texts(results):
    """Apply the same filter to fresh results and previously saved cache results."""
    for result in results:
        if isinstance(result, dict) and isinstance(result.get('texts'), list):
            result['texts'] = [t for t in result['texts'] if isinstance(t, dict) and has_translatable_text(t.get('text', ''))]
    return results


def find_cached_job(source_url: str, image_urls: list[str], pad_x_percent: float, pad_y_percent: float):
    # Match the entire chapter image list, not merely a chapter URL or count.
    # Old result files only contain job_id/results, so infer the page from image URLs.
    wanted = [str(u) for u in image_urls]
    if not wanted or len(wanted) > MAX_BATCH or len(set(wanted)) != len(wanted):
        return None
    with lock:
        active = list(jobs.values())
        active_count = len(active)
    for file in sorted(DATA.glob('*.json'), key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            record = json.loads(file.read_text(encoding='utf-8'))
            if not isinstance(record, dict) or not isinstance(record.get('results'), list):
                continue
            active.append(record)
        except (OSError, ValueError, TypeError):
            continue
    expected_profile = ocr_identity(current_ocr_settings())
    for job in list(reversed(active[:active_count])) + active[active_count:]:
        if job.get('ocr_profile', 'manga-v1') != expected_profile:
            continue
        results = job.get('results', [])
        if float(job.get('pad_x_percent', -1)) != pad_x_percent or float(job.get('pad_y_percent', -1)) != pad_y_percent:
            continue
        if job.get('source_url') and job['source_url'] != source_url:
            continue
        if len(results) != len(wanted) or any(r.get('error') for r in results):
            continue
        by_url = {r.get('url'): r for r in results}
        if len(by_url) != len(wanted) or set(by_url) != set(wanted):
            continue
        if any(not isinstance(r.get('texts'), list) or r.get('detection') != 'comic_text_detector_onnx' or r.get('secondary_ocr') != 'windows-status-count-coordinate-v4' for r in results):
            continue
        ordered = [dict(by_url[u], index=i) for i, u in enumerate(wanted)]
        return {**job, 'status':'completed', 'total':len(wanted), 'completed':len(wanted), 'source_url':source_url, 'results':ordered, 'cached':True}
    return None

class CacheLookup(BaseModel):
    source_url: str = ''
    image_urls: list[str] = Field(default_factory=list, max_length=MAX_BATCH)
    pad_x_percent: float = Field(default=12, ge=0, le=40)
    pad_y_percent: float = Field(default=8, ge=0, le=40)

@app.post('/api/v1/cache/lookup')
def cache_lookup(payload: CacheLookup):
    found = find_cached_job(payload.source_url, payload.image_urls, payload.pad_x_percent, payload.pad_y_percent)
    return {'found': found is not None, 'job': found}

@app.post('/api/v1/images/batch', status_code=202)
def batch_receive(payload: Batch):
    decoded = []
    for item in payload.images:
        try:
            if len(item.image_base64) > MAX_IMAGE_BYTES * 4 // 3 + 100:
                raise ValueError('Image exceeds size limit')
            data = base64.b64decode(item.image_base64, validate=True)
            if len(data) > MAX_IMAGE_BYTES:
                raise ValueError('Image exceeds size limit')
            with Image.open(io.BytesIO(data)) as im:
                im.verify()
            decoded.append({'index': item.index, 'url': item.url, 'data': data, 'sha256': hashlib.sha256(data).hexdigest()})
        except (ValueError, UnidentifiedImageError, OSError) as exc:
            raise HTTPException(422, f'Invalid image index {item.index}: {exc}') from exc
    job_id = uuid.uuid4().hex[:16]
    cfg = current_ocr_settings()
    with lock:
        jobs[job_id] = {'ocr_settings': cfg, 'ocr_profile': ocr_identity(cfg), 'job_id': job_id, 'status': 'queued', 'total': len(decoded), 'completed': 0, 'source_url': payload.source_url, 'selector': payload.selector, 'results': [], 'created_at': datetime.now(timezone.utc).isoformat(), 'output_dir': str(DATA.resolve()), 'pad_x_percent': payload.pad_x_percent, 'pad_y_percent': payload.pad_y_percent}
    executor.submit(process_job, job_id, decoded, payload.pad_x_percent, payload.pad_y_percent)
    return {'accepted': len(decoded), 'job_id': job_id, 'status': 'queued', 'status_url': f'/api/v1/jobs/{job_id}'}

class ManualWindowsOCR(BaseModel):
    job_id: str
    image_index: int
    region_id: int
    image_base64: str

@app.post('/api/v1/windows-ocr/region')
def manual_windows_ocr(payload: ManualWindowsOCR):
    # Manual Windows OCR: successful results become the selected text.
    if not re.fullmatch(r'[0-9a-f]{16}', payload.job_id):
        raise HTTPException(422, 'Invalid job ID')
    with lock:
        job = jobs.get(payload.job_id)
        if not job:
            raise HTTPException(404, 'Job not found (restart may have cleared memory)')
        if job.get('status') not in ('completed','completed_with_errors'):
            raise HTTPException(409, 'OCR job not complete')
        result = next((v for v in job['results'] if v.get('index') == payload.image_index), None)
        region = next((v for v in (result or {}).get('texts',[]) if v.get('id') == payload.region_id), None)
        if region is None:
            raise HTTPException(404, 'OCR region not found')
        expected_sha = result.get('sha256')
        crop_bbox = list(region.get('ocr_crop_bbox') or region['bbox'])
    if len(payload.image_base64) > MAX_IMAGE_BYTES * 4 // 3 + 100:
        raise HTTPException(413, 'Image too large')
    try:
        raw = base64.b64decode(payload.image_base64, validate=True)
        if len(raw) > MAX_IMAGE_BYTES or hashlib.sha256(raw).hexdigest() != expected_sha:
            raise ValueError('Image differs from original OCR image')
        with Image.open(io.BytesIO(raw)) as opened:
            im = ImageOps.exif_transpose(opened).convert('RGB')
            x,y,w,h = map(int,crop_bbox)
            if w < 1 or h < 1 or x < 0 or y < 0 or x+w > im.width or y+h > im.height:
                raise ValueError('Invalid OCR crop coordinates')
            crop = im.crop((x,y,x+w,y+h))
    except (ValueError, OSError, UnidentifiedImageError) as exc:
        raise HTTPException(422, str(exc)) from exc
    from windows_ocr import recognize_windows
    safe_ocr_print(f'[WINOCR][MANUAL] start job={payload.job_id} image={payload.image_index} region={payload.region_id}',flush=True)
    outcome = recognize_windows(crop)
    safe_ocr_print(f'[WINOCR][MANUAL] end job={payload.job_id} image={payload.image_index} region={payload.region_id} status={outcome.get("status")} text={outcome.get("text","")!r} error={outcome.get("error","")}',flush=True)
    with lock:
        region['windows_ocr'] = outcome
        if outcome.get('status') == 'ok' and str(outcome.get('text') or '').strip():
            region['text'] = str(outcome['text']).strip()
            region['selected_engine'] = 'windows'
        region['windows_ocr_manual'] = True
        record = {k:v for k,v in job.items() if k != 'results'}
        record['results'] = job['results']
        (DATA / f'{payload.job_id}.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'status':outcome.get('status'),'windows_ocr':outcome,'job_id':payload.job_id,'image_index':payload.image_index,'region_id':payload.region_id}


class TranslateJobRequest(BaseModel):
    job_id: str = Field(min_length=8, max_length=64, pattern=r'^[0-9a-f]+$')
    force: bool = False
    model: str | None = Field(default=None, max_length=100)
    local_url: str | None = Field(default=None, max_length=150)


class LocalTranslationCheck(BaseModel):
    model: str | None = Field(default=None, max_length=100)
    local_url: str | None = Field(default=None, max_length=150)


@app.post('/api/v1/translate/local/check')
def check_local_translation(payload: LocalTranslationCheck):
    """Check exact model availability and make one short real translation call."""
    from translation_llamacpp import (TranslationError, get_models, normalize_url,
                                      normalize_model, translate_regions)
    try:
        local_url = normalize_url(payload.local_url)
        model = normalize_model(payload.model)
        available = get_models(local_url)
        if model not in available:
            raise TranslationError(f'모델 {model}을 찾지 못했습니다. 사용 가능한 모델: {available}')
        output, meta = translate_regions([{'id':'test:1','text':'こんにちは！'}], model=model, base_url=local_url)
        return {'ok':True, 'model':meta['model'], 'base_url':local_url,
                'translation':output['test:1'], 'available_models':available}
    except TranslationError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post('/api/v1/translate/job')
def translate_job(payload: TranslateJobRequest):
    """Explicit translation: unchanged OCR regions -> selected provider -> persisted Korean."""
    from translation_llamacpp import (
        translate_regions as translate_local,
        TranslationError as LocalError,
        normalize_url, normalize_model, build_batches, get_config_hash
    )
    try:
        requested_model = normalize_model(payload.model)
        local_url = normalize_url(payload.local_url)
    except LocalError as exc:
        raise HTTPException(422, str(exc)) from exc
    provider = 'local'
    config_hash = get_config_hash()

    with lock:
        job = get_saved_or_memory_job(payload.job_id)
        if not job:
            raise HTTPException(404, 'OCR 작업을 찾을 수 없습니다.')
        if job.get('status') not in ('completed','completed_with_errors'):
            raise HTTPException(409, 'OCR 작업이 아직 완료되지 않았습니다.')
        regions = []
        for image in job.get('results',[]):
            for region in image.get('texts',[]):
                source = str(region.get('text') or '').strip()
                if not source: continue
                if not payload.force and region.get('translated_text') and region.get('translation_source') == source:
                    previous_provider = region.get('translation_provider') or ''
                    same_provider = previous_provider == provider
                    same_model = region.get('translation_model') == requested_model
                    same_local_url = region.get('translation_local_url') == local_url
                    same_config = region.get('translation_config_hash') == config_hash
                    if same_provider and same_model and same_local_url and same_config:
                        continue
                regions.append({'id':f"{image['index']}:{region['id']}", 'text':source})
        if len(regions)>1200:
            raise HTTPException(422,'한 작업의 번역 영역은 최대 1200개입니다.')
        if not regions:
            return {'job_id':payload.job_id,'translated':0,'cached':True,
                    'provider':provider,'model':requested_model,'results':job.get('results',[])}

    mapping = {}; model = requested_model; total_usage = {}
    try:
        parts = build_batches(regions)
        for part in parts:
            translated, meta = translate_local(part, model=requested_model, base_url=local_url)
            mapping.update(translated)
            model = meta.get('model', requested_model)
            for k,v in (meta.get('usage') or {}).items():
                if isinstance(v,int): total_usage[k] = total_usage.get(k,0) + v
    except LocalError as exc:
        raise HTTPException(502,str(exc)) from exc

    with lock:
        current = jobs.get(payload.job_id, job)
        for image in current.get('results',[]):
            for region in image.get('texts',[]):
                key=f"{image['index']}:{region['id']}"
                if key in mapping:
                    region['translated_text'] = mapping[key]
                    region['translation_source'] = str(region.get('text') or '').strip()
                    region['translation_model'] = model
                    region['translation_provider'] = provider
                    region['translation_local_url'] = local_url
                    region['translation_config_hash'] = config_hash
        current['translation_usage'] = total_usage
        record = dict(current)
        saved = DATA / f'{payload.job_id}.json'
        temp = DATA / f'{payload.job_id}.translate.tmp'
        temp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
        os.replace(temp, saved)
        jobs[payload.job_id] = current
        return {'job_id':payload.job_id,'translated':len(mapping),'cached':False,
                'provider':provider,'model':model,'usage':total_usage,
                'results':current.get('results',[])}

@app.get('/api/v1/jobs')
def list_jobs():
    with lock:
        return [{k: v for k, v in job.items() if k != 'results'} for job in reversed(list(jobs.values()))][:50]

@app.get('/api/v1/jobs/{job_id}')
def get_job(job_id: str):
    with lock:
        found = get_saved_or_memory_job(job_id)
        if not found:
            raise HTTPException(404, 'Job not found')
        job = dict(found)
        job['results'] = [dict(r) for r in job.get('results', [])]
        return job

@app.get('/', response_class=HTMLResponse)
def dashboard():
    return '''<!doctype html><html lang="ko"><meta charset="utf-8"><title>KoneWebTranslator OCR</title>
<style>body{font-family:system-ui;margin:36px;max-width:1100px}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}button{padding:8px 14px}pre{white-space:pre-wrap;word-break:break-word;background:#f4f4f4;padding:15px}</style>
<h2>KoneWebTranslator - 로컬 OCR</h2><p>서버 상태: <b id="health">확인 중</b></p><button onclick="refresh()">새로고침</button><p>작업 목록 (5초마다 갱신)</p><table><thead><tr><th>작업 ID</th><th>상태</th><th>완료/전체</th><th>OCR 결과</th></tr></thead><tbody id="jobs"></tbody></table><h3>선택한 작업의 텍스트 및 좌표</h3><pre id="detail">작업을 선택하세요.</pre>
<script>async function refresh(){try{let h=await (await fetch('/health')).json();document.getElementById('health').textContent=h.ok?'연결됨 / '+h.ocr_engine:'오류';let jobs=await(await fetch('/api/v1/jobs')).json();document.getElementById('jobs').innerHTML=jobs.map(j=>`<tr><td>${j.job_id}</td><td>${j.status}</td><td>${j.completed}/${j.total}</td><td><button data-id="${j.job_id}">결과 보기</button></td></tr>`).join('');document.querySelectorAll('button[data-id]').forEach(b=>b.onclick=()=>show(b.dataset.id));}catch(e){document.getElementById('health').textContent=String(e)}}async function show(id){let j=await(await fetch('/api/v1/jobs/'+id)).json();document.getElementById('detail').textContent=JSON.stringify(j.results,null,2)}refresh();setInterval(refresh,5000)</script></html>'''

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8765)
