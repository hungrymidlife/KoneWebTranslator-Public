"""Regression: automatic Pillow line breaks should not produce phantom rows."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'local-trans'))
from manga_shape_layout import consume, try_shape_layout, legacy_shape_has_phantom_rows, draw_saved_or_reflow_shape
from typesetting_layout import compact_auto_text, _lines, layout_and_draw

class AutoNewlineTest(unittest.TestCase):
    def setUp(self):
        self.img=Image.new('RGB',(300,300),'white')
        self.draw=ImageDraw.Draw(self.img)
        font_path=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
        self.font=(lambda size:ImageFont.truetype(font_path,size)
                   if font_path.is_file() else ImageFont.load_default())
        self.cfg={'typeset_min_font_size':18,'typeset_max_font_size':18,
                  'typeset_line_height_ratio':1.24,'typeset_padding_percent':4}
        self.style={'text_color':'#111111','stroke_color':'#ffffff'}

    def test_explicit_line_break_no_invisible_row(self):
        rest='First\nSecond\nThird'
        consumed=[]
        while rest:
            line,rest=consume(rest,210,self.draw,self.font(18),1)
            if line is not None:consumed.append(line)
        self.assertEqual(consumed,['First','Second','Third'])

    def test_multiple_newline_sequences_compact_automatically(self):
        self.assertEqual(compact_auto_text('First\r\n\r\n Second \n\n Third'),
                         'First\nSecond\nThird')

    def test_shape_layout_rows_advance_exactly_one_row(self):
        with patch('manga_shape_layout.bubble_mask',
                   return_value=(np.ones((220,220),dtype=bool),'test')):
            info,reason=try_shape_layout(self.img,[20,15,220,220],
                [35,35,100,100],'First\nSecond\nThird',
                self.draw,self.font,self.style,self.cfg)
        self.assertIsNotNone(info,reason)
        self.assertEqual([x['text'] for x in info['shape_line_placements']],
                         ['First','Second','Third'])
        ys=[x['y'] for x in info['shape_line_placements']]
        self.assertEqual([round(ys[i+1]-ys[i]) for i in range(2)],
                         [info['line_spacing']]*2)

    def test_rectangle_layout_discards_empty_auto_paragraphs(self):
        info=layout_and_draw(self.draw,'First\n\n Second\nThird',
            [20,10,220,220],self.font,self.style,render_cfg=self.cfg)
        self.assertIsNotNone(info)
        self.assertEqual(info['line_or_column_count'],3)

    def test_manual_blank_rows_remain_user_controlled(self):
        rows=_lines(self.draw,'First\n\nSecond',self.font(18),210,1)
        self.assertEqual(rows,['First','','Second'])

    def test_old_cached_shape_is_refitted_without_ocr_or_translation(self):
        old={'layout':'manga_shape_rows_v1','line_spacing':23,
             'shape_line_placements':[{'text':'First','x':10,'y':10},
                                      {'text':'Second','x':10,'y':56}],
             'font_size':18,'stroke_width':1}
        img=Image.new('RGB',(300,300),'white')
        with patch('manga_shape_layout.bubble_mask',
                   return_value=(np.ones((220,220),dtype=bool),'test')):
            drawn=draw_saved_or_reflow_shape(
                ImageDraw.Draw(img),img,old,'First\nSecond',
                [20,15,220,220],[35,35,100,100],
                self.font,self.style,self.cfg)
        self.assertTrue(drawn)
        self.assertEqual(old['shape_line_placements'][1]['y'],56)

    def test_legacy_phantom_row_detection(self):
        old={'layout':'manga_shape_rows_v1','line_spacing':23,
             'shape_line_placements':[{'y':10},{'y':56},{'y':79}]}
        self.assertTrue(legacy_shape_has_phantom_rows(old))
        old['shape_line_placements'][1]['y']=33
        self.assertFalse(legacy_shape_has_phantom_rows(old))
        self.assertFalse(legacy_shape_has_phantom_rows({'layout':'horizontal'}))

if __name__=='__main__':unittest.main()
