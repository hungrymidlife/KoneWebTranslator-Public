"""Allowlisted local Studio dependency installer; no arbitrary command execution.

KWT_STUDIO_INSTALLER_V2_0_0: every command is fixed in source. Only Studio
loopback APIs call this module. Long installs continue in a bounded worker.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
VENV = ROOT / 'local-server' / '.venv' / 'Scripts' / 'python.exe'
HAYAI = ROOT / 'local-server' / '.venv-hayai' / 'Scripts' / 'python.exe'
SITES = lambda venv: venv.parent.parent / 'Lib' / 'site-packages'
MODEL_DETECTOR = ROOT / 'local-server' / 'models' / 'comictextdetector.pt.onnx'
DETECTOR_VENDOR = ROOT / 'local-server' / 'detector_vendor' / 'auto_detector.py'
MODEL_LAMA = ROOT / 'local-trans' / 'models' / 'big-lama.pt'
GEMMA_ROOT = Path(r'C:\AI\Gemma4MTP') if os.name == 'nt' else Path('/tmp/Gemma4MTP')
GEMMA_MAIN = GEMMA_ROOT / 'models' / 'Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf'
GEMMA_MTP = GEMMA_ROOT / 'models' / 'mtp-gemma-4-12B-it.gguf'
GEMMA_EXEC = GEMMA_ROOT / 'llama-bin' / 'llama-server.exe'
LAMA_SHA = '344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9'
LOG_DIR = ROOT / 'studio-bridge' / '.studio_runtime' / 'installer'
LOG_FILE = LOG_DIR / 'setup.log'
WINOCR_STATUS = LOG_DIR / 'windows_ocr_jp_verified.json'
GPU_STATUS = LOG_DIR / 'cuda_verified.json'
WINOCR_SCRIPT = ROOT / 'studio-bridge' / 'windows_ocr_jp_capability.ps1'
# KWT_INSTALL_AUDIT_V2_0_1
OPTIONAL_TASKS = {'winocr_py', 'winocr_lang', 'gemma_mtp', 'gpu'}
TEST_ONLY_TASKS = {'gpu'}
LOCK = threading.RLock()
CURRENT = None
JOB = None

TASKS = (
    ('base_deps', '기본 Python 패키지', 'OCR 서버·Studio Bridge용 FastAPI, Pillow, NumPy, OpenCV(말풍선 검출) 설치/복구'),  # KWT_BUBBLE_OPENCV_DEP_V1
    ('hayai', 'Hayai OCR', '일본어 OCR 전용 .venv-hayai와 PyTorch/CUDA 의존성 설치'),
    ('detector', 'Comic Text Detector', 'ONNX 모델·런타임·검출기 소스 및 실제 검출 작동 검사'),
    ('lama_torch', 'LaMa용 PyTorch', 'Studio 기본 .venv에 별도로 PyTorch 설치 (기존 누락 해결)'),
    ('lama_model', 'LaMa 복원 모델', '글자를 지운 배경을 복원하는 big-lama.pt 다운로드'),
    ('gemma', 'Gemma 4 번역 모델', 'llama.cpp 실행 파일과 주 번역 모델 설치 · 기본 C:\\AI\\Gemma4MTP'),
    ('winocr_py', 'Windows OCR Python 연동', '보조 OCR용 WinRT Python 패키지 설치 (.venv, 선택 기능)'),
    ('winocr_lang', 'Windows 일본어 OCR 언어팩', '일본어 OCR Windows 선택 기능 설치 · 관리자 승인 필요 (선택 기능)'),
    ('gemma_mtp', 'Gemma MTP 보조 모델', 'MTP 가속 모드용 추가 GGUF 설치 (선택)'),
    ('gpu', 'NVIDIA CUDA 가속 검사', '설치된 PyTorch에서 GPU 사용 가능 여부 확인 (진단 전용)'),
)
TASK_IDS = {item[0] for item in TASKS}


def _site_has(venv, module):
    site = SITES(venv)
    return (site / module).exists() or (site / (module + '.py')).exists()


def _winrt_files_present():
    site = SITES(VENV)
    namespaces = ('media/ocr', 'globalization', 'graphics/imaging', 'storage/streams')
    # PyWinRT wheels may expose namespace modules as .pyd/.py, not directories.
    return VENV.is_file() and all(
        (site / 'winrt' / 'windows' / folder).is_dir() or
        any((site / 'winrt' / 'windows' / folder).parent.glob((site / 'winrt' / 'windows' / folder).name+'.*'))
        for folder in namespaces)


def _winocr_last_verified():
    try:
        item = json.loads(WINOCR_STATUS.read_text(encoding='utf-8'))
        return bool(item.get('installed')) and item.get('capability') == 'Language.OCR~~~ja-JP~0.0.1.0'
    except (OSError, ValueError, TypeError):
        return False


def _snapshot_item(key, title, description):
    unknown = False
    if key == 'base_deps':
        # KWT_BUBBLE_OPENCV_DEP_V1: the bubble layout uses cv2 in the same .venv as Studio Bridge.
        site = SITES(VENV)
        cv2_pinned = (_site_has(VENV, 'cv2') and
                      any(site.glob('opencv_python_headless-4.11.0.86.dist-info')))
        ok = VENV.is_file() and cv2_pinned and all(
            _site_has(VENV, name) for name in ('fastapi', 'uvicorn', 'pydantic', 'PIL', 'numpy'))
        detail = ('기본 Python 패키지 + OpenCV 4.11.0.86 파일 발견' if ok else
                  '기본 패키지 또는 OpenCV(headless 4.11.0.86) 누락 · 설치/복구 필요')
    elif key == 'hayai':
        ok = HAYAI.is_file() and _site_has(HAYAI, 'torch') and _site_has(HAYAI, 'hayai_ocr')
        detail = '전용 Python 및 패키지 발견' if ok else 'Hayai 전용 환경 또는 패키지 누락'
    elif key == 'detector':
        ok = MODEL_DETECTOR.is_file() and MODEL_DETECTOR.stat().st_size > 1024 * 1024 and _site_has(VENV, 'onnxruntime') and DETECTOR_VENDOR.is_file()
        detail = 'ONNX·런타임·검출기 소스 발견' if ok else 'ONNX 모델·런타임 또는 검출기 소스 누락'
    elif key == 'lama_torch':
        ok = _site_has(VENV, 'torch')
        detail = '기본 Python의 torch 파일 발견' if ok else '기본 .venv의 torch 미설치'
    elif key == 'lama_model':
        ok = MODEL_LAMA.is_file() and MODEL_LAMA.stat().st_size > 1024 * 1024
        detail = '복원 모델 파일 발견' if ok else 'LaMa 모델 다운로드 필요'
    elif key == 'gemma':
        ok = GEMMA_EXEC.is_file() and GEMMA_MAIN.is_file() and GEMMA_MAIN.stat().st_size > 100 * 1024 * 1024
        detail = '주 모델과 실행 파일 발견' if ok else 'Gemma 또는 llama.cpp 설치 필요'
    elif key == 'winocr_py':
        ok = _winrt_files_present()
        detail = '필요한 네 개 WinRT 네임스페이스 파일 발견' if ok else '보조 OCR용 WinRT Python 패키지 설치 필요'
    elif key == 'winocr_lang':
        ok = _winocr_last_verified()
        unknown = not WINOCR_STATUS.is_file()
        detail = '마지막 검사에서 설치 확인 · 테스트로 재검증 권장' if ok else 'Windows 선택 기능: 테스트로 확인 (일부 PC에서 관리자 권한 필요)'
    elif key == 'gemma_mtp':
        ok = GEMMA_MTP.is_file() and GEMMA_MTP.stat().st_size > 1024 * 1024
        detail = 'MTP 모델 파일 발견' if ok else '선택 설치: MTP 가속 모델 없음'
    else:  # gpu: do not mistake a torch package for a working NVIDIA GPU
        ok = GPU_STATUS.is_file()
        unknown = not ok
        detail = '마지막 CUDA 검사 성공 · 재검증 권장' if ok else '진단 전용: 테스트로 드라이버·PyTorch CUDA 사용 여부 확인'
    return {'id':key,'name':title,'description':description,'detected':bool(ok),'detail':detail,
            'optional':key in OPTIONAL_TASKS,'installable':key not in TEST_ONLY_TASKS,'unknown':unknown}


def _job_copy():
    with LOCK:
        if JOB is None:
            return None
        return {k:(list(v) if isinstance(v,list) else v) for k,v in JOB.items()}


def status():
    return {'project_root':str(ROOT), 'studio_ready':VENV.is_file() and (ROOT/'studio'/'node_modules').is_dir(),
            'items':[_snapshot_item(*x) for x in TASKS], 'job':_job_copy(),
            'notes':['파일 발견은 설치 확인의 1단계입니다. 각 항목의 테스트로 실제 로딩을 검증하세요.',
                     'Hayai 모델 가중치는 첫 OCR 실행 시 추가 다운로드될 수 있습니다.',
                     'Windows 일본어 OCR 선택 기능은 설치 화면에서 UAC 관리자 승인을 받아 설치할 수 있습니다.',
                     'Windows OCR을 사용하려면 Windows 언어팩과 기본 .venv의 WinRT Python 패키지가 모두 필요합니다.',
                     '전체 설치 검사는 필수 항목만 대상으로 합니다. Windows OCR·MTP·GPU 가속은 선택 기능에서 따로 테스트하세요.',
                     '파일 발견은 실행 성공을 보장하지 않습니다. GPU 및 모델 실제 사용 여부는 테스트와 서버 시작 후 확인하세요.']}


def _write_log(text):
    try:
        LOG_DIR.mkdir(parents=True,exist_ok=True)
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > 3 * 1024 * 1024:
            backup = LOG_FILE.with_suffix('.old.log')
            backup.unlink(missing_ok=True)
            LOG_FILE.replace(backup)
        with LOG_FILE.open('a',encoding='utf-8') as fp:
            fp.write(text + '\n')
    except OSError:
        pass


def _log(message):
    line = str(message).replace('\x00','')[:1800]
    with LOCK:
        if JOB is not None:
            JOB['lines'].append(line)
            del JOB['lines'][:-220]
    _write_log(time.strftime('%Y-%m-%d %H:%M:%S')+' '+line)


def _online(port, route):
    try:
        with urlopen('http://127.0.0.1:'+str(port)+route, timeout=0.8) as response:
            return response.status == 200
    except (OSError, URLError, TimeoutError):
        return False


def _test_steps(task):
    base = str(VENV)
    test_code = {
        # KWT_BUBBLE_OPENCV_DEP_V1: binary + version + connected-component smoke test.
        'base_deps': ('import fastapi,uvicorn,pydantic,numpy,cv2; from PIL import Image; '
                      'from importlib.metadata import version; '
                      'assert version("opencv-python-headless")=="4.11.0.86", "OpenCV version mismatch"; '
                      'assert cv2.__version__=="4.11.0", "OpenCV imported unexpected build"; '
                      'assert cv2.connectedComponentsWithStats(numpy.zeros((10,10),dtype=numpy.uint8))[0]>=1; '
                      'print("[OK] Studio/OCR base packages + bubble OpenCV:", cv2.__version__)'),
        'hayai': 'import torch,transformers,hayai_ocr; print("[OK] Hayai packages; torch:",torch.__version__,"CUDA:",torch.cuda.is_available())',
        'detector': ('import sys; from pathlib import Path; from PIL import Image; '
                     'sys.path.insert(0,r"'+str(ROOT/'local-server')+'"); '
                     'from detector_bridge import detect_regions; '
                     'regions=detect_regions(Image.new("RGB",(256,384),"white")); '
                     'assert isinstance(regions,list),"Detector returned invalid result"; '
                     'print("[OK] Comic Text Detector initialized and inferred:",len(regions))'),
        'lama_torch': 'import torch; print("[OK] LaMa torch:",torch.__version__,"CUDA:",torch.cuda.is_available())',
        'lama_model': ('import hashlib,pathlib; p=pathlib.Path(r"'+str(MODEL_LAMA)+'"); '
                       'assert p.is_file(),"LaMa file missing"; '
                       'h=hashlib.file_digest(p.open("rb"),"sha256").hexdigest(); '
                       'assert h=="'+LAMA_SHA+'","LaMa SHA256 mismatch"; print("[OK] LaMa SHA256 verified")'),
        'winocr_py': ('from winrt.windows.media.ocr import OcrEngine; '
                      'from winrt.windows.globalization import Language; '
                      'from winrt.windows.graphics.imaging import BitmapDecoder; '
                      'from winrt.windows.storage.streams import InMemoryRandomAccessStream, DataWriter; '
                      'print("[OK] Windows OCR WinRT Python namespaces import")'),
        'gemma_mtp': ('from pathlib import Path; p=Path(r"'+str(GEMMA_MTP)+'"); '
                      'assert p.is_file() and p.stat().st_size>1048576,"MTP model missing"; '
                      'print("[OK] MTP file exists (weight compatibility verified at launch)")'),
        'gpu': ('import torch; print("CUDA:",torch.cuda.is_available(),"devices:",torch.cuda.device_count()); '
                'assert torch.cuda.is_available(),"NVIDIA CUDA unavailable; check driver, GPU or PyTorch wheel"; '
                'print("[OK]",torch.cuda.get_device_name(0))'),
    }
    if task=='gemma':
        return [[base,str(ROOT/'setup_gemma.py'),'--check']]
    if task=='winocr_lang':
        return [['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(WINOCR_SCRIPT),'-Action','test']]
    py = str(HAYAI) if task=='hayai' else base
    return [[py,'-c',test_code[task]]]


def _install_steps(task):
    py = str(VENV)
    if task=='base_deps':
        return [[py,'-m','pip','install','-r',str(ROOT/'local-server'/'requirements.txt')]]
    if task=='hayai':
        return [['cmd.exe','/d','/c','call',str(ROOT/'SETUP_HAYAI.bat')]]
    if task=='detector':
        return [[py,str(ROOT/'download_detector.py')],
                [py,str(ROOT/'local-server'/'setup_detector.py')]]
    if task=='lama_torch':
        return [[py,'-m','pip','install','torch','--index-url','https://download.pytorch.org/whl/cu128']]
    if task=='lama_model':
        return [[py,str(ROOT/'download_lama.py')]]
    if task=='gemma':
        return [[py,str(ROOT/'setup_gemma.py')]]
    if task=='winocr_py':
        return [[py,'-m','pip','install',
                 'winrt-Windows.Media.Ocr','winrt-Windows.Globalization',
                 'winrt-Windows.Graphics.Imaging','winrt-Windows.Storage.Streams']]
    if task=='winocr_lang':
        return [['powershell.exe','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(WINOCR_SCRIPT),'-Action','install']]
    if task=='gpu':
        raise ValueError('GPU 드라이버는 자동 설치하지 않습니다. GPU 항목에서는 테스트만 가능합니다.')
    return [[py,str(ROOT/'setup_gemma.py'),'--mtp']]


def _run_command(command, label):
    _log('▶ '+label)
    env = os.environ.copy()
    env['PYTHONIOENCODING']='utf-8'
    env['PYTHONUNBUFFERED']='1'
    flags = getattr(subprocess,'CREATE_NO_WINDOW',0)
    with subprocess.Popen(command,cwd=str(ROOT),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                          stdin=subprocess.DEVNULL,encoding='utf-8',errors='replace',bufsize=1,
                          creationflags=flags,env=env) as proc:
        assert proc.stdout is not None
        for line in proc.stdout:
            for part in line.replace('\r','\n').splitlines():
                if part.strip():_log(part.strip())
        code=proc.wait()
    _log(('✓ ' if code==0 else '✗ ')+label+' · 종료 코드 '+str(code))
    return code


def _worker(task, action):
    global CURRENT
    passed=True
    try:
        targets=[x[0] for x in TASKS if x[0] not in OPTIONAL_TASKS] if task=='all' else [task]
        _log('설치 대상 프로젝트: '+str(ROOT))
        for key in targets:
            with LOCK:
                JOB['step']=key
            if action=='install':
                if key in ('base_deps','hayai','detector','winocr_py') and _online(8765,'/health'):
                    raise RuntimeError('OCR 서버가 실행 중입니다. AI 서버 관리에서 종료한 후 설치하세요. 다른 서버는 강제로 종료하지 않습니다.')
                if key in ('gemma','gemma_mtp') and _online(18080,'/v1/models'):
                    raise RuntimeError('Gemma 서버가 실행 중입니다. AI 서버 관리에서 종료한 후 설치하세요.')
            for cmd in (_install_steps(key) if action=='install' else _test_steps(key)):
                if not Path(cmd[0]).is_file() and cmd[0] not in ('cmd.exe','powershell.exe'):
                    raise FileNotFoundError('실행 파일 없음: '+cmd[0])
                code=_run_command(cmd,key+' '+('설치' if action=='install' else '테스트'))
                if key=='winocr_lang':
                    if code==0:
                        LOG_DIR.mkdir(parents=True,exist_ok=True)
                        WINOCR_STATUS.write_text(json.dumps({'installed':True,'capability':'Language.OCR~~~ja-JP~0.0.1.0',
                                                              'checked_at':int(time.time())}),encoding='utf-8')
                    else:
                        WINOCR_STATUS.unlink(missing_ok=True)
                if key=='gpu':
                    if code==0:
                        LOG_DIR.mkdir(parents=True,exist_ok=True)
                        GPU_STATUS.write_text(json.dumps({'verified_at':int(time.time())}),encoding='utf-8')
                    else:
                        GPU_STATUS.unlink(missing_ok=True)
                if code:
                    passed=False
                    _log('[FAIL] '+key+' '+('설치' if action=='install' else '테스트')+' 실패')
                    if action=='install':raise RuntimeError('설치를 중단했습니다. 위 로그를 확인하세요.')
                    break
        with LOCK:
            JOB['state']='completed' if passed else 'failed'
            JOB['message']='작업 완료. 설치된 서버는 AI 서버 관리에서 실행·테스트하세요.' if passed else '일부 항목 검증 실패. 위 로그를 확인하세요.'
    except Exception as exc:
        _log('[ERROR] '+type(exc).__name__+': '+str(exc))
        with LOCK:
            JOB['state']='failed'
            JOB['message']=str(exc)
    finally:
        with LOCK:
            JOB['ended']=int(time.time())
            CURRENT=None


def run(body, processing=False):
    global CURRENT, JOB
    if processing:
        raise RuntimeError('자동 ZIP 번역 작업 중에는 설치·검사를 시작할 수 없습니다.')
    if not isinstance(body,dict):raise ValueError('요청 본문 형식 오류')
    task=body.get('task')
    action=body.get('action')
    if task not in TASK_IDS|{'all'} or action not in ('install','test') or (task=='all' and action!='test') or (task in TEST_ONLY_TASKS and action=='install'):
        raise ValueError('지원하지 않는 설치 항목 또는 명령입니다.')
    if not VENV.is_file():raise FileNotFoundError('Studio 기본 Python 환경이 없습니다. START_STUDIO_SETUP.bat을 실행하세요.')
    with LOCK:
        if CURRENT is not None:
            raise RuntimeError('다른 모델 설치 또는 테스트가 진행 중입니다.')
        JOB={'id':uuid.uuid4().hex[:12], 'task':task,'action':action,'step':task,
             'state':'running','message':'시작 중','started':int(time.time()),'ended':None,'lines':[]}
        CURRENT=threading.Thread(target=_worker,args=(task,action),daemon=True,name='KWT-Installer')
        CURRENT.start()
        return {'started':True,'job_id':JOB['id']}


def get(path):
    if path=='/api/installer/status':return status()
    raise ValueError('Unknown installer query')


def post(path,body,processing=False):
    if path=='/api/installer/run':return run(body,processing=processing)
    raise ValueError('Unknown installer action')
