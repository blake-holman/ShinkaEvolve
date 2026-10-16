"""Generation leases keep retries together and release before central evaluation."""

import asyncio
from contextlib import asynccontextmanager, AsyncExitStack
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from shinka.core import EvolutionConfig, ShinkaEvolveRunner
from shinka.core.workers import WorkerPool, current_worker
from shinka.database import DatabaseConfig, Program
from shinka.llm.providers.headless import query_headless, query_headless_async
from shinka.llm.providers.headless import HeadlessModel, _run_headless_command_async


class FakePool:
    total_capacity = 2

    def __init__(self):
        self.acquisitions = 0
        self.released = False
        self.close = AsyncMock()
        self.prepare = AsyncMock()

    @asynccontextmanager
    async def acquire(self, work_dir):
        self.acquisitions += 1
        token = current_worker.set(self)
        try:
            yield self
        finally:
            (Path(work_dir) / "returned.txt").write_text("remote artifact")
            self.released = True
            current_worker.reset(token)

    def metadata(self):
        return {"worker_name": "test-worker", "worker_attempt_id": "attempt-1",
                "worker_finished_at": 2 if self.released else None,
                "worker_model": "gpt-6-luna", "worker_effort": "max"}


def make_runner(tmp_path, repair=False):
    runner = object.__new__(ShinkaEvolveRunner)
    runner.evo_config = EvolutionConfig(max_patch_resamples=2, max_novelty_attempts=1)
    runner.db_config = DatabaseConfig()
    runner.db = SimpleNamespace(island_manager=None)
    runner.results_dir = tmp_path
    runner.worker_pool = FakePool()
    runner.lang_ext = "py"
    runner.verbose = False
    runner.meta_summarizer = None
    runner.llm_selection = None
    runner.novelty_judge = None
    runner.active_proposal_tasks = {}
    runner.total_proposals_generated = 0
    runner.total_api_cost = 0
    runner.running_jobs = []
    runner.submitted_jobs = {}
    runner.slot_available = asyncio.Event()
    runner.max_evaluation_jobs = 1
    runner.max_proposal_jobs = 2
    runner._get_code_embedding_async = AsyncMock(return_value=(None, 0))
    runner._update_avg_proposal_cost = Mock()
    runner._cleanup_proposal_task_state = AsyncMock()
    runner._record_terminal_failed_proposal = AsyncMock()
    runner.async_db = SimpleNamespace(sample_with_fix_mode_async=AsyncMock(return_value=(
        Program(id="parent", code="source", correct=not repair), [], [], repair
    )))
    return runner


@pytest.mark.parametrize("repair", [False, True])
def test_generation_retries_share_lease_and_return_artifacts_before_evaluation(tmp_path, repair):
    async def scenario():
        runner = make_runner(tmp_path, repair)
        attempts = []

        async def propose(*args, **kwargs):
            attempts.append(current_worker.get())
            if len(attempts) == 1:
                return None, {"api_costs": 0.1}, False
            (tmp_path / "gen_1/main.py").write_text("candidate")
            return "patch", {"api_costs": 0.2}, True

        async def evaluate(**kwargs):
            assert current_worker.get() is None
            assert runner.worker_pool.released
            assert (tmp_path / "gen_1/returned.txt").read_text() == "remote artifact"
            return "evaluation", 0, 3, 3, 1

        runner._run_patch_async = propose
        runner._run_fix_patch_async = propose
        runner._submit_evaluation_job_with_slot = evaluate
        job = await runner._generate_proposal_async(1, "generation-1")
        assert attempts == [runner.worker_pool, runner.worker_pool]
        assert runner.worker_pool.acquisitions == 1
        assert job.meta_patch_data["worker_name"] == "test-worker"
        assert job.meta_patch_data["worker_finished_at"] == 2
        assert job.meta_patch_data["api_costs"] == pytest.approx(0.3)
        assert not (tmp_path / "gen_1/.generation_lock").exists()
    asyncio.run(scenario())


def test_failed_proposal_releases_worker_and_records_provenance(tmp_path):
    async def scenario():
        runner = make_runner(tmp_path)
        runner._run_patch_async = AsyncMock(return_value=(None, {"api_costs": 0}, False))
        runner._submit_evaluation_job_with_slot = AsyncMock()
        assert await runner._generate_proposal_async(1, "generation-1") is None
        assert runner.worker_pool.released
        assert current_worker.get() is None
        runner._submit_evaluation_job_with_slot.assert_not_called()
        failure = runner._record_terminal_failed_proposal.call_args.kwargs
        assert failure["meta_patch_data"]["worker_attempt_id"] == "attempt-1"
    asyncio.run(scenario())


def test_cancelled_generation_releases_worker_and_lock(tmp_path):
    async def scenario():
        runner = make_runner(tmp_path)
        started = asyncio.Event()

        async def propose(*args, **kwargs):
            started.set()
            await asyncio.Future()

        runner._run_patch_async = propose
        task = asyncio.create_task(runner._generate_proposal_async(1, "generation-1"))
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert runner.worker_pool.released
        assert not (tmp_path / "gen_1/.generation_lock").exists()
        runner._cleanup_proposal_task_state.assert_awaited_once()
    asyncio.run(scenario())


def test_initial_generation_releases_worker_before_seed_evaluation(tmp_path):
    async def scenario():
        runner = make_runner(tmp_path)
        runner.evo_config.max_patch_attempts = 2
        runner._sample_program_prompt = Mock(return_value=(("system", "user"), "prompt-1"))
        response = SimpleNamespace(content="```python\nprint(1)\n```", cost=0, to_dict=lambda: {})
        runner.llm = SimpleNamespace(get_kwargs=lambda **kwargs: {"model_name": "headless/codex"},
                                     query=AsyncMock(side_effect=[None, response]))
        runner._save_patch_attempt_async = AsyncMock()

        async def evaluate(*args):
            assert current_worker.get() is None
            assert runner.worker_pool.released
            assert args[4]["worker_attempt_id"] == "attempt-1"

        runner._setup_initial_program_with_metadata = evaluate
        async with AsyncExitStack() as scope:
            worker = await runner._acquire_proposal_worker(scope, tmp_path / "gen_0")
            await runner._generate_initial_program(scope, worker)
        assert runner.worker_pool.acquisitions == 1
        assert runner.llm.query.await_count == 2
    asyncio.run(scenario())


def test_pool_capacity_keeps_proposals_independent_of_central_evaluation(tmp_path):
    runner = make_runner(tmp_path)
    assert runner._compute_proposal_pipeline_target() == 3
    runner.worker_pool = None
    assert runner._compute_proposal_pipeline_target() == 1


def test_headless_provider_uses_current_worker_and_keeps_local_fallback(tmp_path):
    async def scenario():
        completed = subprocess.CompletedProcess([], 0, 'ANSWER\n{"usage": {"cost": 0}}\n', "")
        worker = SimpleNamespace(run_headless=AsyncMock(return_value=completed))
        local = AsyncMock(return_value=completed)
        token = current_worker.set(worker)
        kwargs = dict(client=None, model="headless/codex@gpt-6-luna?effort=max", msg="request",
                      system_msg="system", msg_history=[], output_model=None,
                      headless_work_dir=str(tmp_path))
        try:
            with patch("shinka.llm.providers.headless._run_headless_command_once_async", local):
                result = await query_headless_async(**kwargs)
                assert result.content == "ANSWER"
                local.assert_not_called()
            command = worker.run_headless.call_args.kwargs
            assert command["model"].agent_model == "gpt-6-luna"
            assert command["model"].effort == "max"
            with pytest.raises(RuntimeError, match="asynchronous"):
                query_headless(**kwargs)
        finally:
            current_worker.reset(token)
        with patch("shinka.llm.providers.headless._run_headless_command_once_async", local):
            await query_headless_async(**kwargs)
            local.assert_awaited_once()
    asyncio.run(scenario())


def test_worker_acquisition_failure_is_recorded_and_cleans_lock(tmp_path):
    async def scenario():
        runner = make_runner(tmp_path)
        runner.worker_pool.acquire = Mock(side_effect=OSError("worker offline"))
        runner._run_patch_async = AsyncMock()
        assert await runner._generate_proposal_async(1, "generation-1") is None
        runner._run_patch_async.assert_not_called()
        failure = runner._record_terminal_failed_proposal.call_args.kwargs
        assert failure["failure_stage"] == "proposal_worker"
        assert failure["failure_reason"] == "worker offline"
        assert not (tmp_path / "gen_1/.generation_lock").exists()
    asyncio.run(scenario())


def test_claude_worker_removes_auth_overrides_and_preserves_shell_arguments(tmp_path, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "dummy")

    async def scenario():
        pool = WorkerPool([{"name": "local", "capacity": 1, "launch_command": []}], {}, tmp_path)
        script = ('import json,os,sys; print(json.dumps({"argument":sys.argv[1],'
                  '"overrides":[key for key in ("ANTHROPIC_API_KEY","CLAUDE_CODE_OAUTH_TOKEN") if key in os.environ]}))')
        command = [sys.executable, "-c", script, "literal spaces; $HOME"]
        try:
            await pool.prepare()
            async with pool.acquire(tmp_path / "gen_1"):
                result = await _run_headless_command_async(model=HeadlessModel("claude"), command=command)
            assert result.returncode == 0
            assert json.loads(result.stdout) == {"argument": "literal spaces; $HOME", "overrides": []}
        finally:
            await pool.close()
    asyncio.run(scenario())


def test_claude_worker_uses_existing_transient_credit_retry_policy():
    async def scenario():
        failure = subprocess.CompletedProcess([], 1, '{"pricingSource":"models.dev"}', "Credit balance is too low")
        success = subprocess.CompletedProcess([], 0, "ok", "")
        worker = SimpleNamespace(run_headless=AsyncMock(side_effect=[failure, success]))
        token = current_worker.set(worker)
        try:
            with patch("shinka.llm.providers.headless.asyncio.sleep", new_callable=AsyncMock):
                result = await _run_headless_command_async(model=HeadlessModel("claude"), command=["fake"])
            assert result is success
            assert worker.run_headless.await_count == 2
        finally:
            current_worker.reset(token)
    asyncio.run(scenario())


def test_existing_generation_directory_does_not_start_another_worker(tmp_path):
    async def scenario():
        runner = make_runner(tmp_path)
        (tmp_path / "gen_1").mkdir()
        assert await runner._generate_proposal_async(1, "generation-1") is None
        assert runner.worker_pool.acquisitions == 0
    asyncio.run(scenario())


def test_worker_capacity_overrides_local_proposal_clamp(tmp_path, monkeypatch):
    from shinka.core import async_runner
    from shinka.core import workers
    from shinka.launch import LocalJobConfig

    pool = SimpleNamespace(total_capacity=5)
    monkeypatch.setattr(workers, "WorkerPool", lambda *args: pool)
    snapshot = SimpleNamespace(source="test", fetched_at="now", stale=False, sha256="test")
    monkeypatch.setattr(async_runner, "load_run_pricing_snapshot", lambda *args: snapshot)
    monkeypatch.setattr(async_runner, "write_run_pricing_snapshot", lambda *args: None)
    monkeypatch.setattr(async_runner, "_validate_evo_config_model_env_access", lambda *args: None)
    monkeypatch.setattr(async_runner, "_print_gradient_logo_and_mirror", lambda *args, **kwargs: None)
    monkeypatch.setattr(async_runner, "AsyncLLMClient", lambda **kwargs: None)
    monkeypatch.setattr(async_runner, "JobScheduler", lambda **kwargs: None)
    monkeypatch.setattr(ShinkaEvolveRunner, "_validate_concurrency_settings", lambda *args: (1, 1, 1))
    config = EvolutionConfig(
        results_dir=str(tmp_path), embedding_model=None, llm_dynamic_selection=None,
        llm_models=["headless/codex@gpt-6-luna?effort=max"],
        proposal_workers=[{"name": "one", "capacity": 2, "launch_command": ["worker"]},
                          {"name": "two", "capacity": 3, "launch_command": ["worker"]}],
    )
    runner = ShinkaEvolveRunner(config, LocalJobConfig(), DatabaseConfig(), verbose=False)
    assert runner.max_proposal_jobs == 5
    assert runner.max_evaluation_jobs == 1
    assert runner._compute_proposal_pipeline_target() == 6


def test_cli_passes_worker_configuration_through_native_fields():
    from shinka.cli.run import _field_types, _parse_overrides

    overrides = _parse_overrides([
        'evo.proposal_workers=[{"name":"remote","capacity":2,"launch_command":["ssh","host","worker"]}]',
        'evo.proposal_workspace={"mirrors":["/project"],"prepare":["prepare"],"artifacts":["notes.md"]}',
    ], _field_types())
    assert overrides["evo"]["proposal_workers"][0]["capacity"] == 2
    assert overrides["evo"]["proposal_workspace"]["artifacts"] == ["notes.md"]


def test_novelty_headless_calls_stay_local(tmp_path):
    async def scenario():
        runner = make_runner(tmp_path)
        runner._run_patch_async = AsyncMock(return_value=("patch", {"api_costs": 0}, True))
        runner._get_code_embedding_async = AsyncMock(return_value=([1], 0))

        async def assess(*args):
            assert current_worker.get() is None
            return True, {}

        runner.novelty_judge = SimpleNamespace(
            should_check_novelty_async=AsyncMock(return_value=True),
            assess_novelty_with_rejection_sampling_async=assess,
        )
        runner._submit_evaluation_job_with_slot = AsyncMock(return_value=("evaluation", 0, 3, 3, 1))
        assert await runner._generate_proposal_async(1, "generation-1") is not None
        assert runner.worker_pool.released
    asyncio.run(scenario())
