"""HTTP-level tests for the dashboard server."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from shinka.webui.server.db_reader import ReadCache
from shinka.webui.server.paths import resolve_within
from shinka.webui.server.responses import Forbidden

from .conftest import DB_PATH


def test_list_databases_finds_fixture(client):
    status, data = client.json("/list_databases")
    assert status == 200
    paths = [entry["path"] for entry in data]
    assert DB_PATH in paths
    assert not any(p.endswith("prompts.sqlite") for p in paths)
    entry = next(e for e in data if e["path"] == DB_PATH)
    assert entry["task"] == "results_fixture"
    assert entry["name"] == "results_fixture"


def test_programs_summary_includes_failed_proposals(client):
    status, data = client.json("/get_programs_summary", db_path=DB_PATH)
    assert status == 200
    failed = [p for p in data if p["id"].startswith("failed:proposal:")]
    assert {p["generation"] for p in failed} == {5, 9}
    assert all("code" not in p for p in data if not p["id"].startswith("failed:"))
    assert all(p["correct"] is False for p in failed)


def test_full_programs_carry_code_and_embeddings(client):
    status, data = client.json("/get_programs", db_path=DB_PATH)
    assert status == 200
    real = [p for p in data if not p["id"].startswith("failed:")]
    assert real and all(p["code"] for p in real)
    assert all(len(p["embedding"]) == 8 for p in real)


def test_program_count_counts_failed_nodes(client):
    _, summary = client.json("/get_programs_summary", db_path=DB_PATH)
    status, data = client.json("/get_program_count", db_path=DB_PATH)
    assert status == 200
    assert data["count"] == len(summary)
    assert data["max_timestamp"] is not None


def test_program_details_and_failed_details(client):
    _, summary = client.json("/get_programs_summary", db_path=DB_PATH)
    real = next(p for p in summary if p["generation"] == 1)
    status, data = client.json("/get_program_details", db_path=DB_PATH, id=real["id"])
    assert status == 200
    assert data["id"] == real["id"] and data["code"]

    status, data = client.json(
        "/get_program_details", db_path=DB_PATH, id="failed:proposal:5"
    )
    assert status == 200
    assert "generation 5 variant 99" in data["code"]
    assert data["metadata"]["failure_class"] == "patch_apply_failed"

    status, data = client.json("/get_program_details", db_path=DB_PATH, id="missing")
    assert status == 404
    status, data = client.json(
        "/get_program_details", db_path=DB_PATH, id="failed:proposal:77"
    )
    assert status == 404


def test_meta_files_and_content(client):
    status, files = client.json("/get_meta_files", db_path=DB_PATH)
    assert status == 200
    assert [f["processed_count"] for f in files] == [5, 10, 20]
    status, content = client.json(
        "/get_meta_content", db_path=DB_PATH, processed_count=10
    )
    assert status == 200
    assert content["filename"] == "meta_10.txt"
    assert "GLOBAL INSIGHTS SCRATCHPAD" in content["content"]
    status, alias = client.json("/get_meta_content", db_path=DB_PATH, generation=5)
    assert status == 200 and alias["processed_count"] == 5
    status, _ = client.json("/get_meta_content", db_path=DB_PATH, processed_count=99)
    assert status == 404
    status, _ = client.json("/get_meta_content", db_path=DB_PATH, processed_count="abc")
    assert status == 400


def test_meta_pdf_falls_back_to_text_when_disabled(client):
    status, headers, body = client.get(
        "/download_meta_pdf", db_path=DB_PATH, processed_count=5
    )
    assert status == 200
    assert headers["Content-Type"] == "application/pdf"
    assert 'filename="meta_5.pdf"' in headers["Content-Disposition"]
    assert body.startswith(b"Meta Generation 5")


def test_plots_listing_and_serving(client):
    status, plots = client.json(
        "/get_plots", db_path=DB_PATH, generation=3, program_id="x"
    )
    assert status == 200
    assert [p["filename"] for p in plots] == ["animation.gif", "convergence.png"]
    assert plots[0]["type"] == "animation"
    status, headers, body = client.get("/plot_file/" + plots[1]["path"])
    assert (
        status == 200
        and headers["Content-Type"] == "image/png"
        and body[:4] == b"\x89PNG"
    )
    status, plots = client.json(
        "/get_plots", db_path=DB_PATH, generation=4, program_id="x"
    )
    assert status == 200 and plots == []
    status, _ = client.json(
        "/get_plots", db_path=DB_PATH, generation="3; DROP", program_id="x"
    )
    assert status == 400


def test_system_prompts(client):
    status, prompts = client.json("/get_system_prompts", db_path=DB_PATH)
    assert status == 200
    assert [p["id"] for p in prompts] == ["prompt-0", "prompt-1", "prompt-2"]
    assert prompts[1]["parent_id"] == "prompt-0"


def test_database_stats(client):
    status, stats = client.json("/get_database_stats", db_path=DB_PATH)
    assert status == 200
    assert stats["program_count"] > 30
    assert stats["max_generation"] == 11
    assert 0 < stats["best_score"] <= 1
    assert stats["has_prompt_evo"] is True and stats["prompt_count"] == 3
    assert stats["total_runtime_seconds"] > 0
    status, missing = client.json("/get_database_stats", db_path="nope.sqlite")
    assert status == 200 and missing == {"error": "not_found"}


def test_missing_query_parameters_are_400(client):
    status, data = client.json("/get_programs")
    assert status == 400 and "db_path" in data["error"]


def test_unknown_database_is_404(client):
    status, _ = client.json("/get_programs", db_path="nope.sqlite")
    assert status == 404


@pytest.mark.parametrize(
    "bad_path",
    [
        "/etc/passwd",
        "../../etc/passwd",
        "results_fixture/../../x.sqlite",
        "//etc/passwd",
    ],
)
def test_database_paths_outside_root_are_rejected(client, bad_path):
    status, _ = client.json("/get_programs", db_path=bad_path)
    assert status in (403, 404)
    status, data = client.json("/get_database_stats", db_path=bad_path)
    assert status == 403 or (status == 200 and data == {"error": "not_found"})


def test_plot_file_cannot_escape_root(client, results_root: Path):
    outside = results_root.parent / "secret.png"
    outside.write_bytes(b"\x89PNGsecret")
    try:
        status, _, body = client.get("/plot_file/../secret.png")
        assert status in (403, 404) and b"secret" not in body
        status, _, body = client.get("/plot_file/" + str(outside))
        assert status in (403, 404) and b"secret" not in body
    finally:
        outside.unlink()


def test_static_files_and_headers(client):
    status, headers, body = client.get("/")
    assert status == 200 and headers["Content-Type"].startswith("text/html")
    assert "no-store" in headers["Cache-Control"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert "Access-Control-Allow-Origin" not in headers
    status, _, _ = client.get("/../pyproject.toml")
    assert status == 404
    status, _, _ = client.get("/does-not-exist.html")
    assert status == 404


def test_resolve_within_rejects_absolute_and_escaping(tmp_path: Path):
    inner = tmp_path / "a" / "b.txt"
    inner.parent.mkdir()
    inner.write_text("x")
    assert resolve_within(tmp_path, "a/b.txt") == inner.resolve()
    for bad in ("/abs", "../x", "a/../../x"):
        with pytest.raises(Forbidden):
            resolve_within(tmp_path, bad)


def test_read_cache_invalidates_when_file_changes(tmp_path: Path):
    db_file = tmp_path / "x.sqlite"
    db_file.write_bytes(b"one")
    cache = ReadCache(grace_seconds=0.0)
    calls = []

    def compute():
        calls.append(1)
        return len(calls)

    assert cache.get_or_compute("k", db_file, compute) == 1
    assert cache.get_or_compute("k", db_file, compute) == 1
    db_file.write_bytes(b"three")
    import os
    import time

    os.utime(db_file, ns=(time.time_ns(), time.time_ns() + 10_000_000))
    assert cache.get_or_compute("k", db_file, compute) == 2


def test_summary_reflects_new_rows_after_write(client, results_root: Path):
    db_file = results_root / DB_PATH
    _, before = client.json("/get_program_count", db_path=DB_PATH)
    conn = sqlite3.connect(db_file)
    conn.execute(
        "INSERT INTO attempt_log (generation, stage, status, details, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            11,
            "proposal",
            "failed",
            json.dumps({"node_kind": "failed_proposal", "failure_reason": "late"}),
            1.9e9,
        ),
    )
    conn.commit()
    conn.close()
    import time

    time.sleep(1.1)  # exceed the cache grace period
    _, after = client.json("/get_program_count", db_path=DB_PATH)
    assert after["count"] == before["count"] + 1
