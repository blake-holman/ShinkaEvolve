"""``/list_databases``: discover program databases under the search root."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List

from ..context import ServerContext
from ..responses import Response, json_response

DATE_PATTERN = re.compile(r"_(\d{8}_\d{6})")
PROMPT_DB_NAMES = {"prompts.db", "prompts.sqlite"}
SKIPPED_DIRS = {"node_modules", "__pycache__", ".venv", "venv"}


def describe_database(search_root: Path, db_file: Path) -> Dict[str, Any]:
    relative = db_file.relative_to(search_root).as_posix()
    parts = relative.split("/")
    if len(parts) >= 2:
        name = "/".join(parts[:-1])
        task = parts[0]
    else:
        name = relative
        task = search_root.name
    match = DATE_PATTERN.search(relative)
    return {
        "path": relative,
        "name": name,
        "task": task,
        "actual_path": relative,
        "_sort_key": match.group(1) if match else "0",
    }


def find_databases(search_root: Path) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []
    if not search_root.is_dir():
        return found
    for dirpath, dirnames, filenames in os.walk(search_root):
        dirnames[:] = sorted(
            d for d in dirnames if not d.startswith(".") and d not in SKIPPED_DIRS
        )
        for filename in sorted(filenames):
            lowered = filename.lower()
            if lowered in PROMPT_DB_NAMES or not lowered.endswith((".db", ".sqlite")):
                continue
            found.append(describe_database(search_root, Path(dirpath) / filename))
    found.sort(key=lambda item: item["_sort_key"], reverse=True)
    for item in found:
        del item["_sort_key"]
    return found


def list_databases(ctx: ServerContext, query: Dict[str, str]) -> Response:
    return json_response(find_databases(ctx.search_root))
