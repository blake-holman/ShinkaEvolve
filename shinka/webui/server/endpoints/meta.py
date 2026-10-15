"""Meta scratchpad files written by the summarizer (``meta/meta_<count>.txt``)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List

from ..context import ServerContext
from ..paths import resolve_database, results_dir_for
from ..pdf_export import meta_to_pdf
from ..responses import BadRequest, NotFound, Response, file_response, json_response

logger = logging.getLogger("shinka.webui")


def meta_dir_for(results_dir: Path) -> Path:
    """``meta/`` inside the run directory, or the run directory itself for old runs."""
    meta_dir = results_dir / "meta"
    return meta_dir if meta_dir.is_dir() else results_dir


def list_meta_files(results_dir: Path) -> List[Dict[str, Any]]:
    meta_dir = meta_dir_for(results_dir)
    found = []
    for path in meta_dir.glob("meta_*.txt"):
        try:
            processed_count = int(path.stem[len("meta_") :])
        except ValueError:
            continue
        found.append(
            {
                "processed_count": processed_count,
                "generation": processed_count,  # alias kept for older clients
                "filename": path.name,
                "path": str(path),
            }
        )
    found.sort(key=lambda item: item["processed_count"])
    return found


def _processed_count(query: Dict[str, str]) -> int:
    raw = query.get("processed_count", query.get("generation"))
    if raw is None:
        raise BadRequest("Missing processed_count")
    try:
        return int(raw)
    except ValueError as exc:
        raise BadRequest("processed_count must be an integer") from exc


def _meta_file(results_dir: Path, processed_count: int) -> Path:
    filename = f"meta_{processed_count}.txt"
    for candidate in (results_dir / "meta" / filename, results_dir / filename):
        if candidate.is_file():
            return candidate
    raise NotFound(f"Meta file not found: {filename}")


def get_meta_files(ctx: ServerContext, query: Dict[str, str]) -> Response:
    db_file = resolve_database(ctx.search_root, query["db_path"])
    results_dir = results_dir_for(db_file)
    if not meta_dir_for(results_dir).is_dir():
        raise NotFound("Meta directory not found")
    return json_response(list_meta_files(results_dir))


def get_meta_content(ctx: ServerContext, query: Dict[str, str]) -> Response:
    db_file = resolve_database(ctx.search_root, query["db_path"])
    processed_count = _processed_count(query)
    path = _meta_file(results_dir_for(db_file), processed_count)
    return json_response(
        {
            "processed_count": processed_count,
            "generation": processed_count,
            "filename": path.name,
            "content": path.read_text(encoding="utf-8"),
        }
    )


def download_meta_pdf(ctx: ServerContext, query: Dict[str, str]) -> Response:
    db_file = resolve_database(ctx.search_root, query["db_path"])
    processed_count = _processed_count(query)
    path = _meta_file(results_dir_for(db_file), processed_count)
    content = path.read_text(encoding="utf-8")

    pdf_bytes = None
    if ctx.pdf_export_enabled:
        pdf_bytes = meta_to_pdf(
            content, str(processed_count), ctx.static_dir / "favicon.png"
        )
    if pdf_bytes is None:
        logger.info("No PDF renderer available; serving meta file as text")
        pdf_bytes = (
            f"Meta Generation {processed_count}\n{'=' * 50}\n\n{content}".encode(
                "utf-8"
            )
        )
    return file_response(
        pdf_bytes, "application/pdf", download_name=f"meta_{processed_count}.pdf"
    )
