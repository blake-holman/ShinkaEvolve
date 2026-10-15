"""HTTP server for the ShinkaEvolve results dashboard.

The package is split by responsibility:

- ``cli``: argument parsing and process entry point (``shinka_visualize``).
- ``app``: the threaded HTTP server, request routing, and static files.
- ``context``: per-server configuration shared by all handlers.
- ``paths``: resolution of client-supplied paths inside the search root.
- ``responses``: response objects and JSON encoding.
- ``db_reader``: read-only SQLite access with retries and change-aware caching.
- ``failed_nodes``: synthetic tree nodes for proposals that never reached evaluation.
- ``endpoints``: one module per API resource.
- ``pdf_export``: conversion of meta scratchpad files to PDF.
"""

from .app import make_server, serve_forever
from .context import ServerContext

__all__ = ["ServerContext", "make_server", "serve_forever"]
