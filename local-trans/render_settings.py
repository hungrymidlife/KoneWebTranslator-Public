"""KWT_UNIFIED_IMAGE_V1_5: one validated rendering profile for ZIP and Studio review.

Read once at ZIP-job start; store the profile in each page's metadata so later
manual rerenders match the original automatic layout even after GUI changes.
"""
from __future__ import annotations
import json
import math
from pathlib import Path

CONFIG_PATH = Path(__file__).resolve().parent.parent / 'runtime_settings.json'
DEFAULTS = {
    'lama_tile_size': 768,
    'lama_tile_context': 72,
    'typeset_min_font_size': 8,
    'typeset_max_font_size': 72,
    'typeset_padding_percent': 4.5,
    'typeset_line_height_ratio': 1.24,
    'output_image_quality': 92,
    'zip_compression_level': 6,
    # KWT_VIRTUAL_OCR_BOX_V1_8: separate OCR bbox and Korean layout bbox.
    # KWT_VIRTUAL_BUBBLE_SAFE_V4_2 · default width 100%, height 100%.
    'virtual_box_width_percent': 100,
    'virtual_box_height_percent': 100,
    # KWT_SHAPE_FONT_V1: categories default to existing library font.
    'shape_font_policy_enabled': True,
    'font_id_round_bubble':'default', 'font_id_rect_box':'default',
    'font_id_no_bubble':'default', 'font_id_unknown':'default',
}
INTEGER_RANGES = {
    'lama_tile_size': (512, 1024),
    'lama_tile_context': (0, 256),
    'typeset_min_font_size': (8, 48),
    'typeset_max_font_size': (8, 96),
    'output_image_quality': (60, 100),
    'zip_compression_level': (0, 9),
    'virtual_box_width_percent': (100, 200),
    'virtual_box_height_percent': (100, 200),
}
FLOAT_RANGES = {
    'typeset_padding_percent': (0.0, 15.0),
    'typeset_line_height_ratio': (1.0, 1.8),
}

def validate(value):
    # Old ZIP metadata can contain a full V1.5 profile without virtual boxes.
    optional = {'virtual_box_width_percent', 'virtual_box_height_percent',
                'shape_font_policy_enabled', 'font_id_round_bubble',
                'font_id_rect_box', 'font_id_no_bubble','font_id_unknown'}
    if not isinstance(value, dict) or set(value) - set(DEFAULTS) or set(DEFAULTS) - set(value) - optional:
        raise ValueError('이미지/식질 설정의 키가 올바르지 않습니다.')
    normalized = {}
    for key, default in DEFAULTS.items():
        item = value.get(key, default)
        if key == 'shape_font_policy_enabled':
            if type(item) is not bool:
                raise ValueError('유형별 폰트 사용 설정은 true/false여야 합니다.')
            normalized[key]=item
        elif key.startswith('font_id_'):
            from shape_font_policy import valid_policy_font
            if not valid_policy_font(item):
                raise ValueError(f'{key}: 등록 폰트 ID 또는 default/system만 허용됩니다.')
            normalized[key]=item
        elif key in INTEGER_RANGES:
            a, b = INTEGER_RANGES[key]
            if type(item) is not int or not a <= item <= b:
                raise ValueError(f'이미지/식질 {key}: {a}~{b} 정수가 필요합니다.')
            normalized[key] = item
        else:
            a, b = FLOAT_RANGES[key]
            if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) or not a <= item <= b:
                raise ValueError(f'이미지/식질 {key}: {a}~{b} 숫자가 필요합니다.')
            normalized[key] = float(item)
    if normalized['typeset_min_font_size'] > normalized['typeset_max_font_size']:
        raise ValueError('식질 최소 글꼴 크기가 최대 글꼴 크기보다 큽니다.')
    if normalized['lama_tile_context'] * 2 >= normalized['lama_tile_size']:
        raise ValueError('LaMa 주변 문맥이 타일 크기에 비해 너무 큽니다.')
    return normalized

def load_render_settings():
    if not CONFIG_PATH.exists():
        return DEFAULTS.copy()
    data = json.loads(CONFIG_PATH.read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise ValueError('통합 설정 JSON 버전이 올바르지 않습니다.')
    group = data.get('typesetting', DEFAULTS)
    return validate(group)
