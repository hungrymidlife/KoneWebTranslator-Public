# KoneWebTranslator

로컬 환경에서 일본어 만화 이미지의 글자를 검출하고 한국어로 번역하여 원본 웹페이지 위에 표시하는 **Chrome 확장 프로그램 + Windows 로컬 서버** 프로젝트입니다.

> **프로젝트 상태:** 개발 중 / Windows 중심으로 테스트됨. 번역문은 현재 원본 이미지를 직접 수정하지 않고 오버레이로 표시합니다. 결과 정확도는 원본 이미지, 텍스트 검출, OCR 및 LLM의 성능에 따라 달라집니다.

## 주요 기능

- **웹 이미지 수집:** DOM 요소 탐색기로 만화 이미지 영역의 CSS 선택자를 찾고 사이트/작품/챕터별 수집 규칙을 저장합니다.
- **자동 실행:** 저장한 규칙과 일치하는 페이지에서 이미지 수집 및 OCR을 시작합니다. 이미지 호스트 접근 권한이 필요할 수 있습니다.
- **텍스트 영역 검출:** Comic Text Detector ONNX와 confidence 필터, NMS, segmentation refinement, overlap resolver를 이용해 글자 영역을 식별합니다.
- **일본어 OCR:** Hayai OCR v2.5 Nova 모델을 사용하고, 숫자/기호가 많은 일부 영역은 조건에 따라 Windows OCR 결과를 사용합니다. Windows OCR은 수동으로도 실행할 수 있습니다.
- **한국어 로컬 번역:** llama.cpp에서 실행한 Gemma 모델에 일본어 텍스트를 전달하고, 영역 ID별 번역 결과를 저장합니다.
- **이미지별 점진적 표시:** 이미지 단위 OCR이 끝나면 번역 큐에 넣고, 번역 완료된 페이지부터 웹페이지에 오버레이로 표시합니다. OCR과 번역은 서로 다른 워커로 진행됩니다.
- **결과 확인:** 원문, 번역문, 영역 박스, 검출 신뢰도, 사용된 OCR 엔진을 확인하고 표시를 토글할 수 있습니다.
- **로컬 캐시:** OCR/번역 작업 결과를 로컬 JSON에 저장하며 기존 결과를 다시 사용할 수 있습니다.

## 처리 흐름

```text
Chrome 페이지 / 수집 규칙
        |
        v
이미지 수집 및 로컬 OCR 서버로 전송 (127.0.0.1:8765)
        |
        v
Comic Text Detector ONNX → 텍스트 박스 검출
        |
        v
Hayai OCR ── 필요 시 Windows OCR 보조
        |
        +--> 이미지별 OCR 결과 저장 ──> Gemma 번역 큐
                                             |
                                             v
                                    llama.cpp (127.0.0.1:18080)
                                             |
                                             v
                               이미지별 결과 저장 및 브라우저 표시
```

## 필요 환경

| 항목 | 설명 |
|---|---|
| OS | Windows 10/11 (Windows OCR 통합 및 BAT/PowerShell 실행 기준) |
| 브라우저 | Chromium 기반 Chrome, Manifest V3 확장 프로그램 |
| Python | 3.11 권장 (`local-server/install.bat`은 `py -3.11` 사용) |
| Python 패키지 | FastAPI, Uvicorn, Pydantic, Pillow, NumPy, ONNX Runtime 및 Hayai 관련 패키지 |
| 일본어 OCR | `hayai-ocr==2.2.0` 패키지와 `JustANormalTinkerer/hayai-ocr-v2.5-nova` 모델 |
| 검출 모델 | `local-server/models/comictextdetector.pt.onnx` 파일 |
| 번역 서버 | llama.cpp 호환 OpenAI API 서버 (`/v1/chat/completions`) |
| 한국어 번역 모델 | 현재 기본 설정: `gemma4-12b-local` (Gemma 4 12B GGUF 모델을 별도 준비) |
| GPU | Hayai 설치 스크립트는 CUDA 12.8용 PyTorch를 설치하도록 작성되어 있습니다. 호환 하드웨어/드라이버가 필요합니다. |


## PC 권장 사양

KoneWebTranslator는 OCR과 Gemma 로컬 AI 번역을 사용하므로 일반적인 웹 번역 확장 프로그램보다 GPU와 메모리 사용량이 높습니다. 특히 아래 사양은 **개발자의 실제 사용 환경을 기준으로 한 권장 사양**이며, 공식 벤치마크나 최소 작동 사양은 아닙니다.

| 항목 | 개발자 테스트 환경 / 빠른 번역 권장 |
|---|---|
| 운영체제 | Windows 11 |
| CPU | AMD Ryzen 7 7700급 |
| GPU | NVIDIA GeForce RTX 5070 Ti (VRAM 16GB)급 |
| 시스템 RAM | 32GB 이상 권장 |
| 저장장치 | SSD 권장 (모델 및 Python 환경 설치 공간 별도 확보) |
| Python | 3.11 |
| AI 구성 | Hayai OCR v2.5 Nova + Comic Text Detector + llama.cpp 기반 Gemma 4 12B 로컬 번역 |

**실사용 성능:** 개발자 PC(Ryzen 7 7700 / RTX 5070 Ti / RAM 32GB)에서는 웹페이지에서 **약 5~7초 대기 후 번역 결과가 보이기 시작하는 사례**를 확인했습니다. 이 수치는 전체 챕터의 번역 완료 시간이 아니며, 특정 조건에서 관찰한 체감 시간입니다. 최초 모델 로딩, 이미지 크기와 개수, 말풍선 수, 모델 양자화, GPU 오프로딩, 캐시 상태 및 동시 작업량에 따라 달라집니다.

**낮은 사양에서도 실행할 수 있나요?** 일부 구성은 더 낮은 사양에서도 가능하지만, 현재 설치 스크립트는 NVIDIA CUDA 환경을 중심으로 작성되어 있습니다. 따라서 **최소 사양 및 5~7초 성능은 다른 PC에서 검증되지 않았습니다.** VRAM이 부족하면 모델 크기·양자화·GPU 오프로딩 설정을 조정해야 하며 번역 속도가 크게 느려질 수 있습니다.

## 설치 (Windows)

### 1. 저장소와 Python 준비

```powershell
git clone https://github.com/hungrymidlife/KoneWebTranslator-Public.git
cd KoneWebTranslator-Public
```

Python 3.11 및 Git을 설치하고 `py -3.11 --version`으로 확인하세요.

### 2. 로컬 OCR 서버 환경 설치

`local-server/install.bat`을 실행합니다. 이 스크립트는 `local-server/.venv`를 생성하고 `requirements.txt` 패키지를 설치합니다.

```powershell
cd local-server
.\install.bat
.\Install_Hayai_OCR.bat
```

Hayai는 별도 `local-server/.venv-hayai` 가상환경에 설치됩니다. 첫 실행에는 추가 모델 다운로드가 발생할 수 있습니다.

### 3. Comic Text Detector 모델 설치

KoneWebTranslator는 만화 이미지에서 일본어 글자가 있는 영역을 자동으로 찾기 위해 **Comic Text Detector**를 사용합니다.

검출 모델은 용량이 크기 때문에 GitHub 저장소에 포함되어 있지 않습니다. 프로그램을 처음 설치하는 사용자는 아래 방법으로 모델 파일을 별도로 준비해야 합니다.

**① 모델 다운로드**

다음 GitHub Releases 페이지에 접속합니다.

- [manga-image-translator 모델 다운로드 (beta-0.3)](https://github.com/zyddnys/manga-image-translator/releases/tag/beta-0.3)
- [Comic Text Detector 원본 프로젝트](https://github.com/dmMaze/comic-text-detector)

Releases의 Assets에서 `comictextdetector.pt.onnx` 파일을 다운로드합니다.

**② 모델 파일 배치**

다운로드한 파일을 KoneWebTranslator의 다음 위치로 복사합니다.

```text
KoneWebTranslator-Public/
└── local-server/
    ├── detector_vendor/
    ├── models/
    │   └── comictextdetector.pt.onnx
    ├── setup_detector.py
    └── setup_detector.bat
```

`models` 폴더가 없다면 직접 생성하세요. 파일명은 반드시 `comictextdetector.pt.onnx`여야 합니다.

**③ 검출 모델 초기화 및 테스트**

PowerShell에서 다음 명령어를 실행합니다.

```powershell
cd KoneWebTranslator-Public\local-server
.\setup_detector.bat
```

이 스크립트는 다음 작업을 수행합니다.

1. 모델 파일 존재 여부 확인
2. 필요한 Python 패키지 확인 및 설치
3. ONNX Runtime을 사용한 모델 초기화
4. 테스트 이미지에 대한 검출 실행

정상적으로 완료되면 다음 메시지가 표시됩니다.

```text
Smoke test OK.
DETECTOR READY
Detector installation successful.
```

**④ 이미 KoneLocalTranslator를 사용하고 있다면**

동일한 모델 파일을 기존 KoneLocalTranslator 프로젝트에서 재사용할 수 있습니다. `setup_detector.py`는 기본적으로 기존 프로젝트의 모델 경로도 확인하므로, 파일을 자동으로 복사할 수 있습니다.

이 기능은 기존 사용자의 편의를 위한 것으로, **KoneWebTranslator 설치에 KoneLocalTranslator가 필요한 것은 아닙니다.**

**문제 해결**

- `ONNX model file not found`: 모델 파일이 `local-server/models/` 폴더에 있는지 확인하세요.
- `Existing Python venv not found`: 먼저 `install.bat`을 실행하세요.
- `ONNX model is suspiciously small`: 다운로드한 파일이 실제 ONNX 모델인지 확인하세요. Git LFS 포인터 파일을 잘못 저장했을 수 있습니다.
- `ONNX initialized` 단계에서 오류 발생: 모델 파일 손상 여부와 ONNX Runtime 설치 상태를 확인하세요.

모델의 사용 및 재배포 조건은 원본 프로젝트의 라이선스를 따릅니다.

### 4. Gemma 번역 서버 설정

llama.cpp 기반 로컬 번역 서버를 별도로 준비하고 GGUF 모델을 로드해 다음 주소에서 API를 제공해야 합니다.

```text
http://127.0.0.1:18080/v1
```

현재 프로그램의 기본 모델 ID는 `gemma4-12b-local`입니다. llama.cpp 서버에 설정된 모델 ID와 일치해야 합니다. 웹브라우저에서 다음 주소의 `data[].id`를 확인하세요.

```text
http://127.0.0.1:18080/v1/models
```

`local-server/Run_Gemma_Manager.bat`는 Gemma 및 OCR 실행을 도와주는 GUI를 엽니다. Gemma 시작 기능은 별도의 `Launch.ps1`이 포함된 로컬 Gemma 설치 폴더가 필요하며 해당 실행 스크립트는 이 저장소에 포함되지 않습니다. 모델/실행 경로는 GUI에서 선택하세요.

### 5. OCR 서버 실행

```powershell
.\start.bat
```

아래 주소에서 상태를 확인합니다.

```text
http://127.0.0.1:8765/health
```

### 6. Chrome 확장 프로그램 설치

1. Chrome 주소창에서 `chrome://extensions`를 엽니다.
2. **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
4. 저장소의 `extension` 폴더를 선택합니다.
5. 확장 아이콘에서 요소 선택기를 열고 이미지 컨테이너 선택자를 지정합니다.
6. 규칙을 저장하고 필요한 이미지 호스트 접근 권한을 허용합니다.

## 사용 방법

1. Gemma 서버와 OCR 서버가 정상 실행 중인지 확인합니다.
2. 만화 페이지에서 확장 프로그램의 DOM 요소 선택기를 사용해 이미지 영역을 선택합니다.
3. URL 패턴과 CSS 선택자로 수집 규칙을 저장하고 자동 실행을 활성화합니다.
4. 새 챕터에 접속하면 이미지를 수집하고 각 이미지에 대해 OCR 및 한국어 번역을 진행합니다.
5. 번역 완료된 이미지부터 한국어 오버레이가 표시됩니다. **캐시에 이미 완료된 결과가 있으면 한 번에 표시될 수 있습니다.**
6. 테스트 시에는 **강제 OCR**로 새 작업을 시작할 수 있습니다.

## 폴더 구조

```text
KoneWebTranslator-Public/
├── extension/                       # Chrome 확장 프로그램 (Manifest V3)
│   ├── manifest.json
│   ├── background.js                 # 이미지 다운로드·로컬 서버 통신
│   ├── content.js                    # 페이지 선택·OCR 오버레이·진행률
│   ├── popup.html / popup.js
│   ├── options.html / options.js
│   ├── rules.html / rules.js
│   └── translation_settings.html / translation_settings.js
└── local-server/
    ├── server.py                     # FastAPI / OCR 작업 / 결과 캐시
    ├── detector_bridge.py
    ├── detector_vendor/              # ONNX 검출, 겹침 영역 처리
    ├── hayai_bridge.py / hayai_worker.py
    ├── windows_ocr.py
    ├── translation_llamacpp.py
    ├── stream_translate.py           # 이미지별 비동기 번역
    ├── KoneGemmaManager.py           # 로컬 서버 GUI
    ├── install.bat / Install_Hayai_OCR.bat
    ├── setup_detector.bat / setup_detector.py
    ├── Run_Gemma_Manager.bat / start.bat
    └── models/                       # 수동 확보한 ONNX 가중치 (Git 제외)
```

## 주요 로컬 API

| API | 기능 |
|---|---|
| `GET /health` | OCR 서버 상태 |
| `POST /api/v1/images/batch` | 이미지 배치 등록 및 OCR Job 생성 |
| `GET /api/v1/jobs` | OCR Job 목록 |
| `GET /api/v1/jobs/{job_id}` | 이미지별 OCR/번역 진행 및 결과 |
| `POST /api/v1/translate/local/check` | Gemma 연결/번역 테스트 |
| `POST /api/v1/translate/job` | OCR Job의 한국어 번역 요청 |
| `POST /api/v1/windows-ocr/region` | 특정 영역 Windows OCR 수동 재인식 |

## 설정 및 문제 해결

- `local-server/detector_confidence.json`: 검출 신뢰도 (최근 사용값 0.3)
- `local-server/detector_nms_mode.txt`: NMS 활성화 (`on`)
- `local-server/detector_overlap_mode.txt`: 겹침 영역 처리 (`on`)
- `local-server/hayai_ocr_settings.json`: Hayai 패치 크기 (최근 384)
- 확장 프로그램 업데이트 후 **Extension context invalidated** 메시지가 나오면 확장 프로그램을 다시 로드하고 만화 탭도 새로고침합니다.
- `HTTP 502` 번역 오류가 나오면 OCR 서버 로그와 Gemma 서버의 `/v1/models` 응답, 번역 영역 ID 오류를 확인합니다.
- 웹페이지에서 번역 결과가 전부 한꺼번에 나타난다면 완료된 캐시가 재사용됐는지 확인하고 강제 OCR로 새 작업을 테스트합니다.
- 검출 영역이 너무 많다면 confidence를 무작정 `0.0`으로 낮추지 마세요. 후보 영역 폭증으로 처리 속도가 크게 저하될 수 있습니다.

## 보안 및 공개 범위

- OCR과 번역 서버는 **로컬 루프백 주소**를 기준으로 구성되어 있습니다. 외부 IP (`0.0.0.0`) 공개 바인딩은 권장하지 않습니다.
- 로컬 실행 결과(`data/`), 가상환경(`.venv*`), 모델 가중치(`*.onnx`, `*.pth`, `*.gguf` 등), 개인 설정과 백업 파일은 Git에 포함하지 마세요.
- 확장 프로그램의 URL 패턴/사이트 권한은 필요한 범위에서만 허용하세요. 수집한 이미지 및 OCR 문장은 사용자의 로컬 환경에서 처리됩니다.
- **기존 Git 이력에 포함된 대용량 파일/비밀값은 현재 파일만 지워도 과거 기록에 남습니다.** 공개 전 Git 히스토리를 반드시 별도로 검토해야 합니다.

## 사용 기술 및 라이선스 고지

KoneWebTranslator는 다음 외부 프로젝트 및 모델과 연동됩니다. 표에 기재한 라이선스는 각 원본 프로젝트·모델의 공지 기준이며, KoneWebTranslator 전체 소스코드의 라이선스를 의미하지 않습니다.

| 구성 요소 | 원본 프로젝트 / 모델 | 원본에서 고지하는 라이선스 | 사용 방식 |
|---|---|---|---|
| Comic Text Detector | [dmMaze/comic-text-detector](https://github.com/dmMaze/comic-text-detector) | GPL-3.0 | ONNX 기반 텍스트 영역 검출에 활용 |
| Hayai OCR v2.5 Nova | [JustANormalTinkerer/hayai-ocr-v2.5-nova](https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2.5-nova) | Apache-2.0 | 사용자의 환경에서 모델 다운로드 및 실행 |
| Gemma 4 | [Google Gemma 4](https://ai.google.dev/gemma/docs/core/model_card_4) | Apache-2.0 (공식 모델) | 별도 준비한 로컬 모델로 번역 |
| llama.cpp | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | 별도 실행하는 로컬 추론 서버와 통신 |

- AI 모델 및 llama.cpp 실행 바이너리는 이 저장소에서 제공하지 않습니다. 모델 파일과 실행 프로그램은 각 공식 배포처의 안내와 사용 조건에 따라 별도로 준비합니다.
- `local-server/detector_vendor/`에는 텍스트 영역 검출 및 후처리용 코드가 포함돼 있습니다. 해당 코드의 정확한 원본 코드 계보와 외부 GPL 코드의 복제·개작 여부는 아직 확정되지 않았으므로, 이 표를 해당 폴더의 재배포 권한 확인을 대신하는 것으로 해석해서는 안 됩니다.
- `comictextdetector.pt.onnx` 파일을 별도로 사용하는 경우 모델 가중치 자체의 배포 조건도 별도로 확인해야 합니다. 위 GPL-3.0 표기는 **원본 Comic Text Detector 소스 저장소**의 라이선스 정보입니다.
- 외부 구성 요소의 저작권과 라이선스는 각 권리자에게 있으며, 이 문서는 KoneWebTranslator 자체의 사용·복제·수정·재배포를 허락하는 라이선스가 아닙니다.

## 사용 및 책임 고지 (Disclaimer)

KoneWebTranslator는 웹 이미지의 텍스트 인식 및 로컬 AI 번역 기술을 연구하고 활용하기 위해 개발된 오픈소스 프로젝트입니다.

### 저작권 및 서비스 이용

- 원본 이미지, 만화 및 기타 콘텐츠의 저작권은 해당 권리자에게 있습니다.
- 사용자는 콘텐츠를 수집, 번역, 저장 또는 배포하기 전에 관련 법령과 해당 웹사이트의 이용약관을 준수해야 합니다.
- 본 프로젝트는 저작권 침해, 무단 재배포 또는 제3자의 권리를 침해하는 행위를 목적으로 제공되지 않습니다.
- 번역 결과물을 외부에 게시하거나 상업적으로 이용하는 경우 필요한 권한을 확인할 책임은 사용자에게 있습니다.

### 정확성 및 책임 제한

- OCR 및 AI 번역 결과의 정확성, 완전성, 안정성을 보장하지 않습니다.
- 본 소프트웨어는 별도의 보증 없이 제공됩니다.
- 관련 법률이 허용하는 범위에서 개발자 및 기여자는 소프트웨어 사용으로 발생하는 손실이나 손해에 대한 책임을 제한합니다.
- 사용자는 외부 모델 및 관련 라이브러리의 라이선스와 이용 조건을 준수해야 합니다.

본 고지는 관련 법령 및 제3자의 권리를 제한하거나 대체하지 않습니다.
