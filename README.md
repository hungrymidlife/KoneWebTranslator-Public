# KoneWebTranslator

로컬 환경에서 일본어 만화 이미지의 글자를 검출하고 한국어로 번역하여 원본 웹페이지 위에 표시하는 **Chrome 확장 프로그램 + Windows 로컬 서버 + 통합 Studio** 프로젝트입니다.



<!-- KWT_PUBLIC_INTEGRATED_STUDIO_20261027 -->

> **2026-10-27 — 통합 Studio 공개 버전:** 이 저장소에는 기존 Chrome 확장앱 + Python 로컬 OCR/번역 서버와 함께 **React 18 / TypeScript / Vite / Tauri 2** 기반의 Windows 통합 Studio가 포함됩니다. 기존 Python GUI는 통합 Studio로 대체되었으며 공개 소스에는 포함되지 않습니다. 공개 저장소의 기본 기능은 개인 개발 저장소의 통합 코드 기준으로 이전한 것이며, 운영환경/모델/AI 실행 파일은 포함되지 않습니다.

## 통합 Studio (신규)

Studio에서는 ZIP 파일 검색·다중 선택·배치 처리, 원문/번역문 나란히 비교, OCR 영역 확인, 식질 텍스트·크기·정렬·좌표·색상 편집, 페이지별 수정 저장, 로그 확인, OCR 및 Gemma 서버 시작/중지와 설정, Chrome 확장앱 규칙 연동을 제공합니다. Studio UI 표시 설정(탭, 패널, 보기, 검색 필터, 로그 자동 스크롤 등)은 로컬 저장소에 유지됩니다.

```text
Windows Studio (Tauri 2 + React / TypeScript / Vite)
    |
    +--> Studio Bridge (Python HTTP, 127.0.0.1:18765)
    |        +--> local-trans/  : ZIP -> OCR -> Gemma -> LaMa -> 한국어 식질
    |        +--> AI 서버 관리 : OCR 127.0.0.1:8765 / Gemma 127.0.0.1:18080
    |        +--> 확장앱 관리  : 코드 페어링 및 규칙 동기화
    +--> Chrome 확장앱 (Manifest V3)
```

### Studio 실행 준비 (Windows)

처음 설치할 때는 아래의 **처음 클론한 사용자를 위한 설치 가이드**를 순서대로 진행하세요.

**안전/보안:** OCR/Bridge/Gemma API는 기본적으로 `127.0.0.1`에서 사용합니다. `studio-bridge/.studio_runtime/`에 있는 확장앱 연결 키·상태 파일을 커밋하지 마세요. OCR 결과, 번역 ZIP, 로그, 모델, 가상환경, `.env`도 공개 저장소에 올리지 마세요. 로컬 서버 전체 노출 또는 임의의 외부 코드 다운로드는 이 프로젝트의 기본 동작이 아닙니다.

**레거시 정리:** 과거의 `Run_Local_Trans.bat`, `local-trans/gui.py`, `local-trans/review_viewer.py`, `local-server/KoneGemmaManager.py`는 통합 Studio로 대체되어 현재 공개 소스에 포함되지 않습니다.

**Studio 의존성 및 재배포:** [Studio 자체 고지](studio/THIRD_PARTY_NOTICES_STUDIO.md)와 [전체 서드파티 고지](THIRD_PARTY_NOTICES.md)를 참고하세요. 소스 공개와 제3자 모델/바이너리 배포는 다른 문제이며 라이선스 확인이 필요합니다.

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
| 번역 서버 | 로컬 llama.cpp 서버 (`127.0.0.1:18080`, OpenAI 호환 API 형식) |
| 한국어 번역 모델 | 로컬 Gemma 4 12B GGUF 모델 (기본 모델 ID: `gemma4-12b-local`) |
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

**실사용 성능:** 개발자 PC(Ryzen 7 7700 / RTX 5070 Ti / RAM 32GB)에서는 웹페이지에서 **약 3~4초 대기 후 번역 결과가 보이기 시작하는 사례**를 확인했습니다. 이 수치는 전체 챕터의 번역 완료 시간이 아니며, 특정 조건에서 관찰한 체감 시간입니다. 최초 모델 로딩, 이미지 크기와 개수, 말풍선 수, 모델 양자화, GPU 오프로딩, 캐시 상태 및 동시 작업량에 따라 달라집니다.

**낮은 사양에서도 실행할 수 있나요?** 일부 구성은 더 낮은 사양에서도 가능하지만, 현재 설치 스크립트는 NVIDIA CUDA 환경을 중심으로 작성되어 있습니다. 따라서 **최소 사양 및 3~4초 성능은 다른 PC에서 검증되지 않았습니다.** VRAM이 부족하면 모델 크기·양자화·GPU 오프로딩 설정을 조정해야 하며 번역 속도가 크게 느려질 수 있습니다.

## 처음 클론한 사용자를 위한 설치 가이드 (Windows)

이 프로젝트는 소스코드 배포본입니다. `.venv`, `node_modules`, AI 모델, llama.cpp 실행 파일은 포함하지 않습니다.

### 1. 필수 프로그램 설치

- Git: https://git-scm.com/download/win
- Python 3.11 (Windows Python Launcher 포함): https://www.python.org/downloads/
- Node.js LTS: https://nodejs.org/
- 데스크톱 Studio에만 추가 필요: Rust/Cargo (https://rustup.rs/), Microsoft C++ Build Tools (Desktop development with C++), Microsoft Edge WebView2 Runtime
- 현재 Hayai 설치 스크립트는 NVIDIA CUDA 12.8용 PyTorch를 사용합니다. NVIDIA GPU와 호환 드라이버가 권장됩니다.

PowerShell에서 `git --version`, `py -3.11 --version`, `node --version`, `npm --version`으로 확인하세요. 데스크톱 빌드는 `cargo --version`도 확인합니다.

### 2. 클론

```powershell
git clone https://github.com/hungrymidlife/KoneWebTranslator-Public.git
cd KoneWebTranslator-Public
```

**이후 명령어는 저장소 루트에서 실행합니다.**

### 3. 기본 환경 설치

루트의 `SETUP.bat`을 더블클릭하거나 다음을 실행합니다.

```powershell
.\SETUP.bat
```

이 스크립트는 Python 기본 가상환경과 Studio npm 의존성을 설치하기 위한 것입니다. 설치 후 다음 파일/폴더가 있어야 합니다.

```text
local-server/.venv/Scripts/python.exe
studio/node_modules/
```

`SETUP.bat`이 없는 이전 버전은 아래 명령을 사용하세요.

```powershell
.\local-server\install.bat
cd studio
npm install
cd ..
```

가상환경은 다른 PC에서 복사하지 않고 **사용자 PC에서 새로 생성**합니다.

### 4. Hayai OCR 설치

```powershell
.\SETUP_HAYAI.bat
```

이 파일이 없는 이전 버전은 `.\local-server\Install_Hayai_OCR.bat`을 실행합니다. 별도 `local-server/.venv-hayai` 환경에 CUDA PyTorch와 `hayai-ocr==2.2.0` 등을 설치합니다. 최초 OCR 시 추가 모델 다운로드가 발생할 수 있습니다.

### 5. Comic Text Detector 모델 자동 다운로드

모델은 Git에 포함되지 않으며 최초 설치 시 공식 GitHub 릴리스에서 다운로드합니다. 저장소 루트에서 실행하세요.

```powershell
.\DOWNLOAD_DETECTOR.bat
```

스크립트는 `local-server/models/comictextdetector.pt.onnx`에 다운로드하고, SHA-256을 검증한 뒤 `local-server/setup_detector.bat`으로 초기화 및 테스트합니다. 이미 검증된 파일은 다시 받지 않습니다. 다운로드 실패 시 인터넷 연결과 GitHub 접근 상태를 확인하고 재실행하세요.

원본: https://github.com/zyddnys/manga-image-translator/releases/tag/beta-0.3

### 6. LaMa 이미지 복원 모델 자동 다운로드

ZIP 식질의 원문 제거와 배경 복원에 사용하는 LaMa 모델은 Git 저장소에 포함되지 않습니다. **저장소 루트에서** 다음 명령으로 자동 다운로드하세요.

```powershell
.\DOWNLOAD_LAMA.bat
```

스크립트는 `local-trans/models/big-lama.pt`에 약 206MB의 모델을 내려받고, 공개된 SHA-256 체크섬으로 무결성을 검증합니다. 이미 검증된 파일이 있으면 다운로드를 생략합니다. 기존 파일이 체크섬과 다르면 **덮어쓰지 않고 중단**합니다. 네트워크 오류 시 다시 실행할 수 있습니다.

모델 출처: https://huggingface.co/signature-ai/big-lama (Apache-2.0 표기). 모델 파일은 PyTorch 직렬화 포맷이므로 신뢰하는 출처의 모델만 사용하세요.

설치 확인:

```powershell
Test-Path .\local-trans\models\big-lama.pt
```

이 검사는 파일 존재만 확인합니다. 실제 식질 동작은 Studio ZIP 처리에서 별도로 확인해야 합니다.

### 7. Gemma 번역 서버 설치

이 저장소에는 Gemma GGUF 가중치, llama.cpp 실행 파일, MTP draft 모델 및 사용자 PC의 `Launch.ps1`이 없습니다. 사용자가 별도로 호환 서버와 모델을 준비해야 합니다.

- 기본 API: `http://127.0.0.1:18080/v1`
- 모델 확인: `http://127.0.0.1:18080/v1/models`
- 기본 모델 ID 예시: `gemma4-12b-local` (실제 서버 ID와 일치시켜야 함)

Studio의 **AI 서버 관리**에서 Gemma 실행 폴더를 선택합니다. `Launch.ps1` 기반 실행 구성은 해당 스크립트가 준비되어 있어야 합니다. 모델을 다운로드하는 것만으로 서버가 자동 실행되지는 않습니다. MTP 기능은 호환 서버 및 draft 모델이 준비된 경우에만 사용합니다.

### 8. Studio 실행

**웹 GUI 테스트 (Rust 불필요)**

```powershell
.\RUN_STUDIO_WEB.bat
```

브라우저에서 `http://127.0.0.1:1420`을 엽니다.

**Windows 데스크톱 GUI (Rust/C++ Build Tools/WebView2 필요)**

```powershell
.\RUN_STUDIO.bat
```

첫 빌드에서는 Rust 컴파일 시간이 걸릴 수 있습니다. 정상 실행 확인 후 `RUN_STUDIO_SILENT.vbs`로 콘솔창 없는 실행을 시도할 수 있습니다.

두 BAT 파일 모두 기본 Python 가상환경을 필요로 합니다. `Python venv not found`가 나오면 **3단계**부터 진행하세요.

### 9. Chrome 확장앱 설치 (웹페이지 번역을 사용하는 경우)

1. Chrome에서 `chrome://extensions`로 이동합니다.
2. 개발자 모드를 활성화합니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 선택하고 저장소의 `extension` 폴더를 지정합니다.
4. Studio의 **웹 확장앱 관리**에서 페어링 코드를 발급하고 확장앱에 입력합니다.
5. 사이트/이미지 호스트 권한을 Chrome에서 허용하고 이미지 수집 규칙을 설정합니다.

### 10. 설치 점검

저장소 루트의 PowerShell에서:

```powershell
Test-Path .\local-server\.venv\Scripts\python.exe
Test-Path .\local-server\.venv-hayai\Scripts\python.exe
Test-Path .\studio\node_modules
Test-Path .\local-server\models\comictextdetector.pt.onnx
Test-Path .\local-trans\models\big-lama.pt
```

각 항목을 설치했다면 `True`여야 합니다. OCR 서버 실행 후 `http://127.0.0.1:8765/health`, Gemma 서버 실행 후 `http://127.0.0.1:18080/v1/models`를 확인하세요.

### 오류 해결

| 증상 | 해결 |
|---|---|
| `Python venv not found` | `SETUP.bat` 또는 `local-server/install.bat` 실행 |
| `py -3.11` 오류 | Python 3.11 및 Python Launcher 설치 |
| `npm` 없음 | Node.js 설치 후 터미널 재시작 |
| `cargo` 없음 | Rust 설치 또는 `RUN_STUDIO_WEB.bat` 사용 |
| Comic Text Detector 파일 없음 | ONNX 모델을 정확한 경로에 배치하고 `setup_detector.bat` 실행 |
| Gemma 연결 실패 | 18080 포트, `/v1/models` 응답, 모델 ID 확인 |
| 확장앱 오류 | 확장앱과 웹페이지 새로고침 |

**보안/라이선스:** `.venv`, `.venv-hayai`, `node_modules`, AI 모델, 로컬 설정, 인증 키, 작업 결과 및 로그를 Git에 커밋하지 마세요. 모델의 재배포 조건은 원저작권자의 라이선스를 따릅니다.


## 사용 방법

1. Gemma 서버와 OCR 서버가 정상 실행 중인지 확인합니다.
2. 만화 페이지에서 확장 프로그램의 DOM 요소 선택기를 사용해 이미지 영역을 선택합니다.
3. URL 패턴과 CSS 선택자로 수집 규칙을 저장하고 자동 실행을 활성화합니다.
4. 새 챕터에 접속하면 이미지를 수집하고 각 이미지에 대해 OCR 및 한국어 번역을 진행합니다.
5. 번역 완료된 이미지부터 한국어 오버레이가 표시됩니다. **캐시에 이미 완료된 결과가 있으면 한 번에 표시될 수 있습니다.**
6. 테스트 시에는 **강제 OCR**로 새 작업을 시작할 수 있습니다.

## 폴더 구조 (통합 버전)

```text
KoneWebTranslator-Public/
├── extension/              # Chrome 확장앱 및 Studio 규칙 연동
├── local-server/           # FastAPI OCR 서버 및 번역 백엔드
├── local-trans/            # ZIP 배치 처리, LaMa 이미지 복원, 한국어 식질
├── studio/                 # React + TypeScript + Vite + Tauri 2 GUI
│   ├── src/               # 편집 캔버스, AI/확장앱 관리 UI
│   └── src-tauri/         # Windows 데스크톱 런타임
├── studio-bridge/          # 로컬 API 및 프로세스·로그 관리
├── SETUP.bat               # Python 및 Studio 의존성 설치
├── SETUP_HAYAI.bat         # Hayai OCR 설치
├── RUN_STUDIO.bat          # Tauri GUI 실행
├── RUN_STUDIO_WEB.bat      # 브라우저 기반 GUI 테스트
├── RUN_STUDIO_SILENT.vbs   # 콘솔 숨김 실행
├── README.md
├── THIRD_PARTY_NOTICES.md
└── LICENSE
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

## 보안 및 개인정보 보호

- OCR 및 AI 번역 서버는 기본적으로 사용자 PC의 로컬 환경(`127.0.0.1`)에서 실행되며, 외부 네트워크에 서버를 공개하지 않도록 구성되어 있습니다.
- 확장 프로그램은 사용자가 허용한 웹사이트 및 이미지 호스트에 접근하여 이미지를 수집합니다. 사이트 접근 권한은 확장 프로그램 설정에서 관리하거나 해제할 수 있습니다.
- 수집한 이미지와 OCR 및 번역 결과는 사용자의 로컬 서버에서 처리됩니다. 단, 원본 이미지 다운로드 및 최초 AI 모델 설치 시에는 해당 외부 서버와 통신할 수 있습니다.
- 로그인된 웹사이트의 이미지를 가져오는 경우 브라우저의 인증 정보가 요청에 사용될 수 있으므로, 신뢰할 수 있는 사이트에만 접근 권한을 허용하세요.

## 사용 기술 및 라이선스 고지

**KoneWebTranslator의 프로젝트 자체 소스코드는 GNU GPL-3.0-only 라이선스로 공개됩니다.** 사용·수정·재배포 조건은 [LICENSE](LICENSE)를 참고하세요. 외부 구성요소의 원저작권과 라이선스는 유지되며 자세한 정보는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요.

| 구성 요소 | 원본 프로젝트 / 모델 | 라이선스 및 확인 사항 | 사용 방식 |
|---|---|---|---|
| Comic Text Detector | [dmMaze/comic-text-detector](https://github.com/dmMaze/comic-text-detector) | 원본 소스 GPL-3.0; 사용 모델 가중치는 별도 확인 | ONNX 검출 |
| Hayai OCR v2.5 Nova | [Hugging Face 모델](https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2.5-nova) | 모델 Apache-2.0 (배포처 표기) | 별도 다운로드 후 OCR |
| Gemma 4 | [Google Gemma 4](https://ai.google.dev/gemma/docs/core/model_card_4) | 공식 모델 Apache-2.0; 실제 GGUF 배포본은 별도 확인 | 로컬 번역 |
| llama.cpp | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) | MIT | 별도 로컬 서버와 통신 |
| LaMa | [advimman/lama](https://github.com/advimman/lama) | 사용 가중치의 출처와 배포 조건은 별도 확인 | 이미지 복원 |

- 외부 모델 가중치와 실행 바이너리는 이 저장소에 포함하지 않습니다. 이를 포함해 재배포할 때는 해당 배포본의 라이선스 및 고지 의무를 별도로 확인해야 합니다.
- `local-server/detector_vendor/` 등 외부 구현과 관련된 출처·검증 범위는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요. 프로젝트 GPL 선언이 외부 저작물의 기존 라이선스를 변경하지 않습니다.

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
