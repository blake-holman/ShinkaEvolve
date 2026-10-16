"""Regression tests for failures seen in the October 2026 Lean run."""

import json

from shinka.core.async_runner import response_patch_type
from shinka.core.workers import current_worker
from shinka.edit.apply_diff import apply_diff_patch
from shinka.edit.apply_full import apply_full_patch
from shinka.llm.llm import restrict_to_worker_agents
from shinka.llm.providers.headless import _parse_stdout

LEAN_PARENT = """import Foo
-- EVOLVE-BLOCK-START
-- SHINKA-LIBRARY abc
def a := 1

def b := 2
-- EVOLVE-BLOCK-END
"""


def test_headless_output_keeps_blank_lines():
    usage = json.dumps({"usage": {"totalTokens": 3}})
    content, parsed = _parse_stdout(f"line one\n\nline three\n\n{usage}\n")
    assert content == "line one\n\nline three"
    assert parsed == {"totalTokens": 3}


def test_search_with_blank_line_applies_after_parsing():
    usage = json.dumps({"usage": {}})
    response = (
        "<NAME>x</NAME>\n<DIFF>\n<<<<<<< SEARCH\ndef a := 1\n\ndef b := 2\n=======\n"
        "def a := 1\n\ndef b := 3\n>>>>>>> REPLACE\n</DIFF>\n"
    )
    content, _ = _parse_stdout(response + usage)
    updated, applied, *_rest = apply_diff_patch(patch_str=content, original_str=LEAN_PARENT, language="lean", verbose=False)
    assert applied == 1 and "def b := 3" in updated


def test_response_patch_type_follows_the_answer():
    full = "<NAME>n</NAME><CODE>```lean\nx\n```</CODE>"
    diff = "<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE"
    assert response_patch_type(full, "diff") == "full"
    assert response_patch_type(full, "cross") == "cross"
    assert response_patch_type(diff, "full") == "diff"
    assert response_patch_type("plain text", "diff") == "diff"


def test_full_rewrite_keeps_lean_marker_prefix():
    patch = "```lean\nimport Foo\n-- EVOLVE-BLOCK-START\n-- SHINKA-LIBRARY abc\ndef a := 5\n-- EVOLVE-BLOCK-END\n```"
    updated, applied, *_rest = apply_full_patch(patch_str=patch, original_str=LEAN_PARENT, language="lean", verbose=False)
    assert applied == 1
    assert "-- EVOLVE-BLOCK-END" in updated and "\n EVOLVE-BLOCK-END" not in updated
    assert "def a := 5" in updated and "SHINKA-LIBRARY abc" in updated


class _Lease:
    def __init__(self, agents):
        self.worker = {"name": "w", "agents": agents}


def test_worker_agent_allowlist_masks_models():
    names = ["headless/codex@gpt", "headless/claude@opus", "plain-model"]
    token = current_worker.set(_Lease(["codex"]))
    try:
        probs = restrict_to_worker_agents(names, [0.5, 0.25, 0.25])
    finally:
        current_worker.reset(token)
    assert probs == [2 / 3, 0.0, 1 / 3]
    assert restrict_to_worker_agents(names, [0.5, 0.25, 0.25]) == [0.5, 0.25, 0.25]
    token = current_worker.set(_Lease(["gemini"]))
    try:
        # Excluding every Headless model leaves the plain model; excluding all models changes nothing.
        assert restrict_to_worker_agents(names[:2], [0.5, 0.5]) == [0.5, 0.5]
    finally:
        current_worker.reset(token)


def test_local_worker_runs_inside_memory_limited_scope(tmp_path):
    import asyncio
    import shutil
    import subprocess
    import sys

    import pytest

    from shinka.core.workers import WorkerPool

    if shutil.which("systemd-run") is None or subprocess.run(
        ["systemd-run", "--user", "--scope", "--quiet", "--collect", "true"], capture_output=True
    ).returncode:
        pytest.skip("no systemd user session")

    class Model:
        agent_model = "m"
        effort = "e"
        agent = "codex"

    async def scenario():
        pool = WorkerPool([{"name": "local", "memory_max": "512M"}], {}, tmp_path)
        await pool.prepare()
        try:
            async with pool.acquire(tmp_path / "gen_1") as lease:
                script = "print(open('/proc/self/cgroup').read().strip())"
                result = await lease.run_headless(Model(), [sys.executable, "-c", script], 60)
                return result
        finally:
            await pool.close()

    result = asyncio.run(scenario())
    assert result.returncode == 0
    assert ".scope" in result.stdout


def test_local_memory_slice_groups_slot_scopes():
    import pytest

    from shinka.core.workers import local_endpoint_command, validate_worker_config

    command = local_endpoint_command({"name": "local", "memory_max": "14G",
                                      "memory_slice": "shinka-agents.slice"})
    assert "--slice=shinka-agents.slice" in command
    assert "MemoryMax=14G" in command
    for bad in ({"name": "local", "memory_slice": "shinka-agents.slice"},
                {"name": "local", "memory_max": "14G", "memory_slice": "../x"}):
        with pytest.raises(ValueError):
            validate_worker_config([bad], {})
