"""Adapter for the existing KoneLocalTranslator ComicTextDetectorONNX implementation."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / 'models' / 'comictextdetector.pt.onnx'


def detect_regions(image: Image.Image):
    if not MODEL.is_file():
        raise RuntimeError('Comic Text Detector ONNX model missing: run setup_detector.bat')
    try:
        from detector_vendor.auto_detector import ComicTextDetectorONNX
    except ImportError as exc:
        raise RuntimeError('Detector source missing: run setup_detector.bat') from exc
    # Cache the ONNX session for all pages of the current server process.
    global _detector
    if _detector is None:
        _detector = ComicTextDetectorONNX(MODEL)
    return _detector.detect(image)


def last_text_mask():
    """Only read while OCR lock is held, immediately after detect_regions."""
    return getattr(_detector, 'last_text_mask', None) if _detector is not None else None


_detector = None
