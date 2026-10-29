"""Regression: runtime settings and saved metadata remain schema-1 compatible."""
import copy
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'local-trans'))
sys.path.insert(0,str(ROOT/'studio-bridge'))

import render_settings
import runtime_settings

class ShapeFontSettingsTest(unittest.TestCase):
    def test_new_render_settings_validate_and_legacy_fallback(self):
        newer=render_settings.validate(dict(render_settings.DEFAULTS))
        self.assertTrue(newer['shape_font_policy_enabled'])
        self.assertEqual(newer['font_id_round_bubble'],'default')
        legacy={k:v for k,v in render_settings.DEFAULTS.items()
                if k not in ('shape_font_policy_enabled',
                            'font_id_round_bubble','font_id_rect_box',
                            'font_id_no_bubble','font_id_unknown')}
        loaded=render_settings.validate(legacy)
        self.assertEqual(loaded['font_id_unknown'],'default')
        self.assertTrue(loaded['shape_font_policy_enabled'])
    def test_disallow_unregistered_path_and_non_boolean(self):
        config=dict(render_settings.DEFAULTS)
        config['font_id_rect_box']='../../fonts/evil.ttf'
        with self.assertRaises(ValueError):
            render_settings.validate(config)
        config=dict(render_settings.DEFAULTS)
        config['shape_font_policy_enabled']='on'
        with self.assertRaises(ValueError):
            render_settings.validate(config)
    def test_runtime_schema_existing_config_backfilled(self):
        base=copy.deepcopy(runtime_settings.DEFAULTS)
        old=copy.deepcopy(base)
        for key in ('shape_font_policy_enabled','font_id_round_bubble',
                    'font_id_rect_box','font_id_no_bubble','font_id_unknown'):
            old['typesetting'].pop(key)
        loaded=runtime_settings.normalize(old)
        self.assertEqual(loaded['typesetting']['font_id_round_bubble'],'default')
        loaded['typesetting']['font_id_round_bubble']='a'*20
        self.assertEqual(runtime_settings.normalize(loaded)['typesetting']['font_id_round_bubble'],'a'*20)

if __name__=='__main__': unittest.main()
