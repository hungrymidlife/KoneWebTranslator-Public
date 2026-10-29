import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from experiment_rich_text import runs
class Rich(unittest.TestCase):
    def test_markup(self):
        x=runs('보통 **강조** [[color:#ff0000]]빨강[[/color]]','#111111')
        self.assertIn(('강조','#111111',True),x)
        self.assertIn(('빨강','#ff0000',False),x)
    def test_plain(self):self.assertEqual(runs('텍스트'),[('텍스트','#000000',False)])
if __name__=='__main__':unittest.main()
