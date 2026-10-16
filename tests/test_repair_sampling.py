import asyncio

import numpy as np
import pytest

from shinka.database import DatabaseConfig, Program, ProgramDatabase
from shinka.database.async_dbase import AsyncProgramDatabase


@pytest.fixture
def database_factory(tmp_path):
    databases = []

    def create(**options):
        defaults = dict(
            db_path=str(tmp_path / f"database-{len(databases)}.db"),
            num_islands=1,
            explicit_initial_population=True,
            repair_probability=1,
            repair_filters={"private_metrics.status": "unresolved"},
            repair_weight_metric="public_metrics.vertices",
        )
        defaults.update(options)
        database = ProgramDatabase(DatabaseConfig(**defaults), embedding_model="")
        databases.append(database)
        return database

    yield create
    for database in databases:
        database.close()


def add_seed(database, index=0, correct=True):
    program = Program(
        id=f"seed-{index}",
        code=f"seed {index}",
        correct=correct,
        metadata={"initial_population_index": index},
    )
    database.add(program)
    return program


def add_candidate(database, name, parent="seed-0", vertices=2, **options):
    defaults = dict(
        id=name,
        code=name,
        parent_id=parent,
        generation=1,
        public_metrics={"vertices": vertices},
        private_metrics={"status": "unresolved"},
    )
    defaults.update(options)
    program = Program(**defaults)
    database.add(program)
    return program


@pytest.mark.parametrize(
    "options",
    [
        {"repair_probability": value}
        for value in [-0.1, 1.1, float("nan"), float("inf"), True, "0.25"]
    ]
    + [
        {"repair_sampling": "other"},
        {"repair_filters": []},
        {"repair_filters": {"correct": False}},
        {"repair_filters": {"metadata..status": "unresolved"}},
        {"repair_filters": {3: "unresolved"}},
        {"repair_weight_metric": "combined_score"},
        {"repair_weight_metric": "public_metrics."},
        {"explicit_initial_population": "yes"},
        {"explicit_initial_population": True, "num_islands": 0},
    ],
)
def test_invalid_repair_configuration(options):
    with pytest.raises(ValueError):
        DatabaseConfig(**options)


def test_hydra_repair_filters():
    from hydra.utils import instantiate
    from omegaconf import OmegaConf

    config = instantiate(OmegaConf.create({
        "_target_": "shinka.database.DatabaseConfig",
        "repair_filters": {"private_metrics.status": "unresolved"},
    }))
    assert config.repair_filters == {"private_metrics.status": "unresolved"}


def test_distinct_incorrect_seeds_initialize_islands_without_copies(database_factory):
    database = database_factory(num_islands=2)
    add_seed(database, 1, correct=False)
    assert database._count_programs_in_db() == 1
    assert database.island_manager.get_initialized_islands() == [1]
    assert not database.island_manager.are_all_islands_initialized()
    add_seed(database, 0)
    assert database._count_programs_in_db() == 2
    assert database.island_manager.are_all_islands_initialized()
    child = add_candidate(database, "child", parent="seed-1", island_idx=0)
    assert child.island_idx == 1
    assert database.get("seed-0").generation == database.get("seed-1").generation == 0


@pytest.mark.parametrize("index", [None, -1, 1, True, "0"])
def test_explicit_seed_requires_valid_index(database_factory, index):
    database = database_factory()
    with pytest.raises(ValueError, match="initial_population_index"):
        database.add(Program(id="invalid", code="invalid", metadata={"initial_population_index": index}))


def test_repair_uses_selected_island_and_replacement_ancestry(database_factory, monkeypatch):
    database = database_factory(num_islands=2)
    add_seed(database, 0)
    add_seed(database, 1)
    add_candidate(database, "wrong-island", parent="seed-0")
    add_candidate(database, "correct", parent="seed-1", correct=True)
    add_candidate(database, "failed", parent="seed-1", private_metrics={"status": "failed"})
    add_candidate(database, "repair", parent="correct")
    monkeypatch.setattr(database.island_sampler, "sample_island", lambda islands: 1)

    parent, ancestry, top_k, needs_fix = database.sample_with_fix_mode()

    assert parent.id == "repair"
    assert parent.island_idx == 1
    assert [program.id for program in ancestry] == ["seed-1", "correct"]
    assert top_k == []
    assert needs_fix


@pytest.mark.parametrize("sampling", ["uniform", "weighted"])
@pytest.mark.parametrize("metric", [None, True, "2", -1, float("nan"), float("inf")])
def test_invalid_metrics_are_ineligible(database_factory, sampling, metric):
    database = database_factory(repair_sampling=sampling)
    add_seed(database)
    add_candidate(database, "invalid", vertices=metric)
    add_candidate(database, "missing", public_metrics={})
    add_candidate(database, "valid", vertices=0)

    parent, _, _, needs_fix = database.sample_with_fix_mode()

    assert parent.id == "valid"
    assert needs_fix


def test_nested_filters_distinguish_missing_from_null(database_factory):
    database = database_factory(repair_filters={"metadata.proof.status": None})
    add_seed(database)
    add_candidate(database, "missing")
    add_candidate(database, "null", metadata={"proof": {"status": None}})
    assert database.sample_with_fix_mode()[0].id == "null"


@pytest.mark.parametrize("sampling, expected", [("uniform", None), ("weighted", [0.8, 0.2])])
def test_repair_weights_include_metric_and_children(database_factory, monkeypatch, sampling, expected):
    database = database_factory(repair_sampling=sampling)
    add_seed(database)
    add_candidate(database, "small", vertices=1)
    add_candidate(database, "large", vertices=3)
    add_candidate(database, "child", parent="large", private_metrics={"status": "failed"})

    def choose(count, p):
        assert count == 2
        if expected is None:
            assert p is None
        else:
            np.testing.assert_allclose(p, expected)
        return 1

    monkeypatch.setattr(np.random, "choice", choose)
    assert database.sample_with_fix_mode()[0].id == "large"


def test_weighted_sampling_without_metric_uses_children(database_factory, monkeypatch):
    database = database_factory(repair_sampling="weighted", repair_weight_metric=None)
    add_seed(database)
    add_candidate(database, "first", vertices=None)
    add_candidate(database, "second", vertices=None, children_count=1)

    def choose(count, p):
        assert count == 2
        np.testing.assert_allclose(p, [2 / 3, 1 / 3])
        return 0

    monkeypatch.setattr(np.random, "choice", choose)
    assert database.sample_with_fix_mode()[0].id == "first"


@pytest.mark.parametrize("probability", [0, 1])
def test_repair_falls_back_to_ordinary_selection(database_factory, probability):
    database = database_factory(repair_probability=probability)
    add_seed(database)
    add_candidate(database, "ineligible", private_metrics={"status": "failed"})

    parent, _, _, needs_fix = database.sample_with_fix_mode()

    assert parent.id == "seed-0"
    assert not needs_fix


def test_probability_gate_can_keep_ordinary_parent(database_factory, monkeypatch):
    database = database_factory(repair_probability=0.25)
    add_seed(database)
    add_candidate(database, "repair")
    monkeypatch.setattr(np.random, "random", lambda: 0.5)
    assert database.sample_with_fix_mode()[0].id == "seed-0"
    monkeypatch.setattr(np.random, "random", lambda: 0.1)
    assert database.sample_with_fix_mode()[0].id == "repair"


def test_no_repair_before_all_seeds_are_inserted(database_factory):
    database = database_factory(num_islands=2)
    add_seed(database)
    add_candidate(database, "repair")

    parent, _, _, needs_fix = database.sample_with_fix_mode()

    assert parent.id == "seed-0"
    assert not needs_fix


@pytest.mark.parametrize("probability", [0, 1])
def test_native_fix_fallback_keeps_original_context(database_factory, monkeypatch, probability):
    database = database_factory(repair_probability=probability)
    add_seed(database, correct=False)
    add_candidate(database, "child", private_metrics={"status": "failed"})
    monkeypatch.setattr(np.random, "randint", lambda count: count - 1)

    parent, ancestry, top_k, needs_fix = database.sample_with_fix_mode()

    assert parent.id == "child"
    assert ancestry == top_k == []
    assert needs_fix


def test_explicit_offspring_inherits_migrated_parent_island(database_factory):
    database = database_factory(num_islands=2)
    add_seed(database, 0)
    add_seed(database, 1)
    add_candidate(database, "migrant", correct=True)
    database.island_manager.migration_strategy._migrate_program("migrant", 0, 1, 2)
    database.conn.commit()

    child = add_candidate(database, "child", parent="migrant", island_idx=0)

    assert child.island_idx == 1


def test_explicit_offspring_inherits_dynamically_spawned_island(database_factory):
    database = database_factory()
    add_seed(database)
    assert database.island_manager.spawn_new_island()
    database.cursor.execute("SELECT id FROM programs WHERE island_idx = 1")
    spawned_parent = database.cursor.fetchone()["id"]

    child = add_candidate(database, "child", parent=spawned_parent, island_idx=0)

    assert child.island_idx == 1


@pytest.mark.parametrize("probability", [0, 1])
def test_latest_repairs_only_when_enabled_within_latest_island(database_factory, probability):
    database = database_factory(
        num_islands=2,
        parent_selection_strategy="latest",
        repair_probability=probability,
    )
    add_seed(database, 0)
    add_seed(database, 1)
    add_candidate(database, "wrong-island", parent="seed-0")
    add_candidate(database, "repair", parent="seed-1")
    add_candidate(database, "latest", parent="seed-1", generation=2, private_metrics={"status": "failed"})

    parent, ancestry, top_k, needs_fix = database.sample_with_fix_mode()

    assert parent.id == ("repair" if probability else "latest")
    assert needs_fix == bool(probability)
    assert [program.id for program in ancestry] == (["seed-1"] if probability else [])
    assert top_k == []


def test_async_workers_preserve_explicit_islands_and_repair_settings(database_factory):
    database = database_factory(num_islands=2)
    add_seed(database, 0)
    add_seed(database, 1, correct=False)
    add_candidate(database, "repair-0", parent="seed-0")
    add_candidate(database, "repair-1", parent="seed-1")

    async def sample():
        async_database = AsyncProgramDatabase(database, max_workers=2)
        try:
            results = await asyncio.gather(
                async_database.sample_with_fix_mode_async(),
                async_database.sample_with_fix_mode_async(),
            )
            for parent, ancestry, top_k, needs_fix in results:
                assert parent.id == f"repair-{parent.island_idx}"
                assert [program.id for program in ancestry] == [f"seed-{parent.island_idx}"]
                assert top_k == []
                assert needs_fix
        finally:
            await async_database.close_async()

    asyncio.run(sample())
