"""Re-typeset from original ZIP and metadata without OCR or Gemma calls."""
import argparse, json, zipfile, io
from pathlib import Path
from zip_pipeline import typeset

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--original',required=True)
    ap.add_argument('--metadata',required=True)
    ap.add_argument('--output',required=True)
    ap.add_argument('--color',choices=['auto','black','white'],default='auto')
    args=ap.parse_args()
    src=Path(args.original).resolve(); dst=Path(args.output).resolve()
    if src==dst:raise SystemExit('Refusing to overwrite original ZIP')
    if dst.exists():raise SystemExit('Output already exists: '+str(dst))
    meta=json.loads(Path(args.metadata).read_text(encoding='utf-8'))
    records={r['entry_name']:r for r in meta['images'] if r.get('status')=='completed'}
    new=[]
    try:
        with zipfile.ZipFile(src) as zin,zipfile.ZipFile(dst,'x',compression=zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                if info.is_dir():continue
                name=info.filename
                data=zin.read(info)
                if name in records:
                    rec=records[name]
                    cache=dst.parent/(dst.stem+'.layers')/('page_%04d'%(int(rec['index'])+1))
                    im,placements,inpaint=typeset(data,rec['regions'],text_color_mode=args.color,cache_dir=cache)
                    buf=io.BytesIO();ext=Path(name).suffix.lower()
                    fmt='JPEG' if ext in ('.jpg','.jpeg') else 'WEBP' if ext=='.webp' else 'PNG'
                    im.save(buf,format=fmt,**({'quality':92} if fmt!='PNG' else {}))
                    data=buf.getvalue()
                    new.append({'entry_name':name,'typesetting':placements,'inpainting':inpaint})
                zout.writestr(info,data)
        dst.with_suffix('.reprocess.json').write_text(json.dumps({'source_metadata':str(args.metadata),'images':new},ensure_ascii=False,indent=2),encoding='utf-8')
    except Exception:
        dst.unlink(missing_ok=True)
        raise
    print('Created:',dst)
if __name__=='__main__':main()
