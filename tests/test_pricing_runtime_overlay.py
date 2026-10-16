"""Regression tests for runtime embedding-price overlays."""

import json
from pathlib import Path

from shinka.pricing.catalog import (
    CatalogSnapshot,
    catalog_from_models_dev_payload,
    load_run_pricing_snapshot,
    write_run_pricing_snapshot,
)


MODEL_NAME = "gemini-embedding-exp-03-07"


def _runtime_catalog(tmp_path: Path, overrides):
    overlay_path = tmp_path / "overlay.json"
    overlay_path.write_text(
        json.dumps({"embedding_overrides": overrides}), encoding="utf-8"
    )
    payload = {
        "google": {
            "models": {
                MODEL_NAME: {
                    "family": "embedding",
                    "cost": {"input": 1.5},
                }
            }
        }
    }
    return catalog_from_models_dev_payload(
        payload,
        overlay_path=overlay_path,
        include_bundled=False,
    )


def test_embedding_overrides_replace_runtime_discovery_price(tmp_path: Path):
    catalog = _runtime_catalog(
        tmp_path,
        [
            {
                "provider": "google",
                "model_name": MODEL_NAME,
                "input_price": 0.0,
                "output_price": 999.0,
            }
        ],
    )

    entry = catalog.get("google", MODEL_NAME, kind="embedding")
    assert entry.input_price == 0.0
    assert entry.output_price is None


def test_embedding_overrides_ignore_unknown_and_malformed_entries(tmp_path: Path):
    catalog = _runtime_catalog(
        tmp_path,
        [
            {"provider": "google"},
            {"provider": "unknown", "model_name": "unknown", "input_price": 0.0},
        ],
    )

    assert catalog.get("google", MODEL_NAME, kind="embedding").input_price == 1.5e-6


def test_embedding_output_cost_does_not_break_saved_run_snapshot(tmp_path):
    payload = {"openai": {"models": {"test-embedding": {
        "cost": {"input": 0.02, "output": 0.0, "tiers": [
            {"tier": {"type": "context", "size": 1000}, "input": 0.04, "output": 0.0}
        ]}
    }}}}
    catalog = catalog_from_models_dev_payload(payload, include_bundled=False)
    snapshot = CatalogSnapshot(catalog, "cache", None, None, "test-catalog")

    write_run_pricing_snapshot(snapshot, tmp_path)
    restored = load_run_pricing_snapshot(tmp_path)

    assert restored is not None
    entry = restored.catalog.get("openai", "test-embedding", kind="embedding")
    assert entry.input_price == 0.02 / 1_000_000
    assert entry.input_price_tier2 == 0.04 / 1_000_000
    assert entry.output_price is None
    assert entry.output_price_tier2 is None
