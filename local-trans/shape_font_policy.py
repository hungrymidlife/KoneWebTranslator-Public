"""KWT_SHAPE_FONT_V1: classify enclosing cleaned-image contours and choose fonts.

Never change OCR detection boxes or LaMa masks. Unknown shapes are explicit.
"""
from __future__ import annotations

import math
import re

FONT_CLASSES=('round_bubble','rect_box','no_bubble','unknown')
FONT_SETTINGS={'round_bubble':'font_id_round_bubble',
               'rect_box':'font_id_rect_box',
               'no_bubble':'font_id_no_bubble',
               'unknown':'font_id_unknown'}
FONT_ID=re.compile(r'^[0-9a-f]{20}$')

def valid_policy_font(value):
    return type(value) is str and (value in ('default','system') or FONT_ID.fullmatch(value) is not None)

def choose_font(shape_class,settings,default_font_id):
    default=default_font_id if valid_policy_font(default_font_id) and default_font_id!='default' else 'system'
    if not settings.get('shape_font_policy_enabled',False):return default
    selected=settings.get(FONT_SETTINGS.get(shape_class,'font_id_unknown'),'default')
    if selected=='default' or not valid_policy_font(selected):return default
    return selected

def effective_class(auto_class,override=None):
    return override if override in FONT_CLASSES else (auto_class if auto_class in FONT_CLASSES else 'unknown')

def classify_shape(clean_image,ocr_bbox):
    """Classify broad components around the OCR seed, not just bbox aspect ratio.

    Only confidently enclosed contours can be called round or rectangular.
    A uniform component open on 3+ search edges indicates no bubble.
    """
    unknown={'shape_class':'unknown','shape_confidence':0.0,
             'shape_reason':'no_reliable_enclosed_contour'}
    try:
        import cv2
        import numpy as np
    except ImportError:
        return dict(unknown,shape_reason='opencv_unavailable')
    try:
        x,y,w,h=(int(float(v)) for v in ocr_bbox)
        iw,ih=clean_image.size
        if min(w,h)<10 or x<0 or y<0 or x+w>iw or y+h>ih:
            return dict(unknown,shape_reason='invalid_ocr_bbox')
        pad=max(48,min(240,int(max(w,h)*1.25)))
        x0,y0=max(0,x-pad),max(0,y-pad)
        x1,y1=min(iw,x+w+pad),min(ih,y+h+pad)
        gray=np.asarray(clean_image.crop((x0,y0,x1,y1)).convert('L'))
        hh,ww=gray.shape
        if min(hh,ww)<32:return dict(unknown,shape_reason='crop_too_small')
        sx0,sy0=x-x0,y-y0
        sx1,sy1=sx0+w,sy0+h
        inset=max(1,min(w,h)//12)
        ax,ay=min(sx0+inset,sx1-1),min(sy0+inset,sy1-1)
        bx,by=max(ax+1,sx1-inset),max(ay+1,sy1-inset)
        best=None
        unbounded=0.0
        for polarity,binary in [('light',gray>=211),('dark',gray<=43)]:
            candidate=cv2.morphologyEx(binary.astype('uint8'),cv2.MORPH_CLOSE,
                                       np.ones((3,3),dtype='uint8'))
            n,labels,stats,_=cv2.connectedComponentsWithStats(candidate,connectivity=8)
            for idx in range(1,n):
                px,py,pw,ph,area=(int(v) for v in stats[idx])
                if area<max(220,w*h*.21):continue
                seed=(labels[ay:by,ax:bx]==idx)
                coverage=float(seed.mean()) if seed.size else 0.0
                if coverage<.42:continue
                touching=sum((px<=1,py<=1,px+pw>=ww-1,py+ph>=hh-1))
                if touching>=3 and area/(ww*hh)>.65:
                    unbounded=max(unbounded,coverage)
                    continue
                if touching:continue
                component=(labels[py:py+ph,px:px+pw]==idx).astype('uint8')
                contours,_=cv2.findContours(component,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
                if not contours:continue
                contour=max(contours,key=cv2.contourArea)
                actual_area=float(cv2.contourArea(contour))
                perimeter=float(cv2.arcLength(contour,True))
                if actual_area<max(180.,.16*w*h) or perimeter<=0:continue
                extent=actual_area/max(1,pw*ph)
                circularity=4*math.pi*actual_area/(perimeter*perimeter)
                vertices=len(cv2.approxPolyDP(contour,.025*perimeter,True))
                if extent>=.88 and vertices<=6:
                    cls='rect_box';confidence=min(.97,.64+.25*extent+.07*coverage)
                elif extent>=.56 and vertices>=6 and circularity>.42:
                    cls='round_bubble';confidence=min(.95,.54+.25*min(1.,circularity)+.15*coverage)
                else:continue
                score=coverage*math.sqrt(actual_area)*max(.3,confidence)
                if best is None or score>best[0]:best=(score,cls,confidence,polarity)
        if best is not None:
            return {'shape_class':best[1],
                    'shape_confidence':round(best[2],3),
                    'shape_reason':'enclosed_'+best[3]+'_component'}
        if unbounded>=.76:
            return {'shape_class':'no_bubble',
                    'shape_confidence':round(min(.9,.60+.25*unbounded),3),
                    'shape_reason':'unbounded_background'}
        return unknown
    except (ValueError,TypeError,OverflowError,IndexError) as exc:
        return dict(unknown,shape_reason='classification_failed_'+type(exc).__name__)
