import sys
import unittest
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from smart_linebreak import balanced_lines
from typesetting_layout import _lines
class BalancedTest(unittest.TestCase):
    def test_keeps_paragraphs(self):
        draw=ImageDraw.Draw(Image.new('RGB',(400,200)))
        font=ImageFont.load_default()
        text='This is a text line that should be balanced\nAnother paragraph to wrap'
        proposal=balanced_lines(draw,text,font,100,1)
        self.assertTrue(proposal)
        self.assertTrue(all(draw.textlength(x,font=font)+2<=100 for x in proposal if x))
    def test_overlong_word_returns_none(self):
        draw=ImageDraw.Draw(Image.new('RGB',(200,200)))
        self.assertIsNone(balanced_lines(draw,'a'*130,ImageFont.load_default(),60,1))
if __name__=='__main__':unittest.main()
