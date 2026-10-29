#!/usr/bin/env python3
"""Exactly two plain-output calls. Isolated diagnostic; no extraction or product writes."""
import base64
import datetime
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import time

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / 'tests/fixtures/groq-eval'
OUT = ROOT / 'artifacts/groq-plain-diagnostic'
BRANCH = 'refs/heads/diagnostic/groq-plain-2026-10-29'


def requests():
    inputs = json.loads((FIX / 'plain-diagnostic.json').read_text())
    asset = json.loads((FIX / 'closure-media.json').read_text())['assets'][0]
    raw = (FIX / asset['path']).read_bytes()
    assert len(raw) == asset['bytes'] and hashlib.sha256(raw).hexdigest() == asset['sha256']
    content = [{'type': 'text', 'text': inputs['vision_prompt']},
               {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(raw).decode()}}]
    cases = []
    for name, model, system, user, output, effort in [
        ('vision', 'qwen/qwen3.8-27b', inputs['vision_system'], content, 650, 'none'),
        ('analysis', 'openai/gpt-oss-120b', inputs['analysis_system'], inputs['analysis_prompt'], 3900, 'low')]:
        text = inputs['vision_prompt'] if name == 'vision' else user
        reserve = len((system + text).encode()) + 512 + output + (2048 if name == 'vision' else 0)
        assert reserve <= 7900, (name, reserve)
        body = {'model': model, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
                'temperature': 0, 'max_completion_tokens': output, 'reasoning_effort': effort,
                'include_reasoning': False, 'stream': False}
        cases.append((name, body, reserve, asset if name == 'vision' else None))
    return cases


def run():
    assert os.environ.get('GITHUB_REPOSITORY') == 'MawrikBorug/kadr-video-lab'
    assert os.environ.get('GITHUB_REF') == BRANCH
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    secret = os.environ.get('GROQ_API_KEY', '')
    assert re.fullmatch(r'[A-Za-z0-9_-]{16,1024}', secret), 'Missing/invalid secret'
    spec = importlib.util.spec_from_file_location('groq_probe', ROOT / 'scripts/groq-probe.py')
    probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
    planned = requests()  # Preflight BOTH before any API request.
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'accepted_quality': False, 'actual_product_publication': False, 'attempted_requests': 0,
              'maximum_requests': 2, 'maximum_reserved_tokens': sum(r for _, _, r, _ in planned),
              'git_sha': os.environ.get('GITHUB_SHA'), 'run_id': os.environ.get('GITHUB_RUN_ID'), 'requests': []}
    def save():
        (OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    save(); last = None
    for name, body, reserve, asset in planned:
        if last is not None:
            while time.monotonic() < last + 65:
                time.sleep(min(5, last + 65 - time.monotonic()))
        # Preserve exact prompts/parameters without embedding pixels or credentials.
        public_body = json.loads(json.dumps(body))
        if asset:
            public_body['messages'][1]['content'][1]['image_url']['url'] = 'LOCAL_JPEG_SHA256:' + asset['sha256']
        (OUT / (name + '-request.json')).write_text(json.dumps(public_body, ensure_ascii=False, indent=2))
        entry = {'case': name, 'model': body['model'], 'reserved_tokens': reserve,
                 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        report['requests'].append(entry)
        conn = None
        try:
            conn = http.client.HTTPSConnection('api.groq.com', timeout=45, context=ssl.create_default_context())
            last = time.monotonic(); report['attempted_requests'] += 1; save()
            conn.request('POST', '/openai/v1/chat/completions', body=json.dumps(body).encode(), headers={
                'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json',
                'Accept': 'application/json', 'User-Agent': 'KADR-Groq-Plain-Diagnostic/1'})
            response = conn.getresponse(); entry['status'] = response.status
            entry['quota_headers'] = probe.safe_headers(response)
            if response.status != 200:
                entry['outcome'] = 'HTTP_ERROR_STOP_NO_RETRY'; break
            raw = response.read(131073)
            if len(raw) > 131072:
                entry['outcome'] = 'RESPONSE_TOO_LARGE_STOP'; break
            data = json.loads(raw)  # API envelope only; generated prose is NEVER JSON-parsed.
            entry['returned_model'] = data.get('model')
            usage = data.get('usage', {})
            entry['usage'] = {k: v for k, v in usage.items() if k in ('prompt_tokens', 'completion_tokens', 'total_tokens') and probe.counter(v) is not None}
            details = usage.get('completion_tokens_details', {})
            if probe.counter(details.get('reasoning_tokens')) is not None:
                entry['usage']['reasoning_tokens'] = details['reasoning_tokens']
            choice = data['choices'][0]; entry['finish_reason'] = choice.get('finish_reason')
            text = choice['message']['content']
            assert isinstance(text, str) and len(text) <= 48000
            sanitized = re.sub(r'gsk_[A-Za-z0-9_-]+', '[REDACTED]', text.replace(secret, '[REDACTED]'))
            entry['secret_redaction_applied'] = sanitized != text
            entry['response_sha256_utf8'] = hashlib.sha256(sanitized.encode()).hexdigest()
            (OUT / (name + '-response.md')).write_text(sanitized)
            entry['outcome'] = 'RESPONSE_SAVED_PENDING_REVIEW'
            if entry['returned_model'] != body['model']:
                entry['outcome'] = 'MODEL_MISMATCH_STOP'; break
        except Exception as exc:
            entry['outcome'] = 'OUTCOME_UNCERTAIN_STOP_NO_RETRY'
            entry['error_type'] = type(exc).__name__; break
        finally:
            entry['latency_ms'] = round((time.monotonic() - last) * 1000) if last else None
            if conn: conn.close()
            save()


if __name__ == '__main__':
    run()
