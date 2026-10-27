"""Page-level asynchronous Gemma translation for KoneWebTranslator.

Only the OCR process writes OCR pages. This worker updates their translations under
its shared job lock and atomically persists each completed translated page.
"""
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

from worker_runtime import worker_count  # KWT_UNIFIED_WORKERS_V1_2
_pool = ThreadPoolExecutor(max_workers=worker_count('translation_workers', 4), thread_name_prefix='kwt-translation')
_futures = {}
_futures_lock = threading.Lock()


def submit_page(job_id, image_index, jobs, lock, persist):
    def work():
        # KWT_STREAM_DIAG_V2
        started=datetime.now(timezone.utc).isoformat()
        print(f"[KWT_STREAM] translate_start job={job_id} image={image_index}",flush=True)
        from translation_llamacpp import translate_regions, build_batches
        with lock:
            job = jobs.get(job_id)
            page = next((p for p in job.get('results', []) if p.get('index') == image_index), None) if job else None
            regions = [dict(r) for r in page.get('texts', [])] if page else []
        requests = [{'id': f"{image_index}:{r['id']}", 'text': str(r.get('text') or '').strip()}
                    for r in regions if str(r.get('text') or '').strip()]
        mapping = {}
        errors = []
        for batch in build_batches(requests):
            try:
                result, _meta = translate_regions(batch)
                mapping.update(result)
            except Exception as exc:
                # Retain successful translations; retry each failed batch entry alone.
                errors.append(f'{type(exc).__name__}: {exc}')
                for item in batch:
                    try:
                        result, _meta = translate_regions([item])
                        mapping.update(result)
                    except Exception as single_exc:
                        errors.append(f"{item['id']}: {type(single_exc).__name__}: {single_exc}")
        with lock:
            job = jobs.get(job_id)
            if job is None:
                return
            page = next((p for p in job.get('results', []) if p.get('index') == image_index), None)
            if page:
                for region in page.get('texts', []):
                    key = f"{image_index}:{region['id']}"
                    if key in mapping:
                        region['translated_text'] = mapping[key]
                        region['translation_source'] = str(region.get('text') or '').strip()
                        region['translation_model'] = 'gemma4-12b-local'
                        region['translation_provider'] = 'local'
                if errors and len(mapping) < len(requests):
                    page['translation_error'] = '; '.join(errors)[-1800:]
            page.setdefault('translation_timing', {})['started_at']=started
            page['translation_timing']['finished_at']=datetime.now(timezone.utc).isoformat()
            page['translation_timing']['translated_regions']=len(mapping)
            page['translation_timing']['requested_regions']=len(requests)
            job['translation_completed'] = int(job.get('translation_completed', 0)) + 1
            job['translation_errors'] = int(job.get('translation_errors', 0)) + (1 if len(mapping) < len(requests) else 0)
            job['translation_status'] = 'running'
            if job.get('translation_ocr_done') and job['translation_completed'] >= job.get('completed', 0):
                job['translation_status'] = 'completed_with_errors' if job['translation_errors'] else 'completed'
            job['stream_revision'] = int(job.get('stream_revision',0))+1
            job['last_stream_event']={'type':'translated','image_index':image_index,'at':page['translation_timing']['finished_at']}
            persist(dict(job))
            print(f"[KWT_STREAM] translate_done job={job_id} image={image_index} translated={len(mapping)}/{len(requests)} rev={job['stream_revision']}",flush=True)
    with _futures_lock:
        previous = _futures.get(job_id)
        future = _pool.submit(work)
        _futures[job_id] = future
    return future


def complete_ocr(job_id, jobs, lock, persist):
    with lock:
        job = jobs.get(job_id)
        if not job:
            return
        job['translation_ocr_done'] = True
        if int(job.get('translation_completed', 0)) >= int(job.get('completed', 0)):
            job['translation_status'] = 'completed_with_errors' if job.get('translation_errors') else 'completed'
        persist(dict(job))
