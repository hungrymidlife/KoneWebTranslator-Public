"""KWT Studio local chat, using ONLY the existing loopback llama.cpp API.

Conversations are saved locally and never uploaded. A bounded rolling summary
compresses older messages while preserving the full original transcript.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'studio-bridge' / '.studio_runtime' / 'chat'
API = 'http://127.0.0.1:18080/v1/chat/completions'
MODEL = 'gemma4-12b-local'
ID_RE = re.compile(r'^[a-f0-9]{32}$')
DEFAULT_SYSTEM = '너는 친절하고 정확한 한국어 AI 도우미다. 불확실한 내용은 확실한 사실과 구별해 설명한다.'
_LOCKS_GUARD = threading.RLock()
_LOCKS: dict[str, threading.RLock] = {}
_BUSY = 0


def _lock(cid: str) -> threading.RLock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(cid, threading.RLock())


def is_busy() -> bool:
    with _LOCKS_GUARD:
        return _BUSY > 0


def _busy_change(delta: int) -> None:
    global _BUSY
    with _LOCKS_GUARD:
        _BUSY += delta


def _file(cid: str) -> Path:
    if not ID_RE.fullmatch(cid):
        raise ValueError('대화 ID가 올바르지 않습니다.')
    return DATA / (cid + '.json')


def _read(cid: str) -> dict:
    path = _file(cid)
    if not path.is_file():
        raise FileNotFoundError('대화를 찾을 수 없습니다.')
    item = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(item, dict) or item.get('id') != cid:
        raise ValueError('대화 파일 형식이 올바르지 않습니다.')
    return item


def _save(item: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    path = _file(item['id'])
    fd, temp = tempfile.mkstemp(prefix='.kwt-chat-', suffix='.tmp', dir=str(DATA))
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(item, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def _public(item: dict) -> dict:
    return {k: item.get(k) for k in ('id', 'title', 'created', 'updated', 'system_prompt',
                                    'context_tokens', 'reply_tokens', 'temperature',
                                    'summary', 'summary_through', 'messages')}


def _list() -> list:
    if not DATA.is_dir():
        return []
    result = []
    for p in DATA.glob('*.json'):
        if not ID_RE.fullmatch(p.stem):
            continue
        try:
            obj = _read(p.stem)
            result.append({'id': obj['id'], 'title': obj.get('title', '새 대화'),
                           'updated': obj.get('updated', 0),
                           'message_count': len(obj.get('messages', []))})
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return sorted(result, key=lambda x: x['updated'], reverse=True)[:100]


def _estimate(text: str) -> int:
    """Conservative approximation for Korean/CJK and English; not a tokenizer."""
    asian = sum(1 for c in text if ord(c) > 127)
    other = len(text) - asian
    return int(asian * 1.8 + other / 2.7 + 10)


def _request(messages: list, max_tokens: int, temperature: float) -> str:
    payload = {'model': MODEL, 'messages': messages, 'stream': False,
               'max_tokens': max_tokens, 'temperature': temperature}
    req = urllib.request.Request(API, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    # Prevent HTTP_PROXY/HTTPS_PROXY from intercepting local prompts.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=300) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read(1400).decode('utf-8', 'replace')
        raise RuntimeError('Gemma API 오류 (%s): %s' % (exc.code, detail)) from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise RuntimeError('Gemma 서버에 연결할 수 없습니다. AI 서버 관리에서 실행 상태를 확인하세요. (%s)' % exc) from exc
    try:
        content = data['choices'][0]['message']['content']
        if isinstance(content, list):
            content = ''.join(str(p.get('text', '')) for p in content if isinstance(p, dict))
        if not isinstance(content, str) or not content.strip():
            raise ValueError('empty response')
        return content.strip()
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise RuntimeError('Gemma 응답이 비어 있거나 예상 형식이 아닙니다.') from exc


def _summarize(previous: str, messages: list) -> str:
    # Summarize in bounded chunks, never discard the original transcript.
    summary = previous
    chunks = []
    buffer = ''
    for msg in messages:
        prefix = ('사용자' if msg['role'] == 'user' else 'AI') + ': '
        content = prefix + msg['content'] + '\n'
        # Extremely long turns are broken into pieces to avoid context overflow.
        while content:
            piece, content = content[:1300], content[1300:]
            if buffer and _estimate(buffer + piece) > 1150:
                chunks.append(buffer)
                buffer = ''
            buffer += piece
    if buffer:
        chunks.append(buffer)
    for chunk in chunks:
        prompt = ('기존 장기 기억과 추가 대화를 하나의 간결한 한국어 기억으로 통합해. '
                  '인물·고유명사·사용자 선호·결정사항·진행 중 작업·중요한 수치를 우선 보존하고, '
                  '추측으로 내용을 만들지 마. 대화 상대에게 답하지 말고 기억 요약만 출력해. '
                  '최대 450 한국어 글자 정도로 정리해.\n\n'
                  '기존 기억:\n' + summary[:2000] + '\n\n추가 대화:\n' + chunk)
        summary = _request([{'role': 'user', 'content': prompt}], 400, 0.15)[:2200]
    return summary


def _messages_for(item: dict, pending: dict) -> list:
    transcript = list(item['messages']) + [pending]
    cursor = max(0, min(int(item.get('summary_through', 0)), len(item['messages'])))
    context = int(item['context_tokens'])
    response = int(item['reply_tokens'])
    # Reserve tokens for chat formatting and the requested answer.
    budget = context - response - 400
    if budget < 650:
        raise ValueError('컨텍스트 설정이 답변 길이에 비해 너무 작습니다.')

    def prompt_messages() -> list:
        memory = item.get('summary', '')
        system = item['system_prompt'] + ('\n\n[이전 대화의 압축 기억]\n' + memory if memory else '')
        return [{'role': 'system', 'content': system}] + transcript[cursor:]

    for _ in range(len(transcript) + 1):
        result = prompt_messages()
        estimated = sum(_estimate(m['content']) for m in result)
        if estimated <= budget:
            item['summary_through'] = cursor
            return result
        # Keep the newest user message verbatim. Older turns can be summarized.
        if cursor >= len(transcript) - 1:
            raise ValueError('현재 메시지가 컨텍스트 예산을 초과합니다. 입력을 줄이거나 서버 -c 값을 늘려 주세요.')
        # Summarize at most four oldest messages per pass. Preserve chronology.
        n = min(4, len(transcript) - 1 - cursor)
        item['summary'] = _summarize(item.get('summary', ''), transcript[cursor:cursor+n])
        cursor += n
    raise RuntimeError('대화 컨텍스트를 구성하지 못했습니다.')


def get(path: str, q: dict) -> object:
    if path == '/api/chat/list':
        return {'conversations': _list()}
    if path == '/api/chat/conversation':
        cid = str(q.get('id', ''))
        with _lock(cid):
            return _public(_read(cid))
    raise ValueError('지원하지 않는 채팅 조회 요청입니다.')


def post(path: str, body: dict) -> object:
    if not isinstance(body, dict):
        raise ValueError('잘못된 요청입니다.')
    if path == '/api/chat/create':
        now = time.time()
        item = {'id': uuid.uuid4().hex, 'title': '새 대화', 'created': now, 'updated': now,
                'system_prompt': DEFAULT_SYSTEM, 'context_tokens': 4096,
                'reply_tokens': 768, 'temperature': 0.65,
                'summary': '', 'summary_through': 0, 'messages': []}
        _save(item)
        return _public(item)
    cid = str(body.get('id', ''))
    with _lock(cid):
        item = _read(cid)
        if path == '/api/chat/delete':
            _file(cid).unlink()
            return {'deleted': True}
        if path == '/api/chat/settings':
            prompt = str(body.get('system_prompt', item['system_prompt'])).strip()
            context = int(body.get('context_tokens', item['context_tokens']))
            reply = int(body.get('reply_tokens', item['reply_tokens']))
            temperature = float(body.get('temperature', item['temperature']))
            if not 1 <= len(prompt) <= 3000:
                raise ValueError('시스템 프롬프트는 1~3000자여야 합니다.')
            if context not in (4096, 8192, 16384, 32768):
                raise ValueError('지원하지 않는 컨텍스트 설정입니다.')
            if not 128 <= reply <= min(2048, context - 1024):
                raise ValueError('답변 길이는 128~2048 토큰이어야 합니다.')
            if not 0 <= temperature <= 2:
                raise ValueError('temperature 범위는 0~2입니다.')
            item.update(system_prompt=prompt, context_tokens=context,
                        reply_tokens=reply, temperature=temperature, updated=time.time())
            _save(item)
            return _public(item)
        if path == '/api/chat/send':
            text = str(body.get('text', '')).strip()
            if not text or len(text) > 6000:
                raise ValueError('메시지는 1~6000자까지 입력할 수 있습니다.')
            if len(item.get('messages', [])) >= 10000:
                raise ValueError('대화 기록이 10000개를 넘었습니다. 새 대화를 시작해 주세요.')
            _busy_change(1)
            try:
                pending = {'role': 'user', 'content': text}
                prompt = _messages_for(item, pending)
                answer = _request(prompt, int(item['reply_tokens']), float(item['temperature']))
                item['messages'].extend([pending, {'role': 'assistant', 'content': answer}])
                if item['title'] == '새 대화':
                    item['title'] = text[:32].replace('\n', ' ')
                item['updated'] = time.time()
                _save(item)
                return _public(item)
            finally:
                _busy_change(-1)
    raise ValueError('지원하지 않는 채팅 요청입니다.')
