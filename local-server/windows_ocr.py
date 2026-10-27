"""Optional Windows Runtime OCR. Never modifies the MangaOCR text."""
import asyncio
import io
import re
from PIL import Image

# Scores are deliberately conservative. Confidence is a detector score, not OCR confidence.
def score_region(text, shape, confidence):
    score, reasons = 0, []
    value = text or ''
    digits = len(re.findall(r'[0-9０-９]', value))
    letters = len(re.findall(r'[A-Za-zぁ-ゟァ-ヿ一-龯]', value))
    if digits >= 2 and letters >= 2:
        score += 2; reasons.append('일본어/숫자 혼합')
    if re.search(r'[【】［］\[\]+＋/%％＋:：]', value):
        score += 2; reasons.append('표/상태 기호')
    if len(value) >= 35 and value.count(' ') >= 5:
        score += 2; reasons.append('비정상적으로 많은 공백')
    w, h = shape
    if len(value) > 65 and w * h < 15000:
        score += 2; reasons.append('면적 대비 긴 인식 결과')
    if confidence < 0.7:
        score += 1; reasons.append('낮은 검출 신뢰도')
    return score, reasons

async def _recognize(data):
    # Requires Windows 10/11 and optional WinRT Python packages.
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.globalization import Language
    from winrt.windows.graphics.imaging import BitmapDecoder
    from winrt.windows.storage.streams import InMemoryRandomAccessStream, DataWriter
    stream = InMemoryRandomAccessStream()
    writer = DataWriter(stream)
    writer.write_bytes(data)
    await writer.store_async()
    await writer.flush_async()
    writer.detach_stream()
    stream.seek(0)
    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    engine = OcrEngine.try_create_from_language(Language('ja-JP'))
    if engine is None:
        raise RuntimeError('일본어 Windows OCR 언어팩이 설치되지 않았습니다.')
    result = await engine.recognize_async(bitmap)
    lines = []
    for line in result.lines:
        words = []
        for word in line.words:
            rect = word.bounding_rect
            words.append({'text':word.text,'bbox':[round(rect.x),round(rect.y),round(rect.width),round(rect.height)]})
        lines.append({'text':line.text,'words':words})
    return {'status':'ok','text':result.text,'lines':lines, 'horizontal_lines':sort_horizontal_words(lines)}

def sort_horizontal_words(lines):
    """Rebuild left-to-right rows using OCR word bounding boxes.

    Apply only to regions selected for horizontal Windows OCR.
    Keep the raw OCR result for comparison and fallback.
    """
    words = []
    for line in lines:
        for word in line.get('words', []):
            bbox = word.get('bbox') or []
            if len(bbox) != 4 or not str(word.get('text') or '').strip():
                continue
            x, y, w, h = bbox
            if w <= 0 or h <= 0:
                continue
            words.append({'text':str(word['text']), 'bbox':[x,y,w,h]})
    if not words:
        return []
    words.sort(key=lambda w:(w['bbox'][1] + w['bbox'][3]/2, w['bbox'][0]))
    rows = []
    for word in words:
        x,y,w,h = word['bbox']
        cy = y + h/2
        candidates = [r for r in rows if abs(cy-r['cy']) <= max(3, min(h,r['avg_h'])*0.45)]
        if candidates:
            row = min(candidates,key=lambda r:abs(cy-r['cy']))
            row['words'].append(word)
            row['cy'] = sum(q['bbox'][1]+q['bbox'][3]/2 for q in row['words'])/len(row['words'])
            row['avg_h'] = sum(q['bbox'][3] for q in row['words'])/len(row['words'])
        else:
            rows.append({'cy':cy,'avg_h':h,'words':[word]})
    rows.sort(key=lambda r:r['cy'])
    result=[]
    for row in rows:
        ordered=sorted(row['words'],key=lambda q:q['bbox'][0])
        result.append({'text':' '.join(q['text'] for q in ordered),'words':ordered})
    return result


def recognize_windows(image: Image.Image):
    buf = io.BytesIO()
    image.save(buf, 'PNG')
    try:
        return asyncio.run(_recognize(buf.getvalue()))
    except (ImportError, OSError) as exc:
        return {'status':'unavailable','text':'','error':str(exc)}
    except Exception as exc:
        return {'status':'error','text':'','error':f'{type(exc).__name__}: {exc}'}


WINDOWS_OCR_CHAR_THRESHOLD = 6
STATUS_SYMBOLS = frozenset(":：/／%％+-＋－=＝[]［］【】()（）{}｛｝★☆※|｜<>＜＞")


def should_use_windows(text, shape=None):
    """Switch on >=6 digits plus status symbols, independent of box shape.

    Counts Unicode digits (including full-width Japanese digits) and only
    status-like punctuation; ordinary Japanese sentence marks are excluded.
    """
    value = text or ''
    digit_count = sum(ch.isdigit() for ch in value)
    symbol_count = sum(ch in STATUS_SYMBOLS for ch in value)
    total = digit_count + symbol_count
    reasons = [f'숫자={digit_count}', f'기호={symbol_count}',
               f'합계={total}', f'기준={WINDOWS_OCR_CHAR_THRESHOLD}']
    return total >= WINDOWS_OCR_CHAR_THRESHOLD, reasons
