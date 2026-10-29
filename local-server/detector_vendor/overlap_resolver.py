"""Resolve overlapping OCR ROIs after ComicTextDetector's ONNX inference.

Design constraints:
* Keep smaller focused boxes in preference to boxes enclosing multiple captions.
* Shrink/split *only* the larger overlapping box(s); never change the original model.
* Use segmentation-mask ink to choose whether to crop left/right/top/bottom.
* Return axis-aligned, pairwise non-overlapping TextRegion objects.
* If the mask is unreliable, favor retaining non-overlapping residual geometry over
  silently losing text. Users can use the v0.1.5 ROI editor for edge cases.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import TypeVar

import numpy as np
from PIL import Image

OVERLAP_VERSION = "0.1.6"
MIN_SIDE = 4
T = TypeVar("T")


@dataclass(frozen=True)
class _Rect:
    x1: int
    y1: int
    x2: int
    y2: int

    @property
    def area(self) -> int:
        return max(0, self.x2-self.x1)*max(0, self.y2-self.y1)


def _rect(reg) -> _Rect:
    return _Rect(reg.x,reg.y,reg.x+reg.width,reg.y+reg.height)


def _inter(a: _Rect, b: _Rect) -> _Rect | None:
    x1,y1=max(a.x1,b.x1),max(a.y1,b.y1)
    x2,y2=min(a.x2,b.x2),min(a.y2,b.y2)
    return _Rect(x1,y1,x2,y2) if x1<x2 and y1<y2 else None


def _valid(rect: _Rect) -> bool:
    return rect.x2-rect.x1>=MIN_SIDE and rect.y2-rect.y1>=MIN_SIDE


def _row_parts(big: _Rect, hole: _Rect) -> list[_Rect]:
    # Entire top and bottom, then left and right across the middle band.
    return [
        _Rect(big.x1,big.y1,big.x2,hole.y1),
        _Rect(big.x1,hole.y2,big.x2,big.y2),
        _Rect(big.x1,hole.y1,hole.x1,hole.y2),
        _Rect(hole.x2,hole.y1,big.x2,hole.y2),
    ]


def _column_parts(big: _Rect, hole: _Rect) -> list[_Rect]:
    # Entire left and right, then top and bottom through the middle band.
    return [
        _Rect(big.x1,big.y1,hole.x1,big.y2),
        _Rect(hole.x2,big.y1,big.x2,big.y2),
        _Rect(hole.x1,big.y1,hole.x2,hole.y1),
        _Rect(hole.x1,hole.y2,hole.x2,big.y2),
    ]


def _ink(mask: np.ndarray, r: _Rect) -> int:
    return int(np.count_nonzero(mask[r.y1:r.y2,r.x1:r.x2]))


def _tight(mask: np.ndarray, r: _Rect, padding: int = 5) -> _Rect:
    block=mask[r.y1:r.y2,r.x1:r.x2]
    ys,xs=np.nonzero(block)
    if xs.size < 12:
        return r
    # Preserve original axes but trim whitespace inside the disjoint residual.
    return _Rect(
        max(r.x1,r.x1+int(xs.min())-padding),
        max(r.y1,r.y1+int(ys.min())-padding),
        min(r.x2,r.x1+int(xs.max())+padding+1),
        min(r.y2,r.y1+int(ys.max())+padding+1),
    )


def _mask_to_page(seg, image_size: tuple[int,int], scale: float) -> np.ndarray | None:
    try:
        raw=np.asarray(seg)
        if raw.ndim==4:
            raw=raw[0,0]
        elif raw.ndim==3:
            raw=raw[0]
        if raw.ndim!=2 or not np.isfinite(raw).any():
            return None
        width,height=image_size
        scaled_w=min(raw.shape[1],max(1,round(width*scale)))
        scaled_h=min(raw.shape[0],max(1,round(height*scale)))
        page=Image.fromarray(np.nan_to_num(raw[:scaled_h,:scaled_w],nan=0).astype(np.float32),"F")
        page=page.resize(image_size,Image.Resampling.BILINEAR)
        return np.asarray(page,dtype=np.float32)>0.36
    except (TypeError,ValueError,IndexError):
        return None


def _subtract(big: _Rect, protected: _Rect, mask: np.ndarray | None) -> list[_Rect]:
    """Return non-overlapping rectangles representing useful text in big - protected."""
    hit=_inter(big,protected)
    if hit is None:
        return [big]
    if hit==big:
        return []
    if mask is not None:
        remaining_ink=_ink(mask,big)-_ink(mask,hit)
        claimed_ink=_ink(mask,hit)
        # A large box containing only the same caption as the protected
        # small box is a true duplicate. Do not emit four empty residuals.
        if claimed_ink>=20 and remaining_ink<=max(7,int(claimed_ink*0.02)):
            return []

    candidates=[]
    for partition in (_row_parts(big,hit),_column_parts(big,hit)):
        raw=[r for r in partition if _valid(r)]
        if mask is None:
            # Without reliable segmentation, don't throw residual strips away.
            candidates.append((len(raw),sum(r.area for r in raw),raw))
            continue
        original_ink=sum(_ink(mask,r) for r in raw)
        if original_ink<15:
            # Segmentation under-detected this region. Preserve its geometry.
            candidates.append((len(raw),sum(r.area for r in raw),raw))
            continue
        # Only discard near-empty pieces, not genuine small dialogue islands.
        threshold=max(4,round(original_ink*0.025))
        selected=[r for r in raw if _ink(mask,r)>=threshold]
        if not selected:
            selected=raw
        lost=original_ink-sum(_ink(mask,r) for r in selected)
        refined=[_tight(mask,r) for r in selected]
        refined=[r for r in refined if _valid(r)]
        # Ranking: don't discard meaningful text, then avoid split into many pieces.
        candidates.append((int(lost>max(5,original_ink*0.05)),len(refined),
                           sum(r.area for r in refined),refined))

    if mask is None or any(len(c)==3 for c in candidates):
        return min(candidates,key=lambda c:(c[0],c[1]))[-1]
    return min(candidates,key=lambda c:(c[0],c[1],c[2]))[-1]


def _convert(template: T, rect: _Rect) -> T:
    # TextRegion in auto_detector.py has x,y,width,height,confidence.
    return type(template)(rect.x1,rect.y1,rect.x2-rect.x1,
                          rect.y2-rect.y1,template.confidence)


def resolve_overlaps(regions: list[T], seg, image_size: tuple[int,int], scale: float) -> list[T]:
    """Make ONNX text regions pairwise disjoint, preferring specific/small ROIs.

    A nested small caption stays intact. The containing box is cropped to
    whatever *different* text the mask finds outside it, if any. This runs
    after the existing v0.1.4 segmentation refinement and changes no weights.
    """
    if len(regions)<2:
        return regions
    mask=_mask_to_page(seg,image_size,scale)
    # All coordinates should already be clamped by decoder, but clamp any
    # fallback or handwritten ROI defensively.
    ordered=sorted(enumerate(regions),key=lambda ir:(
        ir[1].width*ir[1].height,-ir[1].confidence,ir[0]))
    kept:list[T]=[]
    for _,reg in ordered:
        fragments=[_rect(reg)]
        for protected in kept:
            next_parts=[]
            for rect in fragments:
                next_parts.extend(_subtract(rect,_rect(protected),mask))
            fragments=next_parts
            if not fragments:
                break
        for part in fragments:
            if _valid(part):
                kept.append(_convert(reg,part))
    # Stable position order for GUI. No touching positive-area overlaps.
    return sorted(kept,key=lambda reg:(reg.y,reg.x))


# KWT_FINAL_OVERLAP_V1
def _positive_overlap_pairs(regions) -> int:
    """Count actual intersecting bbox pairs; touching edges are not overlaps."""
    pairs = 0
    for index, first in enumerate(regions):
        a = _rect(first)
        for second in regions[index + 1:]:
            if _inter(a, _rect(second)) is not None:
                pairs += 1
    return pairs


def finalize_detected_regions(regions, seg, image_size, scale):
    """Resolve overlaps on the *final* Phase1 + tile candidate collection.

    Text detection is performed before Hayai OCR, so duplicated overlapping
    regions would otherwise be OCRed and translated independently.
    Non-overlapping detections are returned unchanged, preserving their
    coordinates, confidence, and original order. The existing segmentation-
    aware resolver clips only overlapping rectangles and keeps unique ink
    islands. This routine never merges or edits the ONNX model output itself.

    A dedicated experimental opt-out is available at
    local-server/detector_final_overlap_mode.txt ('off'). It is independent of
    the legacy detector_overlap_mode.txt, whose earlier default was 'off'.
    """
    regions = list(regions)
    if len(regions) < 2:
        return regions
    from pathlib import Path
    mode_file = Path(__file__).resolve().parents[1] / 'detector_final_overlap_mode.txt'
    try:
        mode = mode_file.read_text(encoding='utf-8-sig').strip().lower()
    except FileNotFoundError:
        mode = 'on'
    except OSError as exc:
        print('[KWT_FINAL_OVERLAP] unreadable mode file; using on: ' + str(exc), flush=True)
        mode = 'on'
    if mode == 'off':
        return regions
    if mode != 'on':
        print('[KWT_FINAL_OVERLAP] invalid mode; using on: ' + repr(mode), flush=True)
    before = _positive_overlap_pairs(regions)
    if not before:
        return regions
    try:
        result = resolve_overlaps(regions, seg, image_size, scale)
        remaining = _positive_overlap_pairs(result)
        if remaining:
            raise ValueError(f'overlap resolver left {remaining} intersecting pairs')
        print(
            f'[KWT_FINAL_OVERLAP] overlap_pairs={before}->0 '
            f'boxes={len(regions)}->{len(result)} '
            f'no_model_change=1', flush=True
        )
        return result
    except (ValueError, TypeError, IndexError, OverflowError) as exc:
        # Preserve existing OCR coverage instead of failing an entire ZIP.
        print(f'[KWT_FINAL_OVERLAP] safe fallback: {type(exc).__name__}: {exc}', flush=True)
        return regions
