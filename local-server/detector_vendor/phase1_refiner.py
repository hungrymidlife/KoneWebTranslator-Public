"""KWT Detector Phase 1 live: segmentation-aware candidate preservation.

Intentionally uses the existing CTD blk/seg outputs, without another model or
another ONNX inference. All caller-facing boxes are plain TextRegion objects.
"""
from __future__ import annotations

from pathlib import Path
import numpy as np

VERSION = 'KWT_DETECTOR_PHASE1_LIVE_V1'
_MAX_PROPOSALS = 360


def phase1_active(detector_dir: Path | None = None) -> bool:
    detector_dir = detector_dir or Path(__file__).resolve().parents[1]
    control = Path(detector_dir) / 'detector_phase1_mode.txt'
    try:
        return control.read_text(encoding='utf-8-sig').strip().lower() != 'off'
    except OSError:
        return True  # Live-trial default. User can revert from Studio.


def _boxes(raw, image_size, scale, confidence):
    """Decode the same release tensor as the existing decoder; no NMS yet."""
    from .auto_detector import TextRegion
    data = np.asarray(raw)
    if data.ndim == 3 and data.shape[0] == 1:
        data = data[0]
    if data.ndim != 2 or data.shape[1] < 6:
        raise ValueError(f'Invalid CTD candidate shape {data.shape}')
    if data.shape[0] == 0:
        return []
    scores = data[:, 4] * data[:, 5:].max(axis=1)
    good = np.isfinite(data).all(axis=1) & (scores >= confidence)
    data, scores = data[good], scores[good]
    if not scores.size:
        return []
    top = np.argsort(-scores, kind='stable')[:_MAX_PROPOSALS]
    data, scores = data[top], scores[top]
    bounds = np.concatenate((data[:, :2] - data[:, 2:4] / 2,
                             data[:, :2] + data[:, 2:4] / 2), axis=1) / scale
    iw, ih = image_size
    bounds[:, [0, 2]] = np.clip(bounds[:, [0, 2]], 0, iw)
    bounds[:, [1, 3]] = np.clip(bounds[:, [1, 3]], 0, ih)
    out = []
    for coords, score in zip(bounds, scores):
        x1, y1, x2, y2 = int(np.floor(coords[0])), int(np.floor(coords[1])), int(np.ceil(coords[2])), int(np.ceil(coords[3]))
        if x2 - x1 >= 4 and y2 - y1 >= 4:
            out.append(TextRegion(x1, y1, x2-x1, y2-y1, float(score)))
    return out


def _iou(a, b):
    x1, y1 = max(a.x, b.x), max(a.y, b.y)
    x2, y2 = min(a.x+a.width, b.x+b.width), min(a.y+a.height, b.y+b.height)
    intersection = max(0, x2-x1) * max(0, y2-y1)
    union = a.width*a.height + b.width*b.height - intersection
    return intersection / union if union > 0 else 0.0


def _integral(mask):
    # Integral image for O(1) ink estimates per candidate/overlap region.
    cumsum = np.pad(mask.astype(np.int32), ((1, 0), (1, 0)), mode='constant')
    return cumsum.cumsum(axis=0).cumsum(axis=1)


def _rect_ink(integral, x1, y1, x2, y2):
    return int(integral[y2, x2] - integral[y1, x2] - integral[y2, x1] + integral[y1, x1])


def _unique_mask_fraction(region, previous, mask):
    # Limit the per-candidate cost to a local crop, not the whole page.
    x1, y1 = region.x, region.y
    x2, y2 = x1 + region.width, y1 + region.height
    area = mask[y1:y2, x1:x2]
    total = int(area.sum())
    if total < 8:
        return None
    claimed = np.zeros_like(area, dtype=bool)
    for other in previous:
        xx1, yy1 = max(x1, other.x), max(y1, other.y)
        xx2, yy2 = min(x2, other.x + other.width), min(y2, other.y + other.height)
        if xx2 > xx1 and yy2 > yy1:
            claimed[yy1-y1:yy2-y1, xx1-x1:xx2-x1] = True
    novel = int((area & ~claimed).sum())
    return novel / total, novel


def phase1_refine(raw, seg, image_size, scale, confidence):
    """Keep proposals with unique segmentation ink despite geometric overlap.

    Deduplicate near-identical boxes, preserve distinct text islands, and reuse
    the existing conservative splitter. Fallback to original NMS+refiner when
    the mask is missing/weak or candidate volume is excessive.
    """
    from .auto_detector import decode_blocks, refine_regions, _model_text_mask
    candidates = _boxes(raw, image_size, scale, confidence)
    if not candidates:
        return []
    if len(candidates) > _MAX_PROPOSALS - 1:
        return refine_regions(decode_blocks(raw, image_size, scale, confidence), seg, image_size, scale)
    try:
        mask = _model_text_mask(seg, image_size, scale)
        if mask.shape != (image_size[1], image_size[0]) or not np.any(mask):
            raise ValueError('Segmentation mask is missing')
    except (ValueError, TypeError, IndexError, AttributeError):
        return refine_regions(decode_blocks(raw, image_size, scale, confidence), seg, image_size, scale)
    kept = []
    # Descending confidence; include unique-ink proposals regardless of bounding-box IoU.
    for reg in candidates:
        if any(_iou(reg, prior) >= 0.88 for prior in kept):
            continue
        if not kept:
            kept.append(reg)
            continue
        novel = _unique_mask_fraction(reg, kept, mask)
        if novel is None:
            # When model segmentation is uncertain, keep boxes not highly overlapped.
            if all(_iou(reg, prior) < .40 for prior in kept):
                kept.append(reg)
            continue
        fraction, count = novel
        if count >= 10 and fraction >= 0.10:
            kept.append(reg)
        elif all(_iou(reg, prior) < 0.25 for prior in kept):
            # A detached non-mask region may still be legitimate (thin font).
            kept.append(reg)
    if not kept:
        return refine_regions(decode_blocks(raw, image_size, scale, confidence), seg, image_size, scale)
    # Legacy splitter is conservative and keeps geometry if segmentation is uncertain.
    return refine_regions(kept, seg, image_size, scale)
