#!/usr/bin/env python3
"""One synthetic Groq POST. Never emit provider bodies or exception text."""

import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import time

HOST = "api.groq.com"
ENDPOINT = "/openai/v1/chat/completions"
MODEL = "openai/gpt-oss-120b"
MAX_BODY = 65536
MAX_COUNTER = 1_000_000_000
REPORT_PATH = Path("artifacts/groq-probe/report.json")
NUMERIC_HEADERS = (
    "x-ratelimit-limit-requests", "x-ratelimit-remaining-requests",
    "x-ratelimit-limit-tokens", "x-ratelimit-remaining-tokens",
)
RESET_HEADERS = ("x-ratelimit-reset-requests", "x-ratelimit-reset-tokens")
PAYLOAD = {
    "model": MODEL,
    "messages": [{"role": "user", "content": "Return the single word OK."}],
    "temperature": 0,
    "max_completion_tokens": 128,
    "reasoning_effort": "low",
    "include_reasoning": False,
    "stream": False,
}


def counter(value):
    return value if type(value) is int and 0 <= value <= MAX_COUNTER else None


def safe_headers(response):
    result = {}
    for name in NUMERIC_HEADERS:
        value = response.getheader(name)
        if isinstance(value, str) and re.fullmatch(r"[0-9]{1,10}", value):
            parsed = int(value)
            if parsed <= MAX_COUNTER:
                result[name] = parsed
    retry = response.getheader("retry-after")
    if isinstance(retry, str) and re.fullmatch(r"[0-9]{1,6}", retry):
        result["retry-after-seconds"] = int(retry)
    for name in RESET_HEADERS:
        value = response.getheader(name)
        # Numeric durations only. Never pass arbitrary header strings through.
        if isinstance(value, str) and len(value) <= 32 and re.fullmatch(
                r"(?:[0-9]{1,6}(?:\.[0-9]{1,6})?(?:ms|s|m|h)){1,4}", value):
            result[name] = value
    return result


def base_report():
    return {
        "schema": "kadr.groq-access-probe.v1",
        "model": MODEL,
        "classification": "NOT_RUN",
        "attempted_requests": 0,
        "http_status": None,
        "latency_ms": None,
        "quota_headers": {},
        "usage": {},
        "response_shape_valid": False,
        "finish_reason": None,
        "content_quality": "NOT_EVALUATED",
        "account_limits_and_zdr": "NOT_VERIFIED",
    }


def probe(secret, connection_factory=http.client.HTTPSConnection, clock=time.monotonic):
    report = base_report()
    if not isinstance(secret, str) or not secret:
        report["classification"] = "NOT_RUN_MISSING_SECRET"
        return report
    if len(secret) > 1024 or not re.fullmatch(r"[A-Za-z0-9_-]{16,1024}", secret):
        report["classification"] = "NOT_RUN_INVALID_SECRET_FORMAT"
        return report
    connection = None
    started = clock()
    try:
        # HTTPSConnection uses certificate verification. It does not follow redirects,
        # use HTTP(S)_PROXY, or forward the Authorization header to another origin.
        connection = connection_factory(HOST, timeout=30, context=ssl.create_default_context())
        report["attempted_requests"] = 1
        connection.request("POST", ENDPOINT, body=json.dumps(PAYLOAD).encode("utf-8"), headers={
            "Authorization": "Bearer " + secret,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "KADR-Groq-Access-Probe/1",
        })
        response = connection.getresponse()
        status = response.status
        if type(status) is not int or not 100 <= status <= 599:
            report["classification"] = "INVALID_HTTP_STATUS"
            return report
        report["http_status"] = status
        report["quota_headers"] = safe_headers(response)
        if 300 <= status <= 399:
            report["classification"] = "REDIRECT_REJECTED"
        elif status == 401:
            report["classification"] = "UNAUTHORIZED"
        elif status == 403:
            report["classification"] = "FORBIDDEN"
        elif status == 429:
            report["classification"] = "RATE_LIMITED"
        elif status != 200:
            report["classification"] = "HTTP_ERROR"
        else:
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                report["classification"] = "RESPONSE_TOO_LARGE"
                return report
            try:
                data = json.loads(raw)
            except (ValueError, UnicodeError):
                report["classification"] = "INVALID_RESPONSE"
                return report
            if not isinstance(data, dict) or data.get("model") != MODEL:
                report["classification"] = "INVALID_RESPONSE"
                return report
            usage = data.get("usage")
            if isinstance(usage, dict):
                for name in ("prompt_tokens", "completion_tokens", "total_tokens"):
                    value = counter(usage.get(name))
                    if value is not None:
                        report["usage"][name] = value
                details = usage.get("completion_tokens_details")
                value = counter(details.get("reasoning_tokens")) if isinstance(details, dict) else None
                if value is not None:
                    report["usage"]["reasoning_tokens"] = value
            choices = data.get("choices")
            if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
                report["classification"] = "INVALID_RESPONSE"
                return report
            choice = choices[0]
            message = choice.get("message")
            if not isinstance(message, dict) or not isinstance(message.get("content"), str):
                report["classification"] = "INVALID_RESPONSE"
                return report
            finish = choice.get("finish_reason")
            if finish in ("stop", "length", "content_filter", "tool_calls"):
                report["finish_reason"] = finish
            report["response_shape_valid"] = True
            report["classification"] = "ACCESS_CONFIRMED" if finish == "stop" else "ACCESS_CONFIRMED_INCOMPLETE"
    except (TimeoutError, socket.timeout):
        report["classification"] = "OUTCOME_UNKNOWN_TIMEOUT"
    except ssl.SSLError:
        report["classification"] = "TLS_ERROR"
    except (OSError, http.client.HTTPException):
        report["classification"] = "OUTCOME_UNKNOWN_TRANSPORT"
    except Exception:
        # No str(exc), repr(exc), traceback or provider content in any output.
        report["classification"] = "INTERNAL_ERROR"
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
        report["latency_ms"] = max(0, min(3_600_000, int((clock() - started) * 1000)))
    return report


def main():
    secret = os.environ.pop("GROQ_API_KEY", None)
    report = probe(secret)
    secret = None
    safe_json = json.dumps(report, indent=2, sort_keys=True) + "\n"
    try:
        REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
        REPORT_PATH.write_text(safe_json, encoding="utf-8")
    except Exception:
        print("REPORT_WRITE_FAILED")
        return 1
    print(safe_json, end="")
    return 0 if report["classification"] == "ACCESS_CONFIRMED" else 1


if __name__ == "__main__":
    try:
        exit_code = main()
    except Exception:
        print("PROBE_INTERNAL_ERROR_NO_DETAILS")
        exit_code = 1
    raise SystemExit(exit_code)
