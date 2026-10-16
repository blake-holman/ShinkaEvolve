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
        lambda m: (
            errors.append(f"console.{m.type}: {m.text}")
            if m.type == "error" and not any(s in m.text for s in IGNORED_CONSOLE)
            else None
        ),
    )
    page.on("requestfailed", lambda r: errors.append(f"request failed: {r.url}"))
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


def open_run(page, query=""):
    page.goto(
        f"{page.base}/run.html?db_path={DB_PATH}{query}", wait_until="networkidle"
    )
    page.wait_for_function(
        "window.shinkaRun && window.shinkaRun.state.model !== null", timeout=15_000
    )
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
    assert (
        page.locator(
            "#panel .js-plotly-plot, #panel .plotly, #panel svg, #panel canvas"
        ).count()
        >= 1
    )
    assert "Scratchpad" in panel
    assert page.errors == []


def test_tree_shows_collapsed_lineage_and_expands(page):
    open_run(page)
    s = state(page)
    summary = page.locator("#tree-summary").inner_text()
    program_count = page.evaluate("window.shinkaRun.state.model.totals.programCount")
    assert f"of {program_count} programs" in summary and "2 failed proposals" in summary
    shown_before = int(summary.split(" of ")[0])
    assert shown_before < s["programs"]
    page.click("#btn-expand")
    page.wait_for_timeout(300)
    shown_after = int(page.locator("#tree-summary").inner_text().split(" of ")[0])
    assert shown_after == program_count
    page.click("#btn-collapse")
    page.wait_for_timeout(300)
    assert (
        int(page.locator("#tree-summary").inner_text().split(" of ")[0]) == shown_before
    )
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
    s = state(page)
    assert s["view"] == "overview" and s["selectedId"] is None
    assert "program=" not in page.url
    page.go_back()
    page.wait_for_timeout(500)
    assert state(page)["selectedId"] == best_id(page)
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


def test_unknown_program_falls_back_to_overview(page):
    open_run(page, "&program=does-not-exist")
    s = state(page)
    assert s["view"] == "overview" and s["selectedId"] is None
    assert "program=" not in page.url
    assert "not in this run" in page.locator("#toast").inner_text()
    assert page.errors == []


def test_keyboard_shortcuts(page):
    open_run(page)
    page.keyboard.press("b")
    page.wait_for_timeout(600)
    assert state(page)["selectedId"] == best_id(page)
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(600)
    s = state(page)
    parent = page.evaluate("window.shinkaRun.state.model.best.parent_id")
    assert s["selectedId"] == parent
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    assert state(page)["view"] == "overview"
    assert page.errors == []


def test_plus_pill_reveals_whole_subtree(page):
    open_run(page)
    before = int(page.locator("#tree-summary").inner_text().split(" of ")[0])
    pills = page.locator("#tree .tree-pill--more")
    assert pills.count() >= 1
    label = pills.first.locator("text").first.text_content().strip()
    hidden = int(label.lstrip("+"))
    pills.first.click(force=True)
    page.wait_for_timeout(500)
    after = int(page.locator("#tree-summary").inner_text().split(" of ")[0])
    assert after >= before + 1 and after <= before + hidden
    assert page.errors == []


def test_run_cost_matches_run_list(page):
    page.goto(page.base + "/", wait_until="networkidle")
    page.locator("input.result-checkbox, .run-row, tr[data-path]").first.wait_for(
        timeout=10_000
    )
    page.wait_for_timeout(800)
    import re

    list_costs = re.findall(r"\$\d+\.\d+", page.locator("body").inner_text())
    open_run(page)
    strip = page.locator("#status-items").inner_text()
    strip_cost = re.findall(r"\$\d+\.\d+", strip)
    assert strip_cost and strip_cost[0] in list_costs, (strip_cost, list_costs)


def test_unknown_database_shows_error(page):
    page.goto(f"{page.base}/run.html?db_path=nope.sqlite", wait_until="networkidle")
    page.wait_for_timeout(500)
    assert "not found" in page.locator("#status-items").inner_text().lower()
    assert "Could not load" in page.locator("#panel").inner_text()


def test_nodes_show_generation_numbers_without_axis(page):
    open_run(page)
    assert page.locator("#tree .tree-axis").count() == 0
    labels = page.locator("#tree .tree-label")
    assert labels.count() == page.locator("#tree g.tree-node").count()
    texts = {labels.nth(i).text_content() for i in range(labels.count())}
    assert {"0", "11"} <= texts
    assert page.errors == []


@pytest.fixture()
def phone(browser, server):
    base = f"http://127.0.0.1:{server.server_port}"
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.base = base
    page.errors = errors
    yield page
    context.close()


def panel_open(page):
    return page.evaluate("document.body.classList.contains('is-panel-open')")


def test_phone_shows_one_pane_at_a_time(phone):
    open_run(phone)
    assert not panel_open(phone)
    assert not phone.locator("#panel").is_visible()
    assert phone.locator("#tree svg").is_visible()
    assert phone.evaluate("document.documentElement.scrollWidth") <= 390
    phone.locator("#btn-best").tap()
    phone.wait_for_timeout(800)
    assert panel_open(phone) and phone.locator("#panel").is_visible()
    assert "def solve" in phone.locator("#panel").inner_text()
    assert phone.locator("#panel-back-title").inner_text().strip()
    phone.go_back()
    phone.wait_for_timeout(500)
    assert not panel_open(phone)
    phone.locator("#btn-run").tap()
    phone.wait_for_timeout(800)
    assert panel_open(phone) and "view=run" in phone.url
    width = phone.evaluate(
        "document.querySelector('#panel .js-plotly-plot').getBoundingClientRect().width"
    )
    assert width > 250
    phone.locator("#btn-back").tap()
    phone.wait_for_timeout(500)
    assert not panel_open(phone) and "view=run" not in phone.url
    assert phone.errors == []


def test_phone_deep_link_opens_program(phone):
    open_run(phone)
    best = phone.evaluate("window.shinkaRun.state.model.best.id")
    open_run(phone, f"&program={best}")
    assert panel_open(phone)
    phone.locator("#btn-back").tap()
    phone.wait_for_timeout(500)
    assert not panel_open(phone) and "program=" not in phone.url
    assert phone.errors == []


def test_phone_run_list_fits(phone):
    phone.goto(phone.base + "/", wait_until="networkidle")
    phone.locator(".run-row__name").first.wait_for(timeout=10_000)
    assert phone.evaluate("document.documentElement.scrollWidth") <= 390
    assert phone.locator("th", has_text="Cost").first.is_hidden()
    assert phone.errors == []


def tap_centre(page, locator):
    box = locator.bounding_box()
    page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def test_phone_tap_on_node_with_pill_opens_that_node(phone):
    for index in range(4):
        open_run(phone)
        ids = phone.evaluate(
            "[...document.querySelectorAll('#tree g.tree-node')].filter(g => g.querySelector('.tree-pill--more')).map(g => g.__data__.id)"
        )
        assert ids, "fixture has nodes with +N pills"
        if index >= len(ids):
            break
        target = ids[index]
        dot = (
            phone.locator("#tree g.tree-node")
            .filter(has=phone.locator(".tree-pill--more"))
            .nth(index)
            .locator(".tree-dot")
        )
        tap_centre(phone, dot)
        phone.wait_for_timeout(500)
        assert phone.evaluate("window.shinkaRun.state.selectedId") == target
        assert panel_open(phone)
    assert phone.errors == []


def dot_centre(page, program_id):
    return page.evaluate(
        """id => {
            const g = [...document.querySelectorAll('#tree g.tree-node')].find(n => n.__data__.id === id);
            const r = g.querySelector('.tree-dot').getBoundingClientRect();
            return [r.x + r.width / 2, r.y + r.height / 2];
        }""",
        program_id,
    )


def test_phone_pill_tap_leaves_children_tappable(phone):
    open_run(phone)
    parent = phone.evaluate(
        "document.querySelector('#tree .tree-pill--more').closest('g.tree-node').__data__.id"
    )
    tap_centre(phone, phone.locator("#tree .tree-pill--more .tree-pill__box").first)
    phone.wait_for_timeout(500)
    assert phone.locator("#tree .tree-pill--less").count() == 0
    child = phone.evaluate(
        "id => window.shinkaRun.state.model.programs.get(id).children[0]", parent
    )
    x, y = dot_centre(phone, child)
    phone.touchscreen.tap(x, y)
    phone.wait_for_timeout(500)
    assert phone.evaluate("window.shinkaRun.state.selectedId") == child
    assert phone.errors == []


def test_phone_back_bar_unwinds_stacked_panels(phone):
    open_run(phone)
    start_length = phone.evaluate("history.length")
    phone.locator("#btn-best").tap()
    phone.wait_for_timeout(500)
    parent = phone.evaluate("window.shinkaRun.state.model.best.parent_id")
    phone.evaluate(f"window.shinkaRun.selectProgram('{parent}')")
    phone.wait_for_timeout(500)
    phone.locator("#btn-back").tap()
    phone.wait_for_timeout(600)
    assert not panel_open(phone) and "program=" not in phone.url
    # The back bar went back through history instead of adding an entry.
    phone.go_forward()
    phone.wait_for_timeout(500)
    assert panel_open(phone)
    assert phone.evaluate("history.length") == start_length + 2
    assert phone.errors == []


def test_desktop_overview_button_does_not_stack_history(page):
    open_run(page)
    length = page.evaluate("history.length")
    page.click("#btn-run")
    page.click("#btn-run")
    page.wait_for_timeout(300)
    assert page.evaluate("history.length") == length
    assert page.errors == []


def test_tablet_is_single_pane(browser, server):
    context = browser.new_context(
        viewport={"width": 768, "height": 1024}, is_mobile=True, has_touch=True
    )
    page = context.new_page()
    page.goto(
        f"http://127.0.0.1:{server.server_port}/run.html?db_path={DB_PATH}",
        wait_until="networkidle",
    )
    page.wait_for_function("window.shinkaRun && window.shinkaRun.state.model !== null")
    assert not page.locator("#panel").is_visible()
    assert not page.locator("#divider").is_visible()
    context.close()


def test_expanded_fit_keeps_numbers_readable(page):
    open_run(page)
    page.click("#btn-expand")
    page.wait_for_timeout(800)
    assert (
        page.evaluate(
            "document.querySelector('#tree .tree-nodes').classList.contains('tree-nodes--no-labels')"
        )
        is False
    )
    assert page.errors == []


def test_phone_deep_link_then_navigate_back_bar_reaches_tree(phone):
    open_run(phone)
    best = phone.evaluate("window.shinkaRun.state.model.best.id")
    parent = phone.evaluate("window.shinkaRun.state.model.best.parent_id")
    open_run(phone, f"&program={best}")
    phone.wait_for_timeout(500)
    phone.evaluate(f"window.shinkaRun.selectProgram('{parent}')")
    phone.wait_for_timeout(600)
    phone.locator("#btn-back").tap()
    phone.wait_for_timeout(600)
    assert not panel_open(phone) and "program=" not in phone.url
    assert phone.errors == []


def test_window_resize_does_not_pin_split(page):
    open_run(page)
    page.evaluate("localStorage.removeItem('shinkaTreeWidth')")
    open_run(page)
    page.set_viewport_size({"width": 1000, "height": 900})
    page.wait_for_timeout(200)
    page.set_viewport_size({"width": 1600, "height": 900})
    page.wait_for_timeout(200)
    assert page.evaluate("document.getElementById('tree-pane').style.flexBasis") == ""
    assert page.errors == []


def test_run_list_fits_between_breakpoints(browser, server):
    context = browser.new_context(viewport={"width": 920, "height": 900})
    page = context.new_page()
    page.goto(f"http://127.0.0.1:{server.server_port}/", wait_until="networkidle")
    page.locator(".run-row__name").first.wait_for(timeout=10_000)
    page.wait_for_timeout(800)
    assert page.evaluate("document.documentElement.scrollWidth") <= 920
    assert page.evaluate(
        "(() => { const t = document.querySelector('.runs'); return t.scrollWidth <= t.parentElement.clientWidth; })()"
    )
    context.close()
