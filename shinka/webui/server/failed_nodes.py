"""Synthetic tree nodes for proposals that failed before evaluation.

The async runner records such failures in the ``attempt_log`` table with a
``failure.json`` payload on disk.  The dashboard shows them as red nodes so
the user can see what was attempted and why it failed.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional

from .db_reader import open_sqlite_readonly

FAILED_NODE_PREFIX = "failed:proposal:"

LANGUAGE_BY_SUFFIX = {
    "py": "python",
    "js": "javascript",
    "ts": "typescript",
    "cpp": "cpp",
    "cc": "cpp",
    "cxx": "cpp",
    "cu": "cuda",
    "go": "go",
    "sv": "verilog",
    "f90": "fortran",
    "f95": "fortran",
    "f03": "fortran",
    "f08": "fortran",
    "lean": "lean",
    "jl": "julia",
    "rs": "rust",
}

SUFFIX_BY_LANGUAGE = {
    "python": ".py",
    "javascript": ".js",
    "typescript": ".ts",
    "cpp": ".cpp",
    "cuda": ".cu",
    "go": ".go",
    "verilog": ".sv",
    "fortran": ".f90",
    "lean": ".lean",
    "julia": ".jl",
    "rust": ".rs",
}

FAILURE_PAYLOAD_KEYS = [
    "failure_json_path",
    "language",
    "generated_code_available",
    "downstream_eval_submitted",
    "artifacts",
    "attempts",
    "api_costs",
    "embed_cost",
    "novelty_cost",
    "novelty_explanation",
    "max_similarity",
]


def make_failed_node_id(generation: int) -> str:
    return f"{FAILED_NODE_PREFIX}{generation}"


def parse_failed_node_generation(node_id: str) -> Optional[int]:
    if not node_id.startswith(FAILED_NODE_PREFIX):
        return None
    try:
        return int(node_id[len(FAILED_NODE_PREFIX) :])
    except ValueError:
        return None


def language_from_suffix(suffix: str) -> str:
    ext = suffix.lstrip(".").lower()
    return LANGUAGE_BY_SUFFIX.get(ext, ext or "python")


def _inside_root(search_root: Path, relative: Optional[str]) -> Optional[Path]:
    """Resolve a path from a failure payload, ignoring anything outside the root."""
    if not relative:
        return None
    candidate = (search_root / relative).resolve()
    try:
        candidate.relative_to(search_root.resolve())
    except ValueError:
        return None
    return candidate


def read_failure_json(
    search_root: Path, failure_json_path: Optional[str]
) -> Optional[Dict[str, Any]]:
    path = _inside_root(search_root, failure_json_path)
    if path is None or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def resolve_language(
    search_root: Path, details: Dict[str, Any], payload: Optional[Dict[str, Any]]
) -> str:
    for source in (payload or {}, details):
        language = source.get("language")
        if language:
            return str(language)
    generated = ((payload or {}).get("artifacts") or {}).get("generated_code_path")
    if generated:
        return language_from_suffix(Path(generated).suffix)
    failure_path = _inside_root(search_root, details.get("failure_json_path"))
    if failure_path is not None:
        candidates = sorted(failure_path.parent.glob("main.*"))
        if candidates:
            return language_from_suffix(candidates[0].suffix)
    return "python"


def resolve_code_path(
    search_root: Path, details: Dict[str, Any], payload: Optional[Dict[str, Any]]
) -> Optional[Path]:
    generated = ((payload or {}).get("artifacts") or {}).get("generated_code_path")
    code_path = _inside_root(search_root, generated)
    if code_path is not None and code_path.is_file():
        return code_path
    failure_path = _inside_root(search_root, details.get("failure_json_path"))
    if failure_path is None:
        return None
    language = resolve_language(search_root, details, payload)
    preferred_suffix = SUFFIX_BY_LANGUAGE.get(language)
    if preferred_suffix:
        preferred = failure_path.parent / f"main{preferred_suffix}"
        if preferred.is_file():
            return preferred
    candidates = sorted(failure_path.parent.glob("main.*"))
    return candidates[0] if candidates else None


def build_failed_node(
    search_root: Path,
    *,
    generation: int,
    created_at: float,
    details: Dict[str, Any],
    include_code: bool = False,
) -> Dict[str, Any]:
    payload = read_failure_json(search_root, details.get("failure_json_path"))
    metadata = dict(details)
    if payload:
        for key in FAILURE_PAYLOAD_KEYS:
            if key in payload:
                metadata[key] = payload[key]
    language = resolve_language(search_root, details, payload)
    code = None
    if include_code and payload:
        code_path = resolve_code_path(search_root, details, payload)
        if code_path is not None:
            try:
                code = code_path.read_text(encoding="utf-8")
            except OSError:
                code = None
    return {
        "id": make_failed_node_id(generation),
        "code": code,
        "language": language,
        "parent_id": details.get("parent_id"),
        "archive_inspiration_ids": details.get("archive_inspiration_ids") or [],
        "top_k_inspiration_ids": details.get("top_k_inspiration_ids") or [],
        "island_idx": None,
        "generation": generation,
        "timestamp": created_at,
        "code_diff": None,
        "combined_score": 0.0,
        "public_metrics": {},
        "private_metrics": {},
        "text_feedback": details.get("failure_reason", ""),
        "correct": False,
        "children_count": 0,
        "complexity": 0.0,
        "embedding": [],
        "embedding_pca_2d": [],
        "embedding_pca_3d": [],
        "embedding_cluster_id": None,
        "migration_history": [],
        "metadata": metadata,
        "in_archive": False,
        "system_prompt_id": metadata.get("system_prompt_id"),
    }


def load_failed_proposal_nodes(
    search_root: Path,
    db_file: Path,
    *,
    include_code: bool = False,
    generation: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """One synthetic node per generation that ended in a failed proposal."""
    query = """
        SELECT generation, details, created_at
        FROM attempt_log
        WHERE status = 'failed'
          AND json_valid(details)
          AND json_extract(details, '$.node_kind') = 'failed_proposal'
    """
    params: List[Any] = []
    if generation is not None:
        query += " AND generation = ?"
        params.append(generation)
    query += " ORDER BY generation ASC, created_at DESC, id DESC"

    selected: Dict[int, Dict[str, Any]] = {}
    with open_sqlite_readonly(db_file) as conn:
        try:
            rows = conn.execute(query, params).fetchall()
        except sqlite3.OperationalError as error:
            if "no such table" in str(error).lower():
                return []
            raise
    for row in rows:
        gen = int(row["generation"])
        if gen in selected:
            continue
        try:
            details = json.loads(row["details"])
        except json.JSONDecodeError:
            continue
        selected[gen] = build_failed_node(
            search_root,
            generation=gen,
            created_at=float(row["created_at"]),
            details=details,
            include_code=include_code,
        )
    return [selected[gen] for gen in sorted(selected)]
