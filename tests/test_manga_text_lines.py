import sys
import unittest
import numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-server'))
from manga_text_lines import split_lines
class R:
    def __init__(self,x,y,w,h):
        self.x=x;self.y=y;self.width=w;self.height=h
class TextLines(unittest.TestCase):
    def test_vertical_right_left(self):
        mask=np.zeros((160,140),dtype=np.uint8)
        mask[20:125,20:33]=1;mask[20:125,65:80]=1
        boxes=split_lines(mask,R(0,0,140,160),(140,160))
        self.assertEqual(len(boxes),2)
        self.assertGreater(boxes[0][0],boxes[1][0])
    def test_horizontal_top_down(self):
        mask=np.zeros((110,190),dtype=np.uint8)
        mask[17:28,22:158]=1;mask[57:70,20:165]=1
        boxes=split_lines(mask,R(0,0,190,110),(190,110))
        self.assertEqual(len(boxes),2)
        self.assertLess(boxes[0][1],boxes[1][1])
    def test_conservative_fallback(self):
        mask=np.ones((90,90),dtype=np.uint8)
        self.assertEqual(split_lines(mask,R(0,0,90,90),(90,90)),[])
if __name__=='__main__':unittest.main()
