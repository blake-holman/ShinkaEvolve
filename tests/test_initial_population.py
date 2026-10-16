"""Native population setup and resume use fake evaluators, never models."""

import asyncio
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from shinka.core.async_runner import ShinkaEvolveRunner
from shinka.core.config import EvolutionConfig
from shinka.database import DatabaseConfig


def make_seeds(tmp_path):
    seeds = []
    for index, source in enumerate(("proved", "unfinished", "incorrect")):
        path = tmp_path / f"seed_{index}.lean"
        path.write_text(source)
        seeds.append({"name": source, "path": str(path),
                      "sha256": hashlib.sha256(source.encode()).hexdigest(),
                      "require_correct": index == 0})
    return seeds


def evaluate(candidate, results_dir):
    correct = Path(candidate).read_text() == "proved"
    return {"correct": {"correct": correct}, "metrics": {
        "combined_score": -10 if correct else 0, "public": {}, "private": {},
    }}, 0.01


def make_runner(tmp_path, seeds, evaluator=evaluate, **options):
    runner = object.__new__(ShinkaEvolveRunner)
    runner.__dict__.update(
        results_dir=tmp_path, evo_config=EvolutionConfig(
            language="lean", embedding_model=None, initial_population=seeds, **options),
        db_config=DatabaseConfig(num_islands=3, migration_rate=0),
        max_db_workers=1, verbose=False, console=None,
        wandb_logger=SimpleNamespace(enabled=False, active=False),
        prompt_db=None, prompt_llm=None, enable_deadlock_debugging=False,
        llm_selection=None, scheduler=SimpleNamespace(run=Mock(side_effect=evaluator)),
        embedding_client=None, meta_summarizer=None, total_api_cost=0,
        completed_generations=0, next_generation_to_submit=1, stuck_detection_count=0,
    )
    return runner


async def close_runner(runner):
    if getattr(runner, "async_db", None):
        await runner.async_db.close_async()
    if getattr(runner, "db", None):
        runner.db.close()


def test_population_resume_at_generation_zero(tmp_path):
    async def scenario():
        seeds = make_seeds(tmp_path)
        runner = make_runner(tmp_path, seeds, evolve_prompts=True)
        try:
            await runner._setup_async()
            programs = sorted(runner.db.get_all_programs(), key=lambda p: p.island_idx)
            ids = {program.id for program in programs}
            assert [program.island_idx for program in programs] == [0, 1, 2]
            assert [program.correct for program in programs] == [True, False, False]
            assert all(program.language == "lean" and program.generation == 0 for program in programs)
            assert runner.completed_generations == 1
            assert await runner._count_completed_generations_from_db() == 1
            assert runner.scheduler.run.call_count == 3
            assert runner.prompt_db._count_prompts_in_db() == 1
            assert (tmp_path / "gen_0/main.lean").read_text() == "proved"
            assert (tmp_path / "gen_0/seed_2/main.lean").read_text() == "incorrect"
        finally:
            await close_runner(runner)
        resumed = make_runner(tmp_path, seeds, evaluator=AssertionError("reevaluated"), evolve_prompts=True)
        try:
            await resumed._setup_async()
            assert {program.id for program in resumed.db.get_all_programs()} == ids
            assert resumed.completed_generations == 1
            assert resumed.next_generation_to_submit == 1
            assert resumed.prompt_db._count_prompts_in_db() == 1
            resumed.scheduler.run.assert_not_called()
        finally:
            await close_runner(resumed)
    asyncio.run(scenario())


@pytest.mark.parametrize("invalid", [
    {}, {"correct": {"correct": "true"}, "metrics": {"combined_score": 1}},
    {"correct": {"correct": True}, "metrics": {"combined_score": float("nan")}},
    {"correct": {"correct": True}, "metrics": {"combined_score": 1, "public": []}},
    {"correct": {"correct": True}, "metrics": {"combined_score": 1, "private": []}},
    {"correct": {"correct": True, "error": "failed"}, "metrics": {"combined_score": 1}},
])
def test_invalid_later_evaluation_inserts_nothing(tmp_path, invalid):
    async def scenario():
        def evaluator(candidate, results_dir):
            return evaluate(candidate, results_dir) if Path(candidate).read_text() == "proved" else (invalid, 0)
        runner = make_runner(tmp_path, make_seeds(tmp_path), evaluator)
        try:
            with pytest.raises(ValueError):
                await runner._setup_async()
            assert runner.db.get_all_programs() == []
        finally:
            await close_runner(runner)
    asyncio.run(scenario())


def test_required_correct_seed_failure_inserts_nothing(tmp_path):
    async def scenario():
        def incorrect(candidate, results):
            return {"correct": {"correct": False}, "metrics": {"combined_score": 0}}, 0
        runner = make_runner(tmp_path, make_seeds(tmp_path), incorrect)
        try:
            with pytest.raises(ValueError, match="proved must be correct"):
                await runner._setup_async()
            assert runner.db.get_all_programs() == []
        finally:
            await close_runner(runner)
    asyncio.run(scenario())


@pytest.mark.parametrize("change", ["hash", "manifest", "marker", "missing_row", "config"])
def test_resume_rejects_changed_or_incomplete_population(tmp_path, change):
    async def scenario():
        seeds = make_seeds(tmp_path)
        runner = make_runner(tmp_path, seeds)
        try:
            await runner._setup_async()
            if change == "marker":
                runner.db._update_metadata_in_db("initial_population_complete", "false")
            elif change == "manifest":
                runner.db._update_metadata_in_db("initial_population_manifest", json.dumps([]))
            elif change == "missing_row":
                runner.db.cursor.execute("DELETE FROM programs WHERE island_idx = 2")
                runner.db.conn.commit()
        finally:
            await close_runner(runner)
        if change == "hash":
            Path(seeds[1]["path"]).write_text("changed")
        resumed = make_runner(tmp_path, None if change == "config" else seeds)
        try:
            with pytest.raises(ValueError):
                await resumed._setup_async()
            resumed.scheduler.run.assert_not_called()
        finally:
            await close_runner(resumed)
    asyncio.run(scenario())


def test_resume_after_dynamic_island_spawn(tmp_path):
    async def scenario():
        seeds = make_seeds(tmp_path)
        runner = make_runner(tmp_path, seeds)
        runner.db_config.enable_dynamic_islands = True
        runner.db_config.island_spawn_strategy = "initial"
        try:
            await runner._setup_async()
            assert runner.db.island_manager.spawn_new_island()
            assert len(runner.db.get_all_programs()) == 4
            assert await runner._count_completed_generations_from_db() == 1
        finally:
            await close_runner(runner)
        resumed = make_runner(tmp_path, seeds)
        try:
            await resumed._setup_async()
            assert len(resumed.db.get_all_programs()) == 4
            assert resumed.completed_generations == 1
            resumed.scheduler.run.assert_not_called()
        finally:
            await close_runner(resumed)
    asyncio.run(scenario())


def test_seed_sources_preserve_crlf_bytes(tmp_path):
    async def scenario():
        seeds = make_seeds(tmp_path)
        source = b"unfinished\r\nsource\r\n"
        Path(seeds[1]["path"]).write_bytes(source)
        seeds[1]["sha256"] = hashlib.sha256(source).hexdigest()
        runner = make_runner(tmp_path, seeds)
        try:
            await runner._setup_async()
            assert (tmp_path / "gen_0/seed_1/main.lean").read_bytes() == source
            assert runner.db.get_all_programs()[1].code.encode() == source
        finally:
            await close_runner(runner)
    asyncio.run(scenario())


def test_initial_evaluation_exception_is_not_marked_correct(tmp_path):
    async def scenario():
        runner = make_runner(tmp_path, None)
        runner.lang_ext = "lean"
        runner.max_proposal_jobs = 1
        runner.max_evaluation_jobs = 1
        runner.scheduler.run.side_effect = RuntimeError("evaluation failed")
        runner.async_db = SimpleNamespace(add_program_async=AsyncMock())
        runner._persist_program_metadata_async = AsyncMock()
        runner._record_progress = Mock()
        runner._log_program_to_wandb = Mock()
        await runner._setup_initial_program("source")
        program = runner.async_db.add_program_async.call_args.args[0]
        assert program.correct is False
        assert program.language == "lean"
        assert program.metadata["evaluation_failed"] is True
    asyncio.run(scenario())
