"""Actual Comic Text Detector segmentation, independent of OCR bounding boxes.
This reuses the same ONNX weights but makes one extra CPU inference per page;
model sessions are cached inside the LocalTrans process. Missing model/session errors
are reported and fallback selection is explicit in metadata.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

_SESSION = None
_MODEL = Path(__file__).resolve().parents[1] / 'local-server' / 'models' / 'comictextdetector.pt.onnx'

def _session():
    global _SESSION
    if _SESSION is None:
        if not _MODEL.is_file():
            raise FileNotFoundError(f'Detector ONNX not found: {_MODEL}')
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        _SESSION = ort.InferenceSession(str(_MODEL), sess_options=opts, providers=['CPUExecutionProvider'])
        if 'seg' not in [x.name for x in _SESSION.get_outputs()]:
            raise ValueError('Detector ONNX has no seg output')
    return _SESSION

def segment_mask(image, regions, threshold=0.36, dilation=3):
    """Crop padded detector canvas before upsampling, matching detector refinement.
    The model's segmentation is constrained to OCR bbox (not OCR crop bbox).
    Strict fallback to bbox estimator is managed by caller and surfaced in JSON.
    """
    image = image.convert('RGB')
    scale = 1024 / max(image.size)
    w,h = [max(1,round(n*scale)) for n in image.size]
    canvas = Image.new('RGB',(1024,1024))
    canvas.paste(image.resize((w,h),Image.Resampling.BILINEAR))
    tensor=np.asarray(canvas,dtype=np.float32).transpose(2,0,1)[None]/255.0
    session=_session()
    seg=session.run(['seg'],{session.get_inputs()[0].name:tensor})[0]
    scores=np.asarray(seg)
    while scores.ndim>2: scores=scores[0]
    if scores.ndim!=2: raise ValueError(f'Unexpected seg shape {scores.shape}')
    hh=min(scores.shape[0],max(1,round(image.height*scale)))
    ww=min(scores.shape[1],max(1,round(image.width*scale)))
    prob=Image.fromarray(np.nan_to_num(scores[:hh,:ww],nan=0).astype('float32'),'F')
    prob=prob.resize(image.size,Image.Resampling.BILINEAR)
    probabilities=np.asarray(prob,dtype=np.float32)
    permitted=np.zeros(probabilities.shape,dtype=np.uint8)
    boxes=[]
    for r in regions:
        if not str(r.get('translated_text') or '').strip():continue
        try:x,y,bw,bh=[int(float(v)) for v in r['bbox']]
        except (KeyError,TypeError,ValueError):continue
        x1,y1,x2,y2=max(0,x),max(0,y),min(image.width,x+bw),min(image.height,y+bh)
        if x2<=x1 or y2<=y1:continue
        permitted[y1:y2,x1:x2]=255
        boxes.append((x1,y1,x2,y2))
    from experiment_mask_hysteresis import refine_probabilities
    binary,mask_strategy=refine_probabilities(probabilities,permitted,threshold)
    # Extend strokes only by 1-3px; keep outside OCR boxes untouched.
    out=Image.fromarray(binary,'L')
    if dilation>=1:
        out=out.filter(ImageFilter.MaxFilter(2*dilation+1))
        out=Image.fromarray(np.minimum(np.asarray(out),permitted),'L')
    pixels=int(np.count_nonzero(np.asarray(out)))
    if not boxes or pixels<8:raise ValueError('Detector mask empty in translated regions')
    return out,boxes,{'mask_source':mask_strategy,'seg_threshold':threshold,'mask_dilation_px':dilation,'mask_pixels':pixels}
