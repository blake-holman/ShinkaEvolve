from webui_sources import index_source


def test_landing_page_lists_runs_in_plain_columns():
    html = index_source()

    for header in (
        ">Run ",
        ">Status<",
        ">Best score<",
        ">Generations<",
        ">Programs<",
        ">Cost<",
        ">Runtime<",
        ">Updated ",
    ):
        assert header in html
    assert "P-Evo" not in html
    assert "/run.html?db_path=" in html
    assert "viz_tree.html" not in html


def test_landing_page_sort_toggle_exists_and_defaults_to_newest_first():
    html = index_source()

    assert 'id="sort-run" data-sort="run"' in html
    assert 'id="sort-updated" data-sort="updated"' in html
    assert 'sortKey: "updated"' in html
    assert 'sortDir: "desc"' in html
    assert "function toggleSort(key)" in html
    assert "function compareRuns(a, b)" in html


def test_landing_page_keeps_empty_runs_visible_with_a_status_pill():
    html = index_source()

    assert "program_count <= 0" not in html
    assert "program_count <= 1" not in html
    assert "row.style.display = 'none'" not in html
    assert ">empty</span>" in html
    assert ">active</span>" in html
    assert ">idle</span>" in html


def test_landing_page_has_no_compare_feature():
    html = index_source()

    for removed in (
        "result-checkbox",
        "select-all",
        "compare-btn",
        "openCompare",
        "compareSelection",
        "sessionStorage",
        "arxiv.org",
        "sakana.ai/shinka-evolve",
    ):
        assert removed not in html


def test_landing_page_theme_matches_run_page():
    html = index_source()

    assert 'data-theme="light"' in html
    assert '[data-theme="dark"]' in html
    assert 'import { initTheme, toggleTheme } from "./run/theme.js";' in html
    assert 'id="btn-theme"' in html
    assert "--bg-elev:" in html and "--fg-muted:" in html


def test_landing_page_shares_formatting_with_run_page():
    html = index_source()

    assert 'from "./run/model.js";' in html
    for helper in ("escapeHtml", "formatCost", "formatDuration", "formatAgo"):
        assert f"function {helper}(" not in html
