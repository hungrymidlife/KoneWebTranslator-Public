import sys,unittest
import numpy as np
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from experiment_mask_hysteresis import refine_probabilities
class HysteresisTest(unittest.TestCase):
    def test_connected_pixels_and_noise(self):
        x=np.zeros((40,50),np.float32)
        x[10:15,10:15]=.8;x[15:18,12:14]=.30;x[29:32,30:33]=.30
        out,mode=refine_probabilities(x,np.ones(x.shape,np.uint8)*255,.36)
        self.assertEqual(int(out[16,12]),255)
        self.assertEqual(int(out[30,31]),0)
        self.assertEqual(mode,'detector_seg_hysteresis_v2')
    def test_legacy_fallback(self):
        x=np.full((12,12),.4,np.float32)
        out,mode=refine_probabilities(x,np.ones(x.shape,np.uint8)*255,.36)
        self.assertTrue(np.all(out==255))
        self.assertIn('fallback',mode)
if __name__=='__main__':unittest.main()
