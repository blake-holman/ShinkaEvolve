import pytest

from shinka.edit import apply_diff_patch, apply_full_patch
from shinka.edit.marker_validation import validate_evolve_markers


@pytest.mark.parametrize("patcher", [apply_diff_patch, apply_full_patch])
def test_lean_candidate_edits(tmp_path, patcher):
    original = (
        "import Mathlib\n\n-- EVOLVE-BLOCK-START\n"
        "def value : ℕ := 1\n-- EVOLVE-BLOCK-END\n"
    )
    expected = original.replace(":= 1", ":= 2")
    patch = (
        f"```lean\n{expected}```"
        if patcher is apply_full_patch else
        "<<<<<<< SEARCH\ndef value : ℕ := 1\n=======\n"
        "def value : ℕ := 2\n>>>>>>> REPLACE"
    )
    updated, applied, output_path, error, *_ = patcher(
        patch_str=patch,
        original_str=original,
        patch_dir=tmp_path,
        language="lean",
        verbose=False,
    )
    assert error is None
    assert applied == 1
    assert updated.rstrip("\n") == expected.rstrip("\n")
    assert output_path == tmp_path / "main.lean"
    assert output_path.read_text(encoding="utf-8") == updated
    assert validate_evolve_markers(updated, "lean") is None
