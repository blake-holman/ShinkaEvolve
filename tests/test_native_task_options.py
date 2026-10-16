"""Fixed instructions and recommendation persistence without model requests."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from shinka.core.async_runner import ShinkaEvolveRunner
from shinka.core.async_summarizer import AsyncMetaSummarizer
from shinka.core.config import EvolutionConfig
from shinka.core.sampler import PromptSampler
from shinka.core.summarizer import MetaSummarizer
from shinka.database import Program


@pytest.mark.parametrize("evolved", [False, True])
@pytest.mark.parametrize("mode", ["initial", "ordinary", "repair"])
def test_every_proposal_includes_fixed_prompt_once_and_preserves_attribution(tmp_path, evolved, mode):
    async def scenario():
        fixed = "Keep the required theorem unchanged."
        # Also accept existing callers that embedded these instructions themselves.
        original = f"Find a proof.\n\n{fixed}"
        runner = object.__new__(ShinkaEvolveRunner)
        runner.evo_config = EvolutionConfig(
            task_sys_msg=original, fixed_prompt=fixed, evolve_prompts=evolved,
            language="lean", patch_types=["full"], patch_type_probs=[1],
        )
        runner.prompt_sampler = PromptSampler(
            task_sys_msg=original, language="lean", patch_types=["full"], patch_type_probs=[1]
        )
        runner.prompt_sampler_evo = SimpleNamespace(sample=lambda: SimpleNamespace(
            prompt_text=f"Use induction.\n{fixed}\n{fixed}", id="evolved", fitness=1
        ))
        response = SimpleNamespace(content="```lean\ntheorem target : True := trivial\n```", cost=0,
                                   to_dict=lambda: {}, new_msg_history=[])
        runner.llm = SimpleNamespace(get_kwargs=lambda **kwargs: {"model_name": "fake"},
                                     query=AsyncMock(return_value=response))
        runner.llm_selection = None
        runner.verbose = False
        runner.results_dir = tmp_path
        runner.lang_ext = "lean"
        runner._save_patch_attempt_async = AsyncMock()
        runner._setup_initial_program_with_metadata = AsyncMock()
        program = Program(id="parent", code="theorem target : True := by sorry", language="lean")
        with patch("shinka.core.async_runner.apply_patch_async", new=AsyncMock(
                return_value=("updated", 1, "main.lean", None, "patch", None))):
            if mode == "initial":
                await runner._generate_initial_program()
                metadata = runner._setup_initial_program_with_metadata.call_args.args[4]
            elif mode == "ordinary":
                _, metadata, success = await runner._run_patch_async(program, [], [], 1)
                assert success
            else:
                _, metadata, success = await runner._run_fix_patch_async(program, [], 1)
                assert success
        request = runner.llm.query.call_args.kwargs
        assert (request["system_msg"] + request["msg"]).count(fixed) == 1
        assert ("Use induction." in request["system_msg"]) == evolved
        assert metadata["system_prompt_id"] == ("evolved" if evolved else None)
        assert runner.prompt_sampler.task_sys_msg == original
    asyncio.run(scenario())


def summarizer(path):
    result = AsyncMetaSummarizer(MetaSummarizer(async_mode=True), Mock())
    result.enable_persistence(path)
    return result


def test_meta_state_restores_pending_programs_and_recommendations(tmp_path):
    path = tmp_path / "meta_state.json"
    meta = summarizer(path)
    meta.sync_summarizer.meta_recommendations = "Try induction."
    meta.add_evaluated_program(Program(id="unfinished", code="source"))
    restored = summarizer(path)
    assert restored.get_current()[0] == "Try induction."
    assert [program.id for program in restored.evaluated_since_last_meta] == ["unfinished"]


@pytest.mark.parametrize("outcome", ["success", "failure", "cancel"])
def test_recommendation_updates_persist_on_every_exit(tmp_path, outcome):
    async def scenario():
        path = tmp_path / "meta_state.json"
        meta = summarizer(path)
        meta.add_evaluated_program(Program(id="before", code="source"))
        original = meta.persist_state
        meta.persist_state = Mock(side_effect=original)
        async def step1(programs):
            meta.add_evaluated_program(Program(id="during", code="another"))
            if outcome == "cancel":
                raise asyncio.CancelledError()
            if outcome == "failure":
                raise RuntimeError("fake request failed")
            return "summary", 0
        meta._step1_individual_summaries_async = step1
        meta._step2_global_insights_async = AsyncMock(return_value=("insight", 0))
        meta._step3_generate_recommendations_async = AsyncMock(return_value=("recommendation", 0))
        if outcome == "cancel":
            with pytest.raises(asyncio.CancelledError):
                await meta.update_meta_memory_async()
        else:
            await meta.update_meta_memory_async()
        assert meta.persist_state.call_count == 2  # Concurrent addition and final update.
        restored = summarizer(path)
        expected = ["during"] if outcome == "success" else ["before", "during"]
        assert [program.id for program in restored.evaluated_since_last_meta] == expected
        assert restored.get_current()[0] == ("recommendation" if outcome == "success" else None)
    asyncio.run(scenario())


@pytest.mark.parametrize("contents", ["not json", "{}", '{"unprocessed_programs": [null]}'])
def test_corrupt_meta_state_is_rejected(tmp_path, contents):
    path = tmp_path / "meta_state.json"
    path.write_text(contents)
    with pytest.raises(ValueError, match="Could not restore saved recommendation state"):
        summarizer(path)
    assert path.read_text() == contents


def test_meta_state_write_failure_is_reported(tmp_path, caplog):
    path = tmp_path / "meta_state.json"
    meta = summarizer(path)
    path.mkdir()
    meta.add_evaluated_program(Program(id="pending", code="source"))
    assert "Failed to save meta state" in caplog.text


def test_invalid_native_options_fail_early():
    with pytest.raises(ValueError, match="fixed_prompt"):
        EvolutionConfig(fixed_prompt=123)
    with pytest.raises(ValueError, match="persist_meta_state"):
        EvolutionConfig(persist_meta_state="false")
