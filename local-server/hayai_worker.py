"""Isolated Hayai 2.5 Nova OCR worker. stdout is JSON-lines only."""
import base64
import io
import json
import sys

# Force UTF-8 even when launched under Windows CP949.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
import traceback

MODEL_ID = 'JustANormalTinkerer/hayai-ocr-v2.5-nova'

def main():
    import torch
    from PIL import Image
    from transformers import AutoModel, AutoProcessor, PreTrainedTokenizerFast
    print('[Hayai] loading model (downloads on first use): ' + MODEL_ID, file=sys.stderr, flush=True)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    # Remote code is part of the model repository. Review it before allowing model downloads.
    model = AutoModel.from_pretrained(MODEL_ID, trust_remote_code=True).to(device).eval()
    tokenizer = PreTrainedTokenizerFast.from_pretrained(MODEL_ID)
    processor = AutoProcessor.from_pretrained('google/siglip2-base-patch16-naflex')
    print('[Hayai] ready device=' + device, file=sys.stderr, flush=True)
    for line in sys.stdin:
        try:
            req = json.loads(line)
            patches = int(req['patches'])
            if patches not in (256, 384, 512):
                raise ValueError('Invalid patch count')
            binary = base64.b64decode(req['image'], validate=True)
            with Image.open(io.BytesIO(binary)) as image:
                inputs = processor(images=[image.convert('RGB')], max_num_patches=patches, return_tensors='pt').to(device)
            with torch.no_grad():
                value = model.generate(pixel_values=inputs['pixel_values'], pixel_attention_mask=inputs['pixel_attention_mask'], spatial_shapes=inputs['spatial_shapes'], tokenizer=tokenizer, max_new_tokens=256, repetition_penalty=1.0)
            print(json.dumps({'ok':True,'text':str(value[0]).strip()},ensure_ascii=True),flush=True)
        except Exception as exc:
            print(json.dumps({'ok':False,'error':f'{type(exc).__name__}: {exc}'},ensure_ascii=True),flush=True)

if __name__ == '__main__':
    try: main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
