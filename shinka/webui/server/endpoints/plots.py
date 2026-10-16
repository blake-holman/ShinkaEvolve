"""Plot images saved by evaluations under ``gen_<N>/results/plots/``."""

from __future__ import annotations

from typing import Any, Dict, List

from ..context import ServerContext
from ..paths import (
    display_relative,
    resolve_database,
    resolve_existing_file,
    results_dir_for,
)
from ..responses import BadRequest, Response, file_response, json_response

IMAGE_TYPES = {
    ".png": "image/png",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def get_plots(ctx: ServerContext, query: Dict[str, str]) -> Response:
    db_file = resolve_database(ctx.search_root, query["db_path"])
    generation = query["generation"]
    if not generation.isdigit():
        raise BadRequest("generation must be a non-negative integer")
    plots_dir = (
        results_dir_for(db_file) / f"gen_{int(generation)}" / "results" / "plots"
    )
    found: List[Dict[str, Any]] = []
    if plots_dir.is_dir():
        for path in sorted(plots_dir.iterdir(), key=lambda p: p.name):
            ext = path.suffix.lower()
            if path.is_file() and ext in IMAGE_TYPES:
                found.append(
                    {
                        "filename": path.name,
                        "path": display_relative(ctx.search_root, path),
                        "type": "animation" if ext == ".gif" else "image",
                        "ext": ext,
                    }
                )
    return json_response(found)


def serve_plot_file(ctx: ServerContext, relative_path: str) -> Response:
    path = resolve_existing_file(ctx.search_root, relative_path, what="Plot file")
    content_type = IMAGE_TYPES.get(path.suffix.lower(), "application/octet-stream")
    return file_response(path.read_bytes(), content_type, cache_seconds=3600)
