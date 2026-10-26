# Third-party notices

This project integrates with or refers to third-party software and AI models. The entries below are informational. Each upstream component is governed by its own license and distribution terms. This file does not grant a license to KoneWebTranslator itself.

| Component | Upstream | License / status | Integration notes |
| --- | --- | --- | --- |
| Comic Text Detector | https://github.com/dmMaze/comic-text-detector | GPL-3.0 (upstream source repository; verify specific reused code) | Text detection / preprocessing |
| Hayai OCR v2.5 Nova | https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2.5-nova | Verify model card and included packages | OCR model downloaded separately |
| Gemma 4 | https://ai.google.dev/gemma | Verify terms for the exact model and weights used | Model supplied separately |
| llama.cpp | https://github.com/ggml-org/llama.cpp | MIT (verify upstream release) | Separate local inference server |

## Before distribution

- Audit `local-server/detector_vendor/` for source lineage and any copied or modified GPL-covered material.
- Confirm notices, licenses, attribution, and source-offer requirements for each actually redistributed dependency.
- A download link to a model does not replace the model's own license terms.
- Check compatibility before assigning a project-wide license.
