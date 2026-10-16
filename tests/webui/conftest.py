"""Shared fixtures: a synthetic results directory and a live dashboard server."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

from shinka.webui.server import ServerContext, make_server

from .fixture_builder import build_results_dir

DB_PATH = "results_fixture/evolution_db.sqlite"


@pytest.fixture(scope="session")
def results_root(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("shinka_results")
    build_results_dir(root)
    return root


class Client:
    def __init__(self, base_url: str):
        self.base_url = base_url

    def get(self, path: str, **params):
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def json(self, path: str, **params):
        status, headers, body = self.get(path, **params)
        assert "application/json" in headers.get("Content-Type", ""), headers
        return status, json.loads(body)


@pytest.fixture(scope="session")
def server(results_root: Path):
    ctx = ServerContext(search_root=results_root, pdf_export_enabled=False)
    httpd = make_server(ctx, "127.0.0.1", 0)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd
    finally:
        httpd.shutdown()
        httpd.server_close()


@pytest.fixture(scope="session")
def client(server) -> Client:
    return Client(f"http://127.0.0.1:{server.server_port}")
