"""KWT_VIRTUAL_OCR_BOX_V1_8: independent Korean layout rectangles.

OCR bbox belongs to recognition and inpainting. This module NEVER edits it, only
creates a page-bounded virtual rectangle for Korean text placement.
"""
from __future__ import annotations
import math


def virtual_bbox(ocr_bbox, image_size, settings):
    if len(ocr_bbox) != 4 or len(image_size) != 2:
        raise ValueError('OCR bbox / image size shape invalid')
    x, y, w, h = (float(v) for v in ocr_bbox)
    iw, ih = (int(v) for v in image_size)
    if not all(math.isfinite(z) for z in (x,y,w,h)) or w <= 0 or h <= 0 or iw <= 0 or ih <= 0:
        raise ValueError('OCR bbox / image size invalid')
    rx = int(settings.get('virtual_box_width_percent', 100))
    ry = int(settings.get('virtual_box_height_percent', 100))
    if not 100 <= rx <= 200 or not 100 <= ry <= 200:
        raise ValueError('Virtual layout ratio must be 100..200 percent')
    width = min(iw, max(1, math.ceil(w * rx / 100)))
    height = min(ih, max(1, math.ceil(h * ry / 100)))
    cx,cy = x + w/2, y + h/2
    left = max(0, min(iw - width, math.floor(cx - width/2)))
    top = max(0, min(ih - height, math.floor(cy - height/2)))
    return [left,top,width,height]


def drawn_bbox(layout_bbox, info, image_size):
    """Approximate rendered text envelope, not an OCR bounding box."""
    x, y, _, _ = layout_bbox
    px, py = int(info.get('padding_x',0)), int(info.get('padding_y',0))
    iw,ih = image_size
    left=max(0,min(iw-1,x+px)); top=max(0,min(ih-1,y+py))
    width=max(0,min(iw-left,math.ceil(info.get('used_width',0))))
    height=max(0,min(ih-top,math.ceil(info.get('used_height',0))))
    return [left,top,width,height]
