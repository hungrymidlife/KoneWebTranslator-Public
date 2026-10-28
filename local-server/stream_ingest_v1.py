"""KWT_PUBLIC_EARLY_OCR_STREAM_V3_1.

Optional, bounded, ordered binary image ingestion.  Uses the existing OCR worker
and page-level translation.  No new OCR model, cache format or output schema.
Registered by server.py only; never launches an external server.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import queue
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from PIL import Image, UnidentifiedImageError

MAX_PAGES = 100
MAX_WAIT_PER_PAGE = 100  # seconds, avoids permanently stuck worker on lost extension message


def install(app, *, jobs, lock, executor, process_job, current_ocr_settings,
            ocr_identity, resolve_padding, image_max_bytes, output_dir):
    """Install independent opt-in routes on the existing loopback FastAPI app."""
    streams = {}
    streams_lock = threading.RLock()

    def image_url(value):
        if not isinstance(value, str) or not 1 <= len(value) <= 4096:
            raise HTTPException(422, 'Invalid image URL')
        try:
            u = urlsplit(value)
        except ValueError as exc:
            raise HTTPException(422, 'Invalid image URL') from exc
        if u.scheme not in ('https', 'http') or not u.hostname or u.username or u.password:
            raise HTTPException(422, 'HTTP(S) image URL required')
        return value

    def get_state(job_id):
        if not re.fullmatch(r'[0-9a-f]{16}', job_id):
            raise HTTPException(422, 'Invalid job ID')
        with streams_lock:
            state = streams.get(job_id)
        if state is None:
            raise HTTPException(404, 'Streaming job not active')
        return state

    def failed_item(index, url, error):
        return {'index': index, 'url': url, 'data': b'',
                'sha256': hashlib.sha256(b'').hexdigest(),
                'stream_error': str(error)[:300]}

    def ordered_items(state):
        for index, url in enumerate(state['urls']):
            if state['aborted'].is_set():
                yield failed_item(index, url, 'Upload aborted')
                continue
            deadline = time.monotonic() + MAX_WAIT_PER_PAGE
            item = None
            while not state['aborted'].is_set() and time.monotonic() < deadline:
                try:
                    item = state['queue'].get(timeout=min(0.5, max(0.01, deadline - time.monotonic())))
                    break
                except queue.Empty:
                    continue
            if item is None:
                reason = 'Upload aborted' if state['aborted'].is_set() else 'Image upload timed out'
                state['aborted'].set()
                yield failed_item(index, url, reason)
                continue
            # Local client sends in input order, but never silently relabel.
            if item['index'] != index:
                state['aborted'].set()
                yield failed_item(index, url, 'Image order mismatch')
            else:
                yield item

    def consume(job_id, state, pad_x, pad_y):
        try:
            process_job(job_id, ordered_items(state), pad_x, pad_y)
        except Exception as exc:
            with lock:
                if job_id in jobs:
                    jobs[job_id]['status'] = 'failed'
                    jobs[job_id]['error'] = f'Stream worker error: {type(exc).__name__}: {exc}'[:300]
        finally:
            state['aborted'].set()  # release any pending uploader after OCR startup/worker failure
            with streams_lock:
                streams.pop(job_id, None)

    @app.post('/api/v1/images/stream/start', status_code=202)
    def stream_start(payload: dict):
        urls = payload.get('image_urls')
        if not isinstance(urls, list) or not 1 <= len(urls) <= MAX_PAGES:
            raise HTTPException(422, '1-100 image URLs required')
        urls = [image_url(v) for v in urls]
        if len(set(urls)) != len(urls):
            raise HTTPException(422, 'Duplicate image URLs')
        source = payload.get('source_url', '')
        selector = payload.get('selector', '')
        if not isinstance(source, str) or len(source) > 4096 or not isinstance(selector, str) or len(selector) > 3000:
            raise HTTPException(422, 'Invalid source page / selector')
        try:
            pad_x, pad_y = resolve_padding(payload.get('pad_x_percent'), payload.get('pad_y_percent'))
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, str(exc)) from exc
        cfg = current_ocr_settings()
        job_id = uuid.uuid4().hex[:16]
        state = {'urls': urls, 'queue': queue.Queue(maxsize=3),
                 'next': 0, 'async_gate': asyncio.Lock(), 'aborted': threading.Event()}
        with lock:
            jobs[job_id] = {'ocr_settings': cfg, 'ocr_profile': ocr_identity(cfg),
                'job_id': job_id, 'status': 'queued', 'total': len(urls), 'completed': 0,
                'source_url': source, 'selector': selector, 'results': [],
                'created_at': datetime.now(timezone.utc).isoformat(),
                'output_dir': str(output_dir.resolve()), 'pad_x_percent': pad_x,
                'pad_y_percent': pad_y}
        with streams_lock:
            streams[job_id] = state
        try:
            executor.submit(consume, job_id, state, pad_x, pad_y)
        except Exception:
            with streams_lock:
                streams.pop(job_id, None)
            with lock:
                jobs.pop(job_id, None)
            raise
        return {'accepted': len(urls), 'job_id': job_id, 'status': 'queued',
                'status_url': f'/api/v1/jobs/{job_id}', 'stream_mode': True}

    async def enqueue(state, index, obj):
        if index < 0 or index >= len(state['urls']):
            raise HTTPException(422, 'Invalid page index')
        # Do not block event loop when OCR is slower than incoming images.
        # One uploader at a time, preserving the same index semantics as old batch.
        async with state['async_gate']:
            if state['aborted'].is_set():
                raise HTTPException(409, 'Stream has been aborted')
            if index != state['next']:
                raise HTTPException(409, 'Pages must be uploaded in ascending index order')
            try:
                await asyncio.to_thread(state['queue'].put, obj, True, MAX_WAIT_PER_PAGE)
            except queue.Full as exc:
                state['aborted'].set()
                raise HTTPException(503, 'OCR queue is full or stalled') from exc
            state['next'] += 1
            return {'accepted': index, 'received': state['next'], 'total': len(state['urls'])}

    @app.post('/api/v1/images/stream/item', status_code=202)
    async def stream_item(request: Request, job_id: str, index: int):
        state = get_state(job_id)
        length = request.headers.get('content-length')
        if length is not None:
            try:
                if int(length) > image_max_bytes:
                    raise HTTPException(413, 'Image exceeds size limit')
            except ValueError as exc:
                raise HTTPException(422, 'Invalid Content-Length') from exc
        data = await request.body()
        if not data or len(data) > image_max_bytes:
            raise HTTPException(413, 'Empty or oversized image')
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.verify()
        except (OSError, ValueError, UnidentifiedImageError) as exc:
            raise HTTPException(422, 'Invalid image bytes') from exc
        obj = {'index': index, 'url': state['urls'][index] if 0 <= index < len(state['urls']) else '',
               'data': data, 'sha256': hashlib.sha256(data).hexdigest()}
        return await enqueue(state, index, obj)

    @app.post('/api/v1/images/stream/fail', status_code=202)
    async def stream_fail(payload: dict):
        job_id = payload.get('job_id')
        state = get_state(job_id)
        index = payload.get('index')
        if type(index) is not int or not 0 <= index < len(state['urls']):
            raise HTTPException(422, 'Invalid page index')
        error = payload.get('error', 'Download failed')
        if not isinstance(error, str) or len(error) > 500:
            raise HTTPException(422, 'Invalid error')
        return await enqueue(state, index, failed_item(index, state['urls'][index], error))

    @app.post('/api/v1/images/stream/abort')
    def stream_abort(payload: dict):
        state = get_state(payload.get('job_id'))
        state['aborted'].set()
        return {'aborted': True}

    return streams
