"""Model segmentation-based internal text-line geometry, without altering OCR region IDs.

A single region may contain several vertical Japanese columns / horizontal rows.
Split only when independent ink projections are very clearly separated; otherwise
keep the full-region Hayai result. Internal lines are ordered Japanese-style.
"""
from __future__ import annotations
import numpy as np

def _bands(values, gap=3):
    positions=np.flatnonzero(values)
    if len(positions)==0:return []
    groups=[];first=last=int(positions[0])
    for pos in positions[1:]:
        pos=int(pos)
        if pos-last>gap+1:
            groups.append((first,last+1));first=pos
        last=pos
    groups.append((first,last+1))
    return groups

def split_lines(mask, region, page_size, max_lines=12):
    x,y,w,h=map(int,(region.x,region.y,region.width,region.height))
    if mask is None or w<24 or h<30:return []
    if y<0 or x<0 or y+h>page_size[1] or x+w>page_size[0]:return []
    ink=np.asarray(mask[y:y+h,x:x+w],dtype=bool)
    if ink.shape!=(h,w) or int(ink.sum())<35:return []
    # Try the likely text orientation; do not split if evidence is weak.
    vertical=h>=w*.9
    axis=0 if vertical else 1
    line_length=h if vertical else w
    thickness=w if vertical else h
    axis_counts=ink.sum(axis=axis)
    active=axis_counts>=max(2,int(line_length*.012))
    groups=_bands(active,gap=max(2,round(thickness*.025)))
    if not 2<=len(groups)<=max_lines:return []
    total=int(ink.sum())
    boxes=[]
    for start,end in groups:
        if end-start<max(5,round(thickness*.035)):return []
        piece=ink[:,start:end] if vertical else ink[start:end,:]
        if int(piece.sum())<max(16,total*.055):return []
        rows,cols=np.nonzero(piece)
        if rows.size==0:return []
        if vertical:
            left=x+start+int(cols.min());right=x+start+int(cols.max())+1
            top=y+int(rows.min());bottom=y+int(rows.max())+1
            if bottom-top<max(18,(right-left)*.9):return []
        else:
            left=x+int(cols.min());right=x+int(cols.max())+1
            top=y+start+int(rows.min());bottom=y+start+int(rows.max())+1
            if right-left<max(20,(bottom-top)*.9):return []
        pad=max(2,min(7,round(min(w,h)*.02)))
        lx=max(x,left-pad);ly=max(y,top-pad)
        rx=min(x+w,right+pad);by=min(y+h,bottom+pad)
        boxes.append([lx,ly,rx-lx,by-ly])
    # Reject if filtered lines would omit an excessive amount of original ink.
    if sum(int((ink[:,a-x:a-x+b] if vertical else ink[c-y:c-y+d,:]).sum())
           for a,c,b,d in boxes)<total*.80:return []
    if vertical:boxes.sort(key=lambda q:(-q[0],q[1]))
    else:boxes.sort(key=lambda q:(q[1],q[0]))
    return boxes
