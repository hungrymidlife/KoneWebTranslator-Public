"""Unit tests for experiment primitives (no OCR model required)."""
import io
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'local-server'),str(ROOT/'local-trans')]
from region_reading_order import reading_order
from experiment_compare import compare
class R:
    def __init__(self,x,y,w,h):
        self.x=x;self.y=y;self.width=w;self.height=h;self.confidence=.7
class TestExperiment(unittest.TestCase):
    def test_vertical_reading_order(self):
        r=[R(20,20,25,100),R(100,20,25,100)]
        self.assertEqual([v.x for v in reading_order(r)],[100,20])
    def test_preserve_mixed(self):
        a,b=R(10,10,100,20),R(50,10,20,100)
        self.assertEqual(reading_order([a,b]),[a,b])
    def test_zip_compare(self):
        with tempfile.TemporaryDirectory() as td:
            a,b=[Path(td)/name for name in ('main.zip','exp.zip')]
            for path,color in [(a,'white'),(b,'black')]:
                image=Image.new('RGB',(22,22),color);buf=io.BytesIO();image.save(buf,format='PNG')
                with zipfile.ZipFile(path,'w') as zipout:zipout.writestr('001.png',buf.getvalue())
            result=compare(a,b)
            self.assertEqual(result['summary']['pixel_changed'],1)
            self.assertEqual(result['summary']['pages'],1)
if __name__=='__main__':unittest.main()
