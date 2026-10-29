"""Seed-connected hysteresis mask for faint OCR strokes; preserves legacy fallback."""
import numpy as np

def refine_probabilities(probability,allowed,threshold=.36):
    prob=np.nan_to_num(np.asarray(probability,dtype=np.float32),nan=0.,posinf=0.,neginf=0.)
    permitted=np.asarray(allowed,dtype=np.uint8)>0
    original=((prob>threshold)&permitted).astype(np.uint8)*255
    if not permitted.any():return original,'detector_seg_empty'
    seed=(prob>=max(.47,min(.70,float(threshold)+.11)))&permitted
    weak=((prob>=max(.18,float(threshold)-.10))&permitted).astype(np.uint8)
    if np.count_nonzero(seed)<8:return original,'detector_seg_fixed_fallback'
    try:import cv2
    except ImportError:return original,'detector_seg_opencv_fallback'
    count,labels,stats,_=cv2.connectedComponentsWithStats(weak,connectivity=8)
    active=np.unique(labels[seed])
    active=active[active!=0]
    if not active.size:return original,'detector_seg_fixed_fallback'
    selected=np.isin(labels,active)&permitted
    if np.count_nonzero(selected)>max(300,.70*np.count_nonzero(permitted)):
        return original,'detector_seg_fixed_fallback'
    return selected.astype(np.uint8)*255,'detector_seg_hysteresis_v2'
