from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shlex
import signal
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs

from pydantic import BaseModel
import psutil

from shinka.llm.constants import TIMEOUT
from shinka.utils.languages import get_language_extension

from .result import QueryResult

DEFAULT_HEADLESS_COMMAND = "npx -y @roberttlange/headless"
HEADLESS_COMMAND_ENV = "SHINKA_HEADLESS_COMMAND"
HEADLESS_TIMEOUT_ENV = "SHINKA_HEADLESS_TIMEOUT"

_VALID_EFFORTS = {"low", "medium", "high", "xhigh", "max"}
_CLAUDE_TRANSIENT_RETRIES = 2
_CLAUDE_TRANSIENT_BACKOFF_SECONDS = 3.0
PROGRAM_FENCE = re.compile(r"^```(\w+)\n(.*?)\n```$", re.M | re.S)


@dataclass(frozen=True)
class HeadlessModel:
    agent: str
    agent_model: str | None = None
    effort: str | None = None


def headless_command_prefix() -> list[str]:
    raw_command = os.getenv(HEADLESS_COMMAND_ENV, DEFAULT_HEADLESS_COMMAND).strip()
    if not raw_command:
        raise ValueError(f"{HEADLESS_COMMAND_ENV} cannot be empty.")
    return shlex.split(raw_command)


def headless_timeout() -> float | None:
    raw_timeout = os.getenv(HEADLESS_TIMEOUT_ENV)
    if raw_timeout is None:
        return float(TIMEOUT)
    if raw_timeout.strip().lower() in {"none", "null", "unlimited"}:
        return None
    timeout = float(raw_timeout)
    if timeout <= 0:
        raise ValueError(f"{HEADLESS_TIMEOUT_ENV} must be > 0.")
    return timeout


def parse_headless_model(model_name: str) -> HeadlessModel:
    if not model_name.startswith("headless/"):
        raise ValueError(f"Headless model must start with 'headless/': {model_name}")

    body = model_name.split("headless/", 1)[1]
    route, _, query = body.partition("?")
    agent, separator, agent_model = route.partition("@")
    if not agent:
        raise ValueError("Headless agent name is required.")

    parsed_query = parse_qs(query, keep_blank_values=True)
    unknown_keys = sorted(set(parsed_query) - {"effort"})
    if unknown_keys:
        raise ValueError(
            f"Unsupported headless model query parameter(s): {unknown_keys}"
        )

    effort_values = parsed_query.get("effort", [])
    if len(effort_values) > 1:
        raise ValueError("Headless model may specify effort only once.")
    effort = effort_values[0] if effort_values else None
    if effort is not None and effort not in _VALID_EFFORTS:
        raise ValueError(
            f"Unsupported headless effort '{effort}'. "
            f"Expected one of {sorted(_VALID_EFFORTS)}."
        )

    return HeadlessModel(
        agent=agent,
        agent_model=agent_model if separator else None,
        effort=effort,
    )


def check_headless_available() -> None:
    cmd = [*headless_command_prefix(), "--check"]
    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=min(headless_timeout() or 60.0, 60.0),
            check=False,
        )
    except FileNotFoundError as exc:
        raise ValueError(f"Headless command not found: {cmd[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Headless availability check timed out.") from exc

    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        stdout = completed.stdout.strip()
        detail = stderr or stdout or f"exit code {completed.returncode}"
        raise ValueError(f"Headless availability check failed: {detail}")


def _render_prompt(
    *,
    msg: str,
    system_msg: str,
    msg_history: list[dict],
) -> str:
    history_text = json.dumps(msg_history, indent=2, ensure_ascii=False)
    return (
        "# System Instructions\n\n"
        f"{system_msg}\n\n"
        "# Previous Messages\n\n"
        f"{history_text}\n\n"
        "# User Request\n\n"
        f"{msg}\n"
    )


def _program_files(text: str, directory: Path) -> str:
    """Write each fenced program to a file and cite the file instead.

    Program fences are those containing EVOLVE-BLOCK-START. Other fenced
    blocks (commands, format examples) stay inline.
    """

    def replace(match: re.Match) -> str:
        language, code = match.groups()
        if "EVOLVE-BLOCK-START" not in code:
            return match.group(0)
        try:
            extension = get_language_extension(language)
        except ValueError:
            return match.group(0)
        data = code.encode("utf-8")
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{hashlib.sha256(data).hexdigest()[:16]}.{extension}"
        if not path.is_file() or path.read_bytes() != data:
            path.write_bytes(data)
        lines = code.removesuffix("\n").split("\n")
        markers = ", ".join(
            f"{marker} on line {number}"
            for number, line in enumerate(lines, 1)
            for marker in ("EVOLVE-BLOCK-START", "EVOLVE-BLOCK-END")
            if marker in line
        )
        return (
            f"Program file: {path} ({len(lines)} lines, {len(data)} bytes; {markers}). "
            "The source is not repeated in this message. Read the parts you need "
            "(rg -n, sed -n 'START,ENDp'); the file stays available after context "
            "compaction. Copy it before editing."
        )

    return PROGRAM_FENCE.sub(replace, text)


def _write_prompt_file(
    *,
    work_dir: str | None,
    msg: str,
    system_msg: str,
    msg_history: list[dict],
) -> Path:
    resolved_work_dir = Path(work_dir or os.getcwd()).absolute()
    prompt_dir = resolved_work_dir / "headless_prompts"
    prompt_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = prompt_dir / f"prompt_{uuid.uuid4().hex}.md"
    programs = prompt_dir / "programs"
    # The history is rendered as JSON, so its programs are moved beforehand.
    msg_history = [
        {**item, "content": _program_files(item["content"], programs)}
        if isinstance(item.get("content"), str)
        else item
        for item in msg_history
    ]
    prompt_path.write_text(
        _program_files(
            _render_prompt(msg=msg, system_msg=system_msg, msg_history=msg_history),
            programs,
        ),
        encoding="utf-8",
    )
    return prompt_path


def _build_headless_command(
    *,
    model: HeadlessModel,
    prompt_path: Path,
    work_dir: str | None,
    allow: str = "read-only",
) -> list[str]:
    if allow not in {"read-only", "yolo"}:
        raise ValueError("Headless allow mode must be 'read-only' or 'yolo'.")
    resolved_work_dir = str(Path(work_dir or os.getcwd()).absolute())
    cmd = [
        *headless_command_prefix(),
        model.agent,
        "--prompt-file",
        str(prompt_path),
        "--work-dir",
        resolved_work_dir,
        "--allow",
        allow,
        "--usage",
    ]
    if model.agent_model:
        cmd.extend(["--model", model.agent_model])
    if model.effort:
        cmd.extend(["--reasoning-effort", model.effort])
    return cmd


def _uses_shell_invocation(model: HeadlessModel) -> bool:
    return model.agent == "claude"


def _subprocess_env(model: HeadlessModel) -> dict[str, str] | None:
    if model.agent != "claude":
        return None
    env = os.environ.copy()
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("CLAUDE_CODE_OAUTH_TOKEN", None)
    return env


def _is_transient_claude_credit_error(
    *,
    model: HeadlessModel,
    completed: subprocess.CompletedProcess,
) -> bool:
    if model.agent != "claude" or completed.returncode == 0:
        return False
    output = f"{completed.stderr}\n{completed.stdout}"
    return "Credit balance is too low" in output and '"pricingSource":"models.dev"' in output


def _run_headless_command_sync(
    *,
    model: HeadlessModel,
    command: list[str],
) -> subprocess.CompletedProcess:
    attempts = _CLAUDE_TRANSIENT_RETRIES + 1
    for attempt in range(attempts):
        if _uses_shell_invocation(model):
            completed = subprocess.run(
                shlex.join(command),
                capture_output=True,
                text=True,
                timeout=headless_timeout(),
                check=False,
                shell=True,
                executable="/bin/sh",
                env=_subprocess_env(model),
            )
        else:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=headless_timeout(),
                check=False,
                env=_subprocess_env(model),
            )

        if not _is_transient_claude_credit_error(model=model, completed=completed):
            return completed
        if attempt < attempts - 1:
            time.sleep(_CLAUDE_TRANSIENT_BACKOFF_SECONDS * (attempt + 1))
    return completed


def _kill_process_tree(process):
    try:
        descendants = psutil.Process(process.pid).children(recursive=True)
    except psutil.NoSuchProcess:
        descendants = []
    for descendant in reversed(descendants):
        try:
            descendant.kill()
        except psutil.NoSuchProcess:
            pass
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
    except ProcessLookupError:
        pass


async def _run_headless_command_once_async(*, model, command):
    if _uses_shell_invocation(model):
        process = await asyncio.create_subprocess_shell(
            shlex.join(command),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            executable="/bin/sh",
            env=_subprocess_env(model),
            start_new_session=(os.name == "posix"),
        )
    else:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=_subprocess_env(model),
            start_new_session=(os.name == "posix"),
        )
    communication = asyncio.create_task(process.communicate())
    try:
        stdout, stderr = await asyncio.wait_for(
            asyncio.shield(communication),
            timeout=headless_timeout(),
        )
    except (asyncio.TimeoutError, asyncio.CancelledError):
        _kill_process_tree(process)
        await asyncio.shield(communication)
        raise
    return subprocess.CompletedProcess(
        args=command,
        returncode=process.returncode,
        stdout=stdout.decode("utf-8", errors="replace"),
        stderr=stderr.decode("utf-8", errors="replace"),
    )


async def _run_headless_command_async(
    *,
    model: HeadlessModel,
    command: list[str],
):
    from shinka.core.workers import current_worker

    worker = current_worker.get()
    attempts = _CLAUDE_TRANSIENT_RETRIES + 1
    for attempt in range(attempts):
        if worker is None:
            completed = await _run_headless_command_once_async(model=model, command=command)
        else:
            completed = await worker.run_headless(
                model=model, command=command, timeout=headless_timeout()
            )
        if not _is_transient_claude_credit_error(model=model, completed=completed):
            return completed
        if attempt < attempts - 1:
            await asyncio.sleep(_CLAUDE_TRANSIENT_BACKOFF_SECONDS * (attempt + 1))
    return completed


def _usage_int(usage: dict[str, Any], *names: str) -> int:
    for name in names:
        value = usage.get(name)
        if value is not None:
            if isinstance(value, dict):
                return int(
                    sum(
                        item
                        for item in _numeric_values(value)
                        if float(item).is_integer()
                    )
                )
            return int(value)
    return 0


def _usage_float(usage: dict[str, Any], *names: str) -> float:
    for name in names:
        value = usage.get(name)
        if value is not None:
            if isinstance(value, dict):
                if isinstance(value.get("total"), (int, float)):
                    return float(value["total"])
                return sum(_numeric_values(value))
            return float(value)
    return 0.0


def _numeric_values(value: Any) -> list[float]:
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, dict):
        numbers: list[float] = []
        for item in value.values():
            numbers.extend(_numeric_values(item))
        return numbers
    if isinstance(value, list):
        numbers = []
        for item in value:
            numbers.extend(_numeric_values(item))
        return numbers
    return []


def _parse_stdout(stdout: str) -> tuple[str, dict[str, Any]]:
    """Split Headless stdout into the assistant text and the final usage JSON line.

    The assistant text is kept verbatim apart from surrounding blank lines:
    SEARCH blocks quote the parent code exactly, including its blank lines.
    """
    text = stdout.rstrip()
    if not text.strip():
        raise ValueError("Headless stdout was empty.")
    head, _, last = text.rpartition("\n")

    try:
        payload = json.loads(last)
    except json.JSONDecodeError as exc:
        raise ValueError("Headless stdout did not end with usage JSON.") from exc

    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        raise ValueError("Headless usage JSON must contain a top-level usage object.")

    content = head.strip("\n").rstrip()
    if not content:
        raise ValueError("Headless assistant content was empty.")

    return content, usage


def _query_result(
    *,
    content: str,
    usage: dict[str, Any],
    model: str,
    msg: str,
    system_msg: str,
    msg_history: list[dict],
    kwargs: dict[str, Any],
    model_posteriors: dict[str, float] | None,
) -> QueryResult:
    cost_fields = ("cost", "total_cost", "input_cost", "prompt_cost", "output_cost", "completion_cost")
    kwargs = {**kwargs, "headless_pricing_unknown": not any(
        _numeric_values(usage.get(name)) for name in cost_fields
    )}
    new_msg_history = [
        *msg_history,
        {"role": "user", "content": msg},
        {"role": "assistant", "content": content},
    ]
    nested_cost = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
    input_cost = _usage_float(usage, "input_cost", "prompt_cost")
    if input_cost == 0.0:
        input_cost = _usage_float(nested_cost, "input", "prompt")
    output_cost = _usage_float(usage, "output_cost", "completion_cost")
    if output_cost == 0.0:
        output_cost = _usage_float(nested_cost, "output", "completion")
    cost = _usage_float(usage, "cost", "total_cost")
    if cost == 0.0:
        cost = input_cost + output_cost

    return QueryResult(
        content=content,
        msg=msg,
        system_msg=system_msg,
        new_msg_history=new_msg_history,
        model_name=model,
        kwargs=kwargs,
        input_tokens=_usage_int(usage, "input_tokens", "prompt_tokens", "inputTokens"),
        output_tokens=_usage_int(
            usage, "output_tokens", "completion_tokens", "outputTokens"
        ),
        thinking_tokens=_usage_int(
            usage,
            "thinking_tokens",
            "reasoning_tokens",
            "reasoningOutputTokens",
        ),
        cost=cost,
        input_cost=input_cost,
        output_cost=output_cost,
        model_posteriors=model_posteriors,
        num_total_queries=_usage_int(usage, "num_total_queries", "total_queries") or 1,
    )


def query_headless(
    client,
    model,
    msg,
    system_msg,
    msg_history,
    output_model: BaseModel | None,
    model_posteriors=None,
    **kwargs,
) -> QueryResult:
    from shinka.core.workers import current_worker

    if current_worker.get() is not None:
        raise RuntimeError("Proposal workers require asynchronous Headless queries.")
    if output_model is not None:
        raise ValueError("Headless does not support structured output.")

    headless_work_dir = kwargs.pop("headless_work_dir", None)
    headless_allow = kwargs.pop("headless_allow", "read-only")
    parsed_model = parse_headless_model(model)
    prompt_path = _write_prompt_file(
        work_dir=headless_work_dir,
        msg=msg,
        system_msg=system_msg,
        msg_history=msg_history,
    )
    command = _build_headless_command(
        model=parsed_model,
        prompt_path=prompt_path,
        work_dir=headless_work_dir,
        allow=headless_allow,
    )

    try:
        completed = _run_headless_command_sync(
            model=parsed_model,
            command=command,
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError(
            f"Headless query timed out after {headless_timeout()}s."
        ) from exc

    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"Headless query failed: {detail}")

    content, usage = _parse_stdout(completed.stdout)
    result_kwargs = {
        **kwargs,
        "model_name": model,
        "headless_prompt_path": str(prompt_path),
    }
    return _query_result(
        content=content,
        usage=usage,
        model=model,
        msg=msg,
        system_msg=system_msg,
        msg_history=msg_history,
        kwargs=result_kwargs,
        model_posteriors=model_posteriors,
    )


async def query_headless_async(
    client,
    model,
    msg,
    system_msg,
    msg_history,
    output_model: BaseModel | None,
    model_posteriors=None,
    **kwargs,
) -> QueryResult:
    if output_model is not None:
        raise ValueError("Headless does not support structured output.")

    headless_work_dir = kwargs.pop("headless_work_dir", None)
    headless_allow = kwargs.pop("headless_allow", "read-only")
    parsed_model = parse_headless_model(model)
    prompt_path = _write_prompt_file(
        work_dir=headless_work_dir,
        msg=msg,
        system_msg=system_msg,
        msg_history=msg_history,
    )
    command = _build_headless_command(
        model=parsed_model,
        prompt_path=prompt_path,
        work_dir=headless_work_dir,
        allow=headless_allow,
    )

    try:
        completed = await _run_headless_command_async(model=parsed_model, command=command)
    except asyncio.TimeoutError as exc:
        raise TimeoutError(
            f"Headless query timed out after {headless_timeout()}s."
        ) from exc

    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"Headless query failed: {detail}")

    content, usage = _parse_stdout(completed.stdout)
    result_kwargs = {
        **kwargs,
        "model_name": model,
        "headless_prompt_path": str(prompt_path),
    }
    return _query_result(
        content=content,
        usage=usage,
        model=model,
        msg=msg,
        system_msg=system_msg,
        msg_history=msg_history,
        kwargs=result_kwargs,
        model_posteriors=model_posteriors,
    )
