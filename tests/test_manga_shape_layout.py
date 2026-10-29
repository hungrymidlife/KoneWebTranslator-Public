"""Synthetic bubble masks: layout must stay inside a non-rectangular bubble."""
import sys
import unittest
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from manga_shape_layout import try_shape_layout,draw_saved_shape
class ShapeTest(unittest.TestCase):
    def test_rounded_mask(self):
        original=Image.new('RGB',(500,500),'black')
        ImageDraw.Draw(original).ellipse((100,70,380,400),fill='white')
        rendered=original.copy()
        font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        # Linux CI image includes DejaVu; Windows devs may skip if absent.
        if not Path(font_path).is_file():self.skipTest('DejaVu font unavailable')
        font=lambda sz:ImageFont.truetype(font_path,sz)
        cfg={'typeset_min_font_size':12,'typeset_max_font_size':45,
             'typeset_line_height_ratio':1.25,'typeset_padding_percent':4}
        style={'text_color':'#000000','stroke_color':'#ffffff'}
        info,reason=try_shape_layout(original,[110,100,260,250],[160,140,120,140],
               'Korean words are placed across the speech bubble with flexible widths.',
               ImageDraw.Draw(rendered),font,style,cfg)
        self.assertIsNotNone(info,reason)
        self.assertGreater(len(info['shape_line_placements']),1)
        replay=original.copy()
        self.assertTrue(draw_saved_shape(ImageDraw.Draw(replay),info,font,style))
        self.assertEqual(replay.tobytes(),rendered.tobytes())
if __name__=='__main__':unittest.main()
