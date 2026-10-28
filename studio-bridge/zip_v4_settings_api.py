"""KWT_ZIP_V4_GUI_V4_1: manage the existing V4.0 settings file via Studio.

Single source of truth with V4.0 OPTIONS.bat. No changed runtime_settings schema.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'local-trans' / 'zip_pipeline_v4_settings.json'
ENGINE = ROOT / 'local-trans' / 'zip_pipeline_v4.py'
_LOCK = threading.RLock()
DEFAULTS = {
    'schema_version': 1,
    'enabled': True,
    'overlap_lama_with_ai': True,
    'encode_workers': 2,
    'max_inflight_pages': 4,
    'poll_interval_seconds': 0.35,
}


def _ensure_installed():
    if not ENGINE.is_file() or not CONFIG.is_file() or ENGINE.is_symlink() or CONFIG.is_symlink():
        raise ValueError('로컬 ZIP V4.0 엔진/설정이 없습니다. V4.0 패치를 먼저 적용하세요.')
    if 'KWT_ZIP_CONTINUOUS_STREAM_V4_0' not in ENGINE.read_text(encoding='utf-8-sig'):
        raise ValueError('ZIP V4.0 엔진 버전을 확인할 수 없습니다.')


def _validate(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError('ZIP V4 설정 키가 일치하지 않습니다.')
    if type(value['schema_version']) is not int or value['schema_version'] != 1:
        raise ValueError('ZIP V4 설정 버전이 올바르지 않습니다.')
    for key in ('enabled', 'overlap_lama_with_ai'):
        if type(value[key]) is not bool:
            raise ValueError('ZIP V4 설정 true/false 필요: ' + key)
    for key, a, b in [('encode_workers', 1, 4), ('max_inflight_pages', 2, 8)]:
        if type(value[key]) is not int or not a <= value[key] <= b:
            raise ValueError(f'ZIP V4 설정 {key}는 {a}~{b} 정수여야 합니다.')
    p = value['poll_interval_seconds']
    if type(p) not in (int, float) or not 0.15 <= p <= 2.0:
        raise ValueError('ZIP V4 상태 확인 간격은 0.15~2초여야 합니다.')
    return dict(value)


def _read():
    _ensure_installed()
    return _validate(json.loads(CONFIG.read_text(encoding='utf-8-sig')))


def _revision(value):
    packed = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(packed.encode('utf-8')).hexdigest()


def payload():
    with _LOCK:
        values = _read()
        return {'values': values, 'defaults': dict(DEFAULTS), 'revision': _revision(values)}


def save(body):
    if not isinstance(body, dict) or set(body) != {'values', '__expected_revision'}:
        raise ValueError('ZIP V4 저장 요청 형식이 올바르지 않습니다.')
    expected = body['__expected_revision']
    if not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected):
        raise ValueError('ZIP V4 설정 리비전이 올바르지 않습니다.')
    values = _validate(body['values'])
    with _LOCK:
        current = _read()
        if _revision(current) != expected:
            raise ValueError('다른 창 또는 OPTIONS.bat에서 ZIP 설정이 변경됐습니다. 저장값을 다시 불러오세요.')
        # Do not rewrite a file for a no-op save; avoid unnecessary watcher events.
        if current != values:
            fd, temp = tempfile.mkstemp(prefix='.kwt-v4-gui-', suffix='.tmp', dir=CONFIG.parent)
            try:
                with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as f:
                    json.dump(values, f, ensure_ascii=False, indent=2, allow_nan=False)
                    f.write('\n')
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(temp, CONFIG)
            finally:
                if os.path.exists(temp):
                    os.unlink(temp)
        return {'values': values, 'revision': _revision(values)}
