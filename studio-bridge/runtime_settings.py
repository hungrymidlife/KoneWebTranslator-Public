"""KWT_UNIFIED_RUNTIME_V1: persistent, validated Studio runtime configuration.

Single file shared by Studio, the Gemma PowerShell launcher and ZIP pipeline.
Only explicitly whitelisted settings can be saved by the GUI.
"""
from __future__ import annotations

import copy
import json
import math
import os
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = PROJECT_ROOT / 'runtime_settings.json'
DEFAULTS = {
    'schema_version': 1,
    'gemma': {
        'context_size': 8192, 'gpu_layers': 99, 'flash_attention': 'on',
        'parallel_slots': 1, 'top_k': 64, 'top_p': 0.9,
        'min_p': 0.05, 'repeat_penalty': 1.1,
    },
    'pipeline': {'batch_pages': 3, 'batch_raw_mb': 22,  # KWT_UNIFIED_WORKERS_V1_2
                 'ocr_workers': 1, 'translation_workers': 1, 'zip_workers': 1},
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
}
FLOAT_RULES = {
    ('gemma', 'top_p'): (0.01, 1.0),
    ('gemma', 'min_p'): (0.0, 1.0),
    ('gemma', 'repeat_penalty'): (1.0, 2.0),
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
    if set(value) != set(DEFAULTS):
        raise ValueError('통합 설정 상위 필드가 누락되었거나 알 수 없는 필드가 있습니다.')
    result = copy.deepcopy(DEFAULTS)
    for section in ('gemma', 'pipeline'):
        data = value.get(section)
        if not isinstance(data, dict):
            raise ValueError(f'{section} 설정이 유효하지 않습니다.')
        # KWT_UNIFIED_WORKERS_V1_2: old V1 JSONs may omit the three new worker keys.
        missing = set(DEFAULTS[section]) - set(data)
        legacy_keys = {'ocr_workers', 'translation_workers', 'zip_workers'} if section == 'pipeline' else set()
        if set(data) - set(DEFAULTS[section]) or missing - legacy_keys:
            raise ValueError(f'{section} 설정 항목이 누락되었거나 알 수 없는 항목이 있습니다.')
        for key, item in data.items():
            result[section][key] = _validate(section, key, item)
    return result


def load():
    if not CONFIG_FILE.is_file():
        return copy.deepcopy(DEFAULTS)
    data = json.loads(CONFIG_FILE.read_text(encoding='utf-8-sig'))
    return normalize(data)


def save(value):
    data = normalize(value)
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
    return {'values': load(), 'defaults': copy.deepcopy(DEFAULTS), 'stored': CONFIG_FILE.is_file()}
