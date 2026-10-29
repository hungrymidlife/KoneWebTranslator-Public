"""Image ZIP and OCR sidecar comparison. Not an accuracy ground truth."""
import argparse
import hashlib
import io
import json
import zipfile
from pathlib import Path
from PIL import Image,ImageChops,ImageStat
IMAGES={'.jpg','.jpeg','.png','.webp','.bmp'}

def metadata(path):
    if path is None:return {}
    root=json.loads(Path(path).read_text(encoding='utf-8-sig'))
    return {str(v['entry_name']):v for v in root.get('images',[]) if isinstance(v,dict) and v.get('entry_name')}

def compare(base_zip, experiment_zip, base_meta=None, experiment_meta=None):
    a,b=metadata(base_meta),metadata(experiment_meta)
    result={'schema':1,'baseline':str(base_zip),'experiment':str(experiment_zip),
            'warning':'Image difference is not a measure of translation quality.',
            'pages':[]}
    with zipfile.ZipFile(base_zip) as za,zipfile.ZipFile(experiment_zip) as zb:
        names=sorted(n for n in set(za.namelist())|set(zb.namelist())
                     if Path(n).suffix.lower() in IMAGES)
        for name in names:
            item={'name':name,'baseline_present':name in za.namelist(),
                  'experiment_present':name in zb.namelist()}
            if item['baseline_present'] and item['experiment_present']:
                x,y=za.read(name),zb.read(name)
                item['same_bytes']=hashlib.sha256(x).digest()==hashlib.sha256(y).digest()
                with Image.open(io.BytesIO(x)) as ia,Image.open(io.BytesIO(y)) as ib:
                    aa,bb=ia.convert('RGB'),ib.convert('RGB')
                    item['dimensions_match']=aa.size==bb.size
                    item['pixel_mae']=round(sum(ImageStat.Stat(ImageChops.difference(aa,bb)).mean)/3,4) if aa.size==bb.size else None
            for label,meta in [('baseline',a),('experiment',b)]:
                v=meta.get(name,{})
                item[label+'_ocr_regions']=len(v.get('regions',[]))
                item[label+'_render_seconds']=v.get('render_seconds')
            result['pages'].append(item)
    result['summary']={'pages':len(result['pages']),
                       'pixel_changed':sum(v.get('same_bytes') is False for v in result['pages']),
                       'baseline_regions':sum(v['baseline_ocr_regions'] for v in result['pages']),
                       'experiment_regions':sum(v['experiment_ocr_regions'] for v in result['pages'])}
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('baseline_zip',type=Path);p.add_argument('experiment_zip',type=Path)
    p.add_argument('--baseline-meta',type=Path)
    p.add_argument('--experiment-meta',type=Path)
    p.add_argument('--out',type=Path,default=Path('experiment_compare.json'))
    v=p.parse_args()
    report=compare(v.baseline_zip,v.experiment_zip,v.baseline_meta,v.experiment_meta)
    v.out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report['summary'],ensure_ascii=False))
