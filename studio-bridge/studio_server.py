"""KoneWebTranslator Studio bridge (loopback-only, standard-library HTTP).

The original OCR/Gemma/LaMa pipeline is imported unchanged from local-trans.
All save operations preserve a .studio-original.bak and use atomic ZIP replacement.
"""
from __future__ import annotations
import io
import math
import json
import os
import re
import sys
import time
import uuid
import zipfile
import shutil
import hashlib
import tempfile
import threading
import subprocess
import traceback
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from PIL import Image, ImageDraw, ImageFont, ImageOps
import installer_service  # KWT_BRIDGE_EXIT_V2_1_1_SERVER: inspect active installer job
from installer_service import get as installer_get, post as installer_post  # KWT_STUDIO_INSTALLER_V2_0_0
from chrome_extension_install import open_for_user as kwt_open_extension_guide  # KWT_CHROME_EXTENSION_GUIDE_V2_0_2
from manager_service import kwt_bridge_shutdown_ready
from chat_service import get as chat_get, post as chat_post, is_busy as chat_busy  # KWT_LOCAL_CHAT_V2_2_0
from manager_service import handle_get as studio_manager_get, handle_post as studio_manager_post  # KWT_UNIFIED_V1
from extension_service import get as extension_get, post as extension_post, EXT_RE  # KWT_EXT_SYNC_V1_3

BASE = Path(__file__).resolve().parent.parent
TRANS = BASE / 'local-trans'
sys.path.insert(0, str(TRANS))
from render_settings import load_render_settings  # KWT_UNIFIED_IMAGE_V1_5
from chat_attachments import upload as kwt_chat_upload  # KWT_CHAT_ATTACH_V2_3
# KWT_STUDIO_FONTS_V1_7_0
from font_library import (list_fonts as kwt_list_fonts, register_bytes as kwt_register_font,
                          register_paths as kwt_import_fonts, select_default as kwt_font_default,
                          remove_font as kwt_font_remove, font_preview as kwt_font_preview,
                          font_file as kwt_font_file, font_for as kwt_font_for,
                          validate_font_id as kwt_validate_font_id)
PORT = int(os.getenv('KWT_STUDIO_PORT', '18765'))
IMAGES = {'.png', '.jpg', '.jpeg', '.webp', '.bmp'}
projects = {}
projects_lock = threading.RLock()
queue_lock = threading.Lock()
active_batch = False
# KWT_BRIDGE_RESTART_V1_8_0
bridge_restarting = False
bridge_server = None

def _restart_bridge_safely():
    global bridge_restarting
    # Check actual running projects rather than the stale active_batch flag.
    # A stuck global flag is the very condition this operation must recover.
    with queue_lock:
        if bridge_restarting:
            raise RuntimeError('Bridge is already restarting')
        with projects_lock:
            running = [p.source.name for p in projects.values()
                       if p.state in ('running','finalizing')]
        if running:
            raise RuntimeError('자동 작업이 실제로 진행 중입니다. 완료 후 Bridge를 재시작하세요.')
        bridge_restarting = True
    try:
        worker = Path(__file__).resolve().with_name('bridge_restart_worker.py')
        if not worker.is_file():raise RuntimeError('Bridge restart worker is missing')
        flags = (getattr(subprocess,'DETACHED_PROCESS',0) |
                 getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0))
        opts = {'creationflags':flags} if os.name=='nt' else {'start_new_session':True}
        subprocess.Popen([sys.executable,str(worker),str(os.getpid()),str(PORT)],
                         cwd=str(BASE),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL,close_fds=True,**opts)
        def close_after_reply():
            time.sleep(.35)
            if bridge_server is not None:bridge_server.shutdown()
        threading.Thread(target=close_after_reply,name='kwt-bridge-restart',daemon=True).start()
        return {'restarting':True,'old_pid':os.getpid()}
    except Exception:
        with queue_lock:bridge_restarting=False
        raise


def natural(name):
    return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)', name)]


def _json_file(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError, OSError):
        return default if default is not None else {}


def _atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    f = path.with_name(path.name + '.tmp')
    f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(f, path)


def _entry_list(path):
    with zipfile.ZipFile(path) as archive:
        return [name for name in archive.namelist()
                if not name.endswith('/') and Path(name).suffix.lower() in IMAGES
                and '..' not in Path(name).parts]


def _key(path):
    return hashlib.sha256(str(Path(path).resolve()).lower().encode('utf-8')).hexdigest()[:16]


def _result_path(source, output=None):
    source = Path(source)
    folder = Path(output) if output else source.parent
    return folder / (source.stem + '_ko.zip')


def _meta_path(result):
    return Path(result).with_suffix('.metadata.json')


def _sidecar(result):
    return Path(str(result) + '.studio_edits.json')


def _normalize_edit(edit, size):
    # Validate rotation before data can reach the renderer or saved sidecar.
    try:
        rotation=float(edit.get('rotation',0))
    except (ValueError,TypeError):
        raise ValueError('회전은 숫자로 입력해 주세요.')
    if not math.isfinite(rotation):
        raise ValueError('회전 값이 유효하지 않습니다.')
    rotation=max(-180.0,min(180.0,rotation))
    from shape_font_policy import FONT_CLASSES
    shape_override=edit.get('shape_class_override')
    if shape_override is not None and shape_override not in FONT_CLASSES:
        raise ValueError('유효하지 않은 말풍선 유형입니다.')
    # Never allow arbitrary paths or executable expressions in edit data.
    x, y, w, h = [int(float(n)) for n in edit.get('bbox', [0, 0, 100, 60])]
    iw, ih = size
    if iw < 2 or ih < 2:
        raise ValueError('Invalid page dimensions')
    x = max(0, min(iw - 1, x)); y = max(0, min(ih - 1, y))
    w = max(1, min(iw - x, w)); h = max(1, min(ih - y, h))
    result = {'bbox': [x,y,w,h], 'text': str(edit.get('text', ''))[:2500],
              'font_size': max(8, min(180, int(edit.get('font_size', 28)))),
              'text_color': str(edit.get('text_color', '#000000')),
              'stroke_color': str(edit.get('stroke_color', '#ffffff')),
              'stroke_width': max(0, min(12, int(edit.get('stroke_width', 2)))),
              'align': str(edit.get('align', 'left')),
              'visible': bool(edit.get('visible', True)),
              'font_id': kwt_validate_font_id(str(edit.get('font_id','system'))),
               'rich_enabled':bool(edit.get('rich_enabled',False)),
               'auto_fit':bool(edit.get('auto_fit',False)),
               'shape_fit':bool(edit.get('shape_fit',False)),
               'pillow_sync':bool(edit.get('pillow_sync',True)),
               'rotation':round(rotation,2),
               'shape_class_override':shape_override,
               'font_policy_auto':bool(edit.get('font_policy_auto',False))}
    for key in ('text_color', 'stroke_color'):
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', result[key]):
            raise ValueError('Color must be #RRGGBB')
    if result['align'] not in ('left', 'center', 'right'):
        result['align'] = 'left'
    return result


# KWT_STUDIO_LAYER_CRUD_BACKEND_V1_6_1: stable manual layer IDs, independent from OCR IDs.
MANUAL_LAYER_ID = re.compile(r'^manual-[a-z0-9_-]{8,80}$')


class Project:
    def __init__(self, source, output=None):
        source = Path(source).resolve()
        if not source.is_file() or source.suffix.lower() != '.zip' or source.stem.endswith('_ko'):
            raise ValueError('일본어 원본 ZIP 경로를 선택하세요.')
        if not zipfile.is_zipfile(source):
            raise ValueError('ZIP 파일이 손상되었습니다.')
        self.source = source
        self.result = _result_path(source, output)
        self.meta_path = _meta_path(self.result)
        self.edit_path = _sidecar(self.result)
        self.id = _key(source)
        self.names = sorted(_entry_list(source), key=natural)
        self.records = {}
        self.live = {}
        self.edits = _json_file(self.edit_path, {}).get('pages', {})
        self.lock = threading.RLock()
        self.state = 'ready' if not self.result.is_file() else 'completed'
        self.detail = '완료 ZIP을 불러왔습니다.' if self.result.exists() else '처리 대기 중'
        self.completed = 0
        self.total = len(self.names)
        self.error = None
        self.load_metadata()

    def load_metadata(self):
        metadata = _json_file(self.meta_path, {})
        self.records.update({r.get('entry_name'): r for r in metadata.get('images', []) if r.get('entry_name')})
        for rec in metadata.get('images', []):
            name = rec.get('entry_name')
            if name and name not in self.edits and rec.get('studio_manual_edits'):
                self.edits[name] = rec['studio_manual_edits']
        self.completed = len(self.records) if self.state == 'completed' else self.completed

    def status(self):
        with self.lock:
            return {'id': self.id, 'source': str(self.source), 'source_name': self.source.name,
                    'result': str(self.result), 'state': self.state, 'detail': self.detail,
                    'completed': self.completed, 'total': self.total, 'error': self.error}

    def page_data(self, index):
        if not 0 <= index < len(self.names):
            raise ValueError('페이지 범위 초과')
        name = self.names[index]
        record = self.records.get(name, {})
        by_id = {str(t.get('region_id')): t for t in record.get('typesetting', [])}
        saved = self.edits.get(name, {})
        layers = []
        for region in record.get('regions', []):
            rid = str(region.get('id'))
            typ = by_id.get(rid, {})
            if typ.get('status') not in ('drawn', 'manual'):
                continue
            base = typ.get('typesetting_bbox') or region.get('bbox') or [0, 0, 100, 80]
            # KWT_VIRTUAL_OCR_BOX_V1_8: expose original, virtual, and rendered text boxes.
            layer = {'region_id': rid, 'ocr_bbox': region.get('bbox') or base,
                     'virtual_bbox': typ.get('virtual_typesetting_bbox') or base,
                     'rendered_text_bbox': typ.get('rendered_text_bbox'),
                     'bbox': list(base), 'text': str(region.get('translated_text') or typ.get('text') or ''),
                     'source_text': str(region.get('text') or ''), 'font_size': typ.get('font_size', 26),
                     'font_id': typ.get('font_id','system'),
                     'font_id_auto':typ.get('font_id_auto',typ.get('font_id','system')),
                     'shape_class_auto':typ.get('shape_class_auto','unknown'),
                     'shape_class_effective':typ.get('shape_class_auto','unknown'),
                     'shape_confidence':typ.get('shape_confidence',0),
                     'shape_reason':typ.get('shape_reason','legacy_unknown'),
                     'shape_class_override':None,
                     'font_policy_auto':bool(typ.get('shape_font_policy_enabled',False)),
                     'text_color': typ.get('text_color') or '#000000',
                     'stroke_color': typ.get('stroke_color') or '#ffffff',
                      'stroke_width': typ.get('stroke_width', 2),
                      'align': 'center' if typ.get('layout')=='manga_shape_rows_v1' else 'left', 'visible': True,
                      'auto_fit': False, 'shape_fit': typ.get('layout')=='manga_shape_rows_v1',
                      'shape_capable': typ.get('layout')=='manga_shape_rows_v1',
                       'pillow_sync':True, 'rotation':0,
                     'edited': rid in saved, 'rich_enabled':bool(saved.get(rid,{}).get('rich_enabled',False))}
            if saved.get(rid, {}).get('deleted'):
                continue
            layer.update(saved.get(rid, {}))
            from shape_font_policy import effective_class
            layer['shape_class_effective']=effective_class(
                layer.get('shape_class_auto'),layer.get('shape_class_override'))
            layers.append(layer)
        # Extra manually created text regions have no OCR reference region.
        for rid, edit in saved.items():
            if not MANUAL_LAYER_ID.fullmatch(str(rid)) or not isinstance(edit, dict) or edit.get('deleted'):
                continue
            bbox = list(edit.get('bbox', [80, 80, 220, 120]))
            layers.append({'region_id': rid, 'ocr_bbox': list(bbox), 'bbox': bbox,
                           'text': str(edit.get('text', '')), 'source_text': '',
                           'font_size': edit.get('font_size', 24), 'font_id': edit.get('font_id','system'),
                           'font_id_auto':edit.get('font_id_auto','system'),
                           'shape_class_auto':'unknown',
                           'shape_class_override':edit.get('shape_class_override'),
                           'shape_class_effective':edit.get('shape_class_override') or 'unknown',
                           'shape_confidence':0,
                           'shape_reason':'manual_layer',
                           'font_policy_auto':bool(edit.get('font_policy_auto',False)),
                           'text_color': edit.get('text_color', '#000000'),
                           'stroke_color': edit.get('stroke_color', '#ffffff'),
                           'stroke_width': edit.get('stroke_width', 2),
                           'align': edit.get('align', 'left'), 'visible': edit.get('visible', True),
                           'edited': True, 'rich_enabled':bool(edit.get('rich_enabled',False)),
                           'auto_fit':bool(edit.get('auto_fit',False)),
                           'shape_fit':bool(edit.get('shape_fit',False)),
                           'shape_capable':False,
                           'pillow_sync':bool(edit.get('pillow_sync',True)),
                           'rotation':float(edit.get('rotation',0))})
        can_edit = self.background_path(name, record).is_file()
        return {'name': name, 'index': index, 'total': self.total, 'record': record,
                'layers': layers, 'ocr': [r.get('bbox') for r in record.get('regions', []) if r.get('bbox')],
                'editable': can_edit, 'ready': bool(record), 'source': str(self.source), 'state': self.state}

    def background_path(self, name, record):
        inpaint = record.get('inpainting') or {}
        path = inpaint.get('cache_path')
        if path:
            candidate = Path(path) / 'clean_background.png'
            if candidate.is_file():
                return candidate
        page_index = int(record.get('index', self.names.index(name)))
        return Path(str(self.result) + '.layers') / ('page_%04d' % (page_index + 1)) / 'clean_background.png'

    def _image_bytes(self, name, kind):
        if kind == 'mask':
            record = self.records.get(name, {})
            path = self.background_path(name, record).with_name('mask.png')
            if not path.is_file():raise FileNotFoundError('원문 제거 마스크를 찾을 수 없습니다.')
            return path.read_bytes()
        if kind == 'clean':
            record = self.records.get(name, {})
            p = self.background_path(name, record)
            if not p.is_file():
                raise FileNotFoundError('clean_background.png 없음')
            return p.read_bytes()
        if kind == 'result' and name in self.live:
            cached = self.live[name]
            return Path(cached).read_bytes() if isinstance(cached, str) else cached
        path = self.source if kind == 'source' else self.result
        with zipfile.ZipFile(path) as z:
            return z.read(name)

    def image(self, index, kind, thumbnail=False):
        with self.lock:
            name = self.names[index]
            raw = self._image_bytes(name, kind)
        if thumbnail:
            with Image.open(io.BytesIO(raw)) as im:
                im.thumbnail((150, 210))
                out = io.BytesIO()
                im.convert('RGB').save(out, format='JPEG', quality=75)
                return out.getvalue(), 'image/jpeg'
        return raw, 'image/png' if kind in ('clean','mask') else ('image/jpeg' if Path(name).suffix.lower() in ('.jpg', '.jpeg') else 'image/png' if Path(name).suffix.lower()=='.png' else 'image/webp')

    def _font(self, size, font_id='system'):
        return kwt_font_for(size, font_id)

    def _manual_draw(self, painter, edit, render_cfg=None, shape_typ=None,
                     clean_image=None, target_image=None):  # KWT_MANUAL_TYPESETTING_AUTOFIT_NAV_V1
        render_cfg = render_cfg if render_cfg is not None else load_render_settings()
        # KWT_EDIT_TEXT_OVERFLOW_V1_9_3: bbox is editable layout guidance, NOT a
        # hard validation bound. Respect requested font size and never fail a
        # save because glyphs/lines exceed the original OCR-derived rectangle.
        if not edit['visible'] or not edit['text']:
            return
        # Konva rotates clockwise around the bbox center. Pillow rotates
        # counterclockwise, so use -angle and the same center pivot.
        angle=float(edit.get('rotation',0))
        if abs(angle)>0.005:
            if target_image is None:
                raise ValueError('회전 텍스트를 저장할 이미지가 없습니다.')
            x,y,w,h=edit['bbox']
            margin=max(12,min(256,int(edit['font_size']*2+edit['stroke_width']*3)))
            local=Image.new('RGBA',(w+2*margin,h+2*margin),(0,0,0,0))
            unrotated=dict(edit)
            unrotated['rotation']=0
            unrotated['bbox']=[margin,margin,w,h]
            unrotated['shape_fit']=False
            # Rotation disables bubble-shape contours, but otherwise respects
            # the box's independent Pillow/manual line-flow preference.
            unrotated['pillow_sync']=bool(edit.get('pillow_sync',False))
            self._manual_draw(ImageDraw.Draw(local),unrotated,render_cfg,
                              shape_typ=None,clean_image=None,target_image=local)
            turned=local.rotate(-angle,expand=True,resample=Image.Resampling.BICUBIC)
            left=round(x+w/2-turned.width/2)
            top=round(y+h/2-turned.height/2)
            target_image.paste(turned,(left,top),turned.getchannel('A'))
            return
        if edit.get('rich_enabled'):
            from experiment_rich_text import render_rich
            render_rich(painter,edit,lambda size:self._font(size,edit.get('font_id','system')),render_cfg)
            return
        # Respect edited font size/content while keeping bubble-aware row layout.
        # If shape no longer fits, fall back to balanced rectangular wrap.
        if (edit.get('pillow_sync',True) and shape_typ
                and shape_typ.get('layout')=='manga_shape_rows_v1'
                and edit.get('shape_fit',False) and clean_image is not None):
            from manga_shape_layout import try_shape_layout
            shape_cfg=dict(render_cfg)
            shape_cfg['typeset_min_font_size']=int(edit['font_size'])
            shape_cfg['typeset_max_font_size']=int(edit['font_size'])
            ocr_anchor=shape_typ.get('original_ocr_bbox') or edit['bbox']
            result,_=try_shape_layout(clean_image,edit['bbox'],ocr_anchor,edit['text'],painter,
                lambda size:self._font(size,edit.get('font_id','system')),
                {'text_color':edit['text_color'],'stroke_color':edit['stroke_color']},
                shape_cfg,stroke_override=edit['stroke_width'])
            if result is not None:return
        from typesetting_layout import _lines
        x, y, w, h = edit['bbox']
        font = self._font(edit['font_size'], edit.get('font_id','system'))
        stroke = edit['stroke_width']
        pad = min(4, max(1, w // 20))
        wrap_width = max(1, w - 2 * pad)
        from manual_font_fit import fitted_lines
        # OFF: exact manual newlines, no shape recomputation or auto-wrap.
        lines = (str(edit['text']).replace('\r\n','\n').replace('\r','\n').split('\n')
                 if not edit.get('pillow_sync',True)
                 else fitted_lines(painter,edit['text'],font,wrap_width,stroke))
        if lines is None:
            # If even one glyph is wider than the box, allow that glyph to
            # spill beyond the box rather than rejecting a user font choice.
            # Keep word-wrap for the rest of the text where possible.
            longest = max((painter.textlength(ch, font=font) + 2 * stroke
                           for ch in str(edit['text'])), default=1)
            lines = _lines(painter, edit['text'], font,
                           max(wrap_width, int(longest + 1)), stroke)
        if not lines:
            return
        step = max(edit['font_size'] + 2 * stroke + 2,
                   round(edit['font_size'] * render_cfg['typeset_line_height_ratio']) + 2 * stroke)
        # The user may deliberately position or size text beyond its rectangle;
        # only the actual canvas/image boundary clips the drawn output.
        for i, line in enumerate(lines):
            if not line:
                continue
            bbox = painter.textbbox((0, 0), line, font=font, stroke_width=stroke)
            tw = painter.textlength(line, font=font) + 2 * stroke
            xx = x + pad
            if edit['align'] == 'center':
                xx = x + (w - tw) / 2
            if edit['align'] == 'right':
                xx = x + w - pad - tw
            yy = y + pad + i * step
            painter.text((round(xx - bbox[0]), round(yy - bbox[1])), line,
                         font=font, fill=edit['text_color'],
                         stroke_width=stroke, stroke_fill=edit['stroke_color'])

    def render_image(self, name, edits_override=None, excluded_ids=None):
        from typesetting_layout import layout_and_draw
        record = self.records.get(name, {})
        render_cfg = record.get('render_settings') or load_render_settings()
        clean = self.background_path(name, record)
        if not clean.is_file():
            raise FileNotFoundError('텍스트 없는 복원 배경 파일이 없습니다: ' + str(clean))
        edits = edits_override if edits_override is not None else self.edits.get(name, {})
        skipped=set(excluded_ids or ())
        with Image.open(clean) as base:
            image = base.convert('RGB')
        source_clean = image.copy()  # source for original bubble mask; never the already drawn image
        painter = ImageDraw.Draw(image)
        all_typ = {str(t.get('region_id')): t for t in record.get('typesetting', [])}
        for region in record.get('regions', []):
            rid = str(region.get('id'))
            if rid in skipped: continue
            typ = all_typ.get(rid, {})
            if typ.get('status') not in ('drawn', 'manual'):
                continue
            if rid in edits:
                if edits[rid].get('deleted'):
                    continue
                self._manual_draw(painter, _normalize_edit(edits[rid], image.size), render_cfg,
                                  shape_typ=typ,clean_image=source_clean,target_image=image)
                continue
            text = str(region.get('translated_text') or typ.get('text') or '')
            if not text.strip(): continue
            bounds = typ.get('typesetting_bbox') or region.get('bbox')
            if not bounds: continue
            style = {'text_color': typ.get('text_color', '#000000'),
                     'stroke_color': typ.get('stroke_color') or '#ffffff'}
            # Matches existing automatic text layout implementation.
            from manga_shape_layout import draw_saved_or_reflow_shape
            font_fn = lambda size: self._font(size,typ.get('font_id','system'))
            if not draw_saved_or_reflow_shape(
                    painter,source_clean,typ,text,bounds,
                    typ.get('original_ocr_bbox') or region.get('bbox') or bounds,
                    font_fn,style,render_cfg):
                layout_and_draw(painter, text, bounds, font_fn, style, render_cfg=render_cfg)
        # Draw user-created text boxes after automatic boxes.
        for rid, edit in edits.items():
            if (str(rid) not in skipped and MANUAL_LAYER_ID.fullmatch(str(rid))
                    and isinstance(edit, dict) and not edit.get('deleted')):
                self._manual_draw(painter, _normalize_edit(edit, image.size), render_cfg, target_image=image)
        return image

    def _replace_zip_page(self, name, raw, compresslevel=6):
        if not self.result.is_file():
            return
        self.result.parent.mkdir(parents=True, exist_ok=True)
        backup = self.result.with_name(self.result.name + '.studio-original.bak')
        if not backup.exists():
            shutil.copy2(self.result, backup)
        fd, tmpname = tempfile.mkstemp(prefix='.kwt-studio-', suffix='.zip', dir=self.result.parent)
        os.close(fd)
        try:
            with zipfile.ZipFile(self.result, 'r') as reader, zipfile.ZipFile(tmpname, 'w') as writer:
                writer.comment = reader.comment
                for info in reader.infolist():
                    data = raw if info.filename == name else reader.read(info.filename)
                    writer.writestr(info, data, compresslevel=compresslevel if info.compress_type == zipfile.ZIP_DEFLATED else None)
            with zipfile.ZipFile(tmpname) as checker:
                if checker.testzip() is not None:
                    raise IOError('ZIP 무결성 검사 실패')
            os.replace(tmpname, self.result)
        finally:
            if os.path.exists(tmpname): os.unlink(tmpname)

    def commit_page(self, name):
        if not self.result.exists() or not name in self.records: return
        render_cfg = self.records[name].get('render_settings') or load_render_settings()
        image = self.render_image(name)
        out = io.BytesIO()
        ext = Path(name).suffix.lower()
        format_name = 'JPEG' if ext in ('.jpg', '.jpeg') else 'WEBP' if ext == '.webp' else 'PNG'
        options = {'quality': render_cfg['output_image_quality']} if format_name != 'PNG' else {}
        image.save(out, format=format_name, **options)
        self._replace_zip_page(name, out.getvalue(), render_cfg['zip_compression_level'])
        self.live[name] = out.getvalue()

    # KWT_MANUAL_TYPESETTING_AUTOFIT_NAV_V1: calculation only, no file modification.
    def fit_manual_layer(self, index, incoming, minimum=18):
        from manual_font_fit import fit_edit
        with self.lock:
            if not 0 <= index < len(self.names):raise ValueError('페이지 범위 초과')
            name=self.names[index]
            record=self.records.get(name,{})
            clean=self.background_path(name,record)
            if not clean.is_file():raise ValueError('LaMa 배경이 아직 준비되지 않았습니다.')
            with Image.open(clean) as source:
                size=source.size
                clean_image=source.convert('RGB')
            if not isinstance(incoming,dict):raise ValueError('수동 식질 입력 형식 오류')
            rid=str(incoming.get('region_id',''))
            valid={str(t.get('region_id')) for t in record.get('typesetting',[])
                   if t.get('status') in ('drawn','manual')}
            if rid not in valid and not MANUAL_LAYER_ID.fullmatch(rid):
                raise ValueError('없는 식질 영역입니다.')
            edit=_normalize_edit(incoming,size)
            cfg=record.get('render_settings') or load_render_settings()
            minimum=max(8,min(110,int(minimum)))
            typ=next((t for t in record.get('typesetting',[])
                      if str(t.get('region_id'))==rid),{})
            if typ.get('layout')=='manga_shape_rows_v1' and edit.get('shape_fit',False) and not edit.get('rich_enabled'):
                from manga_shape_layout import try_shape_layout
                blank=Image.new('RGB',size,'white')
                shape_cfg=dict(cfg)
                shape_cfg['typeset_min_font_size']=8
                shape_cfg['typeset_max_font_size']=110
                result,_=try_shape_layout(clean_image,edit['bbox'],
                    typ.get('original_ocr_bbox') or edit['bbox'],edit['text'],
                    ImageDraw.Draw(blank),lambda n:self._font(n,edit['font_id']),
                    {'text_color':edit['text_color'],'stroke_color':edit['stroke_color']},
                    shape_cfg,stroke_override=edit['stroke_width'])
                if result is not None:
                    found=int(result['font_size'])
                    return {'font_size':found,'fits_minimum':found>=minimum,
                            'minimum_requested':minimum,'layout':'bubble_shape',
                            'fallback':False,'line_count':len(result.get('shape_line_placements',[]))}
            return fit_edit(edit,lambda n:self._font(n,edit['font_id']),cfg,minimum=minimum)

    # EXP_MANGA_V2_EXACT_PREVIEW: no disk mutation, same render_image as commit_page.
    def preview_image(self, index, incoming, excluded_ids=None):
        with self.lock:
            if not 0 <= index < len(self.names):
                raise ValueError('페이지 범위 초과')
            name = self.names[index]
            record = self.records.get(name, {})
            with Image.open(self.background_path(name, record)) as base:
                size = base.size
            allowed = {str(t.get('region_id')) for t in record.get('typesetting', [])
                       if t.get('status') in ('drawn', 'manual')}
            if not isinstance(incoming, list) or len(incoming) > 500:
                raise ValueError('미리보기 변경 개수 초과')
            edits = dict(self.edits.get(name, {}))
            for edit in incoming:
                if not isinstance(edit, dict):
                    raise ValueError('미리보기 수정 데이터 오류')
                rid = str(edit.get('region_id', ''))
                is_manual = bool(MANUAL_LAYER_ID.fullmatch(rid))
                if rid not in allowed and not is_manual:
                    raise ValueError('없는 영역: ' + rid)
                if edit.get('deleted') is True:
                    if is_manual: edits.pop(rid, None)
                    else: edits[rid] = {'deleted': True}
                else:
                    edits[rid] = _normalize_edit(edit, size)
            # Exclude only in editor previews; saving/PSD render every region.
            if excluded_ids is None:excluded_ids=[]
            if not isinstance(excluded_ids,list) or len(excluded_ids)>500:
                raise ValueError('미리보기 제외 목록 오류')
            excluded=set()
            for value in excluded_ids:
                rid=str(value)
                if rid not in allowed and not MANUAL_LAYER_ID.fullmatch(rid):
                    raise ValueError('미리보기 제외 영역 오류')
                excluded.add(rid)
            out = io.BytesIO()
            rendered = self.render_image(name, edits, excluded_ids=excluded)
            rendered.save(out, 'PNG')
            return out.getvalue()

    # EXP_MANGA_V2_PSD: raster layers independent; companion edit metadata lives in sidecar.
    def export_psd(self,index):
        from experiment_psd import write_psd
        with self.lock:
            if not 0<=index<len(self.names):raise ValueError('페이지 범위 초과')
            name=self.names[index]
            record=self.records.get(name,{})
            with zipfile.ZipFile(self.source) as z:
                with Image.open(io.BytesIO(z.read(name))) as opened:
                    orig=ImageOps.exif_transpose(opened).convert('RGBA')
            bg_path=self.background_path(name,record)
            if not bg_path.is_file():raise FileNotFoundError('LaMa 복원 배경 파일 없음')
            with Image.open(bg_path) as opened:
                clean=opened.convert('RGBA')
            overlay=Image.new('RGBA',orig.size,(0,0,0,0))
            painter=ImageDraw.Draw(overlay)
            from typesetting_layout import layout_and_draw
            render_cfg=record.get('render_settings') or load_render_settings()
            edits=self.edits.get(name,{})
            all_typ={str(t.get('region_id')):t for t in record.get('typesetting',[])}
            for region in record.get('regions',[]):
                rid=str(region.get('id'))
                typ=all_typ.get(rid,{})
                if typ.get('status') not in ('drawn','manual'):continue
                if rid in edits:
                    if not edits[rid].get('deleted'):
                        self._manual_draw(painter,_normalize_edit(edits[rid],orig.size),render_cfg,
                                          shape_typ=typ,clean_image=clean.convert('RGB'),
                                          target_image=overlay)
                    continue
                text=str(region.get('translated_text') or typ.get('text') or '')
                bounds=typ.get('typesetting_bbox') or region.get('bbox')
                if text.strip() and bounds:
                    style={'text_color':typ.get('text_color','#000000'),'stroke_color':typ.get('stroke_color') or '#ffffff'}
                    from manga_shape_layout import draw_saved_or_reflow_shape
                    font_fn=lambda sz:self._font(sz,typ.get('font_id','system'))
                    if not draw_saved_or_reflow_shape(
                            painter,clean.convert('RGB'),typ,text,bounds,
                            typ.get('original_ocr_bbox') or region.get('bbox') or bounds,
                            font_fn,style,render_cfg):
                        layout_and_draw(painter,text,bounds,font_fn,style,render_cfg=render_cfg)
            for rid,edit in edits.items():
                if MANUAL_LAYER_ID.fullmatch(str(rid)) and isinstance(edit,dict) and not edit.get('deleted'):
                    self._manual_draw(painter,_normalize_edit(edit,orig.size),render_cfg,target_image=overlay)
            return write_psd([('Original source',orig),('LaMa cleaned',clean),('Korean text (raster)',overlay)])

    # KWT_EXP_PSD_DISK_SAVE_V1: avoid WebView2 blob-download inconsistencies.
    # All files stay beside this project's translated ZIP, never the source ZIP.
    def save_psd(self, index):
        with self.lock:
            if not 0 <= index < len(self.names):
                raise ValueError('페이지 범위 초과')
            name = self.names[index]
            data = self.export_psd(index)
            output_dir = self.result.parent / (self.result.stem + '_psd_layers')
            output_dir.mkdir(parents=True, exist_ok=True)
            safe_stem = re.sub(r'[^\\w.\-]+', '_', Path(name).stem, flags=re.UNICODE).strip('._')[:65] or 'page'
            target = output_dir / f'{index+1:04d}_{safe_stem}.psd'
            tmp = None
            try:
                with tempfile.NamedTemporaryFile(mode='wb', suffix='.tmp', prefix='.kwt-psd-',
                                                 dir=output_dir, delete=False) as f:
                    tmp = Path(f.name)
                    f.write(data)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, target)
            finally:
                if tmp is not None:
                    tmp.unlink(missing_ok=True)
            # Native editable text is optional: JSX for Photoshop, raster PSD
            # remains portable and unchanged for users without Photoshop.
            from experiment_photoshop_text import collect,make_jsx
            companion=target.with_suffix('.jsx')
            script=make_jsx(target,collect(self.records.get(name,{}),
                                           self.edits.get(name,{})))
            companion.write_text(script,encoding='utf-8-sig')
            return {'ok': True, 'path': str(target), 'size_bytes': len(data),
                    'photoshop_script':str(companion),
                    'layers': ['Original source', 'LaMa cleaned', 'Korean text (raster)']}

    # EXP_MANGA_V2_MASK: commit brush edits without discarding untouched source.
    def edit_mask(self, index, strokes):
        from experiment_mask_roi import apply_strokes,partial_restore
        with self.lock:
            if not 0 <= index < len(self.names):raise ValueError('페이지 범위 초과')
            name=self.names[index]
            if name not in self.records:raise ValueError('자동 식질 완료 후 마스크를 수정할 수 있습니다.')
            clean=self.background_path(name,self.records[name])
            mask_file=clean.with_name('mask.png')
            if not clean.is_file() or not mask_file.is_file():
                raise FileNotFoundError('복원 레이어가 없습니다.')
            with zipfile.ZipFile(self.source) as z:
                with Image.open(io.BytesIO(z.read(name))) as img:
                    orig=ImageOps.exif_transpose(img).convert('RGB')
            with Image.open(clean) as im:old_clean=im.convert('RGB').copy()
            with Image.open(mask_file) as im:old_mask=im.convert('L').copy()
            new_mask=apply_strokes(old_mask,strokes)
            next_clean,stats=partial_restore(orig,old_clean,old_mask,new_mask)
            if not (stats['added_pixels'] or stats['removed_pixels']):
                return {'ok':True,'changed':False,**stats}
            previous_mask=mask_file.with_name('mask.experiment-backup.png')
            previous_clean=clean.with_name('clean_background.experiment-backup.png')
            old_mask.save(previous_mask)
            old_clean.save(previous_clean)
            mask_temp=mask_file.with_name('mask.experiment.tmp.png')
            clean_temp=clean.with_name('clean_background.experiment.tmp.png')
            new_mask.save(mask_temp);next_clean.save(clean_temp)
            try:
                os.replace(mask_temp,mask_file);os.replace(clean_temp,clean)
                if self.state=='completed':
                    self.commit_page(name)
                    self._update_meta(name)
            except Exception:
                os.replace(previous_mask,mask_file)
                os.replace(previous_clean,clean)
                raise
            return {'ok':True,'changed':True,**stats}

    def save(self, index, incoming):
        with self.lock:
            name = self.names[index]
            if name not in self.records:
                raise ValueError('아직 자동 식질이 완료되지 않은 페이지입니다.')
            record = self.records[name]
            p = self.background_path(name, record)
            if not p.is_file():
                raise FileNotFoundError('복원 배경 파일이 없습니다. .layers 폴더를 확인하세요.')
            with Image.open(p) as im: size = im.size
            allowed = {str(t.get('region_id')) for t in record.get('typesetting', []) if t.get('status') in ('drawn','manual')}
            if not isinstance(incoming, list) or len(incoming) > 500:
                raise ValueError('한 번에 저장할 수 있는 식질 변경은 최대 500개입니다.')
            updated = dict(self.edits.get(name, {}))
            for edit in incoming:
                if not isinstance(edit, dict):
                    raise ValueError('식질 편집 데이터가 올바르지 않습니다.')
                rid = str(edit.get('region_id', ''))
                is_manual = bool(MANUAL_LAYER_ID.fullmatch(rid))
                if rid not in allowed and not is_manual:
                    raise ValueError('존재하지 않는 식질 영역: '+rid)
                if edit.get('deleted') is True:
                    if is_manual:
                        updated.pop(rid, None)
                    else:
                        updated[rid] = {'deleted': True}
                    continue
                updated[rid] = _normalize_edit(edit, size)
            if len(updated) > 1500:
                raise ValueError('이 페이지의 편집 레이어가 너무 많습니다.')
            # Check rendered result before modifying any files.
            preview = self.render_image(name, updated)
            del preview
            self.edits[name] = updated
            _atomic_json(self.edit_path, {'version': 1, 'source': str(self.source), 'result': str(self.result), 'pages': self.edits})
            if self.state == 'completed':
                self.commit_page(name)
                self._update_meta(name)
                return {'saved': True, 'zip_updated': True, 'message': '기존 ZIP 갱신 완료'}
            return {'saved': True, 'zip_updated': False, 'message': '편집 저장 완료. 처리 종료 시 ZIP에 자동 반영'}

    def _update_meta(self, name):
        # Persist a copy of manual layers in the standard metadata, without changing OCR reference boxes.
        if not self.meta_path.is_file():return
        metadata = _json_file(self.meta_path, {})
        for record in metadata.get('images', []):
            if record.get('entry_name') == name:
                record['studio_manual_edits'] = self.edits.get(name, {})
        backup = self.meta_path.with_name(self.meta_path.name + '.studio-original.bak')
        if not backup.is_file(): shutil.copy2(self.meta_path, backup)
        _atomic_json(self.meta_path, metadata)


def get_project(path, output=None):
    key = _key(path)
    with projects_lock:
        if key not in projects:
            projects[key] = Project(path, output)
        elif output and projects[key].state != 'running' and projects[key].result != _result_path(path, output):
            projects[key] = Project(path, output)
        return projects[key]


def process_batch(paths, output):
    global active_batch
    from zip_pipeline import process_zip
    from concurrent.futures import ThreadPoolExecutor
    from runtime_settings import load as load_runtime_settings  # KWT_UNIFIED_WORKERS_V1_2

    def _process_one(source):
        project = get_project(source, output)
        with project.lock:
            if project.result.exists():
                project.state = 'completed'; project.detail = '기존 결과가 있으므로 건너뜀'; return
            project.state = 'running'; project.completed = 0; project.error = None
        def progress(**kw):
            with project.lock:
                stage = kw.get('stage', '')
                project.detail = (stage + ' | ' + str(kw.get('detail',''))).strip()
                if stage == '페이지 완료':
                    name = kw['name']
                    project.records[name] = kw.get('record') or {}
                    rec = project.records[name]
                    preview_path = Path(str(project.result) + '.layers') / ('page_%04d' % (int(rec.get('index', project.completed)) + 1)) / 'studio-live-preview.bin'
                    preview_path.parent.mkdir(parents=True, exist_ok=True)
                    preview_path.write_bytes(kw['image'])
                    project.live[name] = str(preview_path)
                    project.completed += 1
        try:
            result, metadata = process_zip(project.source, project.result.parent,
                  report=lambda line: None, cancelled=lambda: False, progress=progress)
            with project.lock:
                project.result = Path(result)
                project.meta_path = Path(metadata)
                project.load_metadata()
                project.state = 'finalizing'
                project.detail = '수동 수정 내역 최종 ZIP 반영 중'
                for name in list(project.edits):
                    if name in project.records:
                        project.commit_page(name)
                        project._update_meta(name)
                project.state = 'completed'; project.detail = '처리 완료'
                for entry in list(project.live.values()):
                    if isinstance(entry, str): Path(entry).unlink(missing_ok=True)
                project.live.clear()
        except Exception as exc:
            with project.lock:
                project.state = 'error'; project.error = str(exc)
                project.detail = str(exc)
            traceback.print_exc()
    try:
        # Snapshot ZIP worker count once at the beginning of the overall run.
        workers = load_runtime_settings()['pipeline']['zip_workers']
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix='kwt-zip') as pool:
            futures = [pool.submit(_process_one, source) for source in paths]
            for future in futures:
                future.result()
    finally:
        with queue_lock:
            active_batch = False


class Handler(BaseHTTPRequestHandler):
    server_version = 'KoneWebTranslatorStudio/1.0'

    def log_message(self, format, *args):
        if os.getenv('KWT_STUDIO_VERBOSE'): super().log_message(format, *args)

    def _cors(self):
        origin = self.headers.get('Origin','')
        if origin in ('http://localhost:1420', 'http://127.0.0.1:1420',
                      'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost') or EXT_RE.fullmatch(origin):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary','Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-KWT-Studio, X-KWT-Extension-Key, X-KWT-Font-Name, X-KWT-Chat-Id, X-KWT-Chat-Filename')

    def _send(self, status, data, content_type='application/json; charset=utf-8'):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8') if isinstance(data, (dict,list)) else data
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store')
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= 2_000_000:
            raise ValueError('JSON 요청 크기 제한(2MB)')
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        try:
            uri=urlparse(self.path); path=uri.path; q={k:v[0] for k,v in parse_qs(uri.query).items()}
            if path.startswith('/api/extension/'):
                return self._send(200, extension_get(path,q,self.headers))
            # Installer is allowed only from the Studio UI; never expose unauthenticated install controls.
            if path.startswith('/api/installer/'):
                if self.headers.get('X-KWT-Studio')!='1':
                    return self._send(403,{'error':'Studio request header required'})
                origin=self.headers.get('Origin','')
                if origin and origin not in ('http://localhost:1420','http://127.0.0.1:1420','tauri://localhost','http://tauri.localhost','https://tauri.localhost'):
                    return self._send(403,{'error':'Origin is not allowed'})
                return self._send(200,installer_get(path))
            if path.startswith('/api/chat/'):
                if self.headers.get('X-KWT-Studio')!='1':
                    return self._send(403,{'error':'Studio request header required'})
                origin=self.headers.get('Origin','')
                if origin and origin not in ('http://localhost:1420','http://127.0.0.1:1420','tauri://localhost','http://tauri.localhost','https://tauri.localhost'):
                    return self._send(403,{'error':'Origin is not allowed'})
                return self._send(200,chat_get(path,q))
            if path.startswith('/api/manager/'):
                if self.headers.get('X-KWT-Studio')!='1':
                    return self._send(403,{'error':'Studio request header required'})
                origin=self.headers.get('Origin')
                if origin and origin not in ('http://localhost:1420','http://127.0.0.1:1420','tauri://localhost','http://tauri.localhost','https://tauri.localhost'):
                    return self._send(403,{'error':'Origin is not allowed'})
                return self._send(200,studio_manager_get(path,q))
            if path.startswith('/api/fonts'):
                origin=self.headers.get('Origin','')
                if origin and origin not in ('http://localhost:1420','http://127.0.0.1:1420','tauri://localhost','http://tauri.localhost','https://tauri.localhost'):
                    return self._send(403,{'error':'Origin is not allowed'})
                if path=='/api/fonts/preview':
                    return self._send(200,kwt_font_preview(q.get('id','system')),'image/png')
                if path=='/api/fonts/file':
                    data,ctype=kwt_font_file(q.get('id',''))
                    return self._send(200,data,ctype)
                if self.headers.get('X-KWT-Studio')!='1':
                    return self._send(403,{'error':'Studio request header required'})
                if path=='/api/fonts':return self._send(200,kwt_list_fonts())
                return self._send(404,{'error':'Unknown font API'})
            if path=='/api/health': return self._send(200, {'ok': True, 'engine': str(TRANS), 'projects': len(projects), 'bridge_pid': os.getpid()})
            if path=='/api/projects':
                with projects_lock: data=[p.status() for p in projects.values()]
                return self._send(200,data)
            pid=q.get('id'); project=projects.get(pid)
            if not project: return self._send(404,{'error':'프로젝트를 먼저 선택하세요.'})
            if path=='/api/pages':
                return self._send(200,[{'index':i, 'name':name, 'ready':name in project.records,
                     'edited':bool(project.edits.get(name))} for i,name in enumerate(project.names)])
            if path=='/api/page':
                with project.lock: page=project.page_data(int(q.get('index','0')))
                return self._send(200,page)
            if path=='/api/image':
                kind=q.get('kind','result')
                if kind not in ('source','result','clean','mask'):
                    raise ValueError('Invalid image kind')
                data,ctype=project.image(int(q.get('index','0')),kind,q.get('thumb')=='1')
                return self._send(200,data,ctype)
            return self._send(404,{'error':'Unknown endpoint'})
        except PermissionError as exc:
            return self._send(403,{'error':str(exc)})
        except (ValueError,FileNotFoundError,IndexError,KeyError,zipfile.BadZipFile) as exc:
            return self._send(400,{'error':str(exc)})
        except Exception as exc:
            traceback.print_exc();return self._send(500,{'error':str(exc)})

    def do_POST(self):
        global active_batch
        try:
            path=urlparse(self.path).path
            if path.startswith('/api/extension/client/'):
                return self._send(200, extension_post(path,self._body(),self.headers))
            allowed_origins = ('http://localhost:1420', 'http://127.0.0.1:1420', 'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost')
            origin = self.headers.get('Origin')
            if origin and origin not in allowed_origins:
                return self._send(403, {'error': 'Origin is not allowed'})
            if self.headers.get('X-KWT-Studio') != '1':
                return self._send(403, {'error': 'Studio request header required'})
            path=urlparse(self.path).path
            if path=='/api/bridge/restart':
                return self._send(200,_restart_bridge_safely())
            if path=='/api/installer/chrome-action':
                return self._send(200,kwt_open_extension_guide(self._body()))
            if path=='/api/fonts/upload':
                from urllib.parse import unquote
                length=int(self.headers.get('Content-Length','0'))
                if not 32<=length<=24*1024*1024:
                    raise ValueError('글꼴 파일 용량은 최대 24MB입니다.')
                name=unquote(self.headers.get('X-KWT-Font-Name',''))
                if not name or len(name)>250:
                    raise ValueError('글꼴 파일명이 올바르지 않습니다.')
                return self._send(200,kwt_register_font(name,self.rfile.read(length)))
            if path=='/api/chat/attachment':
                from urllib.parse import unquote
                length=int(self.headers.get('Content-Length','0'))
                if not 0 < length <= 64*1024*1024:
                    raise ValueError('첨부 파일은 최대 64MB입니다.')
                cid=self.headers.get('X-KWT-Chat-Id','')
                # A valid conversation must exist before accepting its bytes.
                from chat_service import _read as kwt_chat_read, _lock as kwt_chat_lock
                with kwt_chat_lock(cid):
                    kwt_chat_read(cid)
                    result=kwt_chat_upload(cid,unquote(self.headers.get('X-KWT-Chat-Filename','')),self.rfile.read(length))
                return self._send(200,result)
            body=self._body()
            if path.startswith('/api/chat/'):
                return self._send(200,chat_post(path,body))
            # KWT_FONT_BULK_V1_9_0
            if path=='/api/fonts/apply-default':
                from font_bulk import apply_default_font
                with queue_lock:
                    if active_batch:raise RuntimeError('자동 작업 진행 중에는 폰트를 일괄 변경할 수 없습니다.')
                return self._send(200,apply_default_font(projects[body['id']]))
            if path=='/api/fonts/default':return self._send(200,kwt_font_default(str(body.get('id',''))))
            if path=='/api/fonts/remove':return self._send(200,kwt_font_remove(str(body.get('id',''))))
            if path=='/api/fonts/import-paths':return self._send(200,kwt_import_fonts(body.get('paths')))
            if path.startswith('/api/extension/studio/'):
                return self._send(200,extension_post(path,body,self.headers))
            if path.startswith('/api/installer/'):
                with queue_lock:
                    processing=active_batch
                return self._send(200,installer_post(path,body,processing=processing))
            if path.startswith('/api/manager/'):
                return self._send(200,studio_manager_post(path,body))
            if path=='/api/scan':
                root=Path(body.get('root','')).expanduser().resolve()
                if not root.is_dir(): raise ValueError('존재하는 폴더를 선택하세요.')
                # Limit recursion to predictable discovery on huge drives.
                candidates = root.rglob('*.zip') if body.get('recursive',False) else root.glob('*.zip')
                found = []
                for p in candidates:
                    if p.is_file() and not p.stem.lower().endswith('_ko'):
                        found.append(p)
                        if len(found) >= 2000: break
                files = sorted(found, key=lambda p:natural(p.name))
                return self._send(200,[{'path':str(f),'name':f.name, 'processed':_result_path(f).exists()} for f in files])
            if path=='/api/open':
                project=get_project(body['source'], body.get('output_dir'))
                return self._send(200,project.status())
            # KWT_REVIEW_CLEANUP_V1_9_2: confirmed cleanup of completed artifacts only.
            if path in ('/api/review/cleanup-preview','/api/review/cleanup'):
                from review_cleanup import cleanup
                selected=body.get('paths',[])
                if not isinstance(selected,list):raise ValueError('ZIP 목록 형식이 올바르지 않습니다.')
                with queue_lock:
                    if active_batch:raise RuntimeError('자동 번역 작업이 진행 중이거나 작업 잠금이 남아 있습니다. 정리할 수 없습니다.')
                    with projects_lock:
                        busy=[str(p.source).casefold() for p in projects.values() if p.state in ('running','finalizing')]
                    result=cleanup(selected,body.get('output_dir'),body.get('keep_original',True),
                                   dry_run=path.endswith('cleanup-preview'),busy_paths=busy)
                    if not path.endswith('cleanup-preview') and result['ok']:
                        with projects_lock:
                            for src in selected:
                                projects.pop(_key(src),None)
                    return self._send(200,result)
            if path=='/api/process':
                paths=body.get('paths',[])
                if not isinstance(paths,list) or not paths or len(paths)>100:
                    raise ValueError('1~100개 ZIP을 선택하세요.')
                output=body.get('output_dir')
                if output and not Path(output).is_dir():
                    raise ValueError('출력 폴더가 존재하지 않습니다.')
                # KWT_UNIFIED_WORKERS_V1_2: reject duplicate sources/outputs before
                # spawning any worker; avoids two ZIP threads writing the same name.
                selected = [get_project(src,output) for src in paths]
                names = [str(p.result.resolve()).casefold() for p in selected]
                if len(names) != len(set(names)):
                    raise ValueError('선택한 ZIP 중 출력 파일 경로가 중복됩니다. 파일명/출력 폴더를 확인하세요.')
                with queue_lock:
                    if active_batch:return self._send(409,{'error':'기존 자동 작업이 진행 중입니다.'})
                    active_batch=True
                threading.Thread(target=process_batch,args=(list(paths),output),daemon=True).start()
                return self._send(202,{'started':len(paths)})
            if path=='/api/experiment/export-psd':
                project=projects.get(str(body.get('id','')))
                if project is None:raise ValueError('먼저 ZIP을 선택하세요')
                return self._send(200,project.save_psd(int(body.get('index',0))))
            if path=='/api/experiment/mask':
                project=projects.get(str(body.get('id','')))
                if project is None:raise ValueError('먼저 ZIP을 선택하세요')
                return self._send(200,project.edit_mask(int(body.get('index',0)),body.get('strokes',[])))
            if path=='/api/experiment/manual-fit':
                project=projects.get(str(body.get('id','')))
                if project is None:raise ValueError('먼저 ZIP을 선택하세요')
                return self._send(200,project.fit_manual_layer(int(body.get('index',0)),
                    body.get('edit',{}),body.get('minimum',18)))
            if path=='/api/experiment/preview':
                project = projects.get(str(body.get('id', '')))
                if project is None: raise ValueError('먼저 ZIP을 선택하세요')
                png = project.preview_image(int(body.get('index',0)),body.get('edits',[]),body.get('exclude_region_ids',[]))
                return self._send(200,png,'image/png')
            if path=='/api/save':
                project=projects[body['id']]
                result=project.save(int(body['index']),body.get('edits',[]))
                return self._send(200,result)
            return self._send(404,{'error':'Unknown endpoint'})
        except PermissionError as exc:
            return self._send(403,{'error':str(exc)})
        except RuntimeError as exc:
            return self._send(409,{'error':str(exc)})
        except (KeyError,ValueError,FileNotFoundError,IndexError,zipfile.BadZipFile) as exc:
            return self._send(400,{'error':str(exc)})
        except Exception as exc:
            traceback.print_exc();return self._send(500,{'error':str(exc)})


def _kwt_bridge_exit_watchdog():
    """Exit the Bridge when the LAST GUI closes; preserve running disk jobs.

    A missing pagehide on a crashed GUI is handled by manager_service's existing
    45-second session expiry. Never terminate an unrelated or external process.
    """
    idle_since = None
    while True:
        time.sleep(1.0)
        if bridge_server is None or not kwt_bridge_shutdown_ready():
            idle_since = None
            continue
        if idle_since is None:
            idle_since = time.monotonic()
        if time.monotonic() - idle_since < 3.0:
            continue  # allow quick GUI reload/reopen
        with queue_lock:
            busy = bool(active_batch or bridge_restarting)
        with projects_lock:
            busy = busy or any(p.state in ('running', 'finalizing') for p in projects.values())
        with installer_service.LOCK:
            busy = busy or installer_service.CURRENT is not None
        busy = busy or chat_busy()  # Keep Bridge alive during chat inference / memory compaction.
        if busy:
            continue  # do not interrupt ZIP writes, tests, model downloads, or chat
        if not kwt_bridge_shutdown_ready():
            idle_since = None
            continue
        # The BAT/hidden console may already have exited; do not print to a dead stdout.
        try:
            log_path = BASE / 'studio-bridge' / '.studio_runtime' / 'bridge_lifecycle.log'
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open('a', encoding='utf-8') as log:
                log.write('%s GUI closed; Bridge shutdown PID=%d\n' %
                          (time.strftime('%Y-%m-%d %H:%M:%S'), os.getpid()))
        except OSError:
            pass
        bridge_server.shutdown()  # called from a separate thread, never HTTP handler
        return


if __name__=='__main__':
    print('[KWT STUDIO] http://127.0.0.1:%d (loopback only)' % PORT, flush=True)
    print('[KWT STUDIO] Python:',sys.executable, flush=True)
    bridge_server = ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    threading.Thread(target=_kwt_bridge_exit_watchdog, name='kwt-bridge-exit', daemon=True).start()
    try:bridge_server.serve_forever()
    finally:bridge_server.server_close()
