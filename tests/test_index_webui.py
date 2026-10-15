from pathlib import Path


from webui_sources import index_source


def test_dashboard_supports_sorting_by_setting():
    html = index_source()

    assert "onclick=\"toggleSort('setting')\"" in html
    assert "let currentSortKey = 'task';" in html
    assert "function getResultDisplayParts(result)" in html
    assert "function compareResults(a, b)" in html
    assert "if (currentSortKey === 'setting')" in html
    assert "filteredResults.sort(compareResults);" in html


def test_dashboard_keeps_initial_generation_results_visible():
    html = index_source()

    assert "program_count <= 1" not in html
    assert "stats.program_count <= 0" in html
