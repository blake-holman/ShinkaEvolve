"""Resolve client-supplied paths while keeping them inside the search root."""

from __future__ import annotations

import os
from pathlib import Path

from .responses import BadRequest, Forbidden, NotFound


def resolve_within(root: Path, relative: str) -> Path:
    """Return ``root / relative`` resolved, or raise if it escapes ``root``.

    Absolute paths, ``..`` segments that climb above the root, and symlinks
    pointing outside the root are all rejected with 403.
    """
    if not relative or not isinstance(relative, str):
        raise BadRequest("Missing path")
    if os.path.isabs(relative) or relative.startswith(("\\", "//")):
        raise Forbidden("Absolute paths are not allowed")
    root = root.resolve()
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise Forbidden("Path escapes the results directory") from exc
    return candidate


def resolve_existing_file(root: Path, relative: str, *, what: str = "File") -> Path:
    """Like :func:`resolve_within` but also require a regular file."""
    path = resolve_within(root, relative)
    if not path.is_file():
        raise NotFound(f"{what} not found: {relative}")
    return path


def resolve_database(root: Path, db_path: str) -> Path:
    """Resolve the ``db_path`` query parameter to an existing SQLite file."""
    return resolve_existing_file(root, db_path, what="Database file")


def results_dir_for(db_file: Path) -> Path:
    """The run directory that owns a database file."""
    return db_file.parent


def display_relative(root: Path, path: Path) -> str:
    """Path relative to the search root using forward slashes."""
    return path.resolve().relative_to(root.resolve()).as_posix()
