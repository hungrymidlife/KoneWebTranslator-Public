"""KWT_CHAT_ATTACH_V2_3: bounded, local-only attachment storage and prompt excerpts.

Only data supplied through the Studio chat endpoint is accepted. Never execute,
import, expand an archive, follow a URL, or open a path from untrusted metadata.
"""
from __future__ import annotations
import base64
import io
import re
import shutil
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / 'studio-bridge' / '.studio_runtime' / 'chat_attachments'
ID_RE = re.compile(r'^[0-9a-f]{32}$')
IMAGE = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'}
VIDEO = {'.mp4', '.webm', '.mkv', '.mov'}
DOCUMENT = {'.txt', '.md', '.csv', '.json', '.jsonl', '.log', '.srt', '.vtt', '.html',
            '.htm', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.py', '.js', '.ts',
            '.tsx', '.jsx', '.css', '.sh', '.ps1', '.bat', '.sql', '.toml', '.pdf'}
MAX_SIZES = {'image': 12 * 1024**2, 'video': 64 * 1024**2,
             'document': 8 * 1024**2}
MAX_ATTACHMENTS = 50
MAX_CONV_BYTES = 250 * 1024**2
MAX_ON_SEND = 4


def _folder(cid):
    if not ID_RE.fullmatch(cid):
        raise ValueError('대화 ID가 올바르지 않습니다.')
    return STORE / cid


def _name(raw):
    name = str(raw).replace('\\', '/').split('/')[-1].strip()
    if not name or len(name) > 180 or any(ord(c) < 32 for c in name):
        raise ValueError('파일명이 올바르지 않습니다.')
    return name


def _kind(name):
    suffix = Path(name).suffix.lower()
    if suffix in IMAGE: return 'image'
    if suffix in VIDEO: return 'video'
    if suffix in DOCUMENT: return 'document'
    raise ValueError('지원하지 않는 첨부 형식입니다. 이미지·영상·문서/코드 파일만 첨부할 수 있습니다.')


def _source(cid, fid, suffix):
    if not ID_RE.fullmatch(fid):
        raise ValueError('첨부 파일 ID가 올바르지 않습니다.')
    return _folder(cid) / (fid + suffix)


def _validate_media(path, kind):
    if kind == 'image':
        try:
            with Image.open(path) as picture:
                picture.verify()
        except (OSError, ValueError, UnidentifiedImageError) as exc:
            raise ValueError('이미지 파일이 손상되었거나 지원하지 않는 형식입니다.') from exc
    elif kind == 'video':
        try:
            import cv2
        except ImportError as exc:
            raise ValueError('영상 장면 추출에 OpenCV가 필요합니다. Studio 기본 의존성을 설치하세요.') from exc
        cap = cv2.VideoCapture(str(path))
        try:
            if not cap.isOpened() or cap.get(cv2.CAP_PROP_FRAME_COUNT) < 1:
                raise ValueError('영상 디코딩이 불가능합니다. MP4(H.264) 또는 지원되는 코덱을 사용하세요.')
        finally:
            cap.release()
    elif path.suffix.lower() == '.pdf':
        # All source files end in .bin. PDF validation is performed from bytes below.
        pass


def _text(raw):
    for codec in ('utf-8-sig', 'cp949'):
        try: return raw.decode(codec)
        except UnicodeDecodeError: continue
    raise ValueError('문서의 문자 인코딩을 해독할 수 없습니다. UTF-8로 저장해 주세요.')


def upload(cid, name, raw):
    name = _name(name)
    kind = _kind(name)
    if not isinstance(raw, bytes) or not raw or len(raw) > MAX_SIZES[kind]:
        raise ValueError(f'{kind} 용량 제한 초과 (이미지 12MB / 문서 8MB / 영상 64MB)')
    folder = _folder(cid)
    folder.mkdir(parents=True, exist_ok=True)
    existing = [p for p in folder.iterdir() if p.is_file()]
    if len(existing) >= MAX_ATTACHMENTS or sum(p.stat().st_size for p in existing) + len(raw) > MAX_CONV_BYTES:
        raise ValueError('대화별 첨부 제한(50개 또는 총 250MB)에 도달했습니다.')
    if kind == 'document':
        if name.lower().endswith('.pdf'):
            try:
                from pypdf import PdfReader
            except ImportError as exc:
                raise ValueError('PDF 읽기 라이브러리(pypdf)가 없습니다. INSTALL_CHAT_DEPS.bat을 실행하세요.') from exc
            try:
                reader = PdfReader(io.BytesIO(raw), strict=False)
                if reader.is_encrypted: raise ValueError('암호화된 PDF는 지원하지 않습니다.')
                if len(reader.pages) > 300: raise ValueError('PDF는 최대 300페이지까지 분석 가능합니다.')
                reader.pages[0].extract_text() if reader.pages else None
            except ValueError: raise
            except Exception as exc:
                raise ValueError('PDF 내용을 해석하지 못했습니다.') from exc
        else:
            _text(raw[:min(len(raw), 65536)])
    fid = uuid.uuid4().hex
    dest = _source(cid, fid, Path(name).suffix.lower())
    try:
        with dest.open('xb') as out:
            out.write(raw)
        _validate_media(dest, kind)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return {'id': fid, 'name': name, 'kind': kind, 'size': len(raw)}


def _image_data(raw):
    with Image.open(io.BytesIO(raw)) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((1280, 1280))
        if image.mode != 'RGB': image = image.convert('RGB')
        out = io.BytesIO()
        image.save(out, format='JPEG', quality=82, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode('ascii')


def _video_frames(path):
    import cv2
    cap = cv2.VideoCapture(str(path))
    result = []
    try:
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        if count < 1: raise ValueError('영상 길이를 파악할 수 없습니다.')
        for fraction in (0.05, 0.35, 0.65, 0.95):
            pos = min(count-1, max(0, int((count-1)*fraction)))
            cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
            success, frame = cap.read()
            if not success: continue
            h, w = frame.shape[:2]
            if max(h,w) > 960:
                frame = cv2.resize(frame, (max(1,round(w*960/max(h,w))), max(1,round(h*960/max(h,w)))))
            success, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 76])
            if success:
                seconds = round(pos/fps, 1) if fps > 0 else None
                result.append((seconds, 'data:image/jpeg;base64,' + base64.b64encode(buf.tobytes()).decode('ascii')))
    finally:
        cap.release()
    if not result: raise ValueError('영상에서 프레임을 추출하지 못했습니다.')
    return result


def prepare(cid, selections):
    """Return sanitized metadata, prompt text, and image URL parts.

    Only attachment IDs from this conversation's dedicated directory are read;
    never accept file paths or user-supplied content as model metadata.
    """
    if not isinstance(selections, list) or len(selections) > MAX_ON_SEND:
        raise ValueError('한 메시지에는 최대 4개 파일을 첨부할 수 있습니다.')
    seen = set(); metadata=[]; notes=[]; visuals=[]
    for supplied in selections:
        fid = str(supplied.get('id', '')) if isinstance(supplied, dict) else ''
        if fid in seen or not ID_RE.fullmatch(fid): raise ValueError('첨부 ID가 중복되었거나 잘못되었습니다.')
        seen.add(fid)
        name = _name(supplied.get('name',''))
        kind = _kind(name)
        path = _source(cid, fid, Path(name).suffix.lower())
        if not path.is_file() or path.stat().st_size > MAX_SIZES[kind]:
            raise ValueError('첨부 파일을 찾을 수 없거나 크기가 초과되었습니다.')
        # Verify the metadata is authentic rather than trusting JSON values.
        if str(supplied.get('kind')) != kind or supplied.get('size') != path.stat().st_size:
            raise ValueError('첨부 정보가 원본 파일과 일치하지 않습니다.')
        meta = {'id': fid, 'name': name, 'kind': kind, 'size': path.stat().st_size}
        metadata.append(meta)
        notes.append(f'- {name} ({kind}, {path.stat().st_size:,} bytes)')
        if kind == 'document':
            if name.lower().endswith('.pdf'):
                from pypdf import PdfReader
                reader = PdfReader(str(path), strict=False)
                pages = []
                readable = False
                for index, page in enumerate(reader.pages[:80]):
                    try:
                        extracted = page.extract_text() or ''
                        readable = readable or bool(extracted.strip())
                        pages.append(f'[페이지 {index+1}]\n' + extracted)
                    except Exception: pages.append(f'[페이지 {index+1}: 텍스트 추출 실패]')
                content='\n'.join(pages)
                if not readable: raise ValueError('PDF에서 텍스트를 추출하지 못했습니다. 스캔 PDF OCR은 추후 지원합니다.')
            else:
                # Do not feed unbounded document bytes to the model.
                content = _text(path.read_bytes()[:30000])
            truncated = len(content) > 8500 or path.stat().st_size > 30000
            notes.append('[첨부 문서 '+name+']\n'+content[:8500]+('\n[이하 생략: 일부만 분석됨]' if truncated else '')+'\n[/첨부 문서]')
        elif kind == 'image':
            visuals.append({'type':'image_url','image_url':{'url':_image_data(path.read_bytes())}})
        elif kind == 'video':
            frames=_video_frames(path)
            for sec, encoded in frames:
                notes.append(f'[영상 대표 프레임 {name} · '+(str(sec)+'초' if sec is not None else '시점 불명')+']')
                visuals.append({'type':'image_url','image_url':{'url':encoded}})
            notes.append('[주의: 영상은 대표 프레임만 분석하며 소리·전체 프레임은 분석하지 못합니다.]')
    return metadata, '\n'.join(notes), visuals


def delete_conversation(cid):
    folder = _folder(cid)
    if folder.is_dir(): shutil.rmtree(folder)
