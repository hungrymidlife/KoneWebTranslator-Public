"""Lightweight isolated test: no OCR/Gemma/LaMa server needed."""
import sys
import unittest
from pathlib import Path

from PIL import ImageFont
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'local-trans'))
from manual_font_fit import fit_edit, fitted_lines


class ManualFontFitTests(unittest.TestCase):
    def setUp(self):
        from PIL import ImageDraw, Image
        self.draw = ImageDraw.Draw(Image.new('RGB', (1, 1)))
        self.font = lambda size: ImageFont.truetype('DejaVuSans.ttf', size)
        self.cfg = {'typeset_line_height_ratio': 1.24}
        self.edit = {'bbox': [10, 10, 220, 90], 'text': 'Some words to balance across several lines',
                     'font_size': 14, 'stroke_width': 1, 'rich_enabled': False}

    def test_fits_largest_font(self):
        result = fit_edit(self.edit, self.font, self.cfg, minimum=18)
        self.assertGreaterEqual(result['font_size'], 8)
        if not result['fallback']:
            from manual_font_fit import line_metrics
            m = line_metrics(self.draw, self.edit, result['font_size'], self.font, self.cfg)
            self.assertTrue(m['fits'])
            if result['font_size'] < 110:
                self.assertFalse(line_metrics(self.draw, self.edit, result['font_size']+1, self.font, self.cfg)['fits'])

    def test_wider_box_not_smaller(self):
        small = fit_edit(self.edit, self.font, self.cfg)['font_size']
        self.edit['bbox'] = [10, 10, 420, 90]
        large = fit_edit(self.edit, self.font, self.cfg)['font_size']
        self.assertGreaterEqual(large, small)

    def test_rich_markup_ignored_for_metrics(self):
        plain = fit_edit(self.edit, self.font, self.cfg)['font_size']
        self.edit['rich_enabled'] = True
        self.edit['text'] = '**Some** words to balance across several lines'
        self.assertEqual(fit_edit(self.edit, self.font, self.cfg)['font_size'], plain)

    def test_minimum_is_advisory(self):
        self.edit['bbox'] = [10, 10, 42, 27]
        result = fit_edit(self.edit, self.font, self.cfg, minimum=25)
        self.assertFalse(result['fits_minimum'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
