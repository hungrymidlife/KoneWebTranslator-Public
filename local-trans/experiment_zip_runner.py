"""One-command real ZIP benchmark for KoneWebTranslator experiment.

Uses the EXISTING local Hayai and configured translation servers. No test
results are invented when those services/models are missing.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import sys
import time
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

def _server(url):
    req=urllib.request.Request(url,headers={'Accept':'application/json'})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req,timeout=3) as r:return {'status':r.status,'data':json.load(r)}
    except Exception as exc:return {'status':None,'error':str(exc)}

def execute(source, baseline=None, output_root=None, log=print):
    from zip_pipeline import process_zip
    from experiment_compare import compare
    source=Path(source).resolve()
    if not source.is_file() or not zipfile.is_zipfile(source):
        raise ValueError('유효한 원본 만화 ZIP 파일을 지정하세요.')
    destination=(Path(output_root) if output_root else source.parent/'kwt_experiment_results').resolve()
    destination.mkdir(parents=True,exist_ok=True)
    output=destination/(source.stem+'_'+time.strftime('%Y%m%d_%H%M%S'))
    output.mkdir(parents=True,exist_ok=False)
    log_file=output/'experiment.log'
    def note(*parts,**kwargs):
        msg=' '.join(map(str,parts))
        with log_file.open('a',encoding='utf-8') as f:f.write(time.strftime('%H:%M:%S')+' '+msg+'\n')
        log(msg)
    health=_server('http://127.0.0.1:8765/health')
    if health['status']!=200:
        raise RuntimeError('Hayai OCR 서버(127.0.0.1:8765)를 먼저 실행해야 합니다: '+str(health))
    api_health=health.get('data',{})
    result={'schema':1,'input':str(source),'input_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'ocr_server':api_health,'baseline':str(baseline) if baseline else None,
            'notes':'No accuracy guarantee; inspect OCR misses and output manually.'}
    note('[EXPERIMENT] OCR connected:',api_health)
    started=time.monotonic()
    def progress(**values):
        note('[PROGRESS]',json.dumps(values,ensure_ascii=False,default=str))
    try:
        translated,metadata=process_zip(source,output,note,lambda:False,progress)
        result.update(ok=True,elapsed_seconds=round(time.monotonic()-started,3),
                      output_zip=str(translated),metadata=str(metadata))
        if baseline:
            baseline=Path(baseline)
            if not baseline.is_file():raise ValueError('기준판 ZIP이 없습니다: '+str(baseline))
            base_meta=baseline.with_suffix('.metadata.json')
            diff=compare(baseline,translated,base_meta if base_meta.exists() else None,metadata)
            (output/'comparison.json').write_text(json.dumps(diff,ensure_ascii=False,indent=2),encoding='utf-8')
            result['comparison_summary']=diff['summary']
        note('[DONE]',result['output_zip'])
    except Exception as exc:
        result.update(ok=False,error=f'{type(exc).__name__}: {exc}',
                      traceback=traceback.format_exc(),elapsed_seconds=round(time.monotonic()-started,3))
        note('[FAILED]',result['error'])
        raise
    finally:
        (output/'experiment_report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        with zipfile.ZipFile(output/'experiment_diagnostics.zip','w',zipfile.ZIP_DEFLATED) as z:
            for name in ['experiment_report.json','experiment.log','comparison.json']:
                path=output/name
                if path.exists():z.write(path,name)
    return result

def main():
    p=argparse.ArgumentParser(description='실제 ZIP 번역 및 품질 비교')
    p.add_argument('source_zip',type=Path)
    p.add_argument('--baseline',type=Path)
    p.add_argument('--out',type=Path)
    args=p.parse_args()
    try:report=execute(args.source_zip,args.baseline,args.out)
    except Exception as exc:
        print('[ERROR]',exc,file=sys.stderr)
        return 1
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 0
if __name__=='__main__':raise SystemExit(main())
