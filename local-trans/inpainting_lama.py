"""LaMa local restoration using bounded, original-scale text-region tiles."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageOps

MODEL_PATH = Path(__file__).resolve().parent / 'models' / 'big-lama.pt'
_model = None
_device = None


def load_model():
    global _model, _device
    if _model is None:
        if not MODEL_PATH.is_file():
            raise FileNotFoundError(f'LaMa model missing: {MODEL_PATH}')
        import torch
        _device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        _model = torch.jit.load(str(MODEL_PATH), map_location=_device).eval()
    return _model


def _box(region, width, height):
    box = region.get('bbox') or []
    if len(box) != 4:
        return None
    try:
        x, y, w, h = [int(float(a)) for a in box]
    except (TypeError, ValueError):
        return None
    x1, y1, x2, y2 = max(0, x), max(0, y), min(width, x+w), min(height, y+h)
    return (x1, y1, x2, y2) if x2 > x1 and y2 > y1 else None


def make_mask(image, regions):
    """Estimate ink only inside detector bbox, never enlarged OCR recognition crop."""
    src = np.asarray(image.convert('L'))
    height, width = src.shape
    out = np.zeros((height, width), np.uint8)
    boxes = []
    for r in regions:
        if not str(r.get('translated_text') or '').strip():
            continue
        b = _box(r, width, height)
        if not b:
            continue
        x1,y1,x2,y2 = b
        boxes.append(b)
        crop = src[y1:y2, x1:x2]
        p20, p50, p80 = np.percentile(crop, (20,50,80))
        # Strongly uniform light/dark speech bubbles allow ink polarity estimation.
        # On mixed artwork, conservatively mask the detector area rather than deleting
        # all dark/bright picture pixels that could be character lineart.
        if p50 >= 190 and np.mean(crop >= 180) >= .72:
            ink = crop < min(185, p80 - 28)
        elif p50 <= 70 and np.mean(crop <= 80) >= .72:
            ink = crop > max(75, p20 + 32)
        else:
            ink = np.ones(crop.shape, bool)
        if not np.any(ink):
            ink = np.ones(crop.shape, bool)
        target = out[y1:y2,x1:x2]
        np.maximum(target, ink.astype(np.uint8)*255, out=target)
    if not boxes:
        return Image.fromarray(out), []
    mask = Image.fromarray(out, 'L').filter(ImageFilter.MaxFilter(5))
    # Restrict dilation spill: a 3px allowance for anti-aliased strokes.
    return mask, boxes


def _tiles(boxes, width, height, max_side=768, context=72):
    """Group nearby boxes without turning dispersed full-page text into one giant ROI."""
    groups = []
    for box in sorted(boxes, key=lambda b:(b[1],b[0])):
        expanded = (max(0,box[0]-context),max(0,box[1]-context),min(width,box[2]+context),min(height,box[3]+context))
        candidate = None
        for i,g in enumerate(groups):
            union = (min(g[0],expanded[0]),min(g[1],expanded[1]),max(g[2],expanded[2]),max(g[3],expanded[3]))
            near = expanded[0] <= g[2]+12 and g[0] <= expanded[2]+12 and expanded[1] <= g[3]+12 and g[1] <= expanded[3]+12
            if near and max(union[2]-union[0],union[3]-union[1]) <= max_side:
                candidate = (i,union)
                break
        if candidate:
            groups[candidate[0]] = candidate[1]
        else:
            # Oversize boxes are split into overlapping tiles; no resize unless a
            # single detector box itself exceeds the target bound.
            groups.append(expanded)
    return groups


def restore(image, regions, report=None, cache_dir=None):
    import torch
    model = load_model()
    original = image.convert('RGB')
    mask, boxes = make_mask(original, regions)
    if not boxes:
        return original, mask, {'engine':'lama','status':'empty_mask','tiles':[]}
    result = original.copy()
    tiles=[]
    for left,top,right,bottom in _tiles(boxes, original.width, original.height):
        crop = original.crop((left,top,right,bottom))
        cmask = mask.crop((left,top,right,bottom))
        if not cmask.getbbox():
            continue
        w,h = crop.size
        scale = min(1., 1024 / max(w,h))
        if scale < 1:
            size=(max(8,round(w*scale)),max(8,round(h*scale)))
            crop=crop.resize(size, Image.Resampling.LANCZOS)
            cmask=cmask.resize(size, Image.Resampling.NEAREST)
        iw,ih=crop.size
        crop=ImageOps.expand(crop,(0,0,(-iw)%8,(-ih)%8),fill='white')
        cmask=ImageOps.expand(cmask,(0,0,(-iw)%8,(-ih)%8),fill=0)
        it=torch.from_numpy(np.asarray(crop,dtype=np.float32).copy()).permute(2,0,1)[None].to(_device)/255.
        mt=torch.from_numpy(np.asarray(cmask,dtype=np.float32).copy())[None,None].to(_device)/255.
        with torch.inference_mode():
            output=model(it,mt)
        if isinstance(output,(tuple,list)):
            output=output[0]
        pixels=(output[0].permute(1,2,0).float().clamp(0,1).cpu().numpy()*255).astype(np.uint8)
        restored=Image.fromarray(pixels,'RGB').crop((0,0,iw,ih))
        if scale < 1:
            restored=restored.resize((w,h),Image.Resampling.LANCZOS)
        result.paste(restored,(left,top),mask.crop((left,top,right,bottom)))
        tiles.append({'roi':[left,top,w,h],'scale':scale})
        if report:
            report(f'LaMa ROI {len(tiles)}: {w}x{h} / scale {scale:.2f}')
    if cache_dir is not None:
        directory=Path(cache_dir)
        directory.mkdir(parents=True,exist_ok=True)
        mask.save(directory/'mask.png')
        result.save(directory/'clean_background.png')
    return result,mask,{'engine':'lama','status':'restored','device':str(_device), 'tiles':tiles,
                        'mask_bbox':list(mask.getbbox() or ()), 'cache_version':1 if cache_dir is not None else 0}
