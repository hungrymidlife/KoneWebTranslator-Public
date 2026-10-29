import sys
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from experiment_mask_roi import apply_strokes,partial_restore
class MaskTest(unittest.TestCase):
    def test_erase_restores_original_without_model(self):
        orig=Image.new('RGB',(40,40),'white')
        prev=Image.new('RGB',(40,40),'black')
        old=Image.new('L',(40,40),255)
        new=apply_strokes(old,[{'mode':'erase','radius':5,'points':[[20,20]]}])
        result,stats=partial_restore(orig,prev,old,new)
        self.assertEqual(result.getpixel((20,20)),(255,255,255))
        self.assertEqual(result.getpixel((0,0)),(0,0,0))
        self.assertEqual(stats['roi_count'],0)
    def test_reject_bogus_stroke(self):
        with self.assertRaises(ValueError):
            apply_strokes(Image.new('L',(10,10)),[{'mode':'remove','radius':1,'points':[[1,1]]}])
if __name__=='__main__':unittest.main()
