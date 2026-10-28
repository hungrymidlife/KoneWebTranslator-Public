"""KWT_VIRTUAL_BUBBLE_SAFE_V4_2 - OCR-anchored bubble-safe layout.

The OCR rectangle is the *anchor*, while the virtual rectangle bounds all
rendering candidates. Reads an already-inpainted RGB image; never alters OCR,
LaMa masks, image bytes or the saved OCR bounding box.
"""
from __future__ import annotations


def propose_safe_bbox(image, bbox, *, seed_bbox=None):
    """Return (safe layout bbox or None, diagnostic reason).

    bbox: virtual Korean layout rectangle [x,y,w,h]
    seed_bbox: unchanged OCR rectangle; useful even when layout is enlarged.
    """
    try:
        import cv2
        import numpy as np

        iw, ih = image.size
        x, y, w, h = map(int, bbox)
        sx, sy, sw, sh = map(int, seed_bbox if seed_bbox is not None else bbox)
        if min(w,h,sw,sh) < 16 or w*h < 400:
            return None, 'bbox_too_small'
        if x < 0 or y < 0 or x+w > iw or y+h > ih:
            return None, 'invalid_virtual_box'
        if sx < 0 or sy < 0 or sx+sw > iw or sy+sh > ih:
            return None, 'invalid_ocr_box'

        # Search around the *virtual* region, but choose the bubble by the
        # OCR-centred seed. A virtual expansion needn't be mostly inside it.
        pad = max(24, min(96, round(min(w, h)*0.55)))
        x0, y0 = max(0, x-pad), max(0, y-pad)
        x3, y3 = min(iw, x+w+pad), min(ih, y+h+pad)
        rgb = np.asarray(image.crop((x0,y0,x3,y3)).convert('RGB'))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        vx, vy, vr, vb = x-x0, y-y0, x+w-x0, y+h-y0
        ox, oy, ore, obe = sx-x0, sy-y0, sx+sw-x0, sy+sh-y0
        # Clip OCR seed into the ROI. It is normally inside the virtual box.
        ox,oy = max(0,ox),max(0,oy)
        ore,obe = min(gray.shape[1],ore),min(gray.shape[0],obe)
        if ore <= ox or obe <= oy:
            return None, 'ocr_anchor_outside_crop'
        center_x, center_y = (sx+sw/2)-x, (sy+sh/2)-y
        candidates = []
        for mode in ('light', 'dark'):
            # The image has been restored by LaMa, so detect light/dark
            # connected bubble interiors rather than OCR text pixels.
            binary = (gray>=210 if mode=='light' else gray<=45).astype('uint8')
            closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE,
                                      np.ones((3,3), np.uint8))
            n, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
            for k in range(1, n):
                _,_,_,_,area = map(int, stats[k])
                if area < max(250,int(sw*sh*0.15)) or area > int(binary.size*.90):
                    continue
                comp = labels == k
                seed = comp[oy:obe, ox:ore]
                if seed.size == 0:
                    continue
                coverage = float(seed.mean())
                if coverage < .42:
                    continue
                # Prevent a morphological close bridging different contents.
                original = binary[oy:obe,ox:ore]
                purity = float(original[seed].mean()) if seed.any() else 0
                if purity < .72:
                    continue
                eroded = cv2.erode(comp.astype('uint8'),
                                     np.ones((5,5),np.uint8)) > 0
                safe = eroded[vy:vb,vx:vr]
                if not safe.any():
                    continue
                hh,ww = safe.shape
                heights = [0]*ww
                best = None
                # Largest contained rectangle with mild OCR-centre preference.
                for ry in range(hh):
                    for rx in range(ww):
                        heights[rx] = heights[rx]+1 if safe[ry,rx] else 0
                    stack = []
                    for rx in range(ww+1):
                        current = heights[rx] if rx < ww else 0
                        start = rx
                        while stack and stack[-1][1] > current:
                            start, high = stack.pop()
                            rw, rh = rx-start, high
                            if rw >= max(12,int(sw*.40)) and rh >= max(12,int(sh*.40)):
                                top = ry-rh+1
                                dist = (abs((start+rx)/2-center_x)/max(1,w) +
                                        abs((top+ry+1)/2-center_y)/max(1,h))
                                score = rw*rh*(1-0.16*min(1,dist))
                                if best is None or score > best[0]:
                                    best = (score,start,top,rw,rh)
                        if not stack or stack[-1][1] < current:
                            stack.append((start,current))
                if best is None:
                    continue
                score,rx,ry,rw,rh = best
                # Allow an actual bubble to be smaller than the OCR rectangle;
                # this was incorrectly forbidden by zip_pipeline.py V1.8.
                if rw*rh < .32*sw*sh:
                    continue
                candidates.append((coverage*purity,score,[x+rx,y+ry,rw,rh],mode))
        if not candidates:
            return None, 'bubble_not_confident'
        candidates.sort(key=lambda v:(v[0],v[1]), reverse=True)
        _,_,selected,mode = candidates[0]
        return selected,'bubble_'+mode+'_safe_rectangle_v4_2'
    except ImportError as exc:
        return None,'opencv_unavailable_'+str(exc)[:120]
    except Exception as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        last = tb[-1] if tb else None
        where = f'{last.name}_line{last.lineno}' if last else 'unknown'
        return None,'bubble_detection_error_'+type(exc).__name__+'_'+where+'_'+str(exc).replace('\n',' ')[:120]
