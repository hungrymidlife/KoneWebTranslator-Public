"""V14.1: horizontal, top-left Korean text layout with consistent line spacing.

This module is deliberately independent of OCR, detector and LaMa.
"""
from PIL import ImageFont
from render_settings import load_render_settings  # KWT_UNIFIED_IMAGE_V1_5


def _lines(draw, text, font, max_width, stroke):
    """Wrap left-to-right; prefer spaces, but break oversized Korean words by glyph."""
    result = []
    paragraphs = str(text).replace('\r\n', '\n').replace('\r', '\n').split('\n')
    for paragraph in paragraphs:
        words = paragraph.split(' ')
        if not paragraph.strip():
            result.append('')
            continue
        current = ''
        for word in words:
            if not word:
                continue
            candidate = (current + ' ' + word) if current else word
            if draw.textlength(candidate, font=font) + 2 * stroke <= max_width:
                current = candidate
                continue
            if current:
                result.append(current)
                current = ''
            # Break a long unspaced word only if it cannot fit in one row.
            for ch in word:
                if draw.textlength(ch, font=font) + 2 * stroke > max_width:
                    return None
                candidate = current + ch
                if current and draw.textlength(candidate, font=font) + 2 * stroke > max_width:
                    result.append(current)
                    current = ch
                else:
                    current = candidate
        if current:
            result.append(current)
    return result


def layout_and_draw(draw, text, bounds, font_for, style, prefer_vertical=None, render_cfg=None):
    """Always use horizontal Korean rows in the bbox, including tall narrow boxes.

    Individual lines start at a common left edge; rows have a fixed advance.
    Choose the largest fitting font; keep glyph aspect ratios unchanged.
    """
    render_cfg = render_cfg if render_cfg is not None else load_render_settings()
    x, y, w, h = [int(v) for v in bounds]
    if w <= 0 or h <= 0 or not str(text).strip():
        return None
    pad_x = 0 if render_cfg['typeset_padding_percent'] == 0 else max(2, round(w * render_cfg['typeset_padding_percent'] / 100.))
    pad_y = 0 if render_cfg['typeset_padding_percent'] == 0 else max(2, round(h * render_cfg['typeset_padding_percent'] / 100.))
    inner_w, inner_h = w - 2 * pad_x, h - 2 * pad_y
    if inner_w <= 0 or inner_h <= 0:
        return None
    chosen = None
    for size in range(min(render_cfg['typeset_max_font_size'], max(render_cfg['typeset_min_font_size'], inner_h)),
                      render_cfg['typeset_min_font_size'] - 1, -1):
        font = font_for(size)
        stroke = max(1, min(3, 1 if size <= 18 else 2 if size <= 34 else 3))
        lines = _lines(draw, text, font, inner_w, stroke)
        if not lines:
            continue
        line_h = max(size + stroke * 2 + 2, round(size * render_cfg['typeset_line_height_ratio']) + stroke * 2)
        used_h = len(lines) * line_h
        if used_h > inner_h:
            continue
        widths = [draw.textlength(line, font=font) + 2 * stroke for line in lines]
        if max(widths, default=0) > inner_w:
            continue
        chosen = (size, font, stroke, lines, line_h, max(widths, default=0), used_h)
        break
    if chosen is None:
        return None
    size, font, stroke, lines, line_h, used_w, used_h = chosen
    left, top = x + pad_x, y + pad_y
    # Pixel-aligned glyph top avoids font ascender bearing causing staggered rows.
    for i, line in enumerate(lines):
        if not line:
            continue
        bb = draw.textbbox((0, 0), line, font=font, stroke_width=stroke)
        yy = top + i * line_h - bb[1]
        xx = left - bb[0]
        draw.text((round(xx), round(yy)), line, font=font,
                  fill=style['text_color'], stroke_width=stroke,
                  stroke_fill=style['stroke_color'])
    return {'font_size':size, 'stroke_width':stroke, 'layout':'horizontal',
            'line_or_column_count':len(lines), 'padding_x':pad_x,
            'padding_y':pad_y, 'used_width':round(used_w, 2),
            'used_height':round(used_h, 2), 'alignment':'top_left',
            'line_spacing':line_h}
