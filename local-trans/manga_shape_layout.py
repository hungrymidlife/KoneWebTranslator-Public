"""Shape-aware Korean rows inside a confident bright/dark bubble component.
Falls back to original rectangular typesetting when no safe contour fits.
"""
from __future__ import annotations
import math
import numpy as np
from PIL import Image
from typesetting_layout import compact_auto_text

def bubble_mask(image, bbox, anchor):
    try:import cv2
    except ImportError:return None,'opencv_unavailable'
    x,y,w,h=map(int,bbox); sx,sy,sw,sh=map(int,anchor)
    iw,ih=image.size
    if min(w,h)<24 or x<0 or y<0 or x+w>iw or y+h>ih:return None,'invalid_bbox'
    pad=max(24,min(110,round(max(w,h)*.4)))
    x0,y0=max(0,x-pad),max(0,y-pad)
    x1,y1=min(iw,x+w+pad),min(ih,y+h+pad)
    gray=np.asarray(image.crop((x0,y0,x1,y1)).convert('L'))
    ix1,iy1=max(0,sx-x0),max(0,sy-y0)
    ix2,iy2=min(gray.shape[1],sx+sw-x0),min(gray.shape[0],sy+sh-y0)
    if ix2<=ix1 or iy2<=iy1:return None,'anchor_outside'
    best=None
    for name,raw in [('light',gray>=212),('dark',gray<=42)]:
        connected=cv2.morphologyEx(raw.astype('uint8'),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
        n,labels,stats,_=cv2.connectedComponentsWithStats(connected,connectivity=8)
        for index in range(1,n):
            area=int(stats[index,cv2.CC_STAT_AREA])
            if area<max(160,int(sw*sh*.19)) or area>gray.size*.91:continue
            component=labels==index
            seed=component[iy1:iy2,ix1:ix2]
            coverage=float(seed.mean()) if seed.size else 0.
            if coverage<.46:continue
            purity=float(raw[iy1:iy2,ix1:ix2][seed].mean()) if seed.any() else 0.
            if purity<.74:continue
            eroded=cv2.erode(component.astype('uint8'),np.ones((5,5),np.uint8))>0
            mask=eroded[y-y0:y-y0+h,x-x0:x-x0+w]
            if mask.shape!=(h,w) or int(mask.sum())<max(200,int(sw*sh*.28)):continue
            score=coverage*purity*math.sqrt(max(1,int(mask.sum())))
            if best is None or score>best[0]:best=(score,mask.copy(),name)
    if best is None:return None,'bubble_mask_unreliable'
    return best[1],'bubble_shape_'+best[2]

def intervals(bits):
    pos=np.flatnonzero(bits)
    if not len(pos):return []
    result=[];first=last=int(pos[0])
    for v in pos[1:]:
        v=int(v)
        if v>last+1:result.append((first,last+1));first=v
        last=v
    result.append((first,last+1))
    return result

def consume(text, available, draw, font, stroke):
    # A newline marks the boundary between two visible rows.
    # Previously it returned an empty row, introducing one extra full
    # line-height gap after each already-completed paragraph.
    text=text.lstrip(' \t\n')
    if not text:return None,''
    paragraph=text.split('\n',1)[0]
    if draw.textlength(paragraph,font=font)+2*stroke<=available:
        return paragraph,text[len(paragraph):].lstrip(' \t\n')
    low,high=1,len(paragraph);best=0
    while low<=high:
        mid=(low+high)//2
        if draw.textlength(paragraph[:mid],font=font)+2*stroke<=available:
            best=mid;low=mid+1
        else:high=mid-1
    if best<1:return None,text
    sp=paragraph.rfind(' ',0,best+1)
    cut=sp if sp>=max(2,best//3) else best
    line=paragraph[:cut].rstrip(' ')
    if not line:return None,text
    return line,text[cut:].lstrip(' ')

def _draw_row(draw,row,font,stroke,style):
    box=draw.textbbox((0,0),row['text'],font=font,stroke_width=stroke)
    draw.text((round(row['x']-box[0]),round(row['y']-box[1])),row['text'],
              font=font,fill=style['text_color'],stroke_width=stroke,
              stroke_fill=style['stroke_color'])

def try_shape_layout(image,bbox,anchor,text,draw,font_for,style,settings,stroke_override=None):
    """Return (metadata, reason). Always measure all lines before drawing."""
    try:
        mask,reason=bubble_mask(image,bbox,anchor)
        if mask is None:return None,reason
        x,y,w,h=map(int,bbox);sx,sy,sw,sh=map(int,anchor)
        center=min(w-1,max(0,sx+sw/2-x))
        padding=max(2,round(min(w,h)*float(settings['typeset_padding_percent'])/100))
        min_size=int(settings['typeset_min_font_size'])
        max_size=int(settings['typeset_max_font_size'])
        max_rows=min(80,max(1,h//max(1,min_size)))
        starts={0,max(0,round(sy+sh*.24-y)),max(0,round(sy+sh*.45-y))}
        starts.update(range(0,max(1,h//2),max(5,h//11)))
        starts=sorted(starts,key=lambda s:(abs((y+s)-(sy+sh*.3)),s))[:10]
        normalized_text=compact_auto_text(text)
        result=None
        for size in range(min(max_size,h),min_size-1,-1):
            font=font_for(size)
            stroke=(int(stroke_override) if stroke_override is not None else max(1,min(3,1 if size<=18 else 2 if size<=34 else 3)))
            line_h=max(size+2*stroke+2,round(size*settings['typeset_line_height_ratio'])+2*stroke)
            glyph_h=max(1,size+2*stroke)
            best=None
            for start in starts:
                remaining=normalized_text
                placements=[];margin=0.;ok=True
                for index in range(max_rows):
                    if not remaining:break
                    top=start+index*line_h
                    if top+glyph_h>h-padding:ok=False;break
                    runs=intervals(mask[top:top+glyph_h,:].all(axis=0))
                    runs=[(a,b) for a,b in runs if b-a>=size+padding*2]
                    if not runs:ok=False;break
                    a,b=max(runs,key=lambda p:(int(p[0]<=center<=p[1])*10000+(p[1]-p[0]),-abs((p[0]+p[1])/2-center)))
                    line,rest=consume(remaining,b-a-padding*2,draw,font,stroke)
                    if line is None:ok=False;break
                    if line:
                        tw=draw.textlength(line,font=font)+2*stroke
                        placements.append({'text':line,'x':round(x+(a+b-tw)/2,2),'y':round(y+top,2)})
                        margin+=max(0,b-a-tw)
                    remaining=rest
                if ok and not remaining and placements:
                    score=(margin/max(1,len(placements)),abs(start-(sy+sh*.25-y)),len(placements))
                    if best is None or score<best[0]:best=(score,placements,line_h)
            if best is not None:
                result=(size,stroke,best[1],best[2]);break
        if result is None:return None,'shape_text_overflow'
        size,stroke,placements,line_h=result
        info={'layout':'manga_shape_rows_v1','shape_line_placements':placements,'font_size':size,
              'stroke_width':stroke,'line_spacing':line_h,'line_or_column_count':len(placements),
              'alignment':'bubble_row_center','padding_x':0,'padding_y':0,
              'used_width':max(draw.textlength(p['text'],font=font_for(size))+2*stroke for p in placements),
              'used_height':len(placements)*line_h}
        for row in placements:_draw_row(draw,row,font_for(size),stroke,style)
        left=max(0,min(int(row['x']) for row in placements))
        top=max(0,min(int(row['y']) for row in placements))
        right=max(round(row['x']+draw.textlength(row['text'],font=font_for(size))+2*stroke) for row in placements)
        bottom=max(int(row['y'])+size+2*stroke for row in placements)
        info['shape_rendered_bbox']=[left,top,max(1,right-left),max(1,bottom-top)]
        return info,reason
    except Exception as exc:return None,'shape_fallback_'+type(exc).__name__


def legacy_shape_has_phantom_rows(info):
    """Detect the old newline bug in stored bubble-shape row coordinates.

    Only gaps close to integer multiples of the stored line advance qualify.
    Do not mistake arbitrary intentional spacing for this bug.
    """
    if info.get('layout') != 'manga_shape_rows_v1':
        return False
    rows=info.get('shape_line_placements') or []
    advance=float(info.get('line_spacing') or 0)
    if advance<=0 or len(rows)<2:
        return False
    for previous,current in zip(rows,rows[1:]):
        gap=float(current['y'])-float(previous['y'])
        slots=round(gap/advance)
        if slots>=2 and abs(gap-slots*advance)<=1.0:
            return True
    return False

def draw_saved_or_reflow_shape(draw, cleaned_image, info, text, bounds,
                               original_bbox, font_for, style, settings):
    """Rebuild legacy cached shape rows only when phantom newline gaps exist.

    Original OCR coordinates and metadata remain unchanged. The returned
    boolean reports whether a shape was rendered, so the caller may use
    its existing safe rectangular fallback on failure.
    """
    if not legacy_shape_has_phantom_rows(info):
        return draw_saved_shape(draw,info,font_for,style)
    rebuilt,_reason=try_shape_layout(
        cleaned_image,bounds,original_bbox,text,draw,font_for,style,settings)
    return rebuilt is not None


def draw_saved_shape(draw,info,font_for,style):
    if info.get('layout')!='manga_shape_rows_v1':return False
    font=font_for(int(info['font_size']))
    for row in info.get('shape_line_placements',[]):_draw_row(draw,row,font,int(info['stroke_width']),style)
    return True

# KWT_MANUAL_TYPESETTING_AUTOFIT_NAV_V1 (shape row reflow)
