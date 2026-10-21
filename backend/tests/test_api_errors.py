import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("TAVILY_API_KEY", "test-tavily-key")
os.environ.setdefault("MODEL", "llama-3.1-8b-instant")

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1] / "src"),
)

from fastapi.testclient import TestClient
from groq import APIConnectionError, RateLimitError
from tavily.errors import UsageLimitExceededError

import app.main as main


def make_groq_response(status_code: int) -> httpx.Response:
    request = httpx.Request(
        "POST",
        "https://api.groq.com/openai/v1/chat/completions",
    )
    return httpx.Response(status_code, request=request)


class ProviderErrorHandlingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(
            main.app,
            raise_server_exceptions=False,
        )
        self.payload = {"topic": "The impact of AI agents"}

    def test_successful_research_response_is_unchanged(self) -> None:
        interrupt = SimpleNamespace(
            value={
                "report": "# Report",
                "message": "Report is waiting for human review.",
            }
        )

        with patch.object(
            main.report_graph,
            "invoke",
            return_value={"__interrupt__": [interrupt]},
        ):
            response = self.client.post(
                "/research",
                json=self.payload,
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "awaiting_review")
        self.assertEqual(body["report"], "# Report")

    def test_groq_rate_limit_returns_sanitized_429(self) -> None:
        error = RateLimitError(
            "rate limited for key test-groq-key",
            response=make_groq_response(429),
            body=None,
        )

        with patch.object(
            main.report_graph,
            "invoke",
            side_effect=error,
        ):
            response = self.client.post(
                "/research",
                json=self.payload,
            )

        self.assertEqual(response.status_code, 429)
        detail = response.json()["detail"]
        self.assertIn("quota", detail.lower())
        self.assertNotIn("test-groq-key", detail)

    def test_tavily_usage_limit_returns_429(self) -> None:
        with patch.object(
            main.report_graph,
            "invoke",
            side_effect=UsageLimitExceededError("quota exceeded"),
        ):
            response = self.client.post(
                "/research",
                json=self.payload,
            )

        self.assertEqual(response.status_code, 429)
        self.assertIn("quota", response.json()["detail"].lower())

    def test_groq_connection_error_returns_502(self) -> None:
        error = APIConnectionError(
            request=httpx.Request(
                "POST",
                "https://api.groq.com/openai/v1/chat/completions",
            ),
        )

        with patch.object(
            main.report_graph,
            "invoke",
            side_effect=error,
        ):
            response = self.client.post(
                "/research",
                json=self.payload,
            )

        self.assertEqual(response.status_code, 502)

    def test_unexpected_error_is_not_reported_as_success(self) -> None:
        with patch.object(
            main.report_graph,
            "invoke",
            side_effect=RuntimeError("internal detail"),
        ):
            response = self.client.post(
                "/research",
                json=self.payload,
            )

        self.assertEqual(response.status_code, 500)
        self.assertNotIn(
            "internal detail",
            response.json()["detail"],
        )


if __name__ == "__main__":
    unittest.main()
