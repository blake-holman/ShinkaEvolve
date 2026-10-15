"""Browser tests for the simplified run page (run.html)."""

from __future__ import annotations

import pytest

from .conftest import DB_PATH

playwright_api = pytest.importorskip("playwright.sync_api")

IGNORED_CONSOLE = ("willReadFrequently", "GL Driver Message")


@pytest.fixture(scope="module")
def browser():
    with playwright_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as error:
            pytest.skip(f"Chromium unavailable: {error}")
        yield browser
        browser.close()


@pytest.fixture()
def page(browser, server):
    base = f"http://127.0.0.1:{server.server_port}"
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on(
        "console",
        lambda m: errors.append(f"console.{m.type}: {m.text}")
        if m.type == "error" and not any(s in m.text for s in IGNORED_CONSOLE)
        else None,
    )
    page.on("requestfailed", lambda r: errors.append(f"request failed: {r.url}"))
    page.route(
        "**/*",
        lambda route: route.continue_()
        if route.request.url.startswith(base)
        else (errors.append(f"external request: {route.request.url}"), route.abort()),
    )
    page.base = base
    page.errors = errors
    yield page
    page.close()


def open_run(page, query=""):
    page.goto(f"{page.base}/run.html?db_path={DB_PATH}{query}", wait_until="networkidle")
    page.wait_for_function("window.shinkaRun && window.shinkaRun.state.model !== null", timeout=15_000)
    page.wait_for_timeout(400)


def state(page):
    return page.evaluate(
        "({selectedId: window.shinkaRun.state.selectedId, view: window.shinkaRun.state.view,"
        " expanded: window.shinkaRun.state.expanded.size, programs: window.shinkaRun.state.model.programs.size})"
    )


def best_id(page):
    return page.evaluate("window.shinkaRun.state.model.best.id")


def test_status_strip_and_overview_on_load(page):
    open_run(page)
    strip = page.locator("#status-items").inner_text()
    for label in ("STATUS", "GENERATION", "PROGRAMS", "BEST SCORE", "COST", "UPDATED"):
        assert label in strip
    assert "11" in strip and "0.98" in strip
    assert state(page)["view"] == "overview"
    panel = page.locator("#panel").inner_text()
    assert "Run overview" in panel or "overview" in panel.lower()
    assert page.locator("#panel .js-plotly-plot, #panel .plotly, #panel svg, #panel canvas").count() >= 1
    assert "Scratchpad" in panel
    assert page.errors == []


def test_tree_shows_collapsed_lineage_and_expands(page):
    open_run(page)
    s = state(page)
    summary = page.locator("#tree-summary").inner_text()
    assert "of" in summary and str(s["programs"]) in summary
    shown_before = int(summary.split(" of ")[0])
    assert shown_before < s["programs"]
    page.click("#btn-expand")
    page.wait_for_timeout(300)
    shown_after = int(page.locator("#tree-summary").inner_text().split(" of ")[0])
    assert shown_after == s["programs"]
    page.click("#btn-collapse")
    page.wait_for_timeout(300)
    assert int(page.locator("#tree-summary").inner_text().split(" of ")[0]) == shown_before
    assert page.locator("#tree svg").count() == 1
    assert page.errors == []


def test_best_button_selects_best_program_and_updates_url(page):
    open_run(page)
    page.click("#btn-best")
    page.wait_for_timeout(800)
    s = state(page)
    assert s["view"] == "program" and s["selectedId"] == best_id(page)
    assert f"program={best_id(page)}" in page.url
    panel = page.locator("#panel").inner_text()
    assert "Generation 11" in panel or "generation 11" in panel.lower()
    assert "def solve" in panel  # code loaded
    page.click("#btn-run")
    page.wait_for_timeout(300)
    assert state(page)["view"] == "overview" and "view=run" in page.url
    assert page.errors == []


def test_url_restores_selected_program(page):
    open_run(page)
    best = best_id(page)
    open_run(page, f"&program={best}")
    s = state(page)
    assert s["selectedId"] == best and s["view"] == "program"
    assert "def solve" in page.locator("#panel").inner_text()
    assert page.errors == []


def test_failed_proposal_shows_failure_and_code(page):
    open_run(page)
    page.evaluate("window.shinkaRun.selectProgram('failed:proposal:5')")
    page.wait_for_timeout(800)
    panel = page.locator("#panel").inner_text()
    assert "SEARCH block did not match" in panel
    assert "generation 5 variant 99" in panel
    assert page.errors == []


def test_parent_diff_and_evaluation_sections(page):
    open_run(page)
    page.click("#btn-best")
    page.wait_for_timeout(800)
    diff_button = page.get_by_role("button", name="Diff from parent")
    assert diff_button.count() == 1
    diff_button.click()
    page.wait_for_timeout(500)
    panel = page.locator("#panel").inner_text()
    assert "Evaluation" in panel
    assert "All tests passed" in panel
    assert page.errors == []


def test_theme_toggle_persists(page):
    open_run(page)
    before = page.evaluate("document.documentElement.dataset.theme")
    page.click("#btn-theme")
    page.wait_for_timeout(300)
    after = page.evaluate("document.documentElement.dataset.theme")
    assert after != before
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(300)
    assert page.evaluate("document.documentElement.dataset.theme") == after
    assert page.errors == []


def test_unknown_database_shows_error(page):
    page.goto(f"{page.base}/run.html?db_path=nope.sqlite", wait_until="networkidle")
    page.wait_for_timeout(500)
    assert "not found" in page.locator("#status-items").inner_text().lower()
    assert "Could not load" in page.locator("#panel").inner_text()
