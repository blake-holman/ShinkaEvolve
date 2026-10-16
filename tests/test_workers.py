"""Transport tests use Python subprocesses; no coding agents or model calls."""

import asyncio
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock
import uuid
import zlib

import pytest

from shinka.core.workers import Connection, WorkerConnectionError, WorkerPool, current_worker, validate_worker_config
from shinka.core.worker_endpoint import CHUNK_SIZE


MODEL = SimpleNamespace(agent="codex", agent_model="fake", effort="max")


def run(coroutine):
    return asyncio.run(coroutine)


def test_local_generation_lease_prepares_once_and_keeps_retry_metadata(tmp_path):
    async def scenario():
        hook = "import os,pathlib; p=pathlib.Path('phases'); p.write_text((p.read_text() if p.exists() else '')+os.environ['SHINKA_PROPOSAL_PREPARE']+'\\n')"
        pool = WorkerPool([{"name": "local", "capacity": 2, "launch_command": []}],
                          {"prepare": [sys.executable, "-c", hook]}, tmp_path)
        await pool.prepare()
        async with pool.acquire(tmp_path / "gen_1") as lease:
            assert current_worker.get() is lease
            for value in ("first", "retry"):
                result = await lease.run_headless(MODEL, [sys.executable, "-c", f"print('{value}')"], 5)
                assert result.stdout.strip() == value
            assert lease.metadata()["worker_finished_at"] is None
        assert current_worker.get() is None
        assert (tmp_path / "gen_1/phases").read_text().splitlines() == ["coordinator", "worker"]
        assert lease.metadata()["worker_model"] == "fake"
        assert lease.metadata()["worker_effort"] == "max"
        assert lease.metadata()["worker_finished_at"] >= lease.metadata()["worker_started_at"]
        assert pool.slots.qsize() == 2
        await pool.close()
    run(scenario())


def test_endpoint_streams_atomic_compressed_files_and_symlinks(tmp_path):
    async def scenario():
        connection = await Connection({"name": "local"}, {"mirrors": [str(tmp_path)]}, tmp_path).open()
        try:
            target = tmp_path / "runtime/binary"
            data = b"lean-runtime\x00" * (CHUNK_SIZE // 6)
            entry = {"path": str(target), "kind": "file", "mode": 0o751,
                     "sha256": hashlib.sha256(data).hexdigest()}
            await connection.rpc("begin", entry=entry)
            assert not target.exists()
            for offset in range(0, len(data), CHUNK_SIZE):
                await connection.send({"op": "chunk", "data": base64.b64encode(zlib.compress(data[offset:offset + CHUNK_SIZE])).decode(), "compressed": True})
            await connection.rpc("end")
            assert target.read_bytes() == data
            assert target.stat().st_mode & 0o777 == 0o751
            link = {"path": str(tmp_path / "runtime/link"), "kind": "symlink", "target": "binary"}
            await connection.rpc("begin", entry=link)
            assert os.readlink(link["path"]) == "binary"
            assert (await connection.rpc("missing", entries=[entry, link]))["entries"] == []
            await connection.rpc("begin", entry={**entry, "sha256": "0" * 64})
            await connection.send({"op": "chunk", "data": base64.b64encode(b"bad").decode()})
            with pytest.raises(RuntimeError, match="checksum"):
                await connection.rpc("end")
            assert target.read_bytes() == data
        finally:
            await connection.close()
    run(scenario())


def test_endpoint_marks_commands_as_supervised(tmp_path, monkeypatch):
    monkeypatch.setenv("SHINKA_WORKER_SUPERVISED", "0")

    async def scenario():
        pool = WorkerPool([{"name": "local"}], {}, tmp_path)
        await pool.prepare()
        try:
            async with pool.acquire(tmp_path / "gen_1") as lease:
                result = await lease.execute(
                    [sys.executable, "-c", "import os; print(os.environ['SHINKA_WORKER_SUPERVISED'])"],
                    5, {"SHINKA_WORKER_SUPERVISED": "0"},
                )
                assert result.returncode == 0
                assert result.stdout.strip() == "1"
        finally:
            await pool.close()
    run(scenario())


def test_inventory_preserves_lake_and_runtime_links_and_rejects_changed_baseline(tmp_path):
    root = tmp_path / "source"
    for directory in (".git", ".lake", "node_modules", "__pycache__"):
        (root / directory).mkdir(parents=True)
        (root / directory / "file").write_text(directory)
    (root / "link").symlink_to(".lake", target_is_directory=True)
    pool = WorkerPool([{"name": "local"}], {}, root / "runs/current")
    (pool.results_dir / "gen_1").mkdir(parents=True)
    (pool.results_dir / "gen_1/output").write_text("result")
    entries = pool.entries([root], immutable=True)
    paths = {Path(entry["path"]).relative_to(root).as_posix() for entry in entries}
    assert {".lake/file", "node_modules/file", "link"} <= paths
    assert ".git/file" not in paths and "__pycache__/file" not in paths
    assert "runs/current" not in paths
    task = pool.results_dir / "task.json"
    task.write_text("task")
    library = pool.results_dir / "library/versions/v1"
    library.mkdir(parents=True)
    (library / "proof.lean").write_text("proof")
    explicit = pool.entries([task, library], immutable=True)
    assert str(task) in {entry["path"] for entry in explicit}
    assert str(library / "proof.lean") in {entry["path"] for entry in explicit}
    (root / ".lake/new").write_text("new immutable version")
    pool.entries([root], immutable=True)
    (root / ".lake/file").write_text("changed")
    with pytest.raises(RuntimeError, match="changed during"):
        pool.entries([root], immutable=True)


def test_interrupted_inventory_preserves_validated_hashes_and_rechecks_changes(tmp_path, monkeypatch):
    from shinka.core import worker_endpoint

    source = tmp_path / "source"
    source.write_text("original")
    pool = WorkerPool([{"name": "local"}], {}, tmp_path)
    entry = pool.entries([source])[0]
    hello = {"results_dir": str(tmp_path), "mirrors": [str(source)], "worker": "local"}
    first = worker_endpoint.Endpoint()
    try:
        first.hello(hello)
        assert first.missing([entry])["entries"] == []
    finally:
        # No sync_done request: a coordinator disconnected during preparation.
        first.close()
    resumed = worker_endpoint.Endpoint()
    hashed = []
    original = worker_endpoint.digest

    def track_digest(path):
        hashed.append(path)
        return original(path)

    monkeypatch.setattr(worker_endpoint, "digest", track_digest)
    try:
        resumed.hello(hello)
        assert resumed.missing([entry])["entries"] == []
        assert hashed == []
        source.write_text("changed contents")
        assert resumed.missing([entry])["entries"] == [entry]
        assert hashed == [source]
    finally:
        resumed.close()


def test_inventory_checkpoints_and_concurrent_connections_merge_cache(tmp_path):
    from shinka.core import worker_endpoint

    endpoints = [worker_endpoint.Endpoint(), worker_endpoint.Endpoint()]
    pool = WorkerPool([{"name": "local"}], {}, tmp_path)
    try:
        for index, endpoint in enumerate(endpoints):
            endpoint.hello({"results_dir": str(tmp_path), "mirrors": [str(tmp_path)], "worker": "local"})
            source = tmp_path / f"source-{index}"
            source.write_text(str(index))
            entry = pool.entries([source])[0]
            assert endpoint.missing([entry])["entries"] == []
        with ThreadPoolExecutor(max_workers=2) as executor:
            list(executor.map(lambda endpoint: endpoint.save_cache(), endpoints))
        assert set(json.loads(endpoints[0].cache_path.read_text())) == {
            str(tmp_path / "source-0"), str(tmp_path / "source-1")}
        source = tmp_path / "periodic"
        source.write_text("checkpoint")
        endpoints[0].cache_saved_at = 0
        endpoints[0].missing(pool.entries([source]))
        assert str(source) in json.loads(endpoints[0].cache_path.read_text())
    finally:
        for endpoint in endpoints:
            endpoint.close()


def test_mirror_reports_progress_when_no_files_need_transfer(tmp_path, monkeypatch, caplog):
    from shinka.core import workers

    times = iter((0, 31, 31, 62, 62))
    monkeypatch.setattr(workers, "time", SimpleNamespace(monotonic=lambda: next(times)))
    connection = SimpleNamespace(worker={"name": "remote"},
                                 rpc=AsyncMock(return_value={"entries": []}))
    pool = WorkerPool([{"name": "remote"}], {}, tmp_path)
    with caplog.at_level("INFO", logger="shinka.core.workers"):
        run(pool.sync(connection, [{}] * 300))
    assert "checked 256/300 entries, 0.0 MiB sent" in caplog.text
    assert "checked 300/300 entries, 0.0 MiB sent" in caplog.text
    assert "mirror complete: checked 300 entries, 0.0 MiB sent" in caplog.text


@pytest.mark.parametrize("timeout,exit_parent", [(0.5, False), (5, True)])
def test_endpoint_cleans_detached_descendants_on_timeout_and_completion(tmp_path, timeout, exit_parent):
    async def scenario():
        pool = WorkerPool([{"name": "local"}], {}, tmp_path)
        await pool.prepare()
        script = ("import pathlib,subprocess,sys,time; "
                  "p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)'],start_new_session=True); "
                  "pathlib.Path('child.pid').write_text(str(p.pid)); "
                  + ("time.sleep(0.15)" if exit_parent else "time.sleep(60)"))
        async with pool.acquire(tmp_path / "gen_1") as lease:
            if exit_parent:
                assert (await lease.run_headless(MODEL, [sys.executable, "-c", script], timeout)).returncode == 0
            else:
                with pytest.raises(asyncio.TimeoutError):
                    await lease.run_headless(MODEL, [sys.executable, "-c", script], timeout)
            pid = int((tmp_path / "gen_1/child.pid").read_text())
            path = Path(f"/proc/{pid}/stat")
            assert not path.exists() or path.read_text().rsplit(")", 1)[1].split()[0] == "Z"
        await pool.close()
    run(scenario())


def test_cancelled_lease_stops_command_before_returning_slot(tmp_path):
    async def scenario():
        pool = WorkerPool([{"name": "local"}], {}, tmp_path)
        await pool.prepare()
        async def generation():
            async with pool.acquire(tmp_path / "gen_1") as lease:
                await lease.run_headless(MODEL, [sys.executable, "-c", "import pathlib,os,time; pathlib.Path('pid').write_text(str(os.getpid())); time.sleep(60)"], 60)
        task = asyncio.create_task(generation())
        for _ in range(100):
            if (tmp_path / "gen_1/pid").exists():
                break
            await asyncio.sleep(0.02)
        pid = int((tmp_path / "gen_1/pid").read_text())
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert not Path(f"/proc/{pid}").exists()
        assert pool.slots.qsize() == 1
        await pool.close()
    run(scenario())


def test_artifact_inventory_excludes_central_files_and_symlinks(tmp_path):
    async def scenario():
        work = tmp_path / "gen_1"
        work.mkdir()
        for name in ("main.lean", "programs.sqlite", "task.json", "proof.txt"):
            (work / name).write_text(name)
        (work / "outside").symlink_to(tmp_path / "secret")
        (tmp_path / "secret").write_text("private")
        connection = await Connection({"name": "local"}, {}, tmp_path, work).open()
        try:
            entries = (await connection.rpc("artifacts", patterns=["*"]))["entries"]
            assert [entry["path"] for entry in entries] == ["proof.txt"]
        finally:
            await connection.close()
    run(scenario())


def test_endpoint_attempt_is_idempotent(tmp_path):
    async def scenario():
        connection = await Connection({"name": "local"}, {}, tmp_path, tmp_path).open()
        try:
            attempt = uuid.uuid4().hex
            command = [sys.executable, "-c", "from pathlib import Path; p=Path('count'); p.write_text((p.read_text() if p.exists() else '')+'x')"]
            await connection.rpc("run", attempt=attempt, command=command, timeout=5)
            while (await connection.rpc("status", attempt=attempt))["status"] == "running":
                await asyncio.sleep(0.02)
            await connection.rpc("run", attempt=attempt, command=command, timeout=5)
            assert (tmp_path / "count").read_text() == "x"
        finally:
            await connection.close()
    run(scenario())


def test_mirror_refresh_only_adds_new_paths(tmp_path):
    async def scenario():
        source = tmp_path / "library"
        source.mkdir()
        (source / "old").write_text("immutable")
        worker = {"name": "remote", "launch_command": ["unused"]}
        pool = WorkerPool([worker], {"mirrors": [str(source)]}, tmp_path / "run")
        pool.sync = AsyncMock()
        connection = SimpleNamespace(worker=worker)
        await pool.mirrors(connection)
        (source / "new").write_text("new immutable input")
        await pool.mirrors(connection)
        assert [entry["path"] for entry in pool.sync.call_args.args[1]] == [str(source / "new")]
        await pool.mirrors(connection)
        assert pool.sync.await_count == 2
    run(scenario())


def test_lost_start_acknowledgement_cancels_existing_uuid_then_reconnects(tmp_path, monkeypatch):
    from shinka.core import workers as workers_module
    monkeypatch.setattr(workers_module, "RECONNECT_DELAY_SECONDS", 0)

    async def scenario():
        pool = WorkerPool([{"name": "local"}], {}, tmp_path)
        await pool.prepare()
        async with pool.acquire(tmp_path / "gen_1") as lease:
            rpc = lease.connection.rpc
            async def lose_ack(op, **values):
                result = await rpc(op, **values)
                if op == "run":
                    raise WorkerConnectionError("lost acknowledgement")
                return result
            lease.connection.rpc = lose_ack
            command = [sys.executable, "-c", "import time; time.sleep(60)"]
            with pytest.raises(WorkerConnectionError, match="lost acknowledgement"):
                await lease.run_headless(MODEL, command, 60)
            assert not lease.uncertain
            assert not lease.failed
            # The lost command was confirmed stopped, so the lease runs the retry
            # on a fresh connection instead of refusing it.
            result = await lease.run_headless(MODEL, [sys.executable, "-c", "print('retry ok')"], 60)
            assert result.returncode == 0 and "retry ok" in result.stdout
            states = [json.loads(p.read_text()) for p in (tmp_path / ".workers/local").glob("*/state.json")]
            assert len(states) == 2
            assert all(state["status"] in {"complete", "cancelled"} for state in states)
        await pool.close()
    run(scenario())


def test_status_waits_for_live_owner_to_finish_persisting(tmp_path, monkeypatch):
    from shinka.core import worker_endpoint as endpoint_module
    endpoint = endpoint_module.Endpoint()
    try:
        endpoint.hello({"results_dir": str(tmp_path), "mirrors": [], "worker": "local"})
        attempt = uuid.uuid4().hex
        state = {"attempt": attempt, "status": "running", "pid": 100, "process_identity": "child",
                 "owner_pid": 200, "owner_identity": "owner"}
        endpoint_module.save_json(endpoint.state_path(attempt), state)
        monkeypatch.setattr(endpoint_module, "process_identity", lambda pid: "owner" if pid == 200 else None)
        assert endpoint.status(attempt)["status"] == "running"
        monkeypatch.setattr(endpoint_module, "process_identity", lambda pid: None)
        assert endpoint.status(attempt)["status"] == "stopped"
    finally:
        endpoint.close()


def test_state_write_failure_cleans_started_process(tmp_path):
    import subprocess
    from shinka.core import worker_endpoint
    script = """
import importlib.util, pathlib, subprocess, sys, uuid
spec = importlib.util.spec_from_file_location('endpoint', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
endpoint = module.Endpoint()
endpoint.hello({'results_dir': sys.argv[2], 'mirrors': [], 'worker': 'local'})
started = []
original = subprocess.Popen
def capture(*args, **kwargs):
    process = original(*args, **kwargs)
    started.append(process)
    return process
module.subprocess.Popen = capture
def fail(*args):
    raise OSError('disk unavailable')
module.save_json = fail
try:
    endpoint.run({'attempt': uuid.uuid4().hex, 'command': [sys.executable, '-c', 'import time; time.sleep(60)'], 'timeout': 60})
except OSError:
    assert started[0].poll() is not None
    assert endpoint.active is None
else:
    raise AssertionError('Expected state persistence failure')
finally:
    endpoint.close()
"""
    subprocess.run([sys.executable, "-c", script, worker_endpoint.__file__, str(tmp_path)], check=True, timeout=10)


def test_pool_startup_stops_prior_unfinished_attempt(tmp_path):
    async def scenario():
        old = await Connection({"name": "local"}, {}, tmp_path, tmp_path).open()
        attempt = uuid.uuid4().hex
        try:
            state = await old.rpc("run", attempt=attempt,
                                  command=[sys.executable, "-c", "import time; time.sleep(60)"], timeout=60)
            pool = WorkerPool([{"name": "local"}], {}, tmp_path)
            await pool.prepare()
            assert (await old.rpc("status", attempt=attempt))["status"] != "running"
            assert not Path(f"/proc/{state['pid']}").exists()
            await pool.close()
        finally:
            await old.close()
    run(scenario())


@pytest.mark.parametrize("workers,workspace", [([], {}), ([{"name": "../x"}], {}),
    ([{"name": "x", "capacity": True}], {}), ([{"name": "x"}, {"name": "x"}], {}),
    ([{"name": "x"}], {"mirrors": ["relative"]}), ([{"name": "x"}], {"artifacts": ["../secret"]})])
def test_invalid_worker_configuration(workers, workspace):
    with pytest.raises(ValueError):
        validate_worker_config(workers, workspace)
