"""Unit tests for static/js/run/model.js, executed with node against the fixture data."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from .conftest import DB_PATH

REPO_ROOT = Path(__file__).resolve().parents[2]
MODEL_JS = REPO_ROOT / "shinka" / "webui" / "static" / "js" / "run" / "model.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is required")


def run_node(script: str, data) -> dict:
    code = f"""
import * as m from {json.dumps(MODEL_JS.as_uri())};
const rows = {json.dumps(data)};
{script}
"""
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


@pytest.fixture(scope="module")
def rows(client):
    _, data = client.json("/get_programs_summary", db_path=DB_PATH)
    return data


def test_best_and_lineage(rows):
    out = run_node(
        """
const model = m.buildRunModel(rows, { now: 1e12 });
const lineage = m.lineageOf(model, model.best.id);
console.log(JSON.stringify({
  best: model.best.combined_score, bestGen: model.best.generation,
  lineageLen: lineage.length, lineageStartsAtRoot: model.roots.includes(lineage[0]),
  lineageIsSet: [...model.bestLineage].length === lineage.length,
  programCount: model.totals.programCount, failed: model.totals.failedProposalCount,
  status: model.status, maxGen: model.maxGeneration,
}));
""",
        rows,
    )
    assert 0 < out["best"] <= 1
    assert out["lineageLen"] >= 2 and out["lineageStartsAtRoot"] and out["lineageIsSet"]
    assert out["failed"] == 2
    assert out["programCount"] == len(rows) - 2
    assert out["status"] == "idle"
    assert out["maxGen"] == 11


def test_generations_are_monotone_in_best_and_cost(rows):
    out = run_node(
        """
const model = m.buildRunModel(rows, {});
console.log(JSON.stringify(model.generations.map(g => [g.generation, g.bestSoFar, g.cumulativeCost, g.count])));
""",
        rows,
    )
    gens = [g[0] for g in out]
    assert gens == list(range(12))
    best = [g[1] for g in out]
    assert all(b is None or a is None or b >= a for a, b in zip(best, best[1:]))
    cost = [g[2] for g in out]
    assert all(b >= a for a, b in zip(cost, cost[1:])) and cost[-1] > 0
    assert all(g[3] >= 1 for g in out)


def test_visibility_follows_expanded_set(rows):
    out = run_node(
        """
const model = m.buildRunModel(rows, {});
const collapsed = m.visibleIds(model, m.defaultExpanded(model));
const all = m.visibleIds(model, m.allExpanded(model));
const leaf = [...model.programs.values()].find(p => p.children.length === 0 && !model.bestLineage.has(p.id));
const revealed = m.visibleIds(model, m.expandTo(model, m.defaultExpanded(model), leaf.id));
const lineageVisible = [...model.bestLineage].every(id => collapsed.has(id));
const hiddenUnderRoot = m.hiddenDescendantCount(model, model.roots[0], new Set());
console.log(JSON.stringify({ collapsed: collapsed.size, all: all.size, total: model.programs.size,
  lineageVisible, revealedHasLeaf: revealed.has(leaf.id), hiddenUnderRoot }));
""",
        rows,
    )
    assert out["all"] == out["total"]
    assert out["collapsed"] < out["all"]
    assert out["lineageVisible"] and out["revealedHasLeaf"]
    assert out["hiddenUnderRoot"] > 0


def test_names_deltas_and_formatting(rows):
    out = run_node(
        """
const model = m.buildRunModel(rows, {});
const root = model.programs.get(model.roots[0]);
const child = model.programs.get(root.children[0]);
const failed = [...model.programs.values()].find(m.isFailedProposal);
console.log(JSON.stringify({
  rootName: m.displayName(root), childName: m.displayName(child), failedName: m.displayName(failed),
  delta: m.scoreDelta(child, root), deltaText: m.formatDelta(m.scoreDelta(child, root)),
  failedDelta: m.scoreDelta(failed, root), failureText: m.failureText(failed),
  cost: m.formatCost(0.012345), zero: m.formatCost(0), dur: m.formatDuration(3725), ago: m.formatAgo(90),
  score: m.formatScore(0.98089812), esc: m.escapeHtml('<a href="x">&</a>'),
  model: m.modelName(child), patch: m.patchType(root),
}));
""",
        rows,
    )
    assert out["rootName"] == "Initial program"
    assert out["childName"].endswith("_g1_0") or "patch" in out["childName"]
    assert "failed" in out["failedName"]
    assert out["failedDelta"] is None and "SEARCH block" in out["failureText"]
    assert isinstance(out["delta"], float) and out["deltaText"][0] in "+−±"
    assert out["cost"] == "$0.012" and out["zero"] == "$0"
    assert out["dur"] == "1h 2m" and out["ago"] == "1 min ago"
    assert out["score"] == "0.9809"
    assert out["esc"] == "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;"
    assert (
        out["model"] in ("gpt-5.5-mini", "claude-sonnet-5-5") and out["patch"] == "init"
    )


def test_empty_run():
    out = run_node(
        """
const model = m.buildRunModel([], { now: 5 });
console.log(JSON.stringify({ size: model.programs.size, best: model.best, gens: model.generations.length, status: model.status, visible: m.visibleIds(model, m.defaultExpanded(model)).size }));
""",
        [],
    )
    assert out == {"size": 0, "best": None, "gens": 1, "status": "idle", "visible": 0}


def test_cycles_null_scores_and_subtrees():
    rows = [
        {
            "id": "r",
            "parent_id": None,
            "generation": 0,
            "correct": 1,
            "combined_score": 0.5,
            "timestamp": 1,
        },
        {
            "id": "a",
            "parent_id": "r",
            "generation": 1,
            "correct": 1,
            "combined_score": None,
            "timestamp": 2,
        },
        {
            "id": "b",
            "parent_id": "a",
            "generation": 2,
            "correct": 1,
            "combined_score": 0.7,
            "timestamp": 3,
        },
        {
            "id": "c",
            "parent_id": "b",
            "generation": 3,
            "correct": 0,
            "combined_score": 0.0,
            "timestamp": 9,
        },
        {
            "id": "x",
            "parent_id": "y",
            "generation": 1,
            "correct": 1,
            "combined_score": 0.6,
            "timestamp": 4,
        },
        {
            "id": "y",
            "parent_id": "x",
            "generation": 2,
            "correct": 1,
            "combined_score": 0.6,
            "timestamp": 5,
        },
        {
            "id": "orphan",
            "parent_id": "missing",
            "generation": 4,
            "correct": 1,
            "combined_score": 0.1,
            "timestamp": 6,
        },
    ]
    out = run_node(
        """
const model = m.buildRunModel(rows, { now: 10, extraCost: 0.25 });
const all = m.visibleIds(model, m.allExpanded(model));
const collapsedRoot = m.hiddenDescendantCount(model, "r", new Set());
const sub = m.expandSubtree(model, new Set(), "r");
const back = m.collapseSubtree(model, sub, "r");
console.log(JSON.stringify({
  roots: model.roots.slice().sort(), best: model.best.id, allVisible: all.size, total: model.programs.size,
  correct: model.totals.correctCount, nullScore: m.formatScore(rows[1].combined_score),
  nullDuration: m.formatDuration(null), nullAgo: m.formatAgo(undefined),
  collapsedRoot, subtreeVisible: m.visibleIds(model, sub).has("c"), backEmpty: back.size,
  newest: model.totals.newestId, defaultHasNewest: m.visibleIds(model, m.defaultExpanded(model)).has("c"),
  totalCost: model.totals.totalCost, extra: model.totals.extraCost, status: model.status,
  deltaNull: m.scoreDelta(model.programs.get("b"), model.programs.get("a")),
  patch: m.patchWords({ generation: 3, metadata: { patch_type: "cross" } }), deltaCls: m.deltaClass(-0.1),
}));
""",
        rows,
    )
    assert out["roots"] == ["orphan", "r", "x", "y"]
    assert out["best"] == "b"
    assert out["allVisible"] == out["total"] == 7
    assert out["correct"] == 6
    assert (
        out["nullScore"] == "–" and out["nullDuration"] == "–" and out["nullAgo"] == "–"
    )
    assert out["collapsedRoot"] == 3 and out["subtreeVisible"] and out["backEmpty"] == 0
    assert out["newest"] == "c" and out["defaultHasNewest"]
    assert (
        out["totalCost"] == 0.25 and out["extra"] == 0.25 and out["status"] == "active"
    )
    assert out["deltaNull"] is None
    assert out["patch"] == "Crossover" and out["deltaCls"] == "delta--down"
