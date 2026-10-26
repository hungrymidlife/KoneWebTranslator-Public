"""Pretrained Comic Text Detector (ONNX Runtime, CPU-only).

A standalone helper for KoneLocalTranslator; Strata, MangaOCR and existing
image operations remain untouched. Does not bundle or redistribute weights.
Detection output is text bounding boxes, not speech/effect classification.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

INPUT_SIZE = 1024
DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "comictextdetector.pt.onnx"


@dataclass(frozen=True)
class TextRegion:
    x: int
    y: int
    width: int
    height: int
    confidence: float

    def to_gui_region(self) -> dict:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "japanese": "",
            "translated": "",
            "confidence": round(self.confidence, 4),
            "source": "automatic",
        }


def prepare_input(image: Image.Image):
    """Resize a page into the detector's 1024 x 1024 input canvas."""
    scale = INPUT_SIZE / max(image.size)
    new_size = tuple(max(1, round(d * scale)) for d in image.size)
    canvas = Image.new("RGB", (INPUT_SIZE, INPUT_SIZE))
    canvas.paste(image.convert("RGB").resize(new_size, Image.Resampling.BILINEAR), (0, 0))
    tensor = np.asarray(canvas, dtype=np.float32).transpose(2, 0, 1)[None] / 255.0
    return tensor, scale


def non_max_suppression(boxes: np.ndarray, scores: np.ndarray, iou: float = 0.35) -> list[int]:
    """Remove highly overlapping rectangles, favoring stronger detections."""
    areas = np.maximum(0, boxes[:, 2] - boxes[:, 0]) * np.maximum(0, boxes[:, 3] - boxes[:, 1])
    order = scores.argsort()[::-1]
    kept: list[int] = []
    while order.size:
        best = int(order[0])
        kept.append(best)
        others = order[1:]
        lt = np.maximum(boxes[best, :2], boxes[others, :2])
        rb = np.minimum(boxes[best, 2:], boxes[others, 2:])
        wh = np.maximum(0, rb - lt)
        overlap = wh[:, 0] * wh[:, 1]
        union = areas[best] + areas[others] - overlap
        ratios = np.divide(overlap, union, out=np.zeros_like(overlap), where=union > 0)
        order = others[ratios <= iou]
    return kept


def decode_blocks(raw, image_size: tuple[int, int], scale: float,
                  confidence: float = 0.0) -> list[TextRegion]:
    """Convert the release's [cx,cy,w,h,objectness,classes...] to page pixels."""
    raw = np.asarray(raw)
    if raw.ndim == 3 and raw.shape[0] == 1:
        raw = raw[0]
    if raw.ndim != 2 or raw.shape[1] < 6:
        raise ValueError(f"Invalid Comic Text Detector output: {raw.shape}")
    if raw.shape[0] == 0:
        return []
    scores = raw[:, 4] * raw[:, 5:].max(axis=1)
    valid = np.isfinite(raw).all(axis=1) & (scores >= confidence)
    boxes_in = raw[valid]
    scores = scores[valid]
    if len(boxes_in) == 0:
        return []
    boxes = np.concatenate(
        [boxes_in[:, :2] - boxes_in[:, 2:4] / 2,
         boxes_in[:, :2] + boxes_in[:, 2:4] / 2],
        axis=1,
    ) / scale
    width, height = image_size
    boxes[:, [0, 2]] = np.clip(boxes[:, [0, 2]], 0, width)
    boxes[:, [1, 3]] = np.clip(boxes[:, [1, 3]], 0, height)
    results = []
    # KWT_NMS_TOGGLE_V1: read a small switch on each image, no restart needed.
    # This changes NMS only; confidence threshold and downstream refinement stay intact.
    _kwt_nms_file = Path(__file__).resolve().parents[1] / 'detector_nms_mode.txt'
    try:
        _kwt_nms_mode = _kwt_nms_file.read_text(encoding='utf-8-sig').strip().lower()
    except OSError:
        _kwt_nms_mode = 'on'  # Fail safely if config was removed.
    if _kwt_nms_mode not in ('on', 'off'):
        raise ValueError('Invalid detector_nms_mode.txt (use on or off)')
    _kwt_selected_indices = (
        non_max_suppression(boxes, scores)
        if _kwt_nms_mode == 'on'
        else list(range(len(scores)))
    )
    for i in _kwt_selected_indices:
        x1, y1, x2, y2 = boxes[i]
        x1, y1 = int(np.floor(x1)), int(np.floor(y1))
        x2, y2 = int(np.ceil(x2)), int(np.ceil(y2))
        if x2 - x1 >= 4 and y2 - y1 >= 4:
            results.append(TextRegion(x1, y1, x2 - x1, y2 - y1, float(scores[i])))
    return results


class ComicTextDetectorONNX:
    def __init__(self, model_path: Path = DEFAULT_MODEL_PATH):
        import onnxruntime as ort

        if not Path(model_path).is_file():
            raise FileNotFoundError(
                "자동 검출 모델이 없습니다. 08_INSTALL_DETECTOR.bat을 실행하세요: " + str(model_path)
            )
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        self.session = ort.InferenceSession(
            str(model_path), sess_options=opts, providers=["CPUExecutionProvider"]
        )
        inputs = self.session.get_inputs()
        names = {out.name for out in self.session.get_outputs()}
        if len(inputs) != 1 or not {"blk", "seg"}.issubset(names):
            raise ValueError("예상한 Comic Text Detector ONNX 입력/출력 형식이 아닙니다.")
        self.input_name = inputs[0].name

    def detect(self, image: Image.Image, confidence: float = 0.0) -> list[TextRegion]:
        tensor, scale = prepare_input(image)
        raw, seg = self.session.run(["blk", "seg"], {self.input_name: tensor})
        # KWT_CONFIDENCE_GUI_V1: runtime threshold from GUI, independent of older 0.0 source patches.
        try:
            import json as _kwt_json
            _kwt_cfg_path = Path(__file__).resolve().parents[1] / 'detector_confidence.json'
            _kwt_conf = float(_kwt_json.loads(_kwt_cfg_path.read_text(encoding='utf-8')).get('confidence', 0.3)) if _kwt_cfg_path.is_file() else 0.3
            if not (0.05 <= _kwt_conf <= 0.90):
                raise ValueError('confidence must be 0.05..0.90')
            confidence = _kwt_conf
        except (OSError, ValueError, TypeError) as _kwt_err:
            print(f'[DETECTOR] confidence config invalid; using 0.3: {_kwt_err}', flush=True)
            confidence = 0.3
        regions = decode_blocks(raw, image.size, scale, confidence)
        from .overlap_resolver import resolve_overlaps
        cleaned = refine_regions(regions, seg, image.size, scale)
        # KWT_OVERLAP_TOGGLE_V1
        # The final geometry-only overlap resolver can remove useful text
        # rectangles. Keep NMS and segmentation refinement unchanged.
        # Read a tiny config file on every call so mode changes do not require
        # restarting the OCR server. Default to off after patch installation.
        _kwt_mode_file = Path(__file__).resolve().parents[1] / 'detector_overlap_mode.txt'
        try:
            _kwt_mode = _kwt_mode_file.read_text(encoding='utf-8-sig').strip().lower()
        except OSError:
            _kwt_mode = 'off'
        if _kwt_mode == 'on':
            return resolve_overlaps(cleaned, seg, image.size, scale)
        return cleaned

# Region refinement uses the model's pixel-level text segmentation output.
# The original detections stay intact whenever the mask is weak or ambiguous.
REFINEMENT_VERSION = "0.1.4"


def _model_text_mask(seg, image_size: tuple[int, int], scale: float) -> np.ndarray:
    """Convert segmentation probabilities to a full-page boolean text mask.

    The model pads the resized page at the bottom/right of a 1024x1024 canvas.
    Crop that padding before resizing the segmentation back to page size.
    """
    scores = np.asarray(seg)
    if scores.ndim == 4:
        scores = scores[0, 0]
    elif scores.ndim == 3:
        scores = scores[0]
    if scores.ndim != 2 or scores.shape[0] < 1 or scores.shape[1] < 1:
        raise ValueError(f"Invalid segmentation tensor: {scores.shape}")
    w = min(scores.shape[1], max(1, round(image_size[0] * scale)))
    h = min(scores.shape[0], max(1, round(image_size[1] * scale)))
    img = Image.fromarray(np.nan_to_num(scores[:h, :w], nan=0).astype('float32'), 'F')
    img = img.resize(image_size, Image.Resampling.BILINEAR)
    return np.asarray(img, dtype=np.float32) > 0.36


def _mask_bounds(mask: np.ndarray, ox: int, oy: int, pad: int = 7):
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    return (
        max(ox, ox + int(xs.min()) - pad),
        max(oy, oy + int(ys.min()) - pad),
        min(ox + mask.shape[1], ox + int(xs.max()) + 1 + pad),
        min(oy + mask.shape[0], oy + int(ys.max()) + 1 + pad),
    )


def _split_mask_region(region: TextRegion, text_mask: np.ndarray) -> list[TextRegion]:
    """Split only *disconnected, offset* text islands in an oversized box.

    Japanese vertical writing has multiple adjacent columns. Splitting merely
    on a vertical whitespace gutter would separate coherent Japanese text, so
    require a substantial horizontal row gap AND a strong lateral displacement.
    """
    if region.width < 105 or region.height < 160:
        return [region]
    x, y = region.x, region.y
    chunk = text_mask[y:y + region.height, x:x + region.width]
    if chunk.shape != (region.height, region.width):
        return [region]
    total_ink = int(chunk.sum())
    if total_ink < 110:
        return [region]
    h, w = chunk.shape
    row_ink = chunk.sum(axis=1)
    active = np.flatnonzero(row_ink >= max(2, int(w * 0.007)))
    if active.size < 45:
        return [region]
    # Split only if there is an unusually large text-free horizontal band.
    gaps = np.diff(active) - 1
    min_gap = max(15, round(h * 0.035))
    candidate_gaps = np.flatnonzero(gaps >= min_gap)
    best = None
    for gi in candidate_gaps:
        boundary = int((active[gi] + active[gi + 1]) // 2) + 1
        top = chunk[:boundary]
        bottom = chunk[boundary:]
        top_count, bottom_count = int(top.sum()), int(bottom.sum())
        if min(top_count, bottom_count) < max(55, total_ink * 0.14):
            continue
        upper = _mask_bounds(top, x, y)
        lower = _mask_bounds(bottom, x, y + boundary)
        if upper is None or lower is None:
            continue
        xa, ya, xb, yb = upper
        xc, yc, xd, yd = lower
        if min(yb - ya, yd - yc) < max(38, round(h * .13)):
            continue
        # The two islands should be laterally distinct narration/caption blocks.
        center_shift = abs((xa + xb) / 2 - (xc + xd) / 2)
        horizontal_overlap = max(0, min(xb, xd) - max(xa, xc))
        narrow_width = min(xb - xa, xd - xc)
        if center_shift < max(35, 0.25 * w):
            continue
        if horizontal_overlap > 0.35 * narrow_width:
            continue
        strength = center_shift * (gaps[gi] + 1)
        if best is None or strength > best[0]:
            best = (strength, upper, lower)
    if best is None:
        return [region]
    output = []
    for _, bounds in [(0, best[1]), (1, best[2])]:
        x1, y1, x2, y2 = bounds
        output.append(TextRegion(x1, y1, x2-x1, y2-y1, region.confidence))
    return output


def _region_area(reg: TextRegion) -> int:
    return reg.width * reg.height


def _is_redundant_with(a: TextRegion, b: TextRegion, text_mask: np.ndarray) -> bool:
    """A is redundant if b already contains practically all of a's detected ink.

    A geometric inner/outer match alone is insufficient: the large region may
    also contain text which would be lost if it were discarded.
    """
    ax1, ay1, ax2, ay2 = a.x, a.y, a.x + a.width, a.y + a.height
    bx1, by1, bx2, by2 = b.x, b.y, b.x + b.width, b.y + b.height
    x1, y1 = max(ax1,bx1), max(ay1,by1)
    x2, y2 = min(ax2,bx2), min(ay2,by2)
    if x2 <= x1 or y2 <= y1:
        return False
    intersection_area = (x2-x1)*(y2-y1)
    if intersection_area < 0.7 * min(_region_area(a),_region_area(b)):
        return False
    orig = text_mask[ay1:ay2,ax1:ax2]
    if int(orig.sum()) < 20:
        return False
    covered_ink = int(text_mask[y1:y2,x1:x2].sum())
    return covered_ink >= 0.92 * int(orig.sum())


def refine_regions(regions: list[TextRegion], seg, image_size: tuple[int,int],
                   scale: float) -> list[TextRegion]:
    """Deduplicate and split overly wide bounding boxes using text seg output.

    Fail open: if a segmentation output cannot be interpreted reliably, retain
    the detector's original boxes rather than risk losing Japanese dialogue.
    """
    if not regions:
        return []
    try:
        mask = _model_text_mask(seg, image_size, scale)
    except (TypeError, ValueError, IndexError):
        return regions
    expanded: list[TextRegion] = []
    for region in regions:
        expanded.extend(_split_mask_region(region, mask))
    # Prefer a close-fitting region to a second region containing the same ink.
    candidates = sorted(expanded, key=lambda r: (_region_area(r), -r.confidence))
    kept: list[TextRegion] = []
    for region in candidates:
        if any(_is_redundant_with(region, other, mask) for other in kept):
            continue
        kept.append(region)
    # Sorting by page position here is for display only; the model's class order
    # need not match actual Japanese reading order. Keep ordering stable enough.
    return sorted(kept, key=lambda r: (r.y, r.x))

OVERLAP_POSTPROCESS_VERSION = "0.1.6"
