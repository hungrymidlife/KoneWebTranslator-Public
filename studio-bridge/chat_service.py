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

from chat_attachments import prepare as kwt_prepare_attachments, delete_conversation as kwt_delete_attachments  # KWT_CHAT_ATTACH_V2_3

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'studio-bridge' / '.studio_runtime' / 'chat'
API = 'http://127.0.0.1:18080/v1/chat/completions'
MODEL = 'gemma4-12b-local'
ID_RE = re.compile(r'^[a-f0-9]{32}$')
DEFAULT_SYSTEM = '너는 친절하고 정확한 한국어 AI 도우미다. 불확실한 내용은 확실한 사실과 구별해 설명한다.'

# KWT_UNIFIED_CHAT_V1_4: snapshot common memory policy at the start of each message.
_CHAT_DEFAULTS = {
    'context_reserve': 400, 'auto_reply_margin': 512, 'summary_batch_messages': 4,
    'summary_chunk_budget': 1150, 'summary_output_tokens': 700,
    'summary_max_chars': 2200, 'summary_previous_chars': 2000,
    'timeout_sec': 300, 'continue_limit': 3,
}
_CHAT_LIMITS = {
    'context_reserve': (200, 1500), 'auto_reply_margin': (256, 2048),
    'summary_batch_messages': (1, 10), 'summary_chunk_budget': (500, 2500),
    'summary_output_tokens': (256, 1600), 'summary_max_chars': (500, 8000),
    'summary_previous_chars': (500, 6000), 'timeout_sec': (30, 900),
    'continue_limit': (1, 6),
}
def _kwt_chat_runtime():
    config_path = ROOT / 'runtime_settings.json'
    values = dict(_CHAT_DEFAULTS)
    if not config_path.is_file():
        return values
    data = json.loads(config_path.read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict) or data.get('schema_version') != 1:
        raise ValueError('채팅 통합 설정 파일의 버전이 올바르지 않습니다.')
    group = data.get('chat', {})
    if not isinstance(group, dict) or set(group) - set(_CHAT_DEFAULTS):
        raise ValueError('채팅 통합 설정 필드가 올바르지 않습니다.')
    for key, val in group.items():
        lo, hi = _CHAT_LIMITS[key]
        if type(val) is not int or not lo <= val <= hi:
            raise ValueError('채팅 설정값 범위 오류: ' + key)
        values[key] = val
    return values

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


def _estimate(text: str | list) -> int:
    """Conservative estimate including multimodal frames (not exact tokens)."""
    if isinstance(text, list):
        return sum(_estimate(p.get('text', '')) if p.get('type') == 'text' else 1100 for p in text if isinstance(p, dict))
    asian = sum(1 for c in text if ord(c) > 127)
    other = len(text) - asian
    return int(asian * 1.8 + other / 2.7 + 10)


def _request(messages: list, max_tokens: int, temperature: float, timeout: int = 300) -> tuple[str, str, int]:
    """Return visible answer, finish reason and generated token count.

    A llama.cpp length finish MUST NOT be silently treated as a completed answer.
    Disable optional Gemma 4 thinking for chat so its hidden reasoning does not
    consume the already-small reply budget (server/template support varies).
    """
    payload = {'model': MODEL, 'messages': messages, 'stream': False,
               'max_tokens': max_tokens, 'temperature': temperature,
               'chat_template_kwargs': {'enable_thinking': False}}
    req = urllib.request.Request(API, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read(1400).decode('utf-8', 'replace')
        raise RuntimeError('Gemma API 오류 (%s): %s' % (exc.code, detail)) from exc
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise RuntimeError('Gemma 서버에 연결할 수 없습니다. AI 서버 관리에서 실행 상태를 확인하세요. (%s)' % exc) from exc
    try:
        choice = data['choices'][0]
        content = choice['message']['content']
        if isinstance(content, list):
            content = ''.join(str(p.get('text', '')) for p in content if isinstance(p, dict))
        if not isinstance(content, str) or not content.strip():
            raise ValueError('empty response')
        finish = str(choice.get('finish_reason') or 'unknown')
        usage = data.get('usage') or {}
        tokens = int(usage.get('completion_tokens') or 0)
        return content.strip(), finish, tokens
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise RuntimeError('Gemma 응답이 비어 있거나 예상 형식이 아닙니다.') from exc


def _join_continuation(previous: str, continuation: str) -> str:
    """Avoid duplicating a repeated suffix/prefix when continuing a cut-off answer."""
    continuation = continuation.lstrip('\n')
    overlap = 0
    for n in range(min(250, len(previous), len(continuation)), 7, -1):
        if previous.endswith(continuation[:n]):
            overlap = n
            break
    return previous + continuation[overlap:]


def _output_limit(messages: list, item: dict, chat_cfg=None) -> int:
    """Resolve 0 (auto) to a positive, context-bounded llama.cpp token cap.

    Do not send max_tokens=0: API servers differ on its interpretation.
    Auto mode lets the model stop naturally, or stops at the remaining -c budget.
    Estimates are intentionally conservative, but are not exact tokenization.
    """
    selected = int(item['reply_tokens'])
    if selected > 0:
        return selected
    context = int(item['context_tokens'])
    prompt_estimate = sum(_estimate(m['content']) for m in messages)
    available = context - prompt_estimate - (chat_cfg or _CHAT_DEFAULTS)['auto_reply_margin']  # estimated
    if available < 128:
        raise ValueError('자동 답변에 남은 컨텍스트가 부족합니다. 입력을 줄이거나 -c를 늘려 주세요.')
    return available


def _generate_complete(prompt: list, item: dict, chat_cfg=None) -> tuple[str, dict]:
    """Continue on length stops, bounded by configured server call count."""
    chat_cfg = chat_cfg or _CHAT_DEFAULTS
    selected = int(item['reply_tokens'])
    temperature = float(item['temperature'])
    context = int(item['context_tokens'])
    answer = ''
    total_tokens = 0
    reason = 'unknown'
    segments = 0
    for index in range(chat_cfg['continue_limit']):
        if index == 0:
            messages = prompt
        else:
            # Keep the newest user question and a short answer tail so the
            # follow-up has room to generate, even in 0 (auto) mode.
            system = prompt[0]
            latest = prompt[-1]
            if isinstance(latest.get('content'), list):
                latest = {'role':'user', 'content':''.join(str(p.get('text','')) for p in latest['content'] if p.get('type')=='text') + '\n[이미지 프레임은 첫 번째 요청에서만 전달됨]'}
            followup = {'role': 'user', 'content':
                        '방금 답변이 길이 제한으로 중단되었습니다. 이미 쓴 내용은 반복하지 말고, '
                        '끊긴 문장부터 자연스럽게 이어서 답변을 마무리해 주세요.'}
            base = sum(_estimate(m['content']) for m in (system, latest, followup))
            reserve = selected if selected > 0 else max(1024, context // 4)
            allowance = context - reserve - (chat_cfg['context_reserve'] + 50) - base
            if allowance < 250:
                reason = 'length'
                break
            tail = answer[-min(len(answer), max(180, int(allowance / 2.0))):]
            while len(tail) > 150 and _estimate(tail) > allowance:
                tail = tail[len(tail)//5:]
            messages = [system, latest, {'role': 'assistant', 'content': tail}, followup]
        try:
            limit = _output_limit(messages, item, chat_cfg)
            part, reason, tokens = _request(messages, limit, temperature, timeout=chat_cfg['timeout_sec'])
        except Exception:
            if not answer:
                raise
            reason = 'continuation_error'
            break
        segments += 1
        total_tokens += tokens
        answer = _join_continuation(answer, part) if answer else part
        if reason != 'length':
            break
    return answer, {'finish_reason': reason, 'completion_tokens': total_tokens,
                    'segments': segments, 'truncated': reason in ('length', 'continuation_error')}


def _summarize(previous: str, messages: list, chat_cfg=None) -> str:
    chat_cfg = chat_cfg or _CHAT_DEFAULTS
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
            if buffer and _estimate(buffer + piece) > chat_cfg['summary_chunk_budget']:
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
                  '기존 기억:\n' + summary[:chat_cfg['summary_previous_chars']] + '\n\n추가 대화:\n' + chunk)
        summary_text, summary_finish, _ = _request([{'role': 'user', 'content': prompt}], chat_cfg['summary_output_tokens'], 0.15, timeout=chat_cfg['timeout_sec'])
        if summary_finish == 'length':
            raise RuntimeError('대화 기억 요약이 출력 한도로 중단됐습니다. 답변 길이를 늘려 다시 시도하세요.')
        summary = summary_text[:chat_cfg['summary_max_chars']]
    return summary


def _messages_for(item: dict, pending: dict, chat_cfg=None) -> list:
    chat_cfg = chat_cfg or _CHAT_DEFAULTS
    transcript = list(item['messages']) + [pending]
    cursor = max(0, min(int(item.get('summary_through', 0)), len(item['messages'])))
    context = int(item['context_tokens'])
    response = int(item['reply_tokens'])
    # 0 = auto: reserve a useful response window while keeping older messages
    # in rolling memory. The actual per-call limit uses all remaining context.
    reserve = response if response > 0 else max(1024, min(4096, context // 2))
    budget = context - reserve - chat_cfg['context_reserve']
    if budget < 650:
        raise ValueError('컨텍스트 설정이 답변 길이에 비해 너무 작습니다.')

    def prompt_messages() -> list:
        memory = item.get('summary', '')
        system = item['system_prompt'] + ('\n\n[이전 대화의 압축 기억]\n' + memory if memory else '')
        return [{'role': 'system', 'content': system}] + [
            {'role': m['role'], 'content': m['content'] + (
                '\n[대화 첨부: ' + ', '.join(a['name'] for a in m.get('attachments', [])) + ']'
                if m.get('attachments') else '')}
            for m in transcript[cursor:]]

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
        n = min(chat_cfg['summary_batch_messages'], len(transcript) - 1 - cursor)
        item['summary'] = _summarize(item.get('summary', ''), transcript[cursor:cursor+n], chat_cfg)
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
                'reply_tokens': 0, 'temperature': 0.65,
                'summary': '', 'summary_through': 0, 'messages': []}
        _save(item)
        return _public(item)
    cid = str(body.get('id', ''))
    with _lock(cid):
        item = _read(cid)
        if path == '/api/chat/delete':
            _file(cid).unlink()
            kwt_delete_attachments(cid)
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
            if reply != 0 and not 128 <= reply <= context - 1024:
                raise ValueError(f'답변 길이는 0(자동) 또는 128~{context - 1024} 토큰이어야 합니다.')
            if not 0 <= temperature <= 2:
                raise ValueError('temperature 범위는 0~2입니다.')
            item.update(system_prompt=prompt, context_tokens=context,
                        reply_tokens=reply, temperature=temperature, updated=time.time())
            _save(item)
            return _public(item)
        if path == '/api/chat/send':
            text = str(body.get('text', '')).strip()
            if len(text) > 6000 or (not text and not body.get('attachments')):
                raise ValueError('메시지는 1~6000자이며 파일만 첨부할 수도 있습니다.')
            if len(item.get('messages', [])) >= 10000:
                raise ValueError('대화 기록이 10000개를 넘었습니다. 새 대화를 시작해 주세요.')
            _busy_change(1)
            try:
                chat_cfg = _kwt_chat_runtime()  # one snapshot per send
                selected = body.get('attachments', [])
                attachments, notes, visuals = kwt_prepare_attachments(cid, selected)
                question = text or '첨부 파일을 분석하고 핵심 내용을 한국어로 설명해 줘.'
                pending = {'role': 'user', 'content': question, 'attachments': attachments} if attachments else {'role':'user','content':question}
                prompt = _messages_for(item, pending, chat_cfg)
                if attachments:
                    # Do not persist base64 frames or extracted full documents in the transcript.
                    detail = question + '\n\n[첨부 내용]\n' + notes
                    prompt[-1] = {'role':'user','content': ([{'type':'text','text':detail}] + visuals) if visuals else detail}
                try:
                    answer, generation = _generate_complete(prompt, item, chat_cfg)
                except RuntimeError as exc:
                    if visuals:
                        raise RuntimeError('이미지/영상 분석에는 Gemma의 멀티모달 지원과 모델에 맞는 mmproj가 필요합니다. AI 서버 실행 설정을 확인하세요. 원본 오류: '+str(exc)[:480]) from exc
                    raise
                item['messages'].extend([pending, {'role': 'assistant', 'content': answer,
                                                  'generation': generation}])
                if item['title'] == '새 대화':
                    item['title'] = question[:32].replace('\n', ' ')
                item['updated'] = time.time()
                _save(item)
                return _public(item)
            finally:
                _busy_change(-1)
    raise ValueError('지원하지 않는 채팅 요청입니다.')
