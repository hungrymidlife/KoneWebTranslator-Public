# KoneWebTranslator

**Windows에서 일본어 만화 이미지를 한국어로 번역하는 로컬 도구**입니다. Chrome 확장 프로그램으로 웹페이지의 이미지를 수집·번역할 수 있고, 통합 Studio에서 ZIP 파일을 순차 처리하고 OCR 영역·번역문·식질을 검수할 수 있습니다.

> **소스코드 배포본입니다.** AI 모델, llama.cpp 실행 파일, Python 가상환경, npm 패키지는 저장소에 포함되지 않습니다. 처음 실행하기 전 설치가 필요합니다. 모델 다운로드에는 인터넷과 충분한 저장 공간이 필요합니다.

## 제공 기능

- **Chrome 확장 프로그램:** 선택한 웹사이트의 이미지 수집, 글자 영역 검출, OCR, 한국어 번역 오버레이, 사이트별 수집 규칙
- **통합 Studio (React / Tauri):** 여러 ZIP 작업, 원본·번역 비교, OCR 박스·번역문 검수, 한글 식질 조정, 결과 저장
- **로컬 AI 처리:** Comic Text Detector ONNX → Hayai OCR → llama.cpp 기반 Gemma 번역 → LaMa 원문 제거·배경 복원 → 한글 식질
- **Windows 일본어 OCR:** 숫자·기호가 많은 영역 등에 사용하는 **선택적 보조 기능**
- **웹 확장앱 관리:** Studio와 Chrome 확장앱 페어링, 사이트 규칙 동기화 및 활동 상태 확인(지원 버전)

모델과 기능은 별도로 설치해야 하며, 성능과 정확도는 PC 사양·원본 이미지·설정에 따라 달라집니다.

## 설치 전 준비

| 항목 | 요구사항 |
|---|---|
| 운영체제 | Windows 10/11 |
| Python | **Python 3.11** 및 Windows Python Launcher (`py`) |
| Node.js | Node.js LTS 및 npm |
| 데스크톱 Studio | Rust/Cargo, Microsoft C++ Build Tools(Desktop development with C++), Microsoft Edge WebView2 Runtime |
| 웹페이지 번역 | Google Chrome 또는 호환 Chromium 브라우저 |
| AI 가속 | 현재 설치 스크립트는 NVIDIA CUDA 환경을 중심으로 구성. 호환 GPU·드라이버 권장 |
| 디스크 | Gemma GGUF 약 7.4GB 외에 OCR·검출·복원 모델 및 Python/CUDA 패키지 설치 공간 필요 |

공식 설치 페이지: [Python](https://www.python.org/downloads/) · [Node.js](https://nodejs.org/) · [Rust](https://rustup.rs/) · [Git](https://git-scm.com/download/win)

Python·Node.js·Rust가 준비되었는지 PowerShell에서 확인할 수 있습니다.

```powershell
py -3.11 --version
node --version
npm --version
cargo --version  # 데스크톱 Studio 사용 시
```

> 성능 참고: README에 표시하는 테스트 사양 및 속도는 개발 환경에서 관찰된 사례이며 모든 PC에 대한 최소 사양이나 보장 성능은 아닙니다. GPU가 없거나 VRAM이 부족하면 일부 기능의 실행이 어렵거나 크게 느려질 수 있습니다.

## 1. 프로젝트 다운로드

```powershell
git clone https://github.com/hungrymidlife/KoneWebTranslator-Public.git
cd KoneWebTranslator-Public
```

Git 없이 GitHub의 **Code → Download ZIP**을 이용해도 됩니다. 내려받은 ZIP을 원하는 폴더에 압축 해제한 뒤 **저장소 루트**에서 BAT 파일을 실행하세요.

## 2. Studio 기본 환경 설치

### 설치 마법사가 포함된 버전

프로젝트 루트에 **`START_STUDIO_SETUP.bat`이 있다면** 이 파일을 실행하세요.

```powershell
.\START_STUDIO_SETUP.bat
```

기본 Python 및 Studio npm 의존성을 설치한 다음 Studio를 시작합니다. Rust/Cargo가 없으면 지원 버전에 따라 웹 미리보기로 실행될 수 있습니다. Studio가 열리면 왼쪽 **설치 · 환경 점검** 메뉴에서 설치 대상을 확인하세요.

> **버전 안내:** GitHub에서 받은 소스에 위 파일이나 `설치 · 환경 점검` 메뉴가 없을 수 있습니다. 해당 경우 오류가 아니라 공개된 코드 버전의 차이이므로 아래 **기본 설치 방식**을 사용하세요. Windows에서 Tauri GUI를 빌드할 때 Rust 및 C++ 빌드 도구가 필요합니다.

### 기본 설치 방식 (모든 공개 소스 버전에서 사용)

프로젝트 루트에서 다음 명령을 실행하세요.

```powershell
.\SETUP.bat
```

기본 Python 가상환경(`local-server/.venv`)과 Studio npm 패키지(`studio/node_modules`)를 설치합니다. 이어서 Studio를 실행합니다.

```powershell
.\RUN_STUDIO.bat       # Windows 데스크톱 GUI
# 또는
.\RUN_STUDIO_WEB.bat   # 브라우저에서 Studio 사용, Rust 불필요
```

웹 모드 주소: `http://127.0.0.1:1420`. 설치 직후에는 OCR·Gemma가 **오프라인**으로 나오는 것이 정상입니다. AI 모델과 서버를 아직 설치·실행하지 않았기 때문입니다.

## 3. AI 모델과 필수 의존성 설치

**설치 · 환경 점검** 메뉴가 있으면 아래 구성요소들을 **설치 → 테스트** 순서로 진행하세요. 한 항목이 종료된 후 다음 항목을 설치합니다.

1. **기본 Python 패키지** — 설치 상태 검사
2. **Hayai OCR** — 전용 `.venv-hayai` 생성 및 OCR 패키지 설치
3. **Comic Text Detector** — ONNX 검출 모델 다운로드와 검출기 초기화
4. **LaMa용 PyTorch** — **기본 `.venv`**에 이미지 복원용 PyTorch 설치
5. **LaMa 복원 모델** — `big-lama.pt` 다운로드
6. **Gemma 번역 모델** — llama.cpp 실행 파일 및 Gemma GGUF 다운로드
7. **필수 항목 전체 검사** — 실제 패키지 import/모델 검사

**선택·보조 항목:** Windows OCR Python 연동, Windows 일본어 OCR 언어팩, NVIDIA CUDA 진단, Gemma MTP 보조 모델. Windows OCR은 Hayai를 대체하는 주 엔진이 아니며, MTP는 기본 번역에 필수가 아닙니다.

### GUI 설치 메뉴가 없는 버전의 수동 설치

다음 명령은 **프로젝트 루트**에서 실행합니다.

```powershell
.\SETUP_HAYAI.bat
.\DOWNLOAD_DETECTOR.bat
.\DOWNLOAD_LAMA.bat
.\SETUP_GEMMA.bat
```

**LaMa용 PyTorch는 반드시 기본 `.venv`에 별도로 설치해야 합니다.** `SETUP_HAYAI.bat`의 전용 환경과 다른 Python 환경이기 때문입니다.

```powershell
.\local-server\.venv\Scripts\python.exe -m pip install torch --index-url https://download.pytorch.org/whl/cu128
.\local-server\.venv\Scripts\python.exe -c "import torch; print('Torch:', torch.__version__, 'CUDA:', torch.cuda.is_available())"
```

이 명령은 CUDA 12.8용 NVIDIA 패키지를 설치합니다. GPU·드라이버가 맞지 않는 환경은 [PyTorch 공식 설치 안내](https://pytorch.org/get-started/locally/)를 참조하세요. `CUDA: False`여도 import는 성공할 수 있으나 이미지 복원은 느려질 수 있습니다.

Gemma 기본 설치 경로는 `C:\AI\Gemma4MTP`이며, 주요 모델 다운로드 용량은 약 **7.4GB**입니다. Windows CUDA용 llama.cpp 릴리스 파일명이나 공개 방식이 바뀌면 설치기가 업데이트되어야 할 수 있습니다. **설치 오류가 발생하면 임의 모델·실행 파일로 대체하지 말고 로그를 확인**하세요.

설치 확인:

```powershell
.\CHECK_GEMMA.bat
Test-Path .\local-server\models\comictextdetector.pt.onnx
Test-Path .\local-trans\models\big-lama.pt
```

### Windows 일본어 OCR (선택)

기본 OCR은 Hayai입니다. 숫자·상태 기호 등 일부 영역에서 Windows 일본어 OCR을 사용하려면 Windows 기능 `Language.OCR~~~ja-JP~0.0.1.0`이 필요합니다. 설치 관리자에 해당 항목이 없으면 관리자 권한으로 다음 BAT를 실행하세요.

```powershell
.\INSTALL_WINDOWS_OCR_JP.bat
```

설치 여부 확인:

```powershell
Get-WindowsCapability -Online -Name 'Language.OCR~~~ja-JP~0.0.1.0'
```

상태가 `Installed`이면 설치된 것입니다. Windows 표시 언어를 일본어로 변경할 필요는 없습니다. **Python WinRT 연동 패키지도 별도로 필요할 수 있으므로**, 설치 메뉴의 Windows OCR Python 연동 검사 및 실제 OCR 테스트를 확인하세요.

## 4. OCR·Gemma 서버 실행 및 작동 확인

Studio의 **AI 서버 관리** 메뉴에서 OCR과 Gemma 서버를 실행하고 상태를 확인합니다. 기본 로컬 주소는 다음과 같습니다.

| 서버 | 주소 | 확인 |
|---|---|---|
| Studio Bridge | `http://127.0.0.1:18765` | Studio GUI와 연결되어 있는지 확인 |
| OCR | `http://127.0.0.1:8765/health` | 브라우저에서 응답 확인 |
| Gemma | `http://127.0.0.1:18080/v1/models` | 설치된 모델 목록 확인 |
| Studio 웹 미리보기 | `http://127.0.0.1:1420` | 웹 모드 사용 시 |

Gemma를 수동으로 실행하려면 프로젝트 루트에서 `RUN_GEMMA.bat`을 사용합니다. 실행 중에는 서버 콘솔을 닫지 마세요. **모델 파일 존재만으로 번역이 정상이라는 뜻은 아닙니다.** 반드시 AI 서버 관리의 실행/번역 테스트를 확인하세요.

## 5. Studio에서 ZIP 만화 번역

1. Studio의 **번역 · 검수 · 편집** 메뉴에서 처리할 ZIP을 선택합니다.
2. OCR·번역 서버를 실행하고 작업을 시작합니다.
3. OCR 영역과 번역문을 비교·검수하고 글자 크기·위치·폰트 등을 필요에 따라 조정합니다.
4. 원문 제거·LaMa 배경 복원·한글 식질이 끝난 결과를 확인해 저장합니다.

원본 파일과 결과 ZIP을 구분하여 보관하세요. 최초 테스트에서는 **복사한 테스트용 ZIP**을 사용하는 것이 안전합니다. 일부 기능은 Studio 버전에 따라 메뉴 이름이 다를 수 있습니다.

## 6. Chrome 확장 프로그램 설치 (무료)

Chrome 웹 스토어 등록이 아니라 **로컬 폴더 로드 방식**을 사용합니다. Google 개발자 계정과 등록비가 필요하지 않습니다.

1. Chrome 주소창에 `chrome://extensions`를 입력합니다.
2. 오른쪽 위의 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 클릭합니다.
4. 프로젝트의 `extension` 폴더를 선택합니다. **`manifest.json` 파일이 들어 있는 폴더**입니다.
5. Studio의 **웹 확장앱 관리**에서 연결 코드를 발급해 확장앱 옵션 페이지에 입력합니다.
6. Chrome에서 사용할 사이트와 이미지 호스트 접근 권한을 승인합니다.

지원 버전에서는 Studio **설치 · 환경 점검 → Chrome 확장앱 설치 안내**에서 폴더 열기와 Chrome 관리 페이지 열기를 안내합니다.

**주의:** `extension` 폴더를 로드한 뒤에는 해당 폴더를 이동하거나 삭제하지 마세요. 프로젝트 소스를 업데이트했다면 `chrome://extensions`에서 KoneWebTranslator의 **새로고침**을 눌러 변경 사항을 반영하세요. 잠시 동기화 기록이 없더라도 실제 페어링이 해제된 것은 아닐 수 있습니다.

## 선택 기능: Studio AI 채팅의 이미지 분석·GitHub 연동

아래 기능은 **기본 만화 번역에 필수가 아닌 선택 기능**입니다. 추가 구성요소를 설치하지 않아도 일반 텍스트 채팅, OCR, Gemma 텍스트 번역, LaMa 식질, ZIP 자동 번역, Chrome 확장앱 번역을 사용할 수 있습니다. **`설치 · 환경 점검`의 필수 설치/전체 검사 대상에 포함되지 않으며**, 필요할 때만 수동으로 설치하세요.

### 채팅에서 이미지·영상 내용 분석 — Gemma mmproj (선택)

이미지 파일 업로드·크기 변환에는 기본 Python 패키지의 Pillow가, 영상의 대표 프레임 추출에는 OpenCV가 사용됩니다. 하지만 **업로드한 이미지나 영상 프레임의 내용을 Gemma가 실제로 분석**하려면 현재 Gemma GGUF와 호환되는 **mmproj (비전 projector)** 모델을 별도로 준비해야 합니다.

1. [Gemma 4 HauhauCS 모델의 mmproj 파일](https://huggingface.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced/blob/main/mmproj-Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-BF16.gguf) 페이지에서 **Download**를 눌러 `mmproj-Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced-BF16.gguf`를 다운로드합니다 (약 175 MB).
2. 다운로드한 파일을 Gemma 설치 폴더의 `models`에 복사합니다. 기본 경로는 `C:\AI\Gemma4MTP\models\`입니다. Gemma 설치 경로를 변경했다면 **변경한 경로의 `models`**를 사용하세요. 파일명은 바꾸지 마세요.
3. Studio의 **환경 설정 → Gemma 설정 → 이미지 분석 mmproj**를 **ON**으로 변경하고 설정을 저장합니다.
4. **AI 서버 관리**에서 Gemma 서버를 완전히 종료한 후 다시 실행합니다. mmproj는 서버 시작 시 로드되며, 사용 중인 llama.cpp 실행 파일이 `--mmproj` 옵션을 지원해야 합니다.

현재 배포본에는 GUI 설명에 등장하는 `INSTALL_MMPROJ.bat`이 포함되어 있지 않으므로 위 수동 설치 방법을 사용하세요. mmproj가 없으면 설정을 **OFF(기본값)**로 유지하세요. ON 상태에서 파일이 없거나 호환되지 않으면 Gemma 서버 시작에 실패할 수 있습니다. mmproj 사용 시 VRAM 사용량이 증가할 수 있습니다.

### 채팅에서 GitHub 저장소·커밋·PR 조회 — GitHub CLI (선택)

Studio 채팅의 **GitHub 도구 ON** 기능은 사용자의 Windows 계정에 설치된 GitHub CLI(`gh`)와 해당 계정의 인증 상태를 사용합니다. 프로젝트 자체에 GitHub 인증키를 입력하거나 저장할 필요는 없습니다.

PowerShell에서 다음 명령을 실행합니다.

```powershell
winget install --id GitHub.cli --source winget
```

설치 후 **터미널을 새로 열고** 다음을 실행해 브라우저에서 GitHub 로그인을 완료합니다.

```powershell
gh --version
gh auth login
gh auth status
```

인증 확인 후 Studio를 재시작하고 채팅에서 **GitHub 도구를 ON**으로 켠 다음 조회할 저장소를 `소유자/저장소명` 형식으로 지정하세요. 비공개 저장소는 인증한 계정에 조회 권한이 있어야 합니다. 현재 GitHub 도구는 PR·커밋·코드 등을 **읽기 전용**으로 조회하며, 수정·푸시 기능을 제공하지 않습니다.

GitHub CLI가 없거나 인증하지 않아도 일반 채팅과 번역 기능에는 영향이 없습니다. 설치 참고: [GitHub CLI Windows 안내](https://github.com/cli/cli/blob/trunk/docs/install_windows.md) · [GitHub CLI 로그인 안내](https://cli.github.com/manual/gh_auth_login).

### 채팅에 PDF 문서 첨부 (기본 Python 설치에 포함)

텍스트가 들어 있는 PDF의 글자 추출에는 **pypdf**를 사용합니다. `SETUP.bat` 또는 **설치 · 환경 점검 → 기본 Python 패키지 → 설치/복구**에서 `local-server/requirements.txt`와 함께 설치됩니다. 별도 채팅 설치 BAT는 필요하지 않습니다. PDF 첨부 시 `pypdf` 누락 오류가 발생하면 다음 명령으로 기본 가상환경에 설치할 수 있습니다.

```powershell
.\local-server\.venv\Scripts\python.exe -m pip install "pypdf>=5,<7"
```

이 기능은 **텍스트 PDF 추출**용이며 이미지로만 구성된 스캔 PDF에 OCR을 수행하지는 않습니다. PDF 분석·이미지 분석·GitHub 조회 기능은 기본 만화 번역 파이프라인과 별개입니다.

## 자주 발생하는 문제

| 증상 | 확인할 내용 |
|---|---|
| `py -3.11` 오류 | Python 3.11 및 Windows Python Launcher 설치 확인 |
| `npm` / `cargo` 없음 | Node.js 설치 / Rust·C++ 도구 설치, 또는 웹 Studio 실행 |
| `.venv` 없음 | 프로젝트 루트에서 `SETUP.bat` 재실행 |
| `Port 1420 is already in use` | 기존 Studio 웹 서버가 실행 중인지 확인하고 종료한 뒤 재시작 |
| `Port 18765` 충돌 | 이전 Studio Bridge가 남아 있는지 확인. 진행 중인 작업을 종료한 뒤 충돌 해결 |
| Hayai OCR 미설치 | `SETUP_HAYAI.bat` 또는 설치 관리자 실행 |
| Detector / LaMa 파일 없음 | 다운로드 스크립트 또는 설치 관리자 실행 |
| `No module named 'torch'` | **기본 `.venv`**에 PyTorch 설치 후 Bridge 재시작 |
| Gemma 설치 중 CUDA 릴리스 파일 탐색 실패 | `setup_gemma.py`의 설치기 버전 확인; 다운로드 가능한 공식 llama.cpp 릴리스를 선택하는 최신 수정 필요 |
| OCR·Gemma 오프라인 | 모델 설치와 **서버 실행**은 별개. AI 서버 관리에서 실행 |
| Chrome 확장앱 미연결 표시 | Chrome 확장앱 새로고침, 페어링·최근 동기화 기록을 구별해 확인 |

## 폴더 구성

```text
KoneWebTranslator-Public/
├── extension/        Chrome 확장 프로그램
├── local-server/     OCR·번역용 로컬 서버, Python 환경
├── local-trans/      ZIP 배치 번역, LaMa 복원, 식질
├── studio/           React / TypeScript / Vite / Tauri UI
├── studio-bridge/    Studio ↔ 로컬 서버 연동
├── SETUP.bat         기본 Python/npm 설치
├── RUN_STUDIO.bat    Tauri 데스크톱 실행
├── RUN_STUDIO_WEB.bat  브라우저에서 Studio 실행
├── README.md
├── LICENSE
└── THIRD_PARTY_NOTICES.md
```

추가 설치용 BAT 파일 및 GUI 설치 마법사 파일은 배포 버전에 따라 다를 수 있습니다.

## 보안 및 개인정보 보호

- OCR, Studio Bridge, Gemma API는 기본적으로 같은 PC의 `127.0.0.1`에서만 이용하도록 설계되었습니다. 임의로 외부 네트워크에 노출하지 마세요.
- Chrome 확장 프로그램은 사용자가 허용한 웹사이트와 이미지 호스트에 접근합니다. 로그인된 사이트 이미지 요청에 브라우저 인증 정보가 사용될 수 있으므로 신뢰하는 사이트에만 권한을 부여하세요.
- 확장앱 연결 키, 로컬 설정, 모델, 가상환경, 번역 결과 및 로그를 공개 Git 저장소에 업로드하지 마세요.
- 외부 다운로드는 최초 모델/프로그램 설치 및 원본 이미지 요청 시 발생할 수 있습니다.

## 라이선스 및 외부 구성요소

이 저장소의 프로젝트 소스코드 라이선스는 **GNU GPL-3.0-only**입니다. [LICENSE](LICENSE)와 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), [Studio 관련 고지](studio/THIRD_PARTY_NOTICES_STUDIO.md)를 확인하세요. 제3자 모델/가중치/바이너리는 각각의 라이선스와 배포 조건을 따릅니다.

| 구성요소 | 프로젝트/배포처 |
|---|---|
| Hayai OCR | [hayai-ocr-v2.5-nova](https://huggingface.co/JustANormalTinkerer/hayai-ocr-v2.5-nova) |
| Comic Text Detector | [dmMaze/comic-text-detector](https://github.com/dmMaze/comic-text-detector) 및 별도 ONNX 배포본 |
| LaMa | [advimman/lama](https://github.com/advimman/lama) |
| llama.cpp | [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp) |
| Gemma GGUF | [HauhauCS Gemma 4 GGUF](https://huggingface.co/HauhauCS/Gemma4-12B-QAT-Uncensored-HauhauCS-Balanced) |

KoneWebTranslator는 번역 결과의 정확성·완전성을 보장하지 않습니다. 원본 이미지·만화의 저작권 및 웹사이트 이용약관을 준수하고, 결과물을 배포·게시하기 전 필요한 권한을 확인하세요. 이 소프트웨어는 관련 법령이 허용하는 범위에서 별도의 보증 없이 제공됩니다.
