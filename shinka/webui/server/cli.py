"""``shinka_visualize`` command line entry point."""

from __future__ import annotations

import argparse
import logging
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Optional, Sequence

from .app import make_server
from .context import ServerContext

DEFAULT_PORT = 8000
DEFAULT_HOST = "127.0.0.1"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="shinka_visualize",
        description="Serve the ShinkaEvolve results dashboard.",
    )
    parser.add_argument(
        "root_directory",
        nargs="?",
        default=".",
        help="Directory searched for evolution databases (default: current directory).",
    )
    parser.add_argument(
        "-p",
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT}).",
    )
    parser.add_argument(
        "--host",
        default=DEFAULT_HOST,
        help=(
            "Interface to bind (default: 127.0.0.1, local access only). "
            "Use 0.0.0.0 to accept connections from other machines."
        ),
    )
    parser.add_argument(
        "--open",
        dest="open_browser",
        action="store_true",
        help="Open the dashboard in a browser.",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="Database file (relative to the root directory) to open directly.",
    )
    parser.add_argument(
        "--no-pdf",
        dest="pdf_export",
        action="store_false",
        help="Disable PDF export, which shells out to wkhtmltopdf or pandoc.",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Log every request."
    )
    return parser


def dashboard_url(host: str, port: int, db: Optional[str]) -> str:
    display_host = "localhost" if host in ("0.0.0.0", "", "::") else host
    base = f"http://{display_host}:{port}"
    if db:
        return f"{base}/viz_tree.html?{urllib.parse.urlencode({'db_path': db})}"
    return f"{base}/"


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    search_root = Path(args.root_directory).resolve()
    if not search_root.is_dir():
        print(f"Error: root directory does not exist: {search_root}", file=sys.stderr)
        return 1
    if args.db and not (search_root / args.db).is_file():
        print(
            f"Error: database not found under {search_root}: {args.db}", file=sys.stderr
        )
        return 1

    ctx = ServerContext(search_root=search_root, pdf_export_enabled=args.pdf_export)
    try:
        server = make_server(ctx, args.host, args.port)
    except OSError as error:
        print(
            f"Error: could not bind {args.host}:{args.port}: {error}", file=sys.stderr
        )
        return 1

    url = dashboard_url(args.host, server.server_port, args.db)
    print(f"[*] Searching for databases in: {search_root}")
    print(f"[*] Serving http://{args.host}:{server.server_port}  (Ctrl+C to stop)")
    print(f"→ Visit {url}")
    if args.host == DEFAULT_HOST:
        print("(forward the port with ssh -L if this is a remote host)")

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    if args.open_browser:
        try:
            webbrowser.open_new_tab(url)
        except Exception as error:
            print(f"→ Could not open a browser automatically: {error}")
    try:
        thread.join()
    except KeyboardInterrupt:
        print("\n[*] Shutting down.")
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
