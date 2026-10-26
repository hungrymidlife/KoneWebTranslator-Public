# -*- coding: utf-8 -*-
"""One-click detector setup. No interactive source-path questions."""
import importlib.util
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'detector_vendor'
MODEL = ROOT / 'models' / 'comictextdetector.pt.onnx'
SOURCE_FILES = ('auto_detector.py', 'overlap_resolver.py')


def log(msg):
    print(msg, flush=True)


def find_source():
    candidates = []
    env = os.environ.get('KONE_LOCAL_TRANSLATOR_DIR', '').strip().strip('"')
    if env:
        candidates.append(Path(env))
    # Default location used by the existing KoneLocalTranslator installation.
    candidates.extend([
        Path(r'C:\dev\KoneLocalTranslator'),
        ROOT.parent.parent / 'KoneLocalTranslator',
        ROOT.parent / 'KoneLocalTranslator',
        Path.home() / 'dev' / 'KoneLocalTranslator',
    ])
    for folder in candidates:
        if all((folder / 'app' / name).is_file() for name in SOURCE_FILES):
            return folder
    return None


def ensure_packages():
    missing = [pkg for module, pkg in [('numpy','numpy>=1.26,<3'),('onnxruntime','onnxruntime>=1.18,<2'),('PIL','Pillow>=10,<13')]
               if importlib.util.find_spec(module) is None]
    if missing:
        log('[2/4] Installing missing dependencies: ' + ', '.join(missing))
        subprocess.run([sys.executable, '-m', 'pip', 'install', *missing], check=True)
    else:
        log('[2/4] Detector dependencies already installed.')


def main():
    log('=== KoneWebTranslator detector setup v0.8.1 ===')
    log('Python: ' + sys.executable)
    log('[1/4] Locating detector files automatically...')
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / '__init__.py').touch()
    missing_files = [name for name in SOURCE_FILES if not (DEST / name).is_file()]
    source = find_source()
    if missing_files:
        if source is None:
            raise RuntimeError('Detector Python sources not found. Expected C:\\dev\\KoneLocalTranslator\\app. Existing vendor files can also be used.')
        for name in missing_files:
            shutil.copy2(source / 'app' / name, DEST / name)
            log('  Copied: ' + name)
    else:
        log('  Existing detector source files found.')
    MODEL.parent.mkdir(parents=True, exist_ok=True)
    if not MODEL.is_file():
        candidates = []
        if source is not None:
            candidates.append(source / 'models' / MODEL.name)
        candidates += [Path(r'C:\dev\KoneLocalTranslator\models') / MODEL.name,
                       ROOT.parent.parent / 'KoneLocalTranslator' / 'models' / MODEL.name]
        for candidate in candidates:
            if candidate.is_file():
                shutil.copy2(candidate, MODEL)
                log('  Copied ONNX model from: ' + str(candidate))
                break
    if not MODEL.is_file():
        raise RuntimeError('ONNX model file not found at ' + str(MODEL) + '. Model weights cannot be synthesized by the installer.')
    if MODEL.stat().st_size < 1024 * 1024:
        raise RuntimeError('ONNX model is suspiciously small (possibly a Git LFS pointer): ' + str(MODEL))
    ensure_packages()
    log('[3/4] Initializing ONNX model...')
    from detector_vendor.auto_detector import ComicTextDetectorONNX
    detector = ComicTextDetectorONNX(MODEL)
    log('  ONNX initialized.')
    log('[4/4] Running image detection smoke test...')
    from PIL import Image
    regions = detector.detect(Image.new('RGB', (256, 384), 'white'))
    if not isinstance(regions, list):
        raise RuntimeError('Detector returned an invalid result type.')
    log('  Smoke test OK. Regions: ' + str(len(regions)))
    log('DETECTOR READY')
    log('Restart local-server\\start.bat to use region-based OCR.')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        log('SETUP FAILED: ' + str(exc))
        traceback.print_exc()
        sys.exit(1)
