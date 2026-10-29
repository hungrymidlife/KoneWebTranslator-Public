"""KWT_MANUAL_FIT_V1: Pillow-measured non-destructive manual font fitting.

Uses the exact word wrapping & line height used in the Studio manual renderer.
No OCR, translation or image bytes are changed by this module.
"""
from __future__ import annotations

import math
import re
from PIL import Image, ImageDraw

from typesetting_layout import _lines

RICH_TAGS = re.compile(r'(\*\*|\[\[color:#[0-9a-fA-F]{6}\]\]|\[\[/color\]\])')


def display_text(edit):
    raw = str(edit.get('text') or '')
    return RICH_TAGS.sub('', raw) if edit.get('rich_enabled') else raw


def fitted_lines(draw, text, font, width, stroke):
    """Prefer DP balancing when it does not increase the number of lines."""
    greedy = _lines(draw, text, font, width, stroke)
    if not greedy:
        return greedy
    from smart_linebreak import balanced_lines
    proposal = balanced_lines(draw, text, font, width, stroke)
    if proposal and len(proposal) <= len(greedy):
        return proposal
    return greedy


def line_metrics(draw, edit, size, font_for, settings):
    bbox = edit['bbox']
    w, h = int(bbox[2]), int(bbox[3])
    stroke = int(edit.get('stroke_width', 0))
    pad = min(4, max(1, w // 20))
    allowed_w, allowed_h = max(1, w - 2 * pad), max(1, h - 2 * pad)
    font = font_for(size)
    text = display_text(edit)
    lines = fitted_lines(draw, text, font, allowed_w, stroke)
    if not lines:
        return {'fits': False, 'lines': [], 'size': size, 'width': 0,
                'height': 0, 'available_width': allowed_w, 'available_height': allowed_h}
    widths = [float(draw.textlength(line, font=font)) + 2 * stroke for line in lines]
    advance = max(size + 2 * stroke + 2,
                  round(size * float(settings['typeset_line_height_ratio'])) + 2 * stroke)
    used_h = len(lines) * advance
    return {'fits': max(widths, default=0) <= allowed_w and used_h <= allowed_h,
            'lines': lines, 'size': size, 'width': max(widths, default=0),
            'height': used_h, 'advance': advance,
            'available_width': allowed_w, 'available_height': allowed_h}


def fit_edit(edit, font_for, settings, minimum=18, max_size=110):
    """Return largest integer font size fitting a user-controlled rectangular bbox.

    A minimum is advisory only; text is never silently clipped or dropped.
    """
    bbox = edit.get('bbox', [])
    if len(bbox) != 4 or not all(isinstance(x, (int, float)) and math.isfinite(x) for x in bbox):
        raise ValueError('유효한 텍스트 박스 좌표가 필요합니다.')
    if bbox[2] <= 0 or bbox[3] <= 0:
        raise ValueError('텍스트 박스 너비와 높이는 양수여야 합니다.')
    minimum = max(8, min(110, int(minimum)))
    max_size = max(8, min(180, int(max_size)))
    if not display_text(edit).strip():
        raise ValueError('자동 글자 크기 조절을 위해 한국어 문장을 입력하세요.')
    draw = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    for size in range(max_size, 7, -1):
        metrics = line_metrics(draw, edit, size, font_for, settings)
        if metrics['fits']:
            return {'font_size': size, 'fits_minimum': size >= minimum,
                    'minimum_requested': minimum, 'line_count': len(metrics['lines']),
                    'used_width': round(metrics['width'], 2),
                    'used_height': metrics['height'],
                    'layout': 'balanced_rectangle', 'fallback': False}
    # One Korean glyph can be physically wider than a tiny region at 8px.
    # Return a size and an explicit unsuccessful fit status; never claim fit.
    return {'font_size': 8, 'fits_minimum': False, 'minimum_requested': minimum,
            'line_count': 0, 'used_width': 0, 'used_height': 0,
            'layout': 'no_fit', 'fallback': True}
