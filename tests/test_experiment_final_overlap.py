"""The final OCR overlap pass runs AFTER Phase1 and tiled candidates.

No ONNX, Gemma, Hayai, or LaMa model is required for these geometry checks.
"""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'local-server'))

from detector_vendor.auto_detector import ComicTextDetectorONNX, TextRegion
from detector_vendor.overlap_resolver import (
    _positive_overlap_pairs, finalize_detected_regions,
)


class FinalOverlapTest(unittest.TestCase):
    def setUp(self):
        # The user's old overlap switch does not control the new final stage.
        # Patch the dedicated path lookup to test the default-on behavior.
        self.mode = patch('pathlib.Path.read_text', side_effect=FileNotFoundError())
        self.mode.start()

    def tearDown(self):
        self.mode.stop()

    def test_no_overlap_retains_identity_and_geometry(self):
        items = [TextRegion(5, 5, 30, 50, .9), TextRegion(42, 5, 22, 50, .8)]
        output = finalize_detected_regions(items, None, (120, 120), 1.)
        self.assertEqual(items, output)

    def test_nested_duplicate_ink_removed(self):
        a = TextRegion(20, 20, 30, 40, .98)
        b = TextRegion(10, 10, 70, 70, .75)
        segmentation = np.zeros((1, 1, 100, 100), np.float32)
        segmentation[0, 0, 25:50, 25:45] = 1.
        output = finalize_detected_regions([a, b], segmentation, (100, 100), 1.)
        self.assertEqual(output, [a])
        self.assertEqual(_positive_overlap_pairs(output), 0)

    def test_distinct_text_ink_survives_partial_overlap(self):
        first = TextRegion(10, 20, 60, 65, .9)
        second = TextRegion(55, 20, 70, 65, .8)
        mask = np.zeros((120, 145), np.float32)
        mask[30:65, 20:40] = 1.
        mask[32:70, 94:112] = 1.
        output = finalize_detected_regions(
            [first, second], mask, (145, 120), 1.
        )
        self.assertGreaterEqual(len(output), 2)
        self.assertEqual(_positive_overlap_pairs(output), 0)
        combined = np.zeros_like(mask, dtype=bool)
        for region in output:
            combined[region.y:region.y + region.height,
                     region.x:region.x + region.width] = True
        self.assertEqual(np.count_nonzero(combined & (mask > .36)),
                         np.count_nonzero(mask > .36))

    def test_phase1_and_tiled_output_also_get_final_cleanup(self):
        first = TextRegion(10, 15, 60, 60, .92)
        second = TextRegion(56, 16, 64, 58, .82)
        class FakeSession:
            def run(self, _names, _payload):
                return (
                    np.zeros((1, 0, 6), np.float32),
                    np.zeros((1, 1, 1024, 1024), np.float32),
                )
        detector = object.__new__(ComicTextDetectorONNX)
        detector.session = FakeSession()
        detector.input_name = 'images'
        with (
            patch('detector_vendor.phase1_refiner.phase1_active', return_value=True),
            patch('detector_vendor.phase1_refiner.phase1_refine', return_value=[first]),
            patch('detector_vendor.tiled_detector_v1.tile_active', return_value=True),
            patch('detector_vendor.tiled_detector_v1.augment', return_value=[first, second]),
        ):
            output = detector.detect(Image.new('RGB', (140, 140), 'white'))
        self.assertEqual(_positive_overlap_pairs(output), 0)
        self.assertGreaterEqual(len(output), 1)


if __name__ == '__main__':
    unittest.main()
