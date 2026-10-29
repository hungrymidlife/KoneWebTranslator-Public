"""Regression: per-box proof exclusion, manual line flow, and Pillow rotation.

Extract just the production Project methods with Python AST. Importing the full
Bridge here would start optional services and depend on Windows-only packages.
"""
import ast
import math
import re
import sys
import tempfile
import unittest
from pathlib import Path
from types import MethodType
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'local-trans'))

def methods_under_test():
    tree=ast.parse((ROOT/'studio-bridge'/'studio_server.py').read_text(encoding='utf-8-sig'))
    top=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='_normalize_edit')
    cls=next(x for x in tree.body if isinstance(x,ast.ClassDef) and x.name=='Project')
    selected=[x for x in cls.body if isinstance(x,ast.FunctionDef)
              and x.name in ('_manual_draw','render_image')]
    globals_={'Image':Image,'ImageDraw':ImageDraw,'math':math,'re':re,
              'MANUAL_LAYER_ID':re.compile(r'^manual-[a-z0-9_-]{8,80}$'),
              'kwt_validate_font_id':lambda text:text,
              'load_render_settings':lambda:{'typeset_line_height_ratio':1.24}}
    script=ast.fix_missing_locations(ast.Module(body=[top,*selected],type_ignores=[]))
    exec(compile(script,'<bridge-production-methods>','exec'),globals_)
    return globals_

class EditorRotationTest(unittest.TestCase):
    def test_fields_normalize(self):
        fn=methods_under_test()['_normalize_edit']
        result=fn({'bbox':[10,20,100,75],'text':'Test','rotation':27.5,
                   'pillow_sync':False,'shape_fit':False},(320,240))
        self.assertEqual(result['rotation'],27.5)
        self.assertFalse(result['pillow_sync'])
        self.assertEqual(result['bbox'],[10,20,100,75])
        with self.assertRaises(ValueError):
            fn({'rotation':float('nan')},(320,240))

    def test_exclude_only_selected_layer_and_rotate(self):
        funcs=methods_under_test()
        with tempfile.TemporaryDirectory() as temp:
            clean=Path(temp)/'clean.png'
            Image.new('RGB',(320,220),'white').save(clean)
            name='test.png'
            rid='manual-test-1234'
            edit={'bbox':[70,42,135,80],'text':'TEST SFX\\nsecond line',
                  'font_size':25,'font_id':'system','stroke_width':0,'align':'left',
                  'text_color':'#000000','stroke_color':'#ffffff',
                  'visible':True,'rich_enabled':False,'shape_fit':False,
                  'pillow_sync':False,'rotation':0}
            class FakeProject:
                pass
            obj=FakeProject()
            obj.records={name:{'render_settings':{'typeset_line_height_ratio':1.24},
                               'regions':[],'typesetting':[]}}
            obj.edits={name:{rid:edit}}
            obj.background_path=lambda _name,_record:clean
            obj._font=lambda _size,_font_id='system':ImageFont.load_default()
            obj._manual_draw=MethodType(funcs['_manual_draw'],obj)
            obj.render_image=MethodType(funcs['render_image'],obj)
            original=Image.open(clean)
            shown=obj.render_image(name)
            self.assertIsNotNone(ImageChops.difference(shown,original).getbbox())
            excluded=obj.render_image(name,excluded_ids=[rid])
            self.assertIsNone(ImageChops.difference(excluded,original).getbbox())
            edit['rotation']=38
            rotated=obj.render_image(name)
            self.assertIsNotNone(ImageChops.difference(rotated,shown).getbbox())
            self.assertIsNotNone(ImageChops.difference(rotated,original).getbbox())

if __name__=='__main__':unittest.main()
