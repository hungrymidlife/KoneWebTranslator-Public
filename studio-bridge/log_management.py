"""Studio log retention controls, compatible with existing persistent stdout files.
No server process is terminated or restarted.
"""
import os
import time
import threading
from pathlib import Path


def install(service):
    root = Path(service.__module__.replace('.', '/')) if False else None
    import manager_service as mgr
    cfg_file = mgr.RUNTIME / 'log_policy.json'
    defaults = {'enabled': False, 'max_mb': 100, 'days': 7}
    gate = threading.RLock()

    def config():
        obj = mgr.read_json(cfg_file, defaults)
        return {'enabled': obj.get('enabled') is True,
                'max_mb': int(obj.get('max_mb', 100)) if obj.get('max_mb') in (50,100,500,1024) else 100,
                'days': int(obj.get('days', 7)) if obj.get('days') in (1,7,30) else 7}

    def files():
        p = mgr.LOG_ROOT
        if not p.is_dir(): return []
        # Never traverse descendants, symlinks, or arbitrary files.
        return [x for x in p.iterdir() if x.is_file() and not x.is_symlink() and x.suffix == '.log'
                and (x.name.startswith('gemma_') or x.name.startswith('ocr_'))]

    def trim(path, bytes_limit):
        # In-place truncation preserves the OS file handle held by the process.
        # To avoid unbounded writes between sweeps, keep at most 4 MB per active file.
        try:
            with path.open('r+b', buffering=0) as f:
                length = f.seek(0, 2)
                if length <= bytes_limit: return
                if bytes_limit == 0:
                    f.truncate(0)
                    return
                # Preserve most recent bytes, aligned approximately to a newline.
                f.seek(max(0, length-bytes_limit))
                data = f.read(bytes_limit)
                p = data.find(b'\n')
                if p >= 0: data = data[p+1:]
                f.seek(0)
                f.write(data)
                f.truncate(len(data))
        except (OSError, PermissionError):
            pass

    def clean(force=False):
        with gate:
            policy=config()
            entries=files()
            now=time.time()
            # Registered running parent may have redirected stdout to one of these files.
            # Retain active path identity without trusting it for any process operations.
            active = set()
            for key in ('gemma','ocr'):
                entry=service.registry.get(key)
                if isinstance(entry,dict) and entry.get('log'):
                    try:
                        candidate=Path(entry['log']).resolve()
                        if candidate.parent == mgr.LOG_ROOT.resolve(): active.add(candidate)
                    except OSError: pass
            for p in entries:
                try:
                    if not force and policy['enabled'] and now-p.stat().st_mtime <= policy['days']*86400: continue
                    if p.resolve() in active:
                        trim(p,0)
                    else:
                        p.unlink(missing_ok=True)
                except OSError: pass
            if force or not policy['enabled']: return
            entries=files()
            # Bound active individual file, then total disk usage.
            for p in entries:
                if p.resolve() in active: trim(p,min(policy['max_mb']*1024*1024,4*1024*1024))
            entries=sorted(files(),key=lambda x:x.stat().st_mtime)
            total=sum(p.stat().st_size for p in entries)
            max_bytes=policy['max_mb']*1024*1024
            for p in entries:
                if total<=max_bytes: break
                old=p.stat().st_size
                if p.resolve() in active: trim(p,0)
                else: p.unlink(missing_ok=True)
                total-=old

    def state():
        p=config()
        entries=files()
        p.update({'size_bytes':sum(x.stat().st_size for x in entries),'file_count':len(entries),
                  'folder':str(mgr.LOG_ROOT), 'limitation':'OFF 모드에서도 프로세스 출력은 같은 로그 파일에 잠시 기록되며 약 1초마다 비워집니다.'})
        return p

    def change(data):
        enabled=data.get('enabled')
        mb=data.get('max_mb',100)
        days=data.get('days',7)
        if not isinstance(enabled,bool) or type(mb) is not int or mb not in (50,100,500,1024) or type(days) is not int or days not in (1,7,30):
            raise ValueError('로그 정책 입력값이 올바르지 않습니다.')
        with gate:
            mgr.atomic_json(cfg_file,{'enabled':enabled,'max_mb':mb,'days':days})
            clean()
        return state()

    def clear():
        clean(force=True)
        return state()

    def worker():
        # The stdout stream is intentionally never closed while a server runs.
        # In OFF mode truncate frequently so files cannot grow indefinitely.
        while True:
            try: clean()
            except Exception as exc: service._log(f'[로그 정리 오류] {exc}')
            time.sleep(1)

    threading.Thread(target=worker,daemon=True,name='kwt-log-maintenance').start()
    return state, change, clear
