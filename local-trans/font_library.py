"""Project-local registered font library shared by Studio and ZIP typesetting.

Only locally imported TTF/OTF/TTC files. No remote fonts or OS installation.
The files and registry are git-ignored Studio runtime state, not a source asset.
"""
from __future__ import annotations
import hashlib
import io
import json
import os
import re
import threading
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent / 'studio-bridge' / '.studio_runtime' / 'fonts'
REGISTRY = ROOT / 'registry.json'
FONT_EXT = {'.ttf', '.otf', '.ttc'}
FONT_ID = re.compile(r'^[0-9a-f]{20}$')
MAX_FONT_BYTES = 24 * 1024 * 1024
MAX_FONTS = 100
LOCK = threading.RLock()
SYSTEM = {'id':'system','name':'Windows 기본 (맑은 고딕)','family':'Malgun Gothic',
          'style':'Regular','source_name':'','built_in':True,'extension':''}


def _load():
    try:
        raw = json.loads(REGISTRY.read_text(encoding='utf-8'))
        if isinstance(raw,dict) and isinstance(raw.get('fonts'),dict):
            return raw
    except (OSError, ValueError, TypeError):
        pass
    return {'version':1,'default_id':'system','fonts':{}}


def _save(data):
    ROOT.mkdir(parents=True, exist_ok=True)
    temp = REGISTRY.with_name('registry.tmp')
    temp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(temp, REGISTRY)


def _stored(font_id, registry=None):
    if font_id == 'system':
        return None
    if not isinstance(font_id,str) or not FONT_ID.fullmatch(font_id):
        return None
    data = registry if registry is not None else _load()
    entry=data.get('fonts',{}).get(font_id)
    if not isinstance(entry,dict) or entry.get('id') != font_id:
        return None
    ext=entry.get('extension')
    if ext not in FONT_EXT:
        return None
    path=ROOT/(font_id+ext)
    return path if path.is_file() else None


def _system_font(size):
    for name in ('C:/Windows/Fonts/malgun.ttf','C:/Windows/Fonts/malgunbd.ttf',
                 '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if Path(name).is_file():
            return ImageFont.truetype(name, int(size))
    return ImageFont.load_default()


def default_font_id():
    with LOCK:
        data=_load()
        fid=data.get('default_id','system')
        return fid if fid=='system' or _stored(fid,data) is not None else 'system'


def font_for(size, font_id=None):
    fid = default_font_id() if font_id is None else font_id
    if fid and fid!='system':
        with LOCK:
            source=_stored(fid)
        if source is not None:
            try:
                return ImageFont.truetype(str(source),int(size))
            except (OSError,ValueError):
                pass
    return _system_font(size)


def list_fonts():
    with LOCK:
        data=_load()
        fonts=[]
        for fid, item in data['fonts'].items():
            if _stored(fid,data) is not None:
                fonts.append(dict(item,built_in=False))
        fonts.sort(key=lambda entry:(entry.get('name','').casefold(),entry['id']))
        did=data.get('default_id','system')
        if did!='system' and _stored(did,data) is None:
            did='system'
        return {'default_id':did,'fonts':[dict(SYSTEM)]+fonts}


def _read_font_info(binary, extension):
    if extension not in FONT_EXT:
        raise ValueError('TTF, OTF, TTC 글꼴 파일만 등록할 수 있습니다.')
    if not (32<=len(binary)<=MAX_FONT_BYTES):
        raise ValueError('글꼴 파일은 24MB 이하여야 합니다.')
    if binary[:4] not in (b'\x00\x01\x00\x00', b'OTTO', b'ttcf', b'true'):
        raise ValueError('지원하지 않거나 손상된 글꼴 형식입니다.')
    try:
        test=ImageFont.truetype(io.BytesIO(binary),28)
        family, style=test.getname()
        test.getbbox('가나다 ABC 123')
    except (OSError,ValueError,TypeError) as e:
        raise ValueError('글꼴 파일을 읽을 수 없습니다: '+str(e)[:160]) from e
    return str(family)[:120], str(style)[:80]


def register_bytes(filename, binary):
    raw_name=Path(str(filename).replace('\\','/')).name
    ext=Path(raw_name).suffix.lower()
    family, style=_read_font_info(binary,ext)
    fid=hashlib.sha256(binary).hexdigest()[:20]
    with LOCK:
        data=_load()
        if fid in data['fonts'] and _stored(fid,data) is not None:
            return {'font':dict(data['fonts'][fid],built_in=False),'duplicate':True}
        if len(data['fonts'])>=MAX_FONTS:
            raise ValueError('등록 가능한 글꼴은 최대 100개입니다.')
        ROOT.mkdir(parents=True,exist_ok=True)
        path=ROOT/(fid+ext)
        if not path.exists():
            with path.open('xb') as f:
                f.write(binary)
        record={'id':fid,'name':family + ((' '+style) if style and style.lower() not in ('regular','normal') else ''),
                'family':family,'style':style,'source_name':raw_name[:200],
                'extension':ext,'built_in':False}
        data['fonts'][fid]=record
        _save(data)
        return {'font':dict(record),'duplicate':False}


def register_paths(paths):
    if not isinstance(paths,list) or not 1<=len(paths)<=100:
        raise ValueError('1~100개 글꼴 경로를 선택하세요.')
    results=[]
    for raw in paths:
        src=Path(str(raw)).expanduser().resolve()
        if src.suffix.lower() not in FONT_EXT or not src.is_file():
            raise ValueError('글꼴 파일이 아닙니다: '+src.name)
        if src.stat().st_size>MAX_FONT_BYTES:
            raise ValueError('용량을 초과했습니다: '+src.name)
        results.append(register_bytes(src.name,src.read_bytes()))
    return {'results':results,'library':list_fonts()}


def select_default(fid):
    with LOCK:
        data=_load()
        if fid!='system' and _stored(fid,data) is None:
            raise ValueError('등록되지 않은 글꼴입니다.')
        data['default_id']=fid
        _save(data)
        return list_fonts()


def remove_font(fid):
    with LOCK:
        data=_load()
        path=_stored(fid,data)
        if path is None:
            raise ValueError('등록된 사용자 글꼴이 아닙니다.')
        # Existing edits keep their font IDs. If font is removed the renderer falls back.
        del data['fonts'][fid]
        if data.get('default_id')==fid:
            data['default_id']='system'
        _save(data)
        path.unlink(missing_ok=True)
        return list_fonts()


def font_file(fid):
    with LOCK:
        path=_stored(fid)
        if path is None:
            raise FileNotFoundError('등록된 글꼴 파일이 없습니다.')
        return path.read_bytes(), {'.ttf':'font/ttf','.otf':'font/otf','.ttc':'font/collection'}[path.suffix]


def font_preview(fid):
    with LOCK:
        if fid!='system' and _stored(fid) is None:
            raise FileNotFoundError('등록된 글꼴 파일이 없습니다.')
        face=font_for(30,fid)
    picture=Image.new('RGB',(530,146),'#18212c')
    draw=ImageDraw.Draw(picture)
    sample='가나다라마바사 아자차카타파하'
    second='한글 식질 미리보기  ABC 1234'
    draw.text((18,15),sample,font=face,fill='#f6f6f7')
    draw.text((18,78),second,font=font_for(22,fid),fill='#9cdeff')
    result=io.BytesIO()
    picture.save(result,format='PNG')
    return result.getvalue()


def validate_font_id(fid):
    if not isinstance(fid,str) or (fid!='system' and not FONT_ID.fullmatch(fid)):
        raise ValueError('올바르지 않은 폰트 ID입니다.')
    return fid
