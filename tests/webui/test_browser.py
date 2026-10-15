"""Browser tests: load every page and tab in headless Chromium against the fixture.

Requires the Playwright Chromium build (``playwright install chromium``);
the tests are skipped when it is missing. External network access is
blocked so the pages must work from vendored assets alone.
"""

from __future__ import annotations

import pytest

from .conftest import DB_PATH

playwright_api = pytest.importorskip("playwright.sync_api")

LEFT_TABS = [
    "tree-view",
    "meta-prompt-view",
    "table-view",
    "metrics-view",
    "embeddings-view",
    "clusters-view",
    "islands-view",
    "model-posteriors-view",
    "best-path-view",
    "maps-view",
]
RIGHT_TABS = [
    "agent-info",
    "pareto-front",
    "meta-analysis",
    "node-details",
    "agent-code",
    "code-diff",
    "log-output",
    "llm-result",
    "analysis",
    "throughput",
]

IGNORED_CONSOLE = ("willReadFrequently", "GL Driver Message")


@pytest.fixture(scope="module")
def browser():
    with playwright_api.sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception as error:  # browser binary missing
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
        lambda m: (
            errors.append(f"console.{m.type}: {m.text}")
            if m.type == "error" and not any(s in m.text for s in IGNORED_CONSOLE)
            else None
        ),
    )
    page.on(
        "requestfailed",
        lambda r: errors.append(f"request failed: {r.url} {r.failure}"),
    )
    page.route(
        "**/*",
        lambda route: (
            route.continue_()
            if route.request.url.startswith(base)
            else (
                errors.append(f"external request: {route.request.url}"),
                route.abort(),
            )
        ),
    )
    page.base = base
    page.errors = errors
    yield page
    page.close()


def test_landing_page_lists_fixture_with_stats(page):
    page.goto(page.base + "/", wait_until="networkidle")
    row = page.locator("tr.run-row").first
    row.wait_for(timeout=10_000)
    page.locator("tr.run-row .pill").first.wait_for(timeout=10_000)
    page.wait_for_timeout(300)
    text = page.locator("body").inner_text()
    assert "results_fixture" in text
    assert "33 correct" in text
    assert "Best score" in page.locator("#results-table thead").text_content()
    assert page.locator("#loading-state").is_hidden()
    assert page.locator("#empty-state").is_hidden()
    assert page.locator("th#sort-updated").count() == 1
    row.click()
    page.wait_for_url("**/run.html?db_path=*", timeout=10_000)
    assert "/run.html?db_path=" in page.url
    assert page.errors == []


def test_tree_page_renders_every_tab_without_errors(page):
    page.goto(page.base + "/viz_tree.html?db_path=" + DB_PATH, wait_until="networkidle")
    page.locator(".node").first.wait_for(timeout=15_000)
    page.wait_for_timeout(1000)
    assert page.locator(".node").count() >= 30
    page.locator(".node").nth(3).click(force=True)
    page.wait_for_timeout(500)
    for tab in RIGHT_TABS:
        page.locator(f'.tab[data-tab="{tab}"]').click()
        page.wait_for_timeout(300)
        assert page.locator(f"#{tab}").is_visible(), tab
    for tab in LEFT_TABS:
        page.locator(f'.left-tab[data-tab="{tab}"]').click()
        page.wait_for_timeout(400)
        assert page.locator(f"#{tab}").is_visible(), tab
    assert page.errors == []


def test_tree_page_shows_failed_proposals_and_code(page):
    page.goto(page.base + "/viz_tree.html?db_path=" + DB_PATH, wait_until="networkidle")
    page.locator(".node").first.wait_for(timeout=15_000)
    page.wait_for_timeout(800)
    page.evaluate("window.selectNodeById('failed:proposal:5', false)")
    page.locator('.tab[data-tab="agent-code"]').click()
    page.wait_for_timeout(800)
    assert "generation 5 variant 99" in page.locator("#agent-code").inner_text()
    assert page.errors == []


def test_compare_page_charts_selected_runs(page):
    page.goto(page.base + "/", wait_until="networkidle")
    page.evaluate(
        "sel => sessionStorage.setItem('compareSelection', JSON.stringify(sel))",
        [{"path": DB_PATH, "label": "run A"}, {"path": DB_PATH, "label": "run B"}],
    )
    page.goto(page.base + "/compare.html", wait_until="networkidle")
    page.wait_for_timeout(800)
    assert page.locator("canvas").count() >= 1
    assert page.errors == []
