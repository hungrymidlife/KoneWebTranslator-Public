import sys
import unittest
from pathlib import Path
from PIL import Image,ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from shape_font_policy import classify_shape,choose_font,valid_policy_font,effective_class

class ShapeFontPolicyTest(unittest.TestCase):
    def scene(self,kind):
        image=Image.new('RGB',(400,400),'black')
        d=ImageDraw.Draw(image)
        if kind=='round':d.ellipse((75,65,330,335),fill='white')
        elif kind=='rect':d.rectangle((75,65,330,335),fill='white')
        elif kind=='none':image=Image.new('RGB',(400,400),'white')
        return image
    def test_shapes(self):
        for kind,want in [('round','round_bubble'),('rect','rect_box'),('none','no_bubble')]:
            with self.subTest(kind=kind):
                meta=classify_shape(self.scene(kind),[145,145,95,85])
                self.assertEqual(meta['shape_class'],want)
                self.assertGreater(meta['shape_confidence'],.5)
    def test_uncertain_stays_unknown(self):
        self.assertEqual(classify_shape(self.scene('round'),[-1,2,30,30])['shape_class'],'unknown')
    def test_registered_id_policy_and_fallback(self):
        policy={'shape_font_policy_enabled':True,'font_id_round_bubble':'a'*20,
                'font_id_rect_box':'default','font_id_no_bubble':'system','font_id_unknown':'default'}
        self.assertEqual(choose_font('round_bubble',policy,'b'*20),'a'*20)
        self.assertEqual(choose_font('rect_box',policy,'b'*20),'b'*20)
        self.assertEqual(choose_font('no_bubble',policy,'b'*20),'system')
        policy['shape_font_policy_enabled']=False
        self.assertEqual(choose_font('round_bubble',policy,'b'*20),'b'*20)
        self.assertFalse(valid_policy_font('../untrusted.ttf'))
        self.assertEqual(effective_class('round_bubble','rect_box'),'rect_box')

if __name__=='__main__': unittest.main()
