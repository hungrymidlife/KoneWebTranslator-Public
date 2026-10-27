import base64
import hashlib
import io
import json
import re
import time
import urllib.request
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat
from inpainting_lama import restore as lama_restore
# KWT_STUDIO_FONTS_V1_7_0: font library shared with Studio.
from font_library import font_for as kwt_registered_font, default_font_id as kwt_default_font_id

API = 'http://127.0.0.1:8765'
EXTS = {'.jpg', '.jpeg', '.png', '.webp'}
MAX_IMAGE = 18 * 1024 * 1024
MAX_PIXELS = 35_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def natural_key(name):
    return [int(v) if v.isdigit() else v.casefold() for v in re.split(r'(\d+)', name)]


def request(path, payload=None, timeout=35):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(API + path, data=data, headers={'Content-Type': 'application/json'} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)


def entries(zf):
    result = []
    for info in zf.infolist():
        name = info.filename.replace('\\', '/')
        if info.is_dir() or Path(name).suffix.lower() not in EXTS:
            continue
        parts = name.split('/')
        if name.startswith('/') or any(part in ('', '.', '..') for part in parts) or ':' in parts[0]:
            continue
        result.append(info)
    return sorted(result, key=lambda x: natural_key(x.filename))


def font_for(size):
    return kwt_registered_font(size)


def wrap_text(draw, text, font, width):
    lines, current = [], ''
    for char in text:
        if char == '\n':
            lines.append(current)
            current = ''
        elif draw.textlength(current + char, font=font) > width and current:
            lines.append(current)
            current = char
        else:
            current += char
    if current:
        lines.append(current)
    return lines or ['']


def select_text_style(image, box, mode='auto'):
    """Evaluate the restored pixels, never the original Japanese lettering."""
    if mode not in ('auto', 'black', 'white'):
        raise ValueError('Invalid text color mode: ' + str(mode))
    x, y, w, h = box
    sample = image.crop((x, y, x+w, y+h)).convert('RGB')
    sample.thumbnail((128, 128), Image.Resampling.BILINEAR)
    # Percentiles exclude exceptional pixels, e.g. bubble outlines and sound effects.
    gray = list(sample.convert('L').getdata())
    if not gray:
        return {'text_color':'#000000','stroke_color':None,'stroke_width':0,'background_luma':255,'background_range':0,'color_mode':mode}
    gray.sort()
    p10 = gray[len(gray)//10]
    p50 = gray[len(gray)//2]
    p90 = gray[(len(gray)-1)*9//10]
    spread = p90-p10
    if mode == 'auto':
        # Median works well for uniformly dark/bright speech bubbles.
        is_white = p50 < 128
    else:
        is_white = mode == 'white'
    # Busy backgrounds need a modest contrasting outline to protect legibility.
    stroke = 0 if spread < 65 else 1
    return {'text_color':'#ffffff' if is_white else '#000000',
            'stroke_color':('#000000' if is_white else '#ffffff') if stroke else None,
            'stroke_width':stroke,'background_luma':p50,
            'background_range':spread,'color_mode':mode}


def typeset(raw, regions, report=None, text_color_mode='auto', cache_dir=None):
    # V14_BALANCED_TYPESETTING
    from typesetting_layout import layout_and_draw
    with Image.open(io.BytesIO(raw)) as opened:
        im = ImageOps.exif_transpose(opened).convert('RGB')
    im, mask, inpaint_meta = lama_restore(im, regions, report, cache_dir=cache_dir)
    draw = ImageDraw.Draw(im)
    placements = []
    for region in regions:
        translated = str(region.get('translated_text') or '').strip()
        bbox = region.get('bbox') or []
        if not translated or len(bbox) != 4:
            continue
        x, y, w, h = [int(n) for n in bbox]
        x, y = max(0, x), max(0, y)
        w, h = min(w, im.width-x), min(h, im.height-y)
        if w < 8 or h < 8:
            continue
        pad = max(2, min(w, h) // 18)
        # Retain existing luminance-based foreground selection.
        style = select_text_style(im, (x+pad, y+pad, max(1,w-2*pad), max(1,h-2*pad)), text_color_mode)
        style['stroke_color'] = '#000000' if style['text_color'] == '#ffffff' else '#ffffff'
        # V15_BUBBLE_SAFE_LAYOUT: conservative mask-based correction; fallback is original bbox.
        from bubble_safe_layout import propose_safe_bbox
        layout_box, layout_reason = propose_safe_bbox(im, (x,y,w,h))
        info = layout_and_draw(draw, translated, layout_box or (x,y,w,h), font_for, style)
        if info is None and layout_box is not None:
            # Revert if proposed safe area cannot fit the translated text.
            info = layout_and_draw(draw, translated, (x,y,w,h), font_for, style)
            layout_box = None
            layout_reason = 'safe_layout_overflow_fallback'
        if info is not None:
            info['font_id'] = kwt_default_font_id()
            info['layout_source'] = layout_reason if layout_box else 'ocr_bbox_fallback'
            info['bubble_detection_reason'] = layout_reason
            info['typesetting_bbox'] = list(layout_box or (x,y,w,h))
        if info is None:
            placements.append({'region_id':region.get('id'), 'status':'text_overflow'})
            continue
        style['stroke_width'] = info['stroke_width']
        placements.append({'region_id':region.get('id'), 'bbox':[x,y,w,h],
                           'status':'drawn', 'background':'lama', 'text':translated,
                           **style, **info})
    return im, placements, inpaint_meta

# Keep total base64 JSON body below server.py MAX_REQUEST_BYTES (35 MiB).
BATCH_PAGES = 3
BATCH_RAW_BYTES = 22 * 1024 * 1024
OCR_FINISHED = {'completed', 'completed_with_errors', 'failed'}
TRANSLATION_FINISHED = {'completed', 'completed_with_errors', 'failed'}


def build_batches(zin, pages, report):
    # Work on bounded groups so an entire chapter is never held in RAM.
    batch, raw_bytes = [], 0
    for index, info in enumerate(pages):
        try:
            if info.file_size > MAX_IMAGE:
                raise ValueError('Image exceeds 18MB server limit')
            raw = zin.read(info)
            if len(raw) > MAX_IMAGE:
                raise ValueError('Image exceeds 18MB server limit')
            with Image.open(io.BytesIO(raw)) as im:
                im.verify()
            with Image.open(io.BytesIO(raw)) as im:
                if im.width * im.height > MAX_PIXELS:
                    raise ValueError('Image exceeds pixel limit')
            item = (index, info, raw, None)
        except Exception as exc:
            item = (index, info, None, f'{type(exc).__name__}: {exc}')
            report(f'Invalid page: {info.filename}: {exc}')
        size = len(raw) if item[2] is not None else 0
        if batch and (len(batch) >= BATCH_PAGES or raw_bytes + size > BATCH_RAW_BYTES):
            yield batch
            batch, raw_bytes = [], 0
        batch.append(item)
        raw_bytes += size
    if batch:
        yield batch


def process_zip(source, output_dir, report=lambda *args: None, cancelled=lambda: False, progress=None, text_color_mode='auto'):
    if text_color_mode not in ('auto', 'black', 'white'):
        raise ValueError('Invalid text color mode')
    progress = progress or (lambda **kwargs: None)
    source = Path(source).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / (source.stem + '_ko.zip')
    metadata_path = output_dir / (source.stem + '_ko.metadata.json')
    if source == target or source == metadata_path:
        raise ValueError('Output path must differ from source')
    if target.exists() or metadata_path.exists():
        raise FileExistsError(f'Output exists; refusing overwrite: {target}')
    temp_target = target.with_suffix('.zip.part')
    records, used = [], set()
    ocr_done = translated_done = written = 0
    try:
        request('/health')
        with zipfile.ZipFile(source) as zin:
            pages = entries(zin)
            if not pages:
                raise ValueError('No supported images in ZIP')
            total = len(pages)
            progress(stage='시작', page=0, total=total, detail='OCR 0 | 번역 0 | 저장 0')
            with zipfile.ZipFile(temp_target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
                for batch in build_batches(zin, pages, report):
                    if cancelled():
                        raise InterruptedError('User cancelled; server in-flight job may continue')
                    valid = [v for v in batch if v[2] is not None]
                    job = None
                    job_id = None
                    if valid:
                        first = valid[0]
                        progress(stage='서버에 배치 제출', page=first[0]+1, total=total,
                                 name=first[1].filename, image=first[2], image_kind='source',
                                 detail=f'{len(valid)}장 | OCR {ocr_done} / 번역 {translated_done} / 저장 {written}')
                        payload = {'source_url': 'local-zip:' + source.name + ':' + str(first[0]),
                                   'images': [{'index': i, 'url': 'local-zip:' + info.filename,
                                               'image_base64': base64.b64encode(raw).decode('ascii'),
                                               'mime_type': 'image/webp' if info.filename.lower().endswith('.webp') else 'image/jpeg' if info.filename.lower().endswith(('.jpg','.jpeg')) else 'image/png'}
                                              for i,info,raw,_ in valid]}
                        created = request('/api/v1/images/batch', payload, timeout=120)
                        job_id = created['job_id']
                        report(f'배치 제출 {first[0]+1}-{batch[-1][0]+1}/{total} ({len(valid)}장), job={job_id}')
                        deadline = time.monotonic() + max(900, 900 * len(valid))
                        last_ocr = last_translation = -1
                        while time.monotonic() < deadline:
                            if cancelled():
                                raise InterruptedError('User cancelled; server in-flight job may continue')
                            job = request('/api/v1/jobs/' + job_id, timeout=35)
                            if job.get('status') == 'failed':
                                raise RuntimeError(job.get('error') or 'Batch OCR failed')
                            current_ocr = min(len(valid), int(job.get('completed') or 0))
                            current_translation = min(len(valid), int(job.get('translation_completed') or 0))
                            if current_ocr != last_ocr or current_translation != last_translation:
                                last_ocr, last_translation = current_ocr, current_translation
                                progress(stage='OCR / Gemma 병렬 진행', page=first[0]+1, total=total,
                                         detail=f'OCR {ocr_done+current_ocr}/{total} | 번역 {translated_done+current_translation}/{total} | 저장 {written}/{total}')
                            # Translation thread can finish OCR pages while OCR continues.
                            if (job.get('status') in OCR_FINISHED and
                                job.get('translation_status') in TRANSLATION_FINISHED and
                                current_translation >= current_ocr):
                                break
                            time.sleep(1.0)
                        else:
                            raise TimeoutError(f'Batch OCR/translation timed out: {job_id}')
                        ocr_done += current_ocr
                        translated_done += current_translation
                    results = {r.get('index'):r for r in (job or {}).get('results', [])}
                    for index, info, raw, initial_error in batch:
                        if cancelled():
                            raise InterruptedError('User cancelled; server in-flight job may continue')
                        rec = {'entry_name':info.filename, 'index':index, 'status':'pending'}
                        records.append(rec)
                        if raw is not None:
                            rec['sha256'] = hashlib.sha256(raw).hexdigest()
                        if job_id:
                            rec['job_id'] = job_id
                        try:
                            if initial_error:
                                raise ValueError(initial_error)
                            page = results.get(index)
                            if page is None or page.get('error'):
                                raise RuntimeError((page or {}).get('error') or 'Missing OCR result')
                            regions = page.get('texts', [])
                            if any(r.get('text') and not str(r.get('translated_text') or '').strip() for r in regions):
                                rec['translation_incomplete'] = True
                                report(f'번역 누락: {info.filename} (빈 번역 영역 존재, 재번역 자동 요청 안 함)')
                            progress(stage='한국어 식질 중', page=index+1,total=total,name=info.filename,
                                     image=raw,image_kind='source',detail=f'OCR {ocr_done}/{total} | 번역 {translated_done}/{total} | 저장 {written}/{total}')
                            cache_dir = Path(str(target) + '.layers') / f'page_{index+1:04d}'
                            im, placements, inpaint_meta = typeset(raw,regions,report,text_color_mode=text_color_mode,cache_dir=cache_dir)
                            inpaint_meta['cache_path'] = str(cache_dir)
                            fmt = 'JPEG' if Path(info.filename).suffix.lower() in ('.jpg','.jpeg') else 'PNG' if Path(info.filename).suffix.lower()=='.png' else 'WEBP'
                            buf = io.BytesIO()
                            if fmt=='PNG':im.save(buf,format=fmt)
                            else:im.save(buf,format=fmt,quality=92)
                            data = buf.getvalue()
                            zout.writestr(info.filename,data)
                            used.add(info.filename)
                            rec.update(status='completed',regions=regions,typesetting=placements,inpainting=inpaint_meta,width=im.width,height=im.height)
                            written += 1
                            progress(stage='페이지 완료',page=index+1,total=total,name=info.filename,record=rec,image=data,image_kind='result',
                                     detail=f'OCR {ocr_done}/{total} | 번역 {translated_done}/{total} | 저장 {written}/{total}')
                        except Exception as exc:
                            rec.update(status='failed',error=f'{type(exc).__name__}: {exc}')
                            if info.filename not in used:
                                zout.writestr(info.filename, zin.read(info) if raw is None else raw)
                                used.add(info.filename)
                            written += 1
                            report(f'Page error: {info.filename} - {exc}')
                            progress(stage='페이지 오류 (원본 보존)',page=index+1,total=total,
                                     detail=f'OCR {ocr_done}/{total} | 번역 {translated_done}/{total} | 저장 {written}/{total} - {exc}')
                for info in zin.infolist():
                    name=info.filename.replace('\\','/')
                    parts=name.split('/')
                    if info.is_dir() or name in used or name.startswith('/') or any(p in ('','.','..') for p in parts) or ':' in parts[0]:
                        continue
                    if info.file_size > 64*1024*1024:
                        continue
                    zout.writestr(name,zin.read(info))
        progress(stage='ZIP 검증 및 메타데이터 저장',page=total,total=total)
        with zipfile.ZipFile(temp_target) as check:
            if check.testzip() is not None:
                raise RuntimeError('Output ZIP integrity verification failed')
        document={'schema_version':1,'source_kind':'zip','source_zip_name':source.name,
                  'source_zip_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
                  'images':records,'typesetting_method':'lama_tiled_v06',
                  'pipeline':'batched_ocr_async_translation_v03_lama_tiled_v06_color_v05','batch_pages':BATCH_PAGES,
                  'text_color_mode':text_color_mode}
        metadata_path.write_text(json.dumps(document,ensure_ascii=False,indent=2),encoding='utf-8')
        temp_target.replace(target)
        progress(stage='ZIP 저장 완료',page=total,total=total)
        return target,metadata_path
    finally:
        if temp_target.exists():
            temp_target.unlink()
