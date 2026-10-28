"""KWT_PRIVATE_LOCAL_TOOLS_V2_9: explicit user-selected read-only project tools.

Roots can only be registered by the Studio UI (never by model tools). Registry and
chat selections are local, outside git. All model paths are relative to one chosen
root and are checked after resolving symlinks. No subprocess or write tool.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / 'studio-bridge' / '.studio_runtime' / 'local_tools' / 'projects.json'
LOCK = threading.RLock()
MAX_PROJECTS = 20
MAX_FILE_BYTES = 1024 * 1024
MAX_SCAN_BYTES = 16 * 1024 * 1024
MAX_SCAN_FILES = 750
# KWT_PRIVATE_LOCAL_FILTER_TOGGLES_V2_9_3: project owner controls optional filters; core project boundary is always enforced.
ALLOW_EXT = frozenset({'.py', '.pyi', '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.css',
    '.html', '.xml', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.rs', '.go', '.java', '.c',
    '.h', '.cpp', '.hpp', '.cs', '.sql', '.sh', '.ps1', '.bat', '.vbs', '.srt', '.csv'})
EXCLUDE_DIRS = frozenset({'.git', '.svn', '.hg', '.venv', 'venv', 'node_modules', 'dist', 'build',
    'target', '__pycache__', '.studio_runtime', '_patch_backups', '_local_patch_rollback',
    '.ssh', '.aws', '.azure', '.config', '.vscode-test', '.idea', 'models', 'checkpoints',
    'backups', 'backup', 'temp', 'tmp', '.next', '.cache', '.npm', '.rustup', '.cargo'})
SECRET_RE = re.compile(r'(?:^\.env(?:\.|$)|(?:^|[._\-])(?:secret|secrets|credential|credentials|token|tokens|password|private[_-]?key|id_rsa|id_ed25519|auth|cookies|session)(?:[._\-]|$)|\.pem$|\.key$|\.p12$|\.pfx$|\.kdbx$)', re.I)
ID_RE = re.compile(r'^[a-f0-9]{32}$')


def _definition(name, description, properties, required):
    return {'type': 'function', 'function': {'name': name, 'description': description,
        'parameters': {'type': 'object', 'properties': properties, 'required': required,
                       'additionalProperties': False}}}

REL = {'type': 'string', 'description': 'Path RELATIVE to selected project root, using forward slashes. Empty for root.'}
TOOL_DEFINITIONS = [
    _definition('local_list_files', 'List code files/folders inside the user-selected local project. READ ONLY.',
        {'path': REL, 'depth': {'type': 'integer', 'minimum': 1, 'maximum': 3}}, []),
    _definition('local_search_code', 'Search exact text in allowed project source files. READ ONLY.',
        {'query': {'type': 'string', 'description': 'Literal code text, 2-100 chars'}, 'path': REL}, ['query']),
    _definition('local_read_file', 'Read numbered text lines inside the selected project. READ ONLY. Honor the project owner filter switches.',
        {'path': REL, 'start_line': {'type': 'integer', 'minimum': 1},
         'line_count': {'type': 'integer', 'minimum': 1, 'maximum': 80}}, ['path']),
]
NAMES = frozenset(t['function']['name'] for t in TOOL_DEFINITIONS)


def _load_registry():
    if not REGISTRY.exists():
        return []
    data = json.loads(REGISTRY.read_text(encoding='utf-8'))
    if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('projects'), list):
        raise ValueError('로컬 프로젝트 등록 파일 형식이 올바르지 않습니다.')
    return data['projects']


def _store_registry(rows):
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.kwt-project-', suffix='.tmp', dir=str(REGISTRY.parent))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump({'version': 1, 'projects': rows}, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, REGISTRY)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _validate_root(value):
    if not isinstance(value, str) or not 3 <= len(value) <= 1024 or '\x00' in value:
        raise ValueError('프로젝트 경로를 확인하세요.')
    if value.startswith('\\\\') or value.startswith('//'):
        raise ValueError('네트워크/UNC 경로는 등록할 수 없습니다.')
    path = Path(value).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise ValueError('실제로 존재하는 절대 폴더 경로를 선택하세요.')
    path = path.resolve(strict=True)
    # Do not register a drive root, system root, or the user's whole profile.
    if path == Path(path.anchor) or path == Path.home().resolve():
        raise ValueError('드라이브 전체/사용자 프로필 전체는 등록할 수 없습니다. 프로젝트 하위 폴더를 선택하세요.')
    if path.name.casefold() in {'windows', 'program files', 'program files (x86)', 'users', 'system32', 'etc', 'proc', 'sys', 'root'}:
        raise ValueError('운영체제 및 사용자 상위 폴더는 등록할 수 없습니다.')
    return path


def projects():
    with LOCK:
        rows = _load_registry()
    return [{'id': row['id'], 'name': row['name'], 'path': row['path'],
             'available': Path(row['path']).is_dir(),
             'sensitive_filter_enabled': row.get('sensitive_filter_enabled', False) is True,
             'exclude_generated_dirs': row.get('exclude_generated_dirs', True) is True} for row in rows]


def register(path: str):
    target = _validate_root(path)
    with LOCK:
        rows = _load_registry()
        for row in rows:
            if os.path.normcase(row['path']) == os.path.normcase(str(target)):
                return row
        if len(rows) >= MAX_PROJECTS:
            raise ValueError('프로젝트는 최대 20개까지 등록할 수 있습니다.')
        row = {'id': uuid.uuid4().hex, 'name': target.name[:90], 'path': str(target),
               'sensitive_filter_enabled': False, 'exclude_generated_dirs': True}
        rows.append(row)
        _store_registry(rows)
        return row


def unregister(project_id: str):
    if not isinstance(project_id, str) or not ID_RE.fullmatch(project_id):
        raise ValueError('프로젝트 ID가 올바르지 않습니다.')
    with LOCK:
        rows = _load_registry()
        filtered = [row for row in rows if row['id'] != project_id]
        if len(rows) == len(filtered):
            raise ValueError('등록된 프로젝트를 찾을 수 없습니다.')
        _store_registry(filtered)
    return {'unregistered': True, 'note': '등록 정보만 삭제했습니다. 실제 프로젝트 파일은 변경하지 않았습니다.'}


def update_filters(project_id: str, *, sensitive_filter_enabled=None, exclude_generated_dirs=None):
    """Only Studio's explicit settings endpoint may call this; never exposed to Gemma tools."""
    if not isinstance(project_id, str) or not ID_RE.fullmatch(project_id):
        raise ValueError('등록된 프로젝트 ID가 올바르지 않습니다.')
    if sensitive_filter_enabled is None and exclude_generated_dirs is None:
        raise ValueError('변경할 필터 옵션이 없습니다.')
    for key, val in (('sensitive_filter_enabled', sensitive_filter_enabled),
                     ('exclude_generated_dirs', exclude_generated_dirs)):
        if val is not None and type(val) is not bool:
            raise ValueError(key + ' 설정은 true/false만 허용합니다.')
    with LOCK:
        rows = _load_registry()
        for row in rows:
            if row['id'] == project_id:
                if sensitive_filter_enabled is not None:
                    row['sensitive_filter_enabled'] = sensitive_filter_enabled
                if exclude_generated_dirs is not None:
                    row['exclude_generated_dirs'] = exclude_generated_dirs
                _store_registry(rows)
                return dict(row)
    raise ValueError('등록된 프로젝트를 찾을 수 없습니다.')


def selected(project_id: str):
    if not isinstance(project_id, str) or not ID_RE.fullmatch(project_id):
        raise ValueError('프로젝트를 선택하세요.')
    with LOCK:
        for row in _load_registry():
            if row['id'] == project_id:
                path = _validate_root(row['path'])
                # Registered root is pinned: prevent symlink retarget after registration.
                if os.path.normcase(str(path)) != os.path.normcase(row['path']):
                    raise ValueError('프로젝트 경로가 변경되었습니다. 다시 등록하세요.')
                return row, path
    raise ValueError('프로젝트가 등록 해제됐습니다. 다른 프로젝트를 선택하세요.')


def _safe_relative(value: str, allow_empty=False, *, sensitive_filter=False, exclude_generated_dirs=True):
    if value == '' and allow_empty:
        return Path('.')
    if not isinstance(value, str) or not value or len(value) > 240 or '\x00' in value:
        raise ValueError('상대 경로가 올바르지 않습니다.')
    value = value.replace('\\', '/')
    if value.startswith('/') or re.match(r'^[A-Za-z]:', value) or '//' in value:
        raise ValueError('프로젝트 상대 경로만 허용됩니다.')
    if any(bit in ('.', '..', '') for bit in value.split('/')):
        raise ValueError('상위 경로 이동을 허용하지 않습니다.')
    parts = value.split('/')
    if exclude_generated_dirs and any(p.casefold() in EXCLUDE_DIRS for p in parts):
        raise ValueError('대량·생성 폴더 제외가 ON입니다. 프로젝트 관리에서 OFF로 변경할 수 있습니다.')
    if sensitive_filter and any(SECRET_RE.search(p) for p in parts):
        raise ValueError('민감 파일명 필터가 ON입니다. 프로젝트 관리에서 OFF로 변경할 수 있습니다.')
    return Path(*parts)


def _path(root: Path, rel: str, *, allow_empty=False, sensitive_filter=False, exclude_generated_dirs=True):
    sub = _safe_relative(rel, allow_empty=allow_empty, sensitive_filter=sensitive_filter,
                         exclude_generated_dirs=exclude_generated_dirs)
    dest = (root / sub).resolve(strict=False)
    try:
        dest.relative_to(root)
    except ValueError as exc:
        raise ValueError('등록된 프로젝트 외부 접근은 금지됩니다.') from exc
    return dest


def _allowed_file(path: Path, *, sensitive_filter=False):
    # Unknown extensions and extensionless files are allowed when they are text.
    # Binary/NUL/size checks still run in _file_lines; no filename denylist by default.
    return not sensitive_filter or (not SECRET_RE.search(path.name)
        and path.name.lower() not in {'config.json', 'settings.local.json'})


def _walk(root: Path, directory: Path, depth: int, max_files=MAX_SCAN_FILES, *, sensitive_filter=False, exclude_generated_dirs=True):
    # os.walk does not follow symlink directories. Resolve and re-check files.
    count = 0
    for dirpath, dirs, files in os.walk(directory, topdown=True, followlinks=False):
        here = Path(dirpath)
        level = len(here.relative_to(directory).parts)
        dirs[:] = sorted(d for d in dirs if not (here / d).is_symlink()
            and (not exclude_generated_dirs or (d.casefold() not in EXCLUDE_DIRS and not d.startswith('.')))
            and (not sensitive_filter or not SECRET_RE.search(d))) if level < depth else []
        for name in sorted(files):
            raw = here / name
            if raw.is_symlink() or not _allowed_file(raw, sensitive_filter=sensitive_filter):
                continue
            try:
                actual = raw.resolve(strict=True)
                actual.relative_to(root)
                if not actual.is_file() or actual.stat().st_size > MAX_FILE_BYTES:
                    continue
            except (OSError, ValueError):
                continue
            yield actual
            count += 1
            if count >= max_files:
                return


def _file_lines(file: Path):
    raw = file.read_bytes()
    if len(raw) > MAX_FILE_BYTES or b'\x00' in raw[:4096]:
        raise ValueError('파일이 너무 크거나 바이너리입니다.')
    return raw.decode('utf-8-sig', errors='replace').splitlines()


def _cap_int(value, default, low, high):
    if value is None:
        return default
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f'정수 범위는 {low}~{high}입니다.')
    return value


# KWT_PRIVATE_NATIVE_TOOL_BRIDGE_V2_9_2: directory tools tolerate one slash suffix.
# The existing _safe_relative and _path checks still enforce project isolation.
def _normalize_directory_arg(value):
    if (isinstance(value, str) and len(value) > 1 and value[-1] in ('/', chr(92))
            and value[-2] not in ('/', chr(92))):
        return value[:-1]
    return value


def execute(name: str, arguments: dict, project_id: str):
    if name not in NAMES or not isinstance(arguments, dict):
        raise ValueError('허용되지 않은 로컬 읽기 도구')
    project, root = selected(project_id)
    sensitive = project.get('sensitive_filter_enabled', False) is True
    exclude_dirs = project.get('exclude_generated_dirs', True) is True
    scope = {'sensitive_filter': sensitive, 'exclude_generated_dirs': exclude_dirs}
    if name == 'local_list_files':
        depth = _cap_int(arguments.get('depth'), 2, 1, 3)
        path = _path(root, _normalize_directory_arg(arguments.get('path', '')), allow_empty=True, **scope)
        if not path.is_dir():
            raise ValueError('프로젝트 내부 폴더를 선택하세요.')
        entries = []
        # Files only; avoids revealing excluded directories and symlink targets.
        for f in _walk(root, path, depth, max_files=120, **scope):
            entries.append(f.relative_to(root).as_posix())
            if len(entries) >= 60:
                break
        return {'project': project['name'], 'path': arguments.get('path', ''), 'entries': entries,
                'truncated': len(entries) >= 60, 'read_only': True}
    if name == 'local_search_code':
        query = arguments.get('query')
        if not isinstance(query, str) or not 2 <= len(query) <= 100 or '\x00' in query:
            raise ValueError('검색어는 2~100자의 일반 텍스트여야 합니다.')
        folder = _path(root, _normalize_directory_arg(arguments.get('path', '')), allow_empty=True, **scope)
        if not folder.is_dir():
            raise ValueError('검색 폴더가 아닙니다.')
        matches, scanned, byte_total, stopped = [], 0, 0, False
        start = time.monotonic()
        for f in _walk(root, folder, 12, **scope):
            if scanned >= MAX_SCAN_FILES or byte_total >= MAX_SCAN_BYTES or time.monotonic()-start > 3.0:
                stopped = True
                break
            try:
                size = f.stat().st_size
                byte_total += size
                scanned += 1
                for lineno, content in enumerate(_file_lines(f), 1):
                    if query.casefold() in content.casefold():
                        matches.append({'path': f.relative_to(root).as_posix(), 'line': lineno,
                                        'text': content[:170]})
                        if len(matches) >= 12:
                            stopped = True
                            break
                if stopped:
                    break
            except (OSError, UnicodeError, ValueError):
                continue
        return {'project': project['name'], 'query': query, 'matches': matches,
                'scanned_files': scanned, 'truncated': stopped, 'read_only': True}
    file = _path(root, arguments.get('path'), **scope)
    if not _allowed_file(file, sensitive_filter=sensitive) or not file.is_file():
        raise ValueError('등록된 프로젝트의 허용된 텍스트 소스 파일만 읽을 수 있습니다.')
    start = _cap_int(arguments.get('start_line'), 1, 1, 1000000)
    count = _cap_int(arguments.get('line_count'), 55, 1, 80)
    lines = _file_lines(file)
    chosen = [f'{i+1}: {lines[i][:250]}' for i in range(start-1, min(len(lines), start-1+count))]
    return {'project': project['name'], 'path': file.relative_to(root).as_posix(),
            'start_line': start, 'total_lines': len(lines), 'lines': chosen,
            'truncated': start-1+count < len(lines), 'read_only': True}


def compact_result(result: dict, max_chars: int):
    """Never truncate in the middle of JSON. Remove tail entries instead."""
    obj = dict(result)
    cap = max(900, min(int(max_chars), 6500))
    while True:
        text = json.dumps({'ok': True, 'result': obj}, ensure_ascii=False)
        if len(text) <= cap:
            return text
        array = next((k for k in ('lines','matches','entries') if isinstance(obj.get(k), list) and obj[k]), None)
        if array:
            obj[array] = obj[array][:-1]
            obj['truncated'] = True
        else:
            raise ValueError('도구 결과가 컨텍스트 예산을 초과했습니다. 더 작은 범위를 선택하세요.')
