"""``/get_database_stats``: aggregate numbers for the landing page table."""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Any, Dict

from ..context import ServerContext
from ..db_reader import open_sqlite_readonly, with_retries
from ..paths import resolve_database, results_dir_for
from ..responses import HttpError, Response, json_response

logger = logging.getLogger("shinka.webui")

_COST_SUM = " + ".join(
    f"COALESCE(CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.{key}') ELSE 0 END, 0)"
    for key in ("api_costs", "embed_cost", "novelty_cost", "meta_cost")
)

STATS_QUERY = f"""
    SELECT
        COUNT(*) AS program_count,
        COUNT(DISTINCT generation) AS generation_count,
        SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct_count,
        MAX(CASE WHEN correct = 1 THEN combined_score ELSE NULL END) AS best_score,
        MAX(generation) AS max_generation,
        MIN(timestamp) AS first_update,
        MAX(timestamp) AS last_update,
        MIN(CASE WHEN json_valid(metadata)
                 THEN json_extract(metadata, '$.pipeline_started_at') ELSE NULL END)
            AS first_pipeline_start,
        MAX(CASE WHEN json_valid(metadata)
                 THEN json_extract(metadata, '$.postprocess_finished_at') ELSE NULL END)
            AS last_postprocess_finish,
        SUM({_COST_SUM}) AS total_cost
    FROM programs
"""

EMPTY_STATS: Dict[str, Any] = {
    "program_count": 0,
    "best_score": None,
    "max_generation": 0,
    "total_cost": 0,
    "total_runtime_seconds": None,
}


def _prompt_stats(prompts_file: Path) -> Dict[str, Any]:
    stats = {"prompt_count": 0, "prompt_evo_cost": 0, "has_prompt_evo": False}
    if not prompts_file.is_file():
        return stats
    try:
        with open_sqlite_readonly(prompts_file, timeout=2.0) as conn:
            count = conn.execute("SELECT COUNT(*) AS n FROM system_prompts").fetchone()[
                "n"
            ]
            cost = conn.execute(
                """
                SELECT SUM(CASE WHEN json_valid(metadata)
                           THEN COALESCE(json_extract(metadata, '$.llm.cost'), 0)
                           ELSE 0 END) AS prompt_cost
                FROM system_prompts
                """
            ).fetchone()["prompt_cost"]
    except sqlite3.Error as error:
        logger.warning("Could not read prompt stats from %s: %s", prompts_file, error)
        return stats
    stats["prompt_count"] = count or 0
    stats["has_prompt_evo"] = bool(count)
    stats["prompt_evo_cost"] = cost or 0
    return stats


def compute_stats(db_file: Path) -> Dict[str, Any]:
    with open_sqlite_readonly(db_file) as conn:
        row = conn.execute(STATS_QUERY).fetchone()
        best_gen = None
        if row["best_score"] is not None:
            best_row = conn.execute(
                "SELECT MIN(generation) AS best_gen FROM programs"
                " WHERE correct = 1 AND combined_score = ?",
                (row["best_score"],),
            ).fetchone()
            if best_row and best_row["best_gen"] is not None:
                best_gen = best_row["best_gen"]

    max_gen = row["max_generation"] or 0
    runtime_start = row["first_pipeline_start"]
    if runtime_start is None:
        runtime_start = row["first_update"]
    runtime_end = row["last_postprocess_finish"]
    if runtime_end is None:
        runtime_end = row["last_update"]
    total_runtime = None
    if runtime_start is not None and runtime_end is not None:
        total_runtime = max(0.0, runtime_end - runtime_start)

    stats = {
        "program_count": row["program_count"] or 0,
        "generation_count": row["generation_count"] or 0,
        "correct_count": row["correct_count"] or 0,
        "best_score": row["best_score"],
        "best_generation": best_gen,
        "max_generation": max_gen,
        "last_update": row["last_update"],
        "gens_since_improvement": max_gen - best_gen
        if best_gen is not None
        else max_gen,
        "total_cost": row["total_cost"] or 0,
        "total_runtime_seconds": total_runtime,
    }
    stats.update(_prompt_stats(results_dir_for(db_file) / "prompts.sqlite"))
    return stats


def get_database_stats(ctx: ServerContext, query: Dict[str, str]) -> Response:
    """Stats for one database; errors become an ``error`` field, not a failure."""
    try:
        db_file = resolve_database(ctx.search_root, query["db_path"])
    except HttpError as error:
        if error.status == 404:
            return json_response({"error": "not_found"})
        raise
    try:
        stats = ctx.cache.get_or_compute(
            ("stats", str(db_file)),
            db_file,
            lambda: with_retries(
                lambda: compute_stats(db_file),
                attempts=3,
                initial_delay=0.1,
                description="stats read",
            ),
        )
    except Exception as error:
        logger.warning("Stats failed for %s: %s", db_file, error)
        return json_response({**EMPTY_STATS, "error": str(error)})
    return json_response(stats)
