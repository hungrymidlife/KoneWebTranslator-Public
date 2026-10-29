# Third-party notices and provenance

KoneWebTranslator's project-owned source code is released under GNU GPL-3.0-only. See [LICENSE](LICENSE). Upstream components and works retain their own copyright and license terms. A project-wide GPL declaration does not relicense third-party works.

This inventory was updated on **2026-10-30** against the public repository, including the newly integrated manga OCR, typesetting, mask editing and PSD export files. It is a **scoped source/dependency inventory, not a complete provenance or license audit**. **A dependency reference is not evidence that upstream source was copied.** Git contents alone do not establish full code authorship or the origin and license of separately obtained weights.

| Component | Upstream / official resource | License / status | Integration confirmed in this repo | Redistribution |
| --- | --- | --- | --- | --- |
| Comic Text Detector | https://github.com/dmMaze/comic-text-detector | GPL-3.0 upstream source | `local-server/detector_vendor/auto_detector.py` runs ONNX inference with a model file expected at `local-server/models/comictextdetector.pt.onnx`; `overlap_resolver.py` post-processes bounding boxes | ONNX weights are not included. Confirm the license of the exact weights and any upstream code reused before bundling |
| Hayai OCR model (v2.5 Nova) | https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2.5-nova | Apache-2.0 (model page) | `local-server/hayai_worker.py` downloads the model at runtime, using `trust_remote_code=True` | Model and remote modeling code are not part of this repository; retain upstream notices if bundled |
| hayai-ocr Python package | https://pypi.org/project/hayai-ocr/2.2.0/ | Apache License (PyPI) | `local-server/Install_Hayai_OCR.bat` installs `hayai-ocr==2.2.0` | Installed separately; preserve license if repackaged |
| Google Gemma 4 (official model family; 12B reference) | https://ai.google.dev/gemma/docs/core/model_card_4 and https://huggingface.co/google/gemma-4-12B-it | Apache-2.0 (Google official Gemma 4 release) | Upstream model family of the separately installed variant | Official model license does not by itself certify the terms of every modified or redistributed GGUF artifact |
| HauhauCS Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced GGUF (installer's actual model) | https://huggingface.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced | Hugging Face model-page metadata shows **`gemma`**, while Google's official Gemma 4 is **Apache-2.0**; discrepancy requires confirmation against the specific files and distributor's terms | `setup_gemma.py` downloads the separately hosted GGUF; local llama.cpp-compatible server consumes the file. No GGUF weights are committed | Do not assert this variant is Apache-2.0 solely from the official Google model card. Confirm applicable notices/permissions for use, redistribution, and any bundled release |
| llama.cpp | https://github.com/ggml-org/llama.cpp | MIT | Independent local inference server accessed via HTTP, not vendored | The server binary is not included |
| LaMa image inpainting | https://github.com/advimman/lama (upstream project) | Model-weight license **not verified** | `local-trans/inpainting_lama.py` loads an external `models/big-lama.pt` model using `torch.jit.load` | Weight file is not included. Do not redistribute without verifying its specific source and terms |
| PyTorch, Transformers, Pillow, NumPy, FastAPI, etc. | Installed through package managers | Version-specific licenses apply | Used as runtime dependencies, not copied into this repository | When shipping a bundled executable, generate a full dependency/SBOM and license bundle for the precise installed versions |

## Source provenance review

- `local-server/detector_vendor/auto_detector.py` is an ONNX Runtime adapter with model input handling, detection decoding, NMS and local project controls. It references Comic Text Detector by name, but the inspected code does **not** carry a pasted upstream copyright header. This review **cannot establish** whether any implementation portions are copied or adapted from upstream without a verified line-by-line provenance comparison and development records.
- `local-server/detector_vendor/overlap_resolver.py` contains local bounding-box postprocessing for OCR, with no embedded upstream copyright/license header in the inspected version. Its precise historical origin is not independently proven.
- `local-trans/inpainting_lama.py` contains project-side tiling, masking and invocation of a separately sourced PyTorch model. This is not, by itself, proof that LaMa upstream source code was copied.
- `local-server/hayai_worker.py` and `local-server/Install_Hayai_OCR.bat` integrate a third-party model and package; they do not vendor their upstream package source here.
- More broadly, source generated with an AI assistant should be reviewed under the repository maintainer's license and provenance policy. This file does not claim a verified authorship chain for every line.

## 2026-10-30 additions: OCR, typesetting, masks and PSD

The public source now includes the following files introduced by the manga OCR/typesetting integration. The descriptions below identify **functional roles and relevant upstream projects**, not independent proof that every implementation is original, free of third-party code, or covered by a particular license.

| Newly integrated project code | Role / external relationship | Provenance and redistribution note |
| --- | --- | --- |
| `local-server/detector_vendor/phase1_refiner.py`, `tiled_detector_v1.py`, `manga_text_lines.py`, `region_reading_order.py` | Manga text-box refinement, tiled detection, text-line handling and reading order; used with Comic Text Detector and Hayai OCR | Check any reused or adapted upstream detector/OCR implementation and retain applicable notices. The separately downloaded detector and OCR model files are not included |
| `local-trans/experiment_mask_hysteresis.py`, `experiment_mask_roi.py` | Segmentation-mask adjustment and incremental background restoration through an externally installed LaMa model | These files invoke image-processing/runtime dependencies; they do not confer redistribution rights to the LaMa model or its weights |
| `local-trans/smart_linebreak.py`, `manga_shape_layout.py`, `shape_font_policy.py`, `manual_font_fit.py` | Korean text layout, speech-bubble shape detection and automatic font selection, using runtime libraries and user-supplied fonts | User fonts, font files, and font licenses remain separate; do not bundle unlicensed commercial fonts |
| `local-trans/experiment_psd.py`, `experiment_photoshop_text.py` | PSD layer export and optional Photoshop JSX text-layer companion | A generated JSX file can be run by users in Adobe Photoshop. The repository does not include Photoshop or an Adobe runtime, and this feature is not an Adobe endorsement |
| `studio/src/MaskBrushEditor.tsx`, `EditorToolbar.tsx`, `ProofPreview.tsx`, `usePillowProof.ts` | Studio UI for mask editing, editor controls, and Pillow-backed render preview | Check actual npm/Rust dependencies and transitive license notices when distributing a compiled Studio binary |

Provenance review status: the above files and their integration points have been identified in the public tree, but **no line-by-line upstream similarity review or complete authorship verification has been performed**. If any implementation was copied or adapted from third-party code, preserve its original notices and comply with its license; do not assume the project's GPL notice cures missing upstream permissions. For source-only distribution, model files, Photoshop binaries, and commercial fonts remain separately obtained and are not bundled.

## Distribution policy

- The repository does not ship model weights, virtual environments, or third-party server binaries.
- **GPL-3.0-only covers original project code to which the maintainer has rights; it does not override third-party licenses.** Preserve copyright notices and follow GPL conditions for any derivative/combined GPL-covered code.
- The base project license does not automatically establish permissions for separately downloaded weights, any later all-in-one binary bundle, or the hosted websites and source manga content users process.
- For binary builds, review licenses of every included Python wheel, CUDA/PyTorch component, browser extension dependency, and model. Include appropriate copies of license/notice files and applicable source-offer information.

For license questions or corrections, file an issue with the upstream URL, precise file/weight artifact and license evidence.

<!-- KWT_PUBLIC_INTEGRATED_STUDIO_NOTICES_20261027 -->

## Integrated Studio (2026-10-27, newly added)

The public checkout now also includes `studio/` (React/TypeScript/Vite/Tauri desktop UI), `studio-bridge/` (local Python process/API integration), and expanded `local-trans/` (batch processing, text layout, LaMa ROI inpainting). See the separate [Studio dependency notice](studio/THIRD_PARTY_NOTICES_STUDIO.md).

| Dependency | Upstream | Upstream-reported license | How this repository uses it |
| --- | --- | --- | --- |
| Tauri 2 / tauri-plugin-dialog | https://github.com/tauri-apps/tauri | MIT OR Apache-2.0 (project) | Rust desktop shell and folder dialog |
| React / React DOM 18 | https://github.com/facebook/react | MIT | Studio components |
| TypeScript | https://github.com/microsoft/TypeScript | Apache-2.0 | GUI source and build tool |
| Vite | https://github.com/vitejs/vite | MIT | Studio developer/build server |
| Konva / react-konva | https://github.com/konvajs/konva and https://github.com/konvajs/react-konva | MIT | Text-layer canvas editing |
| Motion for React | https://github.com/motiondivision/motion | MIT | Studio transitions |
| lucide-react | https://github.com/lucide-icons/lucide | ISC | UI icons |
| Rust/Node/npm transitive packages | Resolved in `Cargo.lock` and `package-lock.json` | Per-package; not audited exhaustively | Build/runtime dependencies |

The added Studio source uses the repository's declared GPL-3.0-only policy **only to the extent the maintainer owns or can license the code**. No third-party package's original license changes. The source tree includes dependency manifests and lockfiles, but does **not** vendor npm/Rust dependencies, the proprietary operating system runtime, GGUF/LaMa/Hayai/Comic Text Detector model weights, or llama.cpp executables. Users must obtain those separately and verify their exact licensing terms. A distribution of a built desktop installer requires a version-specific third-party license/SBOM audit and compliance with applicable notices, attribution, GPL obligations and model license requirements. The model and source provenance limitations documented above remain open; they are not resolved merely by adopting the integrated GUI.
