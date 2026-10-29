"""KoneWebTranslator Phase 2: full-page + overlapping-tile CTD detector.

Production-path addition. Reuses the existing CTD ONNX session and existing
Phase 1 baseline, preserving all baseline boxes. No OCR / language models are
changed; added boxes only if a tile strongly suggests a separate text island.
"""
from __future__ import annotations

import math
import time
from pathlib import Path

import numpy as np
from PIL import Image

VERSION = 'KWT_DETECTOR_PHASE2_TILES_V1'
DEFAULT = 'on'
MIN_LONG_SIDE = 1550
MAX_TILES = 6
MAX_ADDED = 100
TILE_OVERLAP = 0.16


def tile_active(detector_dir: Path | None = None) -> bool:
    detector_dir = detector_dir or Path(__file__).resolve().parents[1]
    mode_file = Path(detector_dir) / 'detector_phase2_mode.txt'
    try:
        mode = mode_file.read_text(encoding='utf-8-sig').strip().lower()
    except FileNotFoundError:
        return True
    except OSError:
        return False  # Fail closed when the switch cannot be read reliably.
    return mode == 'on'


def tile_plan(size: tuple[int, int]):
    """Bounded, overlapping full-coverage tiles, at most six per page."""
    width, height = map(int, size)
    if min(width, height) < 320 or max(width, height) < MIN_LONG_SIDE:
        return []
    ratio = height / width
    if ratio >= 2.15:
        cols, rows = (1, 3) if width < 1250 else (2, 3)
    elif ratio <= 1 / 2.15:
        cols, rows = (3, 1) if height < 1250 else (3, 2)
    elif height >= width:
        cols, rows = (2 if width >= 800 else 1), (3 if height >= 2900 else 2)
    else:
        cols, rows = (3 if width >= 2900 else 2), (2 if height >= 800 else 1)
    cols, rows = min(cols, 3), min(rows, 3)
    assert cols * rows <= MAX_TILES

    def windows(length, count):
        if count == 1:
            return [(0, length)]
        # Share (count-1) overlapping bands and cover every original pixel.
        span = min(length, math.ceil(length / (count - (count - 1) * TILE_OVERLAP)))
        starts = [round(i * (length - span) / (count - 1)) for i in range(count)]
        return [(start, start + span) for start in starts]

    return [(x1, y1, x2, y2) for y1, y2 in windows(height, rows)
            for x1, x2 in windows(width, cols)]


def _overlap(a, b):
    """Return candidate intersection divided by candidate area and by smaller area."""
    inter = (max(0, min(a.x + a.width, b.x + b.width) - max(a.x, b.x)) *
             max(0, min(a.y + a.height, b.y + b.height) - max(a.y, b.y)))
    area_a = max(1, a.width * a.height)
    area_b = max(1, b.width * b.height)
    return inter / area_a, inter / min(area_a, area_b)


def _separate(candidate, existing):
    """Only append independent candidates, never duplicate OCR over an old box."""
    for previous in existing:
        cover, smaller = _overlap(candidate, previous)
        if cover >= 0.28 or smaller >= 0.58:
            return False
    return True


def _tile_text_mask(seg, size, scale):
    from .auto_detector import _model_text_mask
    try:
        mask = _model_text_mask(seg, size, scale)
        if mask.shape != (size[1], size[0]):
            return None
        return mask
    except (ValueError, TypeError, IndexError, AttributeError):
        return None


def _supported_by_mask(reg, mask, confidence):
    if mask is None:
        # Not all fine/colored lettering is represented in CTD segmentation.
        return reg.confidence >= max(0.68, confidence + 0.25)
    area = mask[reg.y:reg.y+reg.height, reg.x:reg.x+reg.width]
    ink = int(np.count_nonzero(area))
    return ink >= 12 and ink >= min(24, max(12, reg.width * reg.height * 0.003))


def _touches_interior_edge(reg, window, page_size, margin=8):
    x1, y1, x2, y2 = window
    pw, ph = page_size
    # A partial region cut at an *internal* tile edge risks duplicate/broken OCR.
    return bool((x1 > 0 and reg.x <= margin) or
                (y1 > 0 and reg.y <= margin) or
                (x2 < pw and reg.x + reg.width >= x2-x1-margin) or
                (y2 < ph and reg.y + reg.height >= y2-y1-margin))


def augment(detector, image: Image.Image, baseline, confidence: float):
    """Return baseline + independently detected tile boxes, or baseline on failure.

    Each supplementary inference uses the same ONNX session. Stable ordering is
    kept for the downstream Hayai recognition and serialization. On an error in
    *any* tile, discard all provisional additions for this page (atomic fallback).
    """
    from .auto_detector import TextRegion, prepare_input, decode_blocks, refine_regions
    from .phase1_refiner import phase1_refine

    windows = tile_plan(image.size)
    if not windows:
        return baseline
    started = time.monotonic()
    accepted = list(baseline)
    added = 0
    try:
        for tile_window in windows:
            if added >= MAX_ADDED:
                break
            x1, y1, x2, y2 = tile_window
            with image.crop(tile_window) as crop:
                tensor, scale = prepare_input(crop)
                raw, seg = detector.session.run(['blk', 'seg'], {detector.input_name: tensor})
                # Phase 1 postprocessing also works in tile-local coordinates.
                local = phase1_refine(raw, seg, crop.size, scale, confidence)
                mask = _tile_text_mask(seg, crop.size, scale)
                for reg in local:
                    if added >= MAX_ADDED:
                        break
                    if reg.width < 5 or reg.height < 5 or _touches_interior_edge(reg, tile_window, image.size):
                        continue
                    if not _supported_by_mask(reg, mask, confidence):
                        continue
                    page_box = TextRegion(reg.x+x1, reg.y+y1, reg.width, reg.height, reg.confidence)
                    if _separate(page_box, accepted):
                        accepted.append(page_box)
                        added += 1
    except Exception as exc:
        print('[KWT_TILE_DETECT] supplementary inference failed; kept baseline: '
              + f'{type(exc).__name__}: {exc}', flush=True)
        return baseline

    elapsed = time.monotonic() - started
    print(f'[KWT_TILE_DETECT] tiles={len(windows)} baseline={len(baseline)} '
          f'added={added} final={len(accepted)} elapsed={elapsed:.2f}s', flush=True)
    return sorted(accepted, key=lambda r: (r.y, r.x, -r.confidence))
