"""Build a synthetic ShinkaEvolve results directory for web UI tests.

The directory mirrors what ``shinka_launch`` writes: an ``evolution_db.sqlite``
program database, a ``prompts.sqlite`` system prompt database, ``meta/``
summary files, per-generation ``gen_N`` directories with failure payloads and
plot images, and an ``attempt_log`` with failed proposals.  Values are
deterministic so API snapshots and screenshots are reproducible.
"""

from __future__ import annotations

import base64
import json
import math
import random
import uuid
from pathlib import Path
from typing import Dict, List

from shinka.core.pipeline_timing import with_pipeline_timing
from shinka.database import (
    DatabaseConfig,
    Program,
    ProgramDatabase,
    SystemPrompt,
    SystemPromptConfig,
    SystemPromptDatabase,
)

# 1x1 transparent PNG.
_PNG_BYTES = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

MODELS = ["gpt-5.5-mini", "claude-sonnet-5-5"]
PATCH_TYPES = ["diff", "full", "cross"]
BASE_TIME = 1_760_000_000.0  # fixed epoch so timelines are stable


def _program_code(generation: int, idx: int) -> str:
    return (
        "# EVOLVE-BLOCK-START\n"
        f"def solve(n):\n"
        f"    # generation {generation} variant {idx}\n"
        f"    total = 0\n"
        f"    for i in range(n):\n"
        f"        total += i * {generation + 1}\n"
        f"    return total\n"
        "# EVOLVE-BLOCK-END\n"
    )


def _stable_id(generation: int, idx: int) -> str:
    return str(uuid.UUID(int=generation * 1000 + idx))


def _write_meta_file(meta_dir: Path, processed_count: int) -> None:
    content = f"""# INDIVIDUAL PROGRAM SUMMARIES

Summary after {processed_count} processed programs.

**Program Name:** loop_unroll_{processed_count}
**Implementation:** Unrolled the inner loop by a factor of two.
**Performance:** Score improved from 0.80 to 0.91.
**Feedback:** Keep the unrolled loop; avoid recomputing the bound.

**Program Name:** vectorized_sum_{processed_count}
**Implementation:** Replaced the loop with a closed form sum.
**Performance:** Score 0.97, best so far.
**Feedback:** Closed forms dominate; explore them further.

# GLOBAL INSIGHTS SCRATCHPAD

- Closed-form expressions beat loop transforms.
- Full rewrites are more expensive than diffs with similar gains.

# META RECOMMENDATIONS

1. Prefer diff patches that replace loops with closed forms.
2. Reduce the resample budget for full rewrites.
"""
    (meta_dir / f"meta_{processed_count}.txt").write_text(content, encoding="utf-8")


def build_results_dir(root: Path, *, num_generations: int = 12, seed: int = 7) -> Path:
    """Create ``root/results_fixture`` and return it."""
    rng = random.Random(seed)
    results_dir = root / "results_fixture"
    results_dir.mkdir(parents=True, exist_ok=True)
    db_path = results_dir / "evolution_db.sqlite"

    config = DatabaseConfig(db_path=str(db_path), num_islands=2, archive_size=10)
    db = ProgramDatabase(config)

    prompt_db = SystemPromptDatabase(
        SystemPromptConfig(db_path=str(results_dir / "prompts.sqlite"))
    )
    prompt_ids: List[str] = []
    for i in range(3):
        prompt = SystemPrompt(
            id=f"prompt-{i}",
            prompt_text=f"You are an optimizer. Variant {i}.",
            name=f"prompt_variant_{i}",
            description=f"Prompt variant {i}",
            parent_id=f"prompt-{i - 1}" if i > 0 else None,
            generation=i,
            program_generation=i * 4,
            patch_type="init" if i == 0 else "diff",
            timestamp=BASE_TIME + i * 100,
            fitness=0.4 + 0.2 * i,
            metadata={"llm": {"cost": 0.002 * (i + 1), "model": MODELS[i % 2]}},
        )
        prompt_db.add(prompt)
        prompt_ids.append(prompt.id)
    prompt_db.close()

    programs_by_generation: Dict[int, List[Program]] = {}
    clock = BASE_TIME
    best_score = 0.0

    for generation in range(num_generations):
        per_gen = 2 if generation == 0 else 3
        programs_by_generation[generation] = []
        for idx in range(per_gen):
            clock += 30.0
            pipeline_started = clock
            sampling_finished = pipeline_started + rng.uniform(4, 12)
            eval_started = sampling_finished + rng.uniform(0.5, 2)
            eval_finished = eval_started + rng.uniform(5, 25)
            post_started = eval_finished + rng.uniform(0.2, 1)
            post_finished = post_started + rng.uniform(0.5, 2)

            if generation == 0:
                parent = None
                patch_type = "init"
                patch_name = "initial_program"
                model = MODELS[0]
            else:
                parent = rng.choice(programs_by_generation[generation - 1])
                patch_type = PATCH_TYPES[(generation + idx) % len(PATCH_TYPES)]
                patch_name = f"{patch_type}_patch_g{generation}_{idx}"
                model = MODELS[(generation + idx) % len(MODELS)]

            correct = not (generation >= 2 and idx == 2 and generation % 3 == 0)
            if correct:
                score = min(1.0, 0.5 + 0.04 * generation + rng.uniform(-0.05, 0.08))
            else:
                score = 0.0
            best_score = max(best_score, score)

            api_cost = rng.uniform(0.01, 0.08)
            metadata = {
                "patch_type": patch_type,
                "patch_name": patch_name,
                "patch_description": f"Applied {patch_type} patch in generation {generation}.",
                "api_costs": api_cost,
                "embed_cost": 0.0004,
                "novelty_cost": 0.0 if generation == 0 else 0.003,
                "meta_cost": 0.0,
                "model_name": model,
                "model": model,
                "num_applied": 1,
                "novelty_attempt": 1,
                "resample_attempt": 1 + (idx % 2),
                "patch_attempt": 1,
                "stdout_log": f"evaluated generation {generation} idx {idx}\n",
                "stderr_log": "" if correct else "Traceback: ValueError in solve\n",
                "timeline_lane_mode": "pool_slots",
                "sampling_worker_capacity": 2,
                "evaluation_worker_capacity": 2,
                "postprocess_worker_capacity": 1,
                "sampling_worker_id": idx % 2,
                "evaluation_worker_id": idx % 2,
                "llm_result": None
                if generation == 0
                else {
                    "model_name": model,
                    "cost": api_cost,
                    "input_tokens": 1200 + 10 * generation,
                    "output_tokens": 400 + 5 * generation,
                    "model_posteriors": {
                        MODELS[0]: 0.5 + 0.02 * generation,
                        MODELS[1]: 0.5 - 0.02 * generation,
                    },
                },
                "diff_summary": {"lines_added": idx + 1, "lines_removed": idx},
                "thought": f"Trying a {patch_type} change for generation {generation}.",
                "system_prompt_id": prompt_ids[min(generation // 4, 2)],
            }
            if generation % 4 == 1 and idx == 0:
                # Failed-but-stored evaluation, mimicking a crashed candidate.
                metadata["failure_stage"] = "evaluation"
                metadata["failure_class"] = "runtime_error"
                metadata["failure_reason"] = "solve raised ValueError"
            metadata = with_pipeline_timing(
                metadata,
                pipeline_started_at=pipeline_started,
                sampling_started_at=pipeline_started,
                sampling_finished_at=sampling_finished,
                evaluation_started_at=eval_started,
                evaluation_finished_at=eval_finished,
                postprocess_started_at=post_started,
                postprocess_finished_at=post_finished,
            )

            angle = generation * 0.4 + idx
            embedding = [math.cos(angle + k * 0.3) for k in range(8)]
            program = Program(
                id=_stable_id(generation, idx),
                code=_program_code(generation, idx),
                language="python",
                parent_id=parent.id if parent else None,
                generation=generation,
                timestamp=post_finished,
                code_diff=None
                if parent is None
                else f"--- parent\n+++ child\n-    total += i * {generation}\n+    total += i * {generation + 1}\n",
                combined_score=score,
                public_metrics={"score": score, "runtime_ms": rng.uniform(10, 50)},
                private_metrics={"hidden_score": score * 0.9},
                text_feedback="All tests passed." if correct else "Evaluation failed.",
                correct=correct,
                embedding=embedding,
                embedding_pca_2d=[math.cos(angle), math.sin(angle)],
                embedding_pca_3d=[math.cos(angle), math.sin(angle), generation / 10],
                embedding_cluster_id=generation % 3,
                metadata=metadata,
                system_prompt_id=metadata["system_prompt_id"],
                island_idx=(generation + idx) % 2,
            )
            db.add(program)
            programs_by_generation[generation].append(program)
            db.check_scheduled_operations()

    # Failed proposals (never evaluated) recorded in attempt_log.
    for failed_gen in (5, 9):
        gen_dir = results_dir / f"gen_{failed_gen}"
        gen_dir.mkdir(exist_ok=True)
        (gen_dir / "main.py").write_text(
            _program_code(failed_gen, 99), encoding="utf-8"
        )
        parent = programs_by_generation[failed_gen - 1][0]
        failure_payload = {
            "generation": failed_gen,
            "node_kind": "failed_proposal",
            "language": "python",
            "failure_stage": "patch_apply",
            "failure_class": "patch_apply_failed",
            "failure_reason": "SEARCH block did not match",
            "parent_id": parent.id,
            "archive_inspiration_ids": [],
            "top_k_inspiration_ids": [],
            "patch_type": "diff",
            "patch_name": f"broken_patch_g{failed_gen}",
            "patch_description": "A patch whose search block did not match.",
            "api_costs": 0.02,
            "embed_cost": 0.0,
            "novelty_cost": 0.0,
            "attempts": {
                "novelty_attempt": 1,
                "resample_attempt": 2,
                "patch_attempt": 3,
            },
            "artifacts": {
                "generated_code_path": f"results_fixture/gen_{failed_gen}/main.py"
            },
            "failure_json_path": f"results_fixture/gen_{failed_gen}/failure.json",
            "downstream_eval_submitted": False,
            "generated_code_available": True,
        }
        (gen_dir / "failure.json").write_text(json.dumps(failure_payload, indent=2))
        details = {
            "node_kind": "failed_proposal",
            "parent_id": parent.id,
            "failure_stage": "patch_apply",
            "failure_class": "patch_apply_failed",
            "failure_reason": "SEARCH block did not match",
            "failure_json_path": f"results_fixture/gen_{failed_gen}/failure.json",
            "patch_type": "diff",
            "patch_name": f"broken_patch_g{failed_gen}",
        }
        db.cursor.execute(
            "INSERT INTO attempt_log (generation, stage, status, details, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                failed_gen,
                "proposal",
                "failed",
                json.dumps(details),
                BASE_TIME + failed_gen * 100,
            ),
        )
    db.conn.commit()
    db.close()

    # Plot artifacts for generation 3, program 0.
    plots_dir = results_dir / "gen_3" / "results" / "plots"
    plots_dir.mkdir(parents=True, exist_ok=True)
    (plots_dir / "convergence.png").write_bytes(_PNG_BYTES)
    (plots_dir / "animation.gif").write_bytes(b"GIF89a")

    meta_dir = results_dir / "meta"
    meta_dir.mkdir(exist_ok=True)
    for processed_count in (5, 10, 20):
        _write_meta_file(meta_dir, processed_count)

    return results_dir


if __name__ == "__main__":
    import sys

    target = Path(sys.argv[1]).resolve()
    print(build_results_dir(target))
