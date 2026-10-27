"""Open the bundled Chrome extension folder or Chrome extension manager.

KWT_CHROME_EXTENSION_GUIDE_V2_0_2
Only fixed, local actions can be invoked from authenticated Studio requests.
This module never modifies Chrome settings, registry, or installs extensions.
"""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / 'extension'


def _chrome_executable() -> Path | None:
    if os.name != 'nt':
        return None
    try:
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for view in (0, getattr(winreg, 'KEY_WOW64_64KEY', 0), getattr(winreg, 'KEY_WOW64_32KEY', 0)):
                try:
                    with winreg.OpenKey(hive, r'Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 0, winreg.KEY_READ | view) as key:
                        value, _ = winreg.QueryValueEx(key, '')
                    candidate = Path(str(value).strip('"'))
                    if candidate.is_file() and candidate.name.casefold() == 'chrome.exe':
                        return candidate
                except OSError:
                    continue
    except ImportError:
        pass
    bases = [os.environ.get('PROGRAMFILES', ''), os.environ.get('PROGRAMFILES(X86)', ''), os.environ.get('LOCALAPPDATA', '')]
    for base in bases:
        if not base:
            continue
        candidate = Path(base) / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'
        if candidate.is_file():
            return candidate
    candidate = shutil.which('chrome.exe')
    if candidate and Path(candidate).is_file():
        return Path(candidate)
    return None


def open_for_user(body: object) -> dict:
    if not isinstance(body, dict) or set(body) != {'action'}:
        raise ValueError('허용되지 않은 확장앱 설치 안내 요청입니다.')
    action = body['action']
    if os.name != 'nt':
        raise RuntimeError('이 기능은 Windows Studio에서만 지원합니다.')
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    if action == 'folder':
        if not (EXTENSION / 'manifest.json').is_file():
            raise FileNotFoundError('확장앱 폴더의 manifest.json을 찾을 수 없습니다: ' + str(EXTENSION))
        subprocess.Popen(['explorer.exe', str(EXTENSION)], creationflags=flags, cwd=str(ROOT))
        return {'ok': True, 'action': 'folder', 'location': str(EXTENSION)}
    if action == 'chrome':
        executable = _chrome_executable()
        if executable is None:
            raise FileNotFoundError('Chrome 실행 파일을 찾지 못했습니다. Chrome 주소창에서 chrome://extensions 를 직접 입력하세요.')
        subprocess.Popen([str(executable), 'chrome://extensions'], creationflags=flags)
        return {'ok': True, 'action': 'chrome'}
    raise ValueError('지원하지 않는 확장앱 안내 동작입니다.')
