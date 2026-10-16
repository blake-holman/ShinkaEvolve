"""Locate dashboard page sources for the string-based regression tests.

Pages are an HTML shell plus static CSS and ES modules; tests that used to
scan one inline file now scan the shell together with its modules.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
WEBUI = REPO_ROOT / "shinka" / "webui"
STATIC = WEBUI / "static"


def _concat(*paths: Path) -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in paths)


def viz_tree_source() -> str:
    modules = sorted((STATIC / "js" / "viz_tree").glob("*.js"))
    return _concat(WEBUI / "viz_tree.html", STATIC / "css" / "viz_tree.css", *modules)


def viz_tree_js() -> str:
    return _concat(*sorted((STATIC / "js" / "viz_tree").glob("*.js")))


def index_source() -> str:
    return _concat(
        WEBUI / "index.html", STATIC / "css" / "index.css", STATIC / "js" / "index.js"
    )


def compare_source() -> str:
    return _concat(
        WEBUI / "compare.html",
        STATIC / "css" / "compare.css",
        STATIC / "js" / "compare.js",
    )
