#!/usr/bin/env python3
"""One synthetic Gemini POST. Never emit provider bodies or exception text."""

import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import time

HOST = "generativelanguage.googleapis.com"
MODEL = "gemini-3.5-flash-lite"
ENDPOINT = "/v1beta/models/" + MODEL + ":generateContent"
MAX_BODY = 65536
MAX_COUNTER = 1_000_000_000
REPORT_PATH = Path("artifacts/gemini-probe/report.json")
PAYLOAD = {
    "contents": [{"role": "user", "parts": [{"text": "Return the single word OK."}]}],
    "generationConfig": {"candidateCount": 1, "maxOutputTokens": 64},
}


def counter(value):
    return value if type(value) is int and 0 <= value <= MAX_COUNTER else None


def safe_headers(response):
    result = {}
    retry = response.getheader("retry-after")
    if isinstance(retry, str) and re.fullmatch(r"[0-9]{1,6}", retry):
        result["retry-after-seconds"] = int(retry)
    return result


def base_report():
    return {
        "schema": "kadr.gemini-access-probe.v1",
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
        "account_limits_and_data_policy": "NOT_VERIFIED",
        "regional_contractual_eligibility": "NOT_VERIFIED",
        "response_model_matches_request": False,
    }


def probe(secret, connection_factory=http.client.HTTPSConnection, clock=time.monotonic):
    report = base_report()
    if not isinstance(secret, str) or not secret:
        report["classification"] = "NOT_RUN_MISSING_SECRET"
        return report
    if len(secret) > 1024 or not re.fullmatch(r"[A-Za-z0-9_.-]{16,1024}", secret):
        report["classification"] = "NOT_RUN_INVALID_SECRET_FORMAT"
        return report
    connection = None
    started = clock()
    try:
        # HTTPSConnection uses certificate verification. It does not follow redirects,
        # use HTTP(S)_PROXY, or forward x-goog-api-key to another origin.
        connection = connection_factory(HOST, timeout=30, context=ssl.create_default_context())
        report["attempted_requests"] = 1
        connection.request("POST", ENDPOINT, body=json.dumps(PAYLOAD).encode("utf-8"), headers={
            "x-goog-api-key": secret,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "KADR-Gemini-Access-Probe/1",
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
            if not isinstance(data, dict):
                report["classification"] = "INVALID_RESPONSE"
                return report
            version = data.get("modelVersion")
            if not isinstance(version, str) or not re.fullmatch(re.escape(MODEL) + r"(?:-[0-9]{1,4}){0,3}", version):
                report["classification"] = "INVALID_RESPONSE_MODEL"
                return report
            report["response_model_matches_request"] = True
            usage = data.get("usageMetadata")
            if isinstance(usage, dict):
                for name in ("promptTokenCount", "candidatesTokenCount", "totalTokenCount", "thoughtsTokenCount", "cachedContentTokenCount"):
                    value = counter(usage.get(name))
                    if value is not None:
                        report["usage"][name] = value
            feedback = data.get("promptFeedback")
            if isinstance(feedback, dict) and feedback.get("blockReason") in ("SAFETY", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "IMAGE_SAFETY"):
                report["classification"] = "GENERATION_BLOCKED"
                return report
            choices = data.get("candidates")
            if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
                report["classification"] = "INVALID_RESPONSE"
                return report
            choice = choices[0]
            finish = choice.get("finishReason")
            if finish not in ("STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "MALFORMED_FUNCTION_CALL"):
                report["classification"] = "INVALID_RESPONSE"
                return report
            report["finish_reason"] = finish
            content = choice.get("content")
            parts = content.get("parts") if isinstance(content, dict) else None
            has_text = isinstance(parts, list) and any(isinstance(p, dict) and isinstance(p.get("text"), str) and bool(p["text"]) and p.get("thought") is not True for p in parts)
            if finish == "STOP" and not has_text:
                report["classification"] = "INVALID_RESPONSE"
                return report
            report["response_shape_valid"] = True
            report["classification"] = "ACCESS_CONFIRMED" if finish == "STOP" else "ACCESS_CONFIRMED_INCOMPLETE"
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
    secret = os.environ.pop("GEMINI_API_KEY", None)
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
