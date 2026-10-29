import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from experiment_photoshop_text import collect,make_jsx
class JSXTest(unittest.TestCase):
    def test_output(self):
        record={'regions':[{'id':1,'translated_text':'안녕하세요'}],
                'typesetting':[{'region_id':1,'status':'drawn','typesetting_bbox':[10,20,90,60],
                                'font_size':24,'text_color':'#123ABC'}]}
        data=collect(record,{})
        self.assertEqual(data[0]['text'],'안녕하세요')
        source=make_jsx(Path('/tmp/testing.psd'),data)
        self.assertIn('LayerKind.TEXT',source)
        self.assertIn('123ABC',source)
    def test_rich_strips_markup(self):
        record={'regions':[{'id':1,'translated_text':'**Test**'}],
                'typesetting':[{'region_id':1,'status':'drawn','typesetting_bbox':[0,0,80,60]}]}
        self.assertEqual(collect(record,{})[0]['text'],'Test')
if __name__=='__main__':unittest.main()
