"""KWT_UNIFIED_WORKERS_V1_2: bounded workers from runtime_settings.json.

Worker pools are constructed once per OCR service process; restart the OCR server
when changing these values. Missing config falls back to historic single worker.
"""
import json
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / 'runtime_settings.json'


def worker_count(name, maximum):
    if name not in ('ocr_workers', 'translation_workers'):
        raise ValueError('Unknown worker setting')
    if not CONFIG.is_file():
        return 1
    conf = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
    if not isinstance(conf, dict) or conf.get('schema_version') != 1:
        raise ValueError('Invalid runtime settings schema')
    pipeline = conf.get('pipeline')
    if not isinstance(pipeline, dict):
        raise ValueError('Missing pipeline settings')
    value = pipeline.get(name, 1)  # Compatibility with V1 config.
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError(f'Invalid {name}: expected integer between 1 and {maximum}')
    return value
