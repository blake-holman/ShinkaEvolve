"""Threaded HTTP server, request routing, and static file serving."""

from __future__ import annotations

import http.server
import logging
import mimetypes
import socketserver
import urllib.parse
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from .context import ServerContext
from .endpoints import databases, meta, plots, programs, prompts, stats
from .responses import BadRequest, HttpError, NotFound, Response, error_response
from .responses import file_response

logger = logging.getLogger("shinka.webui")

Handler = Callable[[ServerContext, Dict[str, str]], Response]

HTML_SHELLS = {"/", "/index.html", "/run.html", "/viz_tree.html", "/compare.html"}

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


@dataclass(frozen=True)
class Route:
    path: str
    handler: Handler
    required: Tuple[str, ...] = ()
    any_of: Tuple[str, ...] = ()


ROUTES: List[Route] = [
    Route("/list_databases", databases.list_databases),
    Route("/get_programs", programs.get_programs, ("db_path",)),
    Route("/get_programs_summary", programs.get_programs_summary, ("db_path",)),
    Route("/get_program_count", programs.get_program_count, ("db_path",)),
    Route("/get_program_details", programs.get_program_details, ("db_path", "id")),
    Route("/get_meta_files", meta.get_meta_files, ("db_path",)),
    Route(
        "/get_meta_content",
        meta.get_meta_content,
        ("db_path",),
        any_of=("processed_count", "generation"),
    ),
    Route(
        "/download_meta_pdf",
        meta.download_meta_pdf,
        ("db_path",),
        any_of=("processed_count", "generation"),
    ),
    Route("/get_plots", plots.get_plots, ("db_path", "generation", "program_id")),
    Route("/get_system_prompts", prompts.get_system_prompts, ("db_path",)),
    Route("/get_database_stats", stats.get_database_stats, ("db_path",)),
]

ROUTE_TABLE = {route.path: route for route in ROUTES}


def dispatch(
    ctx: ServerContext, path: str, query: Dict[str, str]
) -> Optional[Response]:
    """Run the API handler for ``path`` or return ``None`` for static paths."""
    if path.startswith("/plot_file/"):
        relative = urllib.parse.unquote(path[len("/plot_file/") :])
        return plots.serve_plot_file(ctx, relative)
    route = ROUTE_TABLE.get(path)
    if route is None:
        return None
    missing = [name for name in route.required if name not in query]
    if missing:
        raise BadRequest(f"Missing query parameter: {', '.join(missing)}")
    if route.any_of and not any(name in query for name in route.any_of):
        raise BadRequest(f"Missing query parameter: one of {', '.join(route.any_of)}")
    return route.handler(ctx, query)


def serve_static(ctx: ServerContext, path: str) -> Response:
    """Serve a file from the web UI directory (HTML shells, static assets)."""
    if path == "/":
        path = "/index.html"
    relative = urllib.parse.unquote(path).lstrip("/")
    root = ctx.static_dir
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise NotFound("Not found") from exc
    if not candidate.is_file():
        raise NotFound("Not found")
    content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
    if content_type.startswith("text/") or content_type in (
        "application/javascript",
        "application/json",
    ):
        content_type += "; charset=utf-8"
    response = file_response(candidate.read_bytes(), content_type)
    if path in HTML_SHELLS:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    elif "/static/vendor/" in path:
        response.headers["Cache-Control"] = "max-age=86400"
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response


class DashboardRequestHandler(http.server.BaseHTTPRequestHandler):
    """Routes GET requests to API handlers or static files."""

    server_version = "ShinkaDashboard/1"
    ctx: ServerContext  # injected by make_server

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
        logger.debug("%s - %s", self.address_string(), format % args)

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib naming
        self._handle(head_only=True)

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        self._handle()

    def _handle(self, head_only: bool = False) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = {
            key: values[0]
            for key, values in urllib.parse.parse_qs(parsed.query).items()
        }
        try:
            response = dispatch(self.ctx, parsed.path, query)
            if response is None:
                response = serve_static(self.ctx, parsed.path)
        except HttpError as error:
            response = error_response(error.status, error.message)
        except Exception as error:  # last resort: never leave the client hanging
            logger.exception("Unhandled error serving %s", self.path)
            response = error_response(500, f"Internal server error: {error}")
        self._write(response, head_only)

    def _write(self, response: Response, head_only: bool) -> None:
        self.send_response(response.status)
        self.send_header("Content-Type", response.content_type)
        self.send_header("Content-Length", str(len(response.body)))
        for key, value in {**SECURITY_HEADERS, **response.headers}.items():
            self.send_header(key, value)
        self.end_headers()
        if not head_only:
            try:
                self.wfile.write(response.body)
            except (BrokenPipeError, ConnectionResetError):
                logger.debug("Client disconnected while sending %s", self.path)


class DashboardServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """One thread per request so a slow read never blocks the polling tabs."""

    daemon_threads = True
    allow_reuse_address = True


def make_server(
    ctx: ServerContext, host: str = "127.0.0.1", port: int = 0
) -> DashboardServer:
    """Create a bound server. ``port=0`` picks a free port (``server.server_port``)."""
    handler_cls = type(
        "BoundDashboardRequestHandler", (DashboardRequestHandler,), {"ctx": ctx}
    )
    return DashboardServer((host, port), handler_cls)


def serve_forever(ctx: ServerContext, host: str, port: int) -> None:
    with make_server(ctx, host, port) as server:
        logger.info("Serving dashboard on http://%s:%d", host, server.server_port)
        server.serve_forever()
