"""Regression tests for top-level LLM retry pacing."""

import asyncio

import shinka.llm.llm as llm_module
from shinka.llm.constants import MAX_RETRIES
from shinka.llm.llm import AsyncLLMClient, LLMClient


def test_sync_query_sleeps_between_transient_failures(monkeypatch):
    calls = 0
    sleeps = []

    def always_fails(**kwargs):
        nonlocal calls
        calls += 1
        raise RuntimeError("transient failure")

    monkeypatch.setattr(llm_module, "query", always_fails)
    monkeypatch.setattr(llm_module.time, "sleep", lambda seconds: sleeps.append(seconds))
    client = LLMClient(model_names="test-model", verbose=False)

    result = client.query("msg", "sys", llm_kwargs={"model_name": "test-model"})

    assert result is None
    assert calls == MAX_RETRIES
    # Backoff gives a lost worker connection time to reconnect.
    expected = [llm_module.RETRY_BACKOFF_SECONDS[min(i, len(llm_module.RETRY_BACKOFF_SECONDS) - 1)]
                for i in range(MAX_RETRIES - 1)]
    assert sleeps == expected


def test_async_query_sleeps_between_transient_failures(monkeypatch):
    calls = 0
    sleeps = []

    async def always_fails(**kwargs):
        nonlocal calls
        calls += 1
        raise RuntimeError("transient failure")

    async def record_sleep(seconds):
        sleeps.append(seconds)

    monkeypatch.setattr(llm_module, "query_async", always_fails)
    monkeypatch.setattr(llm_module.asyncio, "sleep", record_sleep)
    client = AsyncLLMClient(model_names="test-model", verbose=False)

    result = asyncio.run(
        client.query("msg", "sys", llm_kwargs={"model_name": "test-model"})
    )

    assert result is None
    assert calls == MAX_RETRIES
    # Backoff gives a lost worker connection time to reconnect.
    expected = [llm_module.RETRY_BACKOFF_SECONDS[min(i, len(llm_module.RETRY_BACKOFF_SECONDS) - 1)]
                for i in range(MAX_RETRIES - 1)]
    assert sleeps == expected
