"""Strict, local-only, destructive finalization of completed ZIP results.

The resulting *_ko.zip is always retained. No glob deletes or unverified tree roots.
"""
from __future__ import annotations
import os
import shutil
import zipfile
from pathlib import Path


def _metadata(meta):
    import json
    try:
        data=json.loads(meta.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise ValueError('완료 메타데이터를 읽을 수 없습니다: '+str(exc)) from exc
    entries=data.get('images') if isinstance(data,dict) else None
    if not isinstance(entries,list) or not entries:
        raise ValueError('완료 이미지 기록이 없습니다.')
    failed=[r.get('entry_name','?') for r in entries if not isinstance(r,dict) or r.get('status')!='completed']
    if failed:
        raise ValueError('미완료/실패 페이지가 있습니다: '+', '.join(map(str,failed[:5])))
    return entries


def _targets(src, output_dir, keep_original, busy_paths):
    source=Path(src).expanduser().resolve(strict=True)
    if not source.is_file() or source.suffix.lower()!='.zip' or source.stem.lower().endswith('_ko'):
        raise ValueError('올바른 원본 ZIP 파일이 아닙니다.')
    if str(source).casefold() in busy_paths:
        raise RuntimeError('현재 번역 중인 ZIP은 정리할 수 없습니다.')
    directory=Path(output_dir).expanduser().resolve(strict=True) if output_dir else source.parent
    if not directory.is_dir():raise ValueError('결과 폴더가 없습니다.')
    result=directory/(source.stem+'_ko.zip')
    metadata=result.with_suffix('.metadata.json')
    if not result.is_file() or result.is_symlink():raise ValueError('완료 번역 ZIP을 찾을 수 없습니다.')
    if not metadata.is_file() or metadata.is_symlink():raise ValueError('검증용 metadata.json이 없습니다. 이미 정리했거나 검수 데이터가 없는 결과입니다.')
    with zipfile.ZipFile(source) as zin, zipfile.ZipFile(result) as zout:
        if zin.testzip() is not None or zout.testzip() is not None:
            raise ValueError('원본 또는 번역 ZIP이 손상되었습니다.')
        source_names={n for n in zin.namelist() if not n.endswith('/') and Path(n).suffix.lower() in ('.jpg','.jpeg','.png','.webp','.bmp')}
        result_names=set(zout.namelist())
    entries=_metadata(metadata)
    recorded={str(r.get('entry_name')) for r in entries}
    if not source_names or not source_names.issubset(recorded) or not source_names.issubset(result_names):
        raise ValueError('원본 페이지와 완료 메타데이터/번역 ZIP의 페이지가 일치하지 않습니다.')
    # Use an exact allowlist. Never glob by prefix or follow directory symlinks.
    candidates=[metadata,Path(str(metadata)+'.studio-original.bak'),
                Path(str(result)+'.studio_edits.json'),
                Path(str(result)+'.studio-original.bak'),
                Path(str(result)+'.layers')]
    if not keep_original:candidates.append(source)
    present=[]
    for item in candidates:
        if item.is_symlink():raise ValueError('심볼릭 링크를 포함한 결과는 정리할 수 없습니다: '+item.name)
        if item.exists():
            if item.is_dir() and item.name.endswith('.layers'):
                # No symlink anywhere under the cache tree.
                for base,dirs,files in os.walk(item,followlinks=False):
                    for name in dirs+files:
                        if (Path(base)/name).is_symlink():
                            raise ValueError('캐시에 심볼릭 링크가 있어 정리를 중단합니다.')
            present.append(item)
    return source,result,present


def cleanup(paths,output_dir=None,keep_original=True,dry_run=True,busy_paths=()):
    if not isinstance(paths,list) or not 1<=len(paths)<=100 or not all(isinstance(p,str) for p in paths):
        raise ValueError('1~100개 원본 ZIP을 선택하세요.')
    if not isinstance(keep_original,bool):raise ValueError('원본 보존 값이 올바르지 않습니다.')
    if not isinstance(dry_run,bool):raise ValueError('요청 형식이 올바르지 않습니다.')
    seen=set(); plans=[]; errors=[]
    for raw in paths:
        try:
            src,result,present=_targets(raw,output_dir,keep_original,set(busy_paths))
            key=os.path.normcase(str(src)).casefold()
            if key in seen:raise ValueError('중복 선택된 ZIP입니다.')
            seen.add(key)
            plans.append((src,result,present))
        except (OSError,ValueError,RuntimeError,zipfile.BadZipFile) as exc:
            errors.append({'source':raw,'error':str(exc)})
    if errors:
        return {'ok':False,'preview':dry_run,'items':[], 'errors':errors,'deleted':0}
    details=[{'source':str(src),'result':str(result),'remove':[str(item) for item in paths]} for src,result,paths in plans]
    if dry_run:return {'ok':True,'preview':True,'items':details,'errors':[],'deleted':0}
    deleted=0
    for src,result,items in plans:
        for item in items:
            try:
                if item.is_dir():shutil.rmtree(item)
                else:item.unlink()
                deleted+=1
            except OSError as exc:
                errors.append({'source':str(src),'error':str(item)+': '+str(exc)})
    return {'ok':not errors,'preview':False,'items':details,'errors':errors,'deleted':deleted}
