# Third-party notices and provenance

KoneWebTranslator's project-owned source code is released under GNU GPL-3.0-only. See [LICENSE](LICENSE). Upstream components and works retain their own copyright and license terms. A project-wide GPL declaration does not relicense third-party works.

This inventory is based on the publicly visible KoneWebTranslator-Public source, examined on 2026-10-26. **A dependency reference is not evidence that upstream source was copied.** The available Git contents do not establish full code authorship or the origin and license of separately obtained weights.

| Component | Upstream / official resource | License / status | Integration confirmed in this repo | Redistribution |
| --- | --- | --- | --- | --- |
| Comic Text Detector | https://github.com/dmMaze/comic-text-detector | GPL-3.0 upstream source | `local-server/detector_vendor/auto_detector.py` runs ONNX inference with a model file expected at `local-server/models/comictextdetector.pt.onnx`; `overlap_resolver.py` post-processes bounding boxes | ONNX weights are not included. Confirm the license of the exact weights and any upstream code reused before bundling |
| Hayai OCR model (v2.5 Nova) | https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2.5-nova | Apache-2.0 (model page) | `local-server/hayai_worker.py` downloads the model at runtime, using `trust_remote_code=True` | Model and remote modeling code are not part of this repository; retain upstream notices if bundled |
| hayai-ocr Python package | https://pypi.org/project/hayai-ocr/2.2.0/ | Apache License (PyPI) | `local-server/Install_Hayai_OCR.bat` installs `hayai-ocr==2.2.0` | Installed separately; preserve license if repackaged |
| Gemma 4 (model family; 12B used by default settings) | https://ai.google.dev/gemma/docs/core/model_card_4 | Apache-2.0 (official Gemma 4) | Local model endpoint consumed through llama.cpp-compatible API; no weights included | Verify the actual GGUF distributor and modifications separately |
| llama.cpp | https://github.com/ggml-org/llama.cpp | MIT | Independent local inference server accessed via HTTP, not vendored | The server binary is not included |
| LaMa image inpainting | https://github.com/advimman/lama (upstream project) | Model-weight license **not verified** | `local-trans/inpainting_lama.py` loads an external `models/big-lama.pt` model using `torch.jit.load` | Weight file is not included. Do not redistribute without verifying its specific source and terms |
| PyTorch, Transformers, Pillow, NumPy, FastAPI, etc. | Installed through package managers | Version-specific licenses apply | Used as runtime dependencies, not copied into this repository | When shipping a bundled executable, generate a full dependency/SBOM and license bundle for the precise installed versions |

## Source provenance review

- `local-server/detector_vendor/auto_detector.py` is an ONNX Runtime adapter with model input handling, detection decoding, NMS and local project controls. It references Comic Text Detector by name, but the inspected code does **not** carry a pasted upstream copyright header. This review **cannot establish** whether any implementation portions are copied or adapted from upstream without a verified line-by-line provenance comparison and development records.
- `local-server/detector_vendor/overlap_resolver.py` contains local bounding-box postprocessing for OCR, with no embedded upstream copyright/license header in the inspected version. Its precise historical origin is not independently proven.
- `local-trans/inpainting_lama.py` contains project-side tiling, masking and invocation of a separately sourced PyTorch model. This is not, by itself, proof that LaMa upstream source code was copied.
- `local-server/hayai_worker.py` and `local-server/Install_Hayai_OCR.bat` integrate a third-party model and package; they do not vendor their upstream package source here.
- More broadly, source generated with an AI assistant should be reviewed under the repository maintainer's license and provenance policy. This file does not claim a verified authorship chain for every line.

## Distribution policy

- The repository does not ship model weights, virtual environments, or third-party server binaries.
- **GPL-3.0-only covers original project code to which the maintainer has rights; it does not override third-party licenses.** Preserve copyright notices and follow GPL conditions for any derivative/combined GPL-covered code.
- The base project license does not automatically establish permissions for separately downloaded weights, any later all-in-one binary bundle, or the hosted websites and source manga content users process.
- For binary builds, review licenses of every included Python wheel, CUDA/PyTorch component, browser extension dependency, and model. Include appropriate copies of license/notice files and applicable source-offer information.

For license questions or corrections, file an issue with the upstream URL, precise file/weight artifact and license evidence.
