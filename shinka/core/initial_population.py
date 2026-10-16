"""Validate, evaluate, and resume explicit seeds for native islands."""

import asyncio
import hashlib
import json
import math
from pathlib import Path
import time
import uuid

from shinka.database import Program
from shinka.utils import get_language_extension, truncate_log_tail


def validate_initial_population(seeds, num_islands):
    if seeds is None:
        return None
    if not isinstance(seeds, list) or len(seeds) != num_islands or not seeds:
        raise ValueError("initial_population must contain one seed per island.")
    manifest = []
    for seed in seeds:
        if not isinstance(seed, dict) or any(
            not isinstance(seed.get(key), str) or not seed[key]
            for key in ("name", "path", "sha256")
        ):
            raise ValueError("Each initial_population seed needs a name, path, and sha256.")
        require_correct = seed.get("require_correct", False)
        if type(require_correct) is not bool:
            raise ValueError("Seed require_correct must be a boolean.")
        path = Path(seed["path"]).resolve()
        if hashlib.sha256(path.read_bytes()).hexdigest() != seed["sha256"]:
            raise ValueError(f"Seed {seed['name']} differs from its frozen source hash.")
        manifest.append({"name": seed["name"], "path": str(path),
                         "sha256": seed["sha256"], "require_correct": require_correct})
    return manifest


def verify_initial_population_resume(database, seeds):
    saved = dict(database.cursor.execute(
        "SELECT key, value FROM metadata_store WHERE key IN "
        "('initial_population_manifest', 'initial_population_complete')"
    ).fetchall())
    if seeds is None:
        if saved:
            raise ValueError("Resuming this run requires its initial_population configuration.")
        return
    count = database.cursor.execute("SELECT COUNT(*) FROM programs").fetchone()[0]
    if not count and not saved:
        return
    if saved.get("initial_population_complete") != "true":
        raise ValueError("Incomplete initial population insertion; use a fresh results directory.")
    if saved.get("initial_population_manifest") != json.dumps(seeds, sort_keys=True):
        raise ValueError("The initial_population manifest differs from the saved run.")
    rows = database.cursor.execute(
        "SELECT code, metadata, correct, island_idx FROM programs WHERE generation = 0 "
        "AND COALESCE(json_extract(metadata, '$._spawned_island'), 0) = 0"
    ).fetchall()
    if len(rows) != len(seeds):
        raise ValueError("Incomplete initial population: saved seeds are missing or duplicated.")
    seen = set()
    for row in rows:
        metadata = json.loads(row["metadata"] or "{}")
        index = metadata.get("initial_population_index")
        if (type(index) is not int or index in seen or not 0 <= index < len(seeds)
                or row["island_idx"] != index):
            raise ValueError("Invalid initial population island assignment in the saved run.")
        seed = seeds[index]
        if (hashlib.sha256(row["code"].encode()).hexdigest() != seed["sha256"]
                or metadata.get("initial_population_sha256") != seed["sha256"]
                or (seed["require_correct"] and not row["correct"])):
            raise ValueError("Saved initial population differs from its frozen source.")
        seen.add(index)


def validate_evaluation(results):
    """Check the scheduler's external evaluator output before trusting it."""
    if not isinstance(results, dict):
        raise ValueError("Evaluation results must be a mapping.")
    correctness = results.get("correct")
    metrics = results.get("metrics")
    if not isinstance(correctness, dict) or type(correctness.get("correct")) is not bool:
        raise ValueError("Evaluation correctness must be a boolean.")
    if not isinstance(metrics, dict):
        raise ValueError("Evaluation metrics must be a mapping.")
    score = metrics.get("combined_score")
    if type(score) not in (int, float) or not math.isfinite(score):
        raise ValueError("Evaluation combined_score must be finite.")
    if any(not isinstance(metrics.get(key, {}), dict) for key in ("public", "private")):
        raise ValueError("Evaluation public and private metrics must be mappings.")
    if correctness["correct"] and (results.get("error") or correctness.get("error")):
        raise ValueError("An evaluation error cannot establish correctness.")
    return correctness["correct"], metrics


async def initialize_population(runner, seeds):
    """Validate every evaluation before adding any seed to the database."""
    programs = []
    for index, seed in enumerate(seeds):
        started = time.time()
        source = Path(seed["path"]).read_bytes().decode("utf-8")
        if hashlib.sha256(source.encode()).hexdigest() != seed["sha256"]:
            raise ValueError(f"Seed {seed['name']} differs from its frozen source hash.")
        work = Path(runner.results_dir) / "gen_0"
        if index:
            work /= f"seed_{index}"
        work.mkdir(parents=True, exist_ok=True)
        candidate = work / f"main.{get_language_extension(runner.evo_config.language)}"
        candidate.write_text(source, encoding="utf-8")
        results, runtime = await asyncio.to_thread(
            runner.scheduler.run, str(candidate), str(work / "results")
        )
        correct, metrics = validate_evaluation(results)
        if seed["require_correct"] and not correct:
            raise ValueError(f"Seed {seed['name']} must be correct before initializing the population.")
        embedding, embed_cost = await runner._get_code_embedding_async(str(candidate))
        programs.append(Program(
            id=str(uuid.uuid4()), code=source, language=runner.evo_config.language,
            generation=0, correct=correct, combined_score=metrics["combined_score"],
            public_metrics=metrics.get("public", {}), private_metrics=metrics.get("private", {}),
            text_feedback=metrics.get("text_feedback", ""), embedding=embedding or [],
            metadata={"patch_type": "init", "patch_name": seed["name"],
                      "initial_population_index": index, "initial_population_sha256": seed["sha256"],
                      "seed_program_path": str(candidate), "seed_results_dir": str(work / "results"),
                      "api_costs": 0.0, "embed_cost": embed_cost, "novelty_cost": 0.0,
                      "evaluation_seconds": runtime, "pipeline_started_at": started,
                      "pipeline_finished_at": time.time(),
                      "stdout_log": truncate_log_tail(results.get("stdout_log", ""),
                                                      runner.db_config.max_stdout_log_chars),
                      "stderr_log": results.get("stderr_log", "")}))
    runner.db._update_metadata_in_db("initial_population_manifest", json.dumps(seeds, sort_keys=True))
    runner.db._update_metadata_in_db("initial_population_complete", "false")
    for program in programs:
        await runner.async_db.add_program_async(program, verbose=runner.verbose)
        runner.total_api_cost += program.metadata["embed_cost"]
        if runner.meta_summarizer:
            runner.meta_summarizer.add_evaluated_program(program)
        runner._log_program_to_wandb(program)
    runner.db._update_metadata_in_db("initial_population_complete", "true")
    if runner.llm_selection is not None:
        best = runner.db.get_best_program()
        runner.llm_selection.set_baseline_score(best.combined_score if best else 0)
    runner.completed_generations = 1
    runner._record_progress()
