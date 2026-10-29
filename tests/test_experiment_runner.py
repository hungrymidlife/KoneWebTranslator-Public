import unittest
import sys
import tempfile
import zipfile
from unittest.mock import patch
from types import ModuleType
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'local-trans'))
from experiment_zip_runner import _server,execute
class RunnerTest(unittest.TestCase):
    def test_server_invalid_port_is_reported(self):
        value=_server('http://127.0.0.1:1/health')
        self.assertIsNone(value.get('status'))

    def test_successful_zip_report(self):
        # Synthetic output: no Hayai, Gemma or LaMa model required.
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            source=root/'input.zip'
            with zipfile.ZipFile(source,'w') as z:z.writestr('page.txt',b'demo')
            fake=ModuleType('zip_pipeline')
            def process_zip(src,out,log,cancel,progress):
                translated=Path(out)/'input_ko.zip'
                metadata=Path(out)/'input_ko.metadata.json'
                with zipfile.ZipFile(translated,'w') as z:z.writestr('page.txt',b'translated')
                metadata.write_text('{"images":[]}',encoding='utf-8')
                progress(stage='complete',page=1,total=1)
                return translated,metadata
            fake.process_zip=process_zip
            with patch.dict(sys.modules,{'zip_pipeline':fake}), patch(
                    'experiment_zip_runner._server',return_value={'status':200,'data':{'ocr_engine':'hayai'}}):
                result=execute(source,output_root=root/'outputs',log=lambda *_:None)
            self.assertTrue(result['ok'])
            self.assertTrue(Path(result['output_zip']).is_file())
            self.assertTrue(Path(result['metadata']).is_file())
            self.assertTrue((Path(result['output_zip']).parent/'experiment_report.json').is_file())
            self.assertTrue((Path(result['output_zip']).parent/'experiment_diagnostics.zip').is_file())
if __name__=='__main__':unittest.main()
