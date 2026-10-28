"""KWT_PRIVATE_NATIVE_TOOL_BRIDGE_V2_9_2: defensive Gemma 4 tool-call parser.

Fallback for a *single, complete*, model-generated native Gemma tool-call turn
that llama.cpp returned as ordinary content. Never guess malformed fragments.
The caller applies its enabled tool allowlist and the local_files root checks.
"""
from __future__ import annotations
import json
import re

# Model output is UNTRUSTED. It is never a shell command or a Python expression.
_CALL = re.compile(
    r'\A<\|tool_call>call:([a-z][a-z0-9_]*)\{([^{}\r\n]{0,1200})\}'
    r'(?:<tool_call\|>|<\|tool_call>|<\|tool_call\|>)\Z', re.I)
_STRING = re.compile(r'<\|"\|>([^\r\n]*?)<\|"\|>')
_KEY = re.compile(r'([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)')
_TOKENS = ('<|tool_call>', '<tool_call|>', '<|tool_response>', '<tool_response|>',
           '<|channel>', '<channel|>', '<|turn>', '<turn|>')


def has_marker(content: str) -> bool:
    return isinstance(content, str) and any(tag in content for tag in _TOKENS)


def _strict_object(pairs):
    d = {}
    for k,v in pairs:
        if k in d: raise ValueError('Duplicate argument key')
        d[k]=v
    return d


def recover(content: str, enabled_names: set[str], ordinal: int) -> list[dict]:
    """Recover exactly one tool call; reject mixed content and unknown tools."""
    if not isinstance(content, str) or len(content) > 1600:
        return []
    match = _CALL.fullmatch(content.strip())
    if not match:
        return []
    name, body = match.groups()
    if name not in enabled_names:
        return []
    try:
        # Gemma 4's <|"|> is a special string delimiter rather than JSON quotes.
        body = _STRING.sub(lambda m: json.dumps(m.group(1), ensure_ascii=False), body)
        if '<|' in body or '|>' in body:
            return []
        encoded = _KEY.sub(r'\1"\2"\3','{'+body+'}')
        args=json.loads(encoded, object_pairs_hook=_strict_object)
        if not isinstance(args, dict) or len(args)>12:
            return []
        return [{'id':f'kwt-native-{ordinal}', 'type':'function',
                 'function':{'name':name,'arguments':json.dumps(args,ensure_ascii=False)}}]
    except (ValueError, TypeError):
        return []
