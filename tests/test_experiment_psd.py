import sys
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from experiment_psd import write_psd
class PSDTest(unittest.TestCase):
    def test_psd_header_and_composite(self):
        bg=Image.new('RGBA',(12,15),'white')
        layer=Image.new('RGBA',(12,15),(255,0,0,0))
        layer.putpixel((2,3),(255,0,0,255))
        payload=write_psd([('원본',bg),('한국어',layer)])
        self.assertEqual(payload[:4],b'8BPS')
        import io
        with Image.open(io.BytesIO(payload)) as im:
            self.assertEqual(im.size,(12,15))
            rgb=im.convert('RGB')
            self.assertEqual(rgb.getpixel((2,3)),(255,0,0))
    def test_dimensions_guard(self):
        with self.assertRaises(ValueError):
            write_psd([('a',Image.new('RGB',(1,1))),('b',Image.new('RGB',(2,1)))])
if __name__=='__main__':unittest.main()
