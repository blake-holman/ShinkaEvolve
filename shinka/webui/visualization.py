"""Compatibility entry point for ``shinka_visualize``.

The server now lives in :mod:`shinka.webui.server`.  This module keeps the
``shinka.webui.visualization:main`` import path working.
"""

from .server.cli import main

__all__ = ["main"]

if __name__ == "__main__":
    raise SystemExit(main())
