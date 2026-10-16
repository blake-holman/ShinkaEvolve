"""Program endpoints: full list, summaries, change-detection count, details."""

from __future__ import annotations

from typing import Any, Dict, List

from ..context import ServerContext
from ..db_reader import open_program_db, with_retries
from ..failed_nodes import load_failed_proposal_nodes, parse_failed_node_generation
from ..paths import resolve_database
from ..responses import NotFound, Response, json_response


def _programs_with_failures(
    ctx: ServerContext, db_file, *, summary: bool
) -> List[Dict[str, Any]]:
    def read() -> List[Dict[str, Any]]:
        with open_program_db(db_file) as db:
            if summary:
                rows = db.get_programs_summary()
            else:
                rows = [program.to_dict() for program in db.get_all_programs()]
        rows.extend(
            load_failed_proposal_nodes(ctx.search_root, db_file, include_code=False)
        )
        return rows

    kind = "summary" if summary else "programs"
    return ctx.cache.get_or_compute(
        (kind, str(db_file)),
        db_file,
        lambda: with_retries(read, description=f"{kind} read"),
    )


def get_programs(ctx: ServerContext, query: Dict[str, str]) -> Response:
    """Every program with code and embeddings. Heavy; prefer the summary."""
    db_file = resolve_database(ctx.search_root, query["db_path"])
    return json_response(_programs_with_failures(ctx, db_file, summary=False))


# Metadata the run page never reads from the summary; it fetches them per
# program from /get_program_details instead. Logs dominate the payload of
# real runs (tens of megabytes for a few thousand programs).
HEAVY_METADATA_KEYS = (
    "stdout_log",
    "stderr_log",
    "thought",
    "patch_description",
    "code_analysis_metrics",
    "novelty_explanation",
    "diff_summary",
    "artifacts",
    # Summarizer notes some branches copy into every program's metadata.
    "meta_summary",
    "meta_scratch_pad",
    "meta_recommendations",
)
LLM_RESULT_KEEP = (
    "model_name",
    "cost",
    "input_tokens",
    "output_tokens",
    "thinking_tokens",
)
FEEDBACK_LIMIT = 500


def lighten_summary_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """A copy of a summary row without logs, LLM text, or embedding projections."""
    light = {
        key: value
        for key, value in row.items()
        if key not in ("embedding_pca_2d", "embedding_pca_3d", "embedding", "code")
    }
    metadata = dict(row.get("metadata") or {})
    for key in HEAVY_METADATA_KEYS:
        metadata.pop(key, None)
    llm = metadata.get("llm_result")
    if isinstance(llm, dict):
        metadata["llm_result"] = {k: llm[k] for k in LLM_RESULT_KEEP if k in llm}
    light["metadata"] = metadata
    feedback = light.get("text_feedback")
    if isinstance(feedback, str) and len(feedback) > FEEDBACK_LIMIT:
        light["text_feedback"] = feedback[:FEEDBACK_LIMIT] + "…"
    reason = metadata.get("failure_reason")
    if isinstance(reason, str) and len(reason) > FEEDBACK_LIMIT:
        metadata["failure_reason"] = reason[:FEEDBACK_LIMIT] + "…"
    return light


def get_programs_summary(ctx: ServerContext, query: Dict[str, str]) -> Response:
    """Every program without code or raw embeddings.

    With ``light=1`` heavy metadata (logs, LLM text, code metrics) is dropped
    as well; the advanced dashboard still uses the full summary.
    """
    db_file = resolve_database(ctx.search_root, query["db_path"])
    rows = _programs_with_failures(ctx, db_file, summary=True)
    if query.get("light") in ("1", "true"):
        rows = ctx.cache.get_or_compute(
            ("summary-light", str(db_file)),
            db_file,
            lambda: [lighten_summary_row(row) for row in rows],
        )
    return json_response(rows)


def get_program_count(ctx: ServerContext, query: Dict[str, str]) -> Response:
    """Program count and newest timestamp, used by the auto-refresh poll."""
    db_file = resolve_database(ctx.search_root, query["db_path"])

    def read() -> Dict[str, Any]:
        with open_program_db(db_file) as db:
            result = db.get_program_count_and_timestamp()
        failed = load_failed_proposal_nodes(ctx.search_root, db_file)
        if failed:
            result["count"] += len(failed)
            newest_failure = max(
                node["timestamp"]
                for node in failed
                if node.get("timestamp") is not None
            )
            if (
                result.get("max_timestamp") is None
                or newest_failure > result["max_timestamp"]
            ):
                result["max_timestamp"] = newest_failure
        return result

    result = ctx.cache.get_or_compute(
        ("count", str(db_file)),
        db_file,
        lambda: with_retries(read, description="count read"),
    )
    return json_response(result)


def get_program_details(ctx: ServerContext, query: Dict[str, str]) -> Response:
    """One program with code, or a failed proposal node with its generated code."""
    db_file = resolve_database(ctx.search_root, query["db_path"])
    program_id = query["id"]

    failed_generation = parse_failed_node_generation(program_id)
    if failed_generation is not None:
        nodes = load_failed_proposal_nodes(
            ctx.search_root, db_file, include_code=True, generation=failed_generation
        )
        if not nodes:
            raise NotFound(f"Program not found: {program_id}")
        return json_response(nodes[0])

    def read():
        with open_program_db(db_file) as db:
            return db.get(program_id)

    program = with_retries(read, description="program read")
    if program is None:
        raise NotFound(f"Program not found: {program_id}")
    return json_response(program.to_dict())
