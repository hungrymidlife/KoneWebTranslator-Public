"""Non-destructive mask brush and bounded incremental LaMa regeneration."""
from __future__ import annotations
import math
import numpy as np
from PIL import Image,ImageChops,ImageDraw,ImageOps

def apply_strokes(base, strokes):
    if not isinstance(strokes,list) or not (1 <= len(strokes) <= 80):
        raise ValueError('마스크 변경은 1~80회 브러시 입력만 허용합니다.')
    updated=base.convert('L').copy()
    draw=ImageDraw.Draw(updated)
    width,height=base.size
    for stroke in strokes:
        if not isinstance(stroke,dict) or stroke.get('mode') not in ('add','erase'):
            raise ValueError('브러시 종류가 올바르지 않습니다.')
        points=stroke.get('points',[])
        if not isinstance(points,list) or not (1<=len(points)<=4000):
            raise ValueError('브러시 점 개수 초과')
        radius=stroke.get('radius',10)
        if isinstance(radius,bool) or not isinstance(radius,(int,float)) or not 1<=radius<=80:
            raise ValueError('브러시 굵기 1~80px')
        pixel=255 if stroke['mode']=='add' else 0
        points2=[]
        for pair in points:
            if not isinstance(pair,list) or len(pair)!=2:
                raise ValueError('좌표 형식 오류')
            x,y=pair
            if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (x,y)):
                raise ValueError('좌표 오류')
            points2.append((max(0,min(width-1,round(x))),max(0,min(height-1,round(y)))))
        pen=max(1,round(radius))
        if len(points2)>1:draw.line(points2,fill=pixel,width=2*pen,joint='curve')
        for x,y in (points2 if len(points2)==1 else (points2[0],points2[-1])):
            draw.ellipse((x-pen,y-pen,x+pen,y+pen),fill=pixel)
    return updated

def _infer(original_crop,mask_crop):
    import torch
    import inpainting_lama as lama
    model=lama.load_model()
    device=lama._device
    w,h=original_crop.size
    factor=min(1.,1024/max(w,h))
    if factor<1:
        dims=(max(8,round(w*factor)),max(8,round(h*factor)))
        original_crop=original_crop.resize(dims,Image.Resampling.LANCZOS)
        mask_crop=mask_crop.resize(dims,Image.Resampling.NEAREST)
    iw,ih=original_crop.size
    img=ImageOps.expand(original_crop,(0,0,(-iw)%8,(-ih)%8),fill='white')
    mask=ImageOps.expand(mask_crop,(0,0,(-iw)%8,(-ih)%8),fill=0)
    v=torch.from_numpy(np.asarray(img,dtype=np.float32).copy()).permute(2,0,1)[None].to(device)/255.
    m=torch.from_numpy(np.asarray(mask,dtype=np.float32).copy())[None,None].to(device)/255.
    with torch.inference_mode():
        pred=model(v,m)
    if isinstance(pred,(tuple,list)):pred=pred[0]
    pixels=(pred[0].permute(1,2,0).float().clamp(0,1).cpu().numpy()*255).astype(np.uint8)
    out=Image.fromarray(pixels,'RGB').crop((0,0,iw,ih))
    return out.resize((w,h),Image.Resampling.LANCZOS) if factor<1 else out

def partial_restore(original,previous_clean,previous_mask,updated_mask,context=72):
    """Erase -> exact original pixels. Add -> infer only newly-masked ROI.
    No net mask change means original clean image bytes remain unchanged.
    """
    if not (original.size==previous_clean.size==previous_mask.size==updated_mask.size):
        raise ValueError('마스크와 이미지 해상도가 다릅니다.')
    original=original.convert('RGB')
    output=previous_clean.convert('RGB').copy()
    old=previous_mask.convert('L')
    new=updated_mask.convert('L')
    removed=ImageChops.subtract(old,new)
    if removed.getbbox():output.paste(original,(0,0),removed)
    added=ImageChops.subtract(new,old)
    bbox=added.getbbox()
    if bbox is None:
        return output, {'added_pixels': 0,
                        'removed_pixels': int(np.count_nonzero(np.asarray(removed))),
                        'roi_count': 0}
    count=int(np.count_nonzero(np.asarray(added)))
    if count>2_500_000:raise ValueError('한 번에 추가할 마스크가 너무 큽니다. 작업을 나눠 주세요.')
    xs,ys,xe,ye=bbox
    tiles=0
    for top in range(ys,ye,768):
        for left in range(xs,xe,768):
            core=(left,top,min(xe,left+768),min(ye,top+768))
            core_mask=added.crop(core)
            if not core_mask.getbbox():continue
            bounds=(max(0,core[0]-context),max(0,core[1]-context),
                    min(original.width,core[2]+context),min(original.height,core[3]+context))
            restored=_infer(original.crop(bounds),new.crop(bounds))
            # Existing restored pixels are not overwritten outside the added mask.
            part=(core[0]-bounds[0],core[1]-bounds[1],core[2]-bounds[0],core[3]-bounds[1])
            output.paste(restored.crop(part),(core[0],core[1]),core_mask)
            tiles+=1
    return output,{'added_pixels':count,'removed_pixels':int(np.count_nonzero(np.asarray(removed))),'roi_count':tiles}
