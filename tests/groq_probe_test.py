"""Safety checks with fake transport only: importing never starts inference."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("groq_probe", Path(__file__).parents[1] / "scripts/groq-probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
SENTINEL = "gsk_SYNTHETIC_TEST_SECRET_ONLY_123456"


class Response:
    def __init__(self, status=200, body=None, headers=None):
        self.status = status
        self.body = body if body is not None else json.dumps({
            "model": probe.MODEL,
            "choices": [{"message": {"content": SENTINEL}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6},
        }).encode()
        self.headers = headers or {}
        self.reads = []

    def getheader(self, name):
        return self.headers.get(name)

    def read(self, maximum):
        self.reads.append(maximum)
        return self.body[:maximum]


class Connection:
    def __init__(self, response=None, error=None):
        self.response = response or Response()
        self.error = error
        self.requests = []
        self.closed = False

    def request(self, *args, **kwargs):
        self.requests.append((args, kwargs))
        if self.error:
            raise self.error

    def getresponse(self):
        return self.response

    def close(self):
        self.closed = True


class ProbeTest(unittest.TestCase):
    def call(self, response=None, error=None, secret=SENTINEL):
        self.connection = Connection(response, error)
        self.hosts = []
        def factory(host, **kwargs):
            self.hosts.append((host, kwargs))
            return self.connection
        report = probe.probe(secret, factory)
        self.assertNotIn(SENTINEL, json.dumps(report))
        return report

    def test_success_one_fixed_https_request(self):
        report = self.call()
        self.assertEqual(report["classification"], "ACCESS_CONFIRMED")
        self.assertEqual(report["usage"]["total_tokens"], 6)
        self.assertEqual(len(self.connection.requests), 1)
        self.assertEqual(self.hosts[0][0], "api.groq.com")
        self.assertTrue(self.hosts[0][1]["context"].check_hostname)
        args, kwargs = self.connection.requests[0]
        self.assertEqual(args, ("POST", "/openai/v1/chat/completions"))
        self.assertEqual(json.loads(kwargs["body"]), probe.PAYLOAD)
        self.assertTrue(self.connection.closed)

    def test_missing_key_no_network(self):
        report = self.call(secret=None)
        self.assertEqual(report["classification"], "NOT_RUN_MISSING_SECRET")
        self.assertEqual(report["attempted_requests"], 0)
        self.assertEqual(self.hosts, [])

    def test_invalid_key_no_network(self):
        for value in ("short", "x" * 2000, "bad\r\nheader", "bad key with spaces"):
            report = self.call(secret=value)
            self.assertEqual(report["attempted_requests"], 0)
            self.assertEqual(self.hosts, [])

    def test_redirect_never_followed_or_read(self):
        response = Response(307, headers={"location": "https://evil.invalid/" + SENTINEL})
        report = self.call(response)
        self.assertEqual(report["classification"], "REDIRECT_REJECTED")
        self.assertEqual(len(self.connection.requests), 1)
        self.assertEqual(response.reads, [])

    def test_failures_no_body_or_retry(self):
        for status, expected in ((401, "UNAUTHORIZED"), (403, "FORBIDDEN"), (429, "RATE_LIMITED"), (402, "HTTP_ERROR"), (500, "HTTP_ERROR")):
            response = Response(status)
            report = self.call(response)
            self.assertEqual(report["classification"], expected)
            self.assertEqual(response.reads, [])
            self.assertEqual(len(self.connection.requests), 1)

    def test_timeout_unknown_no_retry_or_exception_text(self):
        report = self.call(error=TimeoutError(SENTINEL))
        self.assertEqual(report["classification"], "OUTCOME_UNKNOWN_TIMEOUT")
        self.assertEqual(len(self.connection.requests), 1)

    def test_other_error_no_exception_text(self):
        report = self.call(error=RuntimeError(SENTINEL))
        self.assertEqual(report["classification"], "INTERNAL_ERROR")

    def test_quota_header_allowlist_and_strict_values(self):
        report = self.call(Response(headers={
            "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": SENTINEL,
            "x-ratelimit-limit-requests": "999999999999999999", "x-ratelimit-remaining-requests": "28",
            "x-ratelimit-reset-requests": "1m2.5s", "x-ratelimit-reset-tokens": SENTINEL,
            "retry-after": "5", "authorization": SENTINEL, "location": SENTINEL,
        }))
        self.assertEqual(report["quota_headers"], {
            "x-ratelimit-limit-tokens": 8000, "x-ratelimit-remaining-requests": 28,
            "x-ratelimit-reset-requests": "1m2.5s", "retry-after-seconds": 5,
        })

    def test_usage_rejects_bool_negative_string_and_large_values(self):
        data = {"model": probe.MODEL, "choices": [{"message": {"content": SENTINEL}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": True, "completion_tokens": -1, "total_tokens": SENTINEL,
                          "completion_tokens_details": {"reasoning_tokens": 10**30}}}
        self.assertEqual(self.call(Response(body=json.dumps(data).encode()))["usage"], {})

    def test_bounded_body(self):
        response = Response(body=b"x" * (probe.MAX_BODY + 2))
        self.assertEqual(self.call(response)["classification"], "RESPONSE_TOO_LARGE")
        self.assertEqual(response.reads, [probe.MAX_BODY + 1])

    def test_bad_json_and_untrusted_model_not_echoed(self):
        for body in (SENTINEL.encode(), b"[]", json.dumps({"model": SENTINEL}).encode()):
            self.assertEqual(self.call(Response(body=body))["classification"], "INVALID_RESPONSE")

    def test_token_cap_is_not_quality_pass(self):
        data = {"model": probe.MODEL, "choices": [{"message": {"content": SENTINEL}, "finish_reason": "length"}]}
        report = self.call(Response(body=json.dumps(data).encode()))
        self.assertEqual(report["classification"], "ACCESS_CONFIRMED_INCOMPLETE")
        self.assertEqual(report["content_quality"], "NOT_EVALUATED")


if __name__ == "__main__":
    unittest.main()
