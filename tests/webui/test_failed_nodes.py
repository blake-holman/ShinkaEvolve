"""Unit tests for failed-proposal node helpers and meta file discovery."""

from __future__ import annotations

import json
from pathlib import Path

from shinka.webui.server.endpoints.meta import list_meta_files, meta_dir_for
from shinka.webui.server.failed_nodes import (
    build_failed_node,
    language_from_suffix,
    resolve_code_path,
    resolve_language,
)


def test_language_from_suffix_knows_hardware_and_lean():
    assert language_from_suffix(".sv") == "verilog"
    assert language_from_suffix(".f90") == "fortran"
    assert language_from_suffix(".lean") == "lean"
    assert language_from_suffix("") == "python"


def test_code_path_prefers_declared_language_extension(tmp_path: Path):
    failure_dir = tmp_path / "results" / "gen_1"
    failure_dir.mkdir(parents=True)
    expected = failure_dir / "main.sv"
    expected.write_text("module main; endmodule\n", encoding="utf-8")
    (failure_dir / "main.py").write_text("print('fallback')\n", encoding="utf-8")
    details = {"failure_json_path": "results/gen_1/failure.json"}
    assert resolve_code_path(tmp_path, details, {"language": "verilog"}) == expected
    assert resolve_language(tmp_path, details, None) == "python"


def test_failure_payload_outside_root_is_ignored(tmp_path: Path):
    outside = tmp_path.parent / "failure.json"
    outside.write_text(json.dumps({"language": "go"}), encoding="utf-8")
    try:
        node = build_failed_node(
            tmp_path,
            generation=3,
            created_at=1.0,
            details={"failure_json_path": "../failure.json", "failure_reason": "boom"},
            include_code=True,
        )
    finally:
        outside.unlink()
    assert node["id"] == "failed:proposal:3"
    assert node["language"] == "python"
    assert node["code"] is None
    assert node["text_feedback"] == "boom"


def test_meta_files_listing_uses_meta_dir_then_falls_back(tmp_path: Path):
    results_dir = tmp_path / "results"
    meta_dir = results_dir / "meta"
    meta_dir.mkdir(parents=True)
    (meta_dir / "meta_5.txt").write_text("first", encoding="utf-8")
    (meta_dir / "meta_60.txt").write_text("latest", encoding="utf-8")
    (meta_dir / "meta_bad.txt").write_text("skip", encoding="utf-8")
    assert meta_dir_for(results_dir) == meta_dir
    assert [f["processed_count"] for f in list_meta_files(results_dir)] == [5, 60]
    assert list_meta_files(results_dir)[0]["generation"] == 5

    legacy = tmp_path / "legacy"
    legacy.mkdir()
    (legacy / "meta_7.txt").write_text("x", encoding="utf-8")
    assert meta_dir_for(legacy) == legacy
    assert [f["filename"] for f in list_meta_files(legacy)] == ["meta_7.txt"]
