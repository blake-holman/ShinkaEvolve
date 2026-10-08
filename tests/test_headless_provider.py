from __future__ import annotations

import json
import shlex
import stat
import sys
import asyncio
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from shinka.cli import run as cli_run
from shinka.core.async_runner import ShinkaEvolveRunner
from shinka.llm.client import get_async_client_llm, get_client_llm
from shinka.llm.kwargs import sample_model_kwargs
from shinka.llm.providers.headless import (
    _build_headless_command,
    parse_headless_model,
    query_headless,
    query_headless_async,
)
from shinka.llm.providers.model_resolver import resolve_model_backend
from shinka.model_availability import validate_model_env_access


def _make_fake_headless(tmp_path: Path) -> Path:
    script = tmp_path / "fake_headless.py"
    script.write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "import json",
                "import sys",
                "from pathlib import Path",
                "",
                "if '--check' in sys.argv:",
                "    raise SystemExit(0)",
                "",
                "prompt_path = Path(sys.argv[sys.argv.index('--prompt-file') + 1])",
                "work_dir = Path(sys.argv[sys.argv.index('--work-dir') + 1])",
                "assert prompt_path.exists(), prompt_path",
                "assert work_dir.exists(), work_dir",
                "print('<NAME>')",
                "print('raise_score')",
                "print('</NAME>')",
                "print('<DESCRIPTION>')",
                "print('Deterministic fake headless mutation.')",
                "print('</DESCRIPTION>')",
                "print('<CODE>')",
                "print('```python')",
                "print('# EVOLVE-BLOCK-START')",
                "print('def score():')",
                "print('    return 1.0')",
                "print('# EVOLVE-BLOCK-END')",
                "print('```')",
                "print('</CODE>')",
                "print(json.dumps({'usage': {'input_tokens': 11, 'output_tokens': 13, 'thinking_tokens': 0, 'cost': 0.0}}))",
            ]
        ),
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


def _fake_headless_command(script: Path) -> str:
    return f"{shlex.quote(sys.executable)} {shlex.quote(str(script))}"


def _make_task_dir(tmp_path: Path) -> Path:
    task_dir = tmp_path / "headless_task"
    task_dir.mkdir()
    (task_dir / "initial.py").write_text(
        "\n".join(
            [
                "# EVOLVE-BLOCK-START",
                "def score():",
                "    return 0.0",
                "# EVOLVE-BLOCK-END",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (task_dir / "evaluate.py").write_text(
        "\n".join(
            [
                "from __future__ import annotations",
                "",
                "import argparse",
                "import importlib.util",
                "import json",
                "from pathlib import Path",
                "",
                "def _load(path):",
                "    spec = importlib.util.spec_from_file_location('program', path)",
                "    module = importlib.util.module_from_spec(spec)",
                "    spec.loader.exec_module(module)",
                "    return module",
                "",
                "def main(program_path: str, results_dir: str):",
                "    score = float(_load(program_path).score())",
                "    Path(results_dir).mkdir(parents=True, exist_ok=True)",
                "    Path(results_dir, 'metrics.json').write_text(json.dumps({'combined_score': score, 'public': {'score': score}, 'private': {}}))",
                "    Path(results_dir, 'correct.json').write_text(json.dumps({'correct': True, 'error': ''}))",
                "",
                "if __name__ == '__main__':",
                "    parser = argparse.ArgumentParser()",
                "    parser.add_argument('--program_path', required=True)",
                "    parser.add_argument('--results_dir', required=True)",
                "    args = parser.parse_args()",
                "    main(args.program_path, args.results_dir)",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return task_dir


def test_parse_headless_model_with_model_and_effort():
    parsed = parse_headless_model("headless/opencode@openai/gpt-5.4?effort=high")

    assert parsed.agent == "opencode"
    assert parsed.agent_model == "openai/gpt-5.4"
    assert parsed.effort == "high"


def test_resolve_headless_model_backend():
    resolved = resolve_model_backend("headless/codex@gpt-5.5?effort=high")

    assert resolved.provider == "headless"
    assert resolved.api_model_name == "headless/codex@gpt-5.5?effort=high"
    assert resolved.base_url is None


def test_headless_command_accepts_yolo_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", "headless")
    prompt = tmp_path / "prompt.md"
    prompt.write_text("test", encoding="utf-8")

    command = _build_headless_command(
        model=parse_headless_model("headless/claude"),
        prompt_path=prompt,
        work_dir=str(tmp_path),
        allow="yolo",
    )

    assert command[command.index("--allow") + 1] == "yolo"


@pytest.mark.parametrize("model", ["headless/claude", "gpt-5.1"])
def test_initial_program_scopes_work_dir_to_headless(tmp_path, model):
    query = AsyncMock(side_effect=RuntimeError("request captured"))
    runner = SimpleNamespace(
        results_dir=str(tmp_path),
        prompt_sampler=SimpleNamespace(
            initial_program_prompt=Mock(return_value=("system", "user")),
        ),
        llm_selection=None,
        llm=SimpleNamespace(get_kwargs=Mock(return_value={"model_name": model}), query=query),
        evo_config=SimpleNamespace(max_patch_attempts=1),
    )
    with pytest.raises(RuntimeError, match="request captured"):
        asyncio.run(ShinkaEvolveRunner._generate_initial_program(runner))
    kwargs = query.call_args.kwargs["llm_kwargs"]
    if model.startswith("headless/"):
        assert kwargs["headless_work_dir"] == str(tmp_path / "gen_0")
        assert (tmp_path / "gen_0").is_dir()
    else:
        assert kwargs == {"model_name": model}
        assert not (tmp_path / "gen_0").exists()


def test_get_client_allows_headless_without_api_client():
    client, model_name, provider = get_client_llm("headless/codex")
    async_client, async_model_name, async_provider = get_async_client_llm(
        "headless/codex"
    )

    assert client is None
    assert model_name == "headless/codex"
    assert provider == "headless"
    assert async_client is None
    assert async_model_name == "headless/codex"
    assert async_provider == "headless"


def test_headless_kwargs_skip_api_only_parameters():
    kwargs = sample_model_kwargs(
        model_names=["headless/codex@gpt-5.5?effort=high"],
        temperatures=[0.0, 1.0],
        max_tokens=[128],
        reasoning_efforts=["high"],
    )

    assert kwargs == {"model_name": "headless/codex@gpt-5.5?effort=high"}


def test_query_headless_invokes_command_and_parses_usage(tmp_path, monkeypatch):
    fake_headless = _make_fake_headless(tmp_path)
    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", _fake_headless_command(fake_headless))
    monkeypatch.setenv("SHINKA_HEADLESS_TIMEOUT", "10")
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    result = query_headless(
        None,
        "headless/codex@test-model?effort=low",
        "user request",
        "system instructions",
        [],
        output_model=None,
        headless_work_dir=str(work_dir),
    )

    assert "raise_score" in result.content
    assert result.model_name == "headless/codex@test-model?effort=low"
    assert result.input_tokens == 11
    assert result.output_tokens == 13
    assert Path(result.kwargs["headless_prompt_path"]).exists()


def test_query_headless_invokes_claude_through_shell(tmp_path, monkeypatch):
    fake_headless = _make_fake_headless(tmp_path)
    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", _fake_headless_command(fake_headless))
    monkeypatch.setenv("SHINKA_HEADLESS_TIMEOUT", "10")

    result = query_headless(
        None,
        "headless/claude",
        "user request",
        "system instructions",
        [],
        output_model=None,
        headless_work_dir=str(tmp_path),
    )

    assert "raise_score" in result.content
    assert result.model_name == "headless/claude"


def test_query_headless_accepts_nested_cost_usage(tmp_path, monkeypatch):
    script = tmp_path / "nested_cost_headless.py"
    script.write_text(
        "\n".join(
            [
                "import json",
                "import sys",
                "from pathlib import Path",
                "if '--check' in sys.argv:",
                "    raise SystemExit(0)",
                "Path(sys.argv[sys.argv.index('--prompt-file') + 1]).exists() or sys.exit(2)",
                "print('content')",
                "print(json.dumps({'usage': {'inputTokens': 1, 'outputTokens': 2, 'reasoningOutputTokens': 3, 'cost': {'input': 0.01, 'output': 0.02, 'total': 0.03}}}))",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", _fake_headless_command(script))

    result = query_headless(
        None,
        "headless/codex",
        "user request",
        "system instructions",
        [],
        output_model=None,
        headless_work_dir=str(tmp_path),
    )

    assert result.cost == pytest.approx(0.03)
    assert result.input_cost == pytest.approx(0.01)
    assert result.output_cost == pytest.approx(0.02)
    assert result.input_tokens == 1
    assert result.output_tokens == 2
    assert result.thinking_tokens == 3


@pytest.mark.parametrize("agent", ["codex", "claude"])
def test_query_headless_allows_parallel_async_calls(tmp_path, monkeypatch, agent):
    active = 0
    max_active = 0
    both_started = asyncio.Event()

    class FakeProcess:
        returncode = 0

        async def communicate(self):
            nonlocal active
            await asyncio.wait_for(both_started.wait(), timeout=2)
            active -= 1
            return (
                b"content\n"
                b'{"usage":{"inputTokens":1,"outputTokens":1,"cost":{"total":0}}}',
                b"",
            )

        def kill(self):
            raise AssertionError("fake process should not time out")

    async def fake_create_subprocess(*args, **kwargs):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        if active == 2:
            both_started.set()
        return FakeProcess()

    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", "headless")
    monkeypatch.setattr(
        asyncio,
        "create_subprocess_shell" if agent == "claude" else "create_subprocess_exec",
        fake_create_subprocess,
    )

    async def run_queries():
        return await asyncio.gather(
            query_headless_async(
                None,
                f"headless/{agent}",
                "user request",
                "system instructions",
                [],
                output_model=None,
                headless_work_dir=str(tmp_path),
            ),
            query_headless_async(
                None,
                f"headless/{agent}",
                "user request",
                "system instructions",
                [],
                output_model=None,
                headless_work_dir=str(tmp_path),
            ),
        )

    results = asyncio.run(run_queries())

    assert max_active == 2
    assert all(result.content == "content" for result in results)
    prompts = [result.kwargs["headless_prompt_path"] for result in results]
    assert len(set(prompts)) == 2
    assert all(Path(prompt).is_file() for prompt in prompts)


@pytest.mark.parametrize("agent", ["codex", "claude"])
def test_query_headless_allows_parallel_sync_calls(tmp_path, monkeypatch, agent):
    both_started = threading.Barrier(2)

    def fake_run(command, **kwargs):
        args = shlex.split(command) if isinstance(command, str) else command
        prompt = Path(args[args.index("--prompt-file") + 1]).read_text()
        reply = prompt.split("# User Request\n\n", 1)[1].strip()
        # A shared invocation lock would prevent the second call reaching here.
        both_started.wait(timeout=2)
        return subprocess.CompletedProcess(
            command, 0, reply + '\n{"usage":{"input_tokens":1,"output_tokens":1}}', ""
        )

    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", "headless")
    monkeypatch.setattr(subprocess, "run", fake_run)

    def request(message):
        return query_headless(
            None, f"headless/{agent}", message, "system instructions", [],
            output_model=None, headless_work_dir=str(tmp_path),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(request, ["alpha", "beta"]))

    assert [result.content for result in results] == ["alpha", "beta"]
    assert len({result.kwargs["headless_prompt_path"] for result in results}) == 2


def test_validate_model_env_access_runs_headless_check(tmp_path, monkeypatch):
    fake_headless = _make_fake_headless(tmp_path)
    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", _fake_headless_command(fake_headless))
    monkeypatch.setenv("SHINKA_HEADLESS_TIMEOUT", "10")

    validate_model_env_access(llm_models=["headless/codex"])


@pytest.mark.integration
def test_shinka_run_full_headless_cli_mutation_succeeds(tmp_path, monkeypatch):
    fake_headless = _make_fake_headless(tmp_path)
    task_dir = _make_task_dir(tmp_path)
    results_dir = tmp_path / "results"
    monkeypatch.setenv("SHINKA_HEADLESS_COMMAND", _fake_headless_command(fake_headless))
    monkeypatch.setenv("SHINKA_HEADLESS_TIMEOUT", "10")

    exit_code = cli_run.main(
        [
            "--task-dir",
            str(task_dir),
            "--results_dir",
            str(results_dir),
            "--num_generations",
            "2",
            "--max-evaluation-jobs",
            "1",
            "--max-proposal-jobs",
            "1",
            "--max-db-workers",
            "1",
            "--no-verbose",
            "--set",
            'evo.llm_models=["headless/codex@test-model?effort=low"]',
            "--set",
            "evo.llm_dynamic_selection=null",
            "--set",
            "evo.embedding_model=null",
            "--set",
            'evo.patch_types=["full"]',
            "--set",
            "evo.patch_type_probs=[1.0]",
            "--set",
            "evo.max_patch_resamples=1",
            "--set",
            "evo.max_novelty_attempts=1",
            "--set",
            "evo.max_patch_attempts=1",
            "--set",
            "db.num_islands=1",
            "--set",
            "db.archive_size=4",
        ]
    )

    assert exit_code == 0
    generation_prompts = list(results_dir.glob("gen_1/headless_prompts/prompt_*.md"))
    assert generation_prompts, sorted(str(path) for path in results_dir.rglob("*"))
    attempt_prompts = list(results_dir.glob("gen_1/attempts/**/headless_prompt.md"))
    assert attempt_prompts, sorted(str(path) for path in results_dir.rglob("*"))
    assert "Current program" in attempt_prompts[0].read_text(encoding="utf-8")

    metrics_files = list(results_dir.glob("gen_1/**/metrics.json"))
    assert metrics_files
    best_score = max(
        json.loads(path.read_text(encoding="utf-8"))["combined_score"]
        for path in metrics_files
    )
    assert best_score == pytest.approx(1.0)
