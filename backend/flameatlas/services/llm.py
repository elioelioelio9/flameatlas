"""Thin LLM client (Anthropic or OpenAI) using only the standard library.

The model is used to *phrase* answers from passages and numbers that the application has already
retrieved and computed. If no key is configured or the call fails, Fire Lab falls back to a
deterministic extractive answer, so the product never depends on the API being up.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from ..config import settings


class LLMError(RuntimeError):
    pass


def _post(url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"content-type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=settings.llm_timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # pragma: no cover - network
        raise LLMError(f"HTTP {e.code}: {e.read()[:300]!r}") from e
    except Exception as e:  # pragma: no cover - network
        raise LLMError(str(e)) from e


def complete(system: str, user: str, max_tokens: int = 900) -> tuple[str, str]:
    """Return (text, model_id). Raises LLMError if no provider is configured or the call fails."""
    provider = settings.active_llm
    if provider == "anthropic":
        data = _post(
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01"},
            {"model": settings.anthropic_model, "max_tokens": max_tokens, "system": system,
             "messages": [{"role": "user", "content": user}]},
        )
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        return text.strip(), data.get("model", settings.anthropic_model)
    if provider == "openai":
        data = _post(
            "https://api.openai.com/v1/chat/completions",
            {"authorization": f"Bearer {settings.openai_api_key}"},
            {"model": settings.openai_model, "max_tokens": max_tokens, "temperature": 0.1,
             "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        )
        return data["choices"][0]["message"]["content"].strip(), data.get("model", settings.openai_model)
    raise LLMError("No LLM provider configured")
