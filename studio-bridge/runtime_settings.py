"""KWT_UNIFIED_RUNTIME_V1: persistent, validated Studio runtime configuration.

Single file shared by Studio, the Gemma PowerShell launcher and ZIP pipeline.
Only explicitly whitelisted settings can be saved by the GUI.
"""
from __future__ import annotations

import copy
import hashlib
import json
import threading
import math
import os
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = PROJECT_ROOT / 'runtime_settings.json'
# KWT_UNIFIED_STABILITY_V1_6: avoid lost updates from two open Studio windows.
_SAVE_LOCK = threading.RLock()
DEFAULTS = {
    'schema_version': 1,
    'gemma': {
        'context_size': 8192, 'gpu_layers': 99, 'flash_attention': 'on',
        'parallel_slots': 1, 'top_k': 64, 'top_p': 0.9,
        'min_p': 0.05, 'repeat_penalty': 1.1,
        'mmproj_enabled': False,  # KWT_PRIVATE_MMPROJ_TOGGLE_V3_0 (defaults OFF)
    },
    'pipeline': {'batch_pages': 3, 'batch_raw_mb': 22,  # KWT_UNIFIED_WORKERS_V1_2
                 'ocr_workers': 1, 'translation_workers': 1, 'zip_workers': 1},
    # KWT_UNIFIED_ADVANCED_V1_3: values used by new OCR jobs and translation requests.
    'ocr': {'pad_x_percent': 12.0, 'pad_y_percent': 8.0},
    'translation': {'max_region_count': 20, 'max_source_chars': 1200, 'timeout_sec': 120,
                    'top_k': 64, 'top_p': 0.9, 'min_p': 0.05},
    # KWT_UNIFIED_CHAT_V1_4: shared controls; per-conversation options remain in chat records.
    # KWT_UNIFIED_IMAGE_V1_5: shared automatic/review profile.
    'typesetting': {'lama_tile_size': 768, 'lama_tile_context': 72,
                    'typeset_min_font_size': 8, 'typeset_max_font_size': 72,
                    'typeset_padding_percent': 4.5, 'typeset_line_height_ratio': 1.24,
                    'output_image_quality': 92, 'zip_compression_level': 6,
                    # KWT_VIRTUAL_OCR_BOX_V1_8
                    # KWT_VIRTUAL_BUBBLE_SAFE_V4_2
                    'virtual_box_width_percent': 100, 'virtual_box_height_percent': 100,
                    'shape_font_policy_enabled': True,
                    'font_id_round_bubble':'default', 'font_id_rect_box':'default',
                    'font_id_no_bubble':'default', 'font_id_unknown':'default'},
    'chat': {'context_reserve': 400, 'auto_reply_margin': 512, 'summary_batch_messages': 4,
             'summary_chunk_budget': 1150, 'summary_output_tokens': 700,
             'summary_max_chars': 2200, 'summary_previous_chars': 2000,
             'timeout_sec': 300, 'continue_limit': 3},
}

INTEGER_RULES = {
    ('gemma', 'context_size'): (2048, 131072),
    ('gemma', 'gpu_layers'): (0, 999),
    ('gemma', 'parallel_slots'): (1, 16),
    ('gemma', 'top_k'): (0, 200),
    ('pipeline', 'batch_pages'): (1, 20),
    ('pipeline', 'batch_raw_mb'): (4, 22),
    ('pipeline', 'ocr_workers'): (1, 2),
    ('pipeline', 'translation_workers'): (1, 4),
    ('pipeline', 'zip_workers'): (1, 2),
    ('translation', 'max_region_count'): (1, 20),
    ('translation', 'max_source_chars'): (100, 1200),
    ('translation', 'timeout_sec'): (30, 600),
    ('translation', 'top_k'): (0, 200),
    ('chat', 'context_reserve'): (200, 1500),
    ('chat', 'auto_reply_margin'): (256, 2048),
    ('chat', 'summary_batch_messages'): (1, 10),
    ('chat', 'summary_chunk_budget'): (500, 2500),
    ('chat', 'summary_output_tokens'): (256, 1600),
    ('chat', 'summary_max_chars'): (500, 8000),
    ('chat', 'summary_previous_chars'): (500, 6000),
    ('chat', 'timeout_sec'): (30, 900),
    ('chat', 'continue_limit'): (1, 6),
    ('typesetting', 'lama_tile_size'): (512, 1024),
    ('typesetting', 'lama_tile_context'): (0, 256),
    ('typesetting', 'typeset_min_font_size'): (8, 48),
    ('typesetting', 'typeset_max_font_size'): (8, 96),
    ('typesetting', 'output_image_quality'): (60, 100),
    ('typesetting', 'zip_compression_level'): (0, 9),
    ('typesetting', 'virtual_box_width_percent'): (100, 200),
    ('typesetting', 'virtual_box_height_percent'): (100, 200),
}
FLOAT_RULES = {
    ('gemma', 'top_p'): (0.01, 1.0),
    ('gemma', 'min_p'): (0.0, 1.0),
    ('gemma', 'repeat_penalty'): (1.0, 2.0),
    ('ocr', 'pad_x_percent'): (0.0, 40.0),
    ('ocr', 'pad_y_percent'): (0.0, 40.0),
    ('translation', 'top_p'): (0.01, 1.0),
    ('translation', 'min_p'): (0.0, 1.0),
    ('typesetting', 'typeset_padding_percent'): (0.0, 15.0),
    ('typesetting', 'typeset_line_height_ratio'): (1.0, 1.8),
}


def _validate(section, key, value):
    if (section, key) in INTEGER_RULES:
        lo, hi = INTEGER_RULES[(section, key)]
        if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
            raise ValueError(f'{section}.{key}: {lo}~{hi} 정수가 필요합니다.')
    elif (section, key) in FLOAT_RULES:
        lo, hi = FLOAT_RULES[(section, key)]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
            raise ValueError(f'{section}.{key}: {lo}~{hi} 범위가 필요합니다.')
    elif (section,key) == ('typesetting','shape_font_policy_enabled'):
        if type(value) is not bool:
            raise ValueError('typesetting.shape_font_policy_enabled: true/false만 허용됩니다.')
    elif section=='typesetting' and key.startswith('font_id_'):
        import re
        if type(value) is not str or not (
                value in ('default','system') or re.fullmatch(r'[0-9a-f]{20}',value)):
            raise ValueError(f'typesetting.{key}: 올바른 폰트 ID가 아닙니다.')
    elif (section, key) == ('gemma', 'mmproj_enabled'):
        if type(value) is not bool:
            raise ValueError('gemma.mmproj_enabled: true/false만 허용됩니다.')
    elif (section, key) == ('gemma', 'flash_attention'):
        if value not in ('on', 'off', 'auto'):
            raise ValueError('gemma.flash_attention: on / off / auto 중 선택하세요.')
    else:
        raise ValueError(f'알 수 없는 설정: {section}.{key}')
    return value


def normalize(value):
    """Accept only schema 1 with complete validated groups; preserve no unknown keys."""
    if not isinstance(value, dict) or type(value.get('schema_version')) is not int or value.get('schema_version') != 1:
        raise ValueError('지원되지 않는 runtime_settings.json schema_version입니다.')
    # KWT_UNIFIED_ADVANCED_V1_3: existing V1/V1.2 JSON lacks new groups.
    old_groups = {'gemma', 'pipeline', 'schema_version'}
    if set(value) - set(DEFAULTS) or old_groups - set(value):
        raise ValueError('통합 설정 상위 필드가 누락되었거나 알 수 없는 필드가 있습니다.')
    result = copy.deepcopy(DEFAULTS)
    for section in ('gemma', 'pipeline', 'ocr', 'translation', 'chat', 'typesetting'):  # KWT_UNIFIED_CHAT_V1_4
        data = value.get(section, {})
        if not isinstance(data, dict):
            raise ValueError(f'{section} 설정이 유효하지 않습니다.')
        missing = set(DEFAULTS[section]) - set(data)
        legacy_keys = ({'ocr_workers','translation_workers','zip_workers'} if section == 'pipeline'
                       else {'mmproj_enabled'} if section == 'gemma'
                       else set(DEFAULTS[section]) if section in ('ocr','translation','chat','typesetting') else set())
        if set(data) - set(DEFAULTS[section]) or missing - legacy_keys:
            raise ValueError(f'{section} 설정 항목이 누락되었거나 알 수 없는 항목이 있습니다.')
        for key, item in data.items():
            result[section][key] = _validate(section, key, item)
    if result['typesetting']['typeset_min_font_size'] > result['typesetting']['typeset_max_font_size']:
        raise ValueError('식질 최소 글꼴 크기가 최대 글꼴 크기보다 큽니다.')
    if result['typesetting']['lama_tile_context'] * 2 >= result['typesetting']['lama_tile_size']:
        raise ValueError('LaMa 문맥 길이가 타일 크기에 비해 너무 큽니다.')
    return result


def load():
    if not CONFIG_FILE.is_file():
        return copy.deepcopy(DEFAULTS)
    data = json.loads(CONFIG_FILE.read_text(encoding='utf-8-sig'))
    return normalize(data)


def revision(value):
    """Stable revision of the effective settings, independent of JSON whitespace."""
    serialized = json.dumps(normalize(value), sort_keys=True, ensure_ascii=False,
                            separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(serialized.encode('utf-8')).hexdigest()


def save(value):
    # Backward compatible: old clients can post the normal schema 1 object.
    # The V1.6 UI includes __expected_revision for optimistic concurrency.
    if not isinstance(value, dict):
        raise ValueError('설정 데이터는 JSON 객체여야 합니다.')
    expected = value.get('__expected_revision')
    if expected is not None and (not isinstance(expected, str) or len(expected) != 64 or
                                 any(c not in '0123456789abcdef' for c in expected)):
        raise ValueError('설정 리비전 값이 올바르지 않습니다.')
    data = normalize({k: v for k, v in value.items() if k != '__expected_revision'})
    with _SAVE_LOCK:
        current = load()
        if expected is not None and revision(current) != expected:
            raise ValueError('다른 창에서 설정이 변경되었습니다. 현재 입력값은 유지됩니다. 저장값 다시 불러오기로 충돌을 해결하세요.')
        content = (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        fd, temp = tempfile.mkstemp(prefix='.kwt-runtime-', suffix='.json', dir=PROJECT_ROOT)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, CONFIG_FILE)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
    return data


def payload():
    values = load()
    return {'values': values, 'defaults': copy.deepcopy(DEFAULTS),
            'stored': CONFIG_FILE.is_file(), 'revision': revision(values)}
