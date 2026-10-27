"""V15 conservative bubble-safe typesetting bounds. Optional OpenCV dependency.

Detect only a *strong* local light/dark connected component.  When uncertain
return None, never change an OCR bbox. This module does not edit images.
"""

def propose_safe_bbox(image, bbox):
    try:
        import cv2
        import numpy as np
        x,y,w,h=map(int,bbox)
        if min(w,h)<22 or w*h<900: return None,'bbox_too_small'
        iw,ih=image.size
        pad=max(18,min(64,round(min(w,h)*.35)))
        x0=max(0,x-pad);y0=max(0,y-pad)
        x3=min(iw,x+w+pad);y3=min(ih,y+h+pad)
        rgb=np.asarray(image.crop((x0,y0,x3,y3)).convert('RGB'))
        gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
        # Black ink erasure has already happened; fill tiny holes only.
        # Keep dark and light components separate; do not merge adjacent bubbles.
        target=(x-x0,y-y0,x+w-x0,y+h-y0)
        bx,by,br,bb=target
        inner=gray[max(0,by):min(gray.shape[0],bb),max(0,bx):min(gray.shape[1],br)]
        if inner.size==0:return None,'invalid_crop'
        masks=[]
        for mode in ('light','dark'):
            binary=(gray>=210 if mode=='light' else gray<=45).astype('uint8')
            # A modest close tolerates residual text holes without merging large borders.
            closed=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
            n,labels,stats,_=cv2.connectedComponentsWithStats(closed, connectivity=8)
            for k in range(1,n):
                cx,cy,cw,ch,area=map(int,stats[k])
                if area<max(400,int(w*h*.18)):continue
                # Reject obvious whole-page/background regions and narrow streaks.
                if area>int(binary.size*.90):continue
                comp=(labels==k)
                rectpart=comp[by:bb,bx:br]
                if rectpart.size==0:continue
                coverage=float(rectpart.mean())
                if coverage<.55:continue
                # For light mode the selected component must be locally bright,
                # and for dark mode it must be locally dark: on the untouched core.
                truepart=binary[by:bb,bx:br]
                purity=float(truepart[rectpart].mean()) if rectpart.any() else 0
                if purity<.78:continue
                masks.append((coverage,purity,comp,mode))
        if not masks:return None,'bubble_not_confident'
        masks.sort(key=lambda t:t[0]*t[1],reverse=True)
        coverage,purity,comp,mode=masks[0]
        # Erode to reserve a margin for glyph stroke and imperfect detection.
        safe=cv2.erode(comp.astype('uint8'),np.ones((7,7),np.uint8))>0
        safe=safe[by:bb,bx:br]
        # Largest solid axis-aligned rectangle inside the *original* OCR bbox,
        # so layout never drifts into adjacent bubble's detected area.
        hh,ww=safe.shape
        heights=[0]*ww
        best=None
        center_x=ww/2;center_y=hh/2
        for ry in range(hh):
            for rx in range(ww):heights[rx]=heights[rx]+1 if safe[ry,rx] else 0
            stack=[]
            for rx in range(ww+1):
                current=heights[rx] if rx<ww else 0
                start=rx
                while stack and stack[-1][1]>current:
                    start,high=stack.pop()
                    rw=rx-start;rh=high
                    if rw>=max(13,int(w*.25)) and rh>=max(13,int(h*.25)):
                        top=ry-rh+1
                        # Prefer big rectangles near the OCR bbox centre.
                        dist=abs((start+rx)/2-center_x)/max(1,ww)+abs((top+ry+1)/2-center_y)/max(1,hh)
                        score=rw*rh*(1-.14*min(1,dist))
                        if best is None or score>best[0]:best=(score,start,top,rw,rh)
                if not stack or stack[-1][1]<current:stack.append((start,current))
        if best is None:return None,'no_safe_rectangle'
        _,rx,ry,rw,rh=best
        # Minimal useful correction. Avoid sacrificing most of the box's space.
        if rw*rh < .53*w*h or rw<.48*w or rh<.48*h:
            return None,'safe_rectangle_too_small'
        safe_box=[int(x+rx),int(y+ry),int(rw),int(rh)]
        return safe_box,'bubble_'+mode+'_safe_rectangle'
    except ImportError as exc:
        return None, 'opencv_unavailable_' + str(exc)[:140]
    except Exception as exc:
        import traceback
        tb = traceback.extract_tb(exc.__traceback__)
        last = tb[-1] if tb else None
        location = (str(last.name) + '_line' + str(last.lineno)) if last else 'unknown'
        # Exception detail is intentionally placed in metadata for diagnosis.
        # Never include original image bytes or translated text here.
        message = str(exc).replace('\n', ' ')[:180]
        return None, 'bubble_detection_error_' + type(exc).__name__ + '_' + location + '_' + message
