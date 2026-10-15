from pathlib import Path


from webui_sources import compare_source


def test_compare_best_score_only_uses_correct_programs():
    html = compare_source()

    assert "function getBestCorrectScore(programs)" in html
    assert "let bestScore = Number.NEGATIVE_INFINITY;" in html
    assert "return Number.isFinite(bestScore) ? bestScore : null;" in html
    assert "if (!p.correct || p.combined_score === null || p.combined_score === undefined)" in html
    assert "if (p.correct && p.combined_score !== null && p.combined_score !== undefined)" in html
    assert "bestScore === null ? 'N/A' : bestScore.toFixed(2)" in html
    assert "let cumulativeBest = Number.NEGATIVE_INFINITY;" in html
    assert "let runningBest = Number.NEGATIVE_INFINITY;" in html
    assert "Number.isFinite(cumulativeBest) ? cumulativeBest : null" in html
    assert "Number.isFinite(runningBest) ? runningBest : null" in html
