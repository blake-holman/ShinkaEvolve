"""Generation leases and a streamed stdio transport for Linux proposal workers."""

import asyncio
import base64
from contextlib import asynccontextmanager
from contextvars import ContextVar
import fnmatch
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shlex
import signal
import stat
import subprocess
import sys
import time
import uuid
import zlib

from .worker_endpoint import CHUNK_SIZE, digest, safe_artifact


logger = logging.getLogger(__name__)
current_worker = ContextVar("shinka_proposal_worker", default=None)
RECONNECT_DELAY_SECONDS = 5
IGNORED = {".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"}


def validate_worker_config(workers, workspace):
    if workers is None:
        if workspace is not None:
            raise ValueError("proposal_workspace requires proposal_workers")
        return
    if not isinstance(workers, list) or not workers:
        raise ValueError("proposal_workers must be a nonempty list")
    names = set()
    for worker in workers:
        if not isinstance(worker, dict) or set(worker) - {"name", "capacity", "launch_command",
                                                          "agents", "memory_max", "memory_slice"}:
            raise ValueError("Invalid proposal worker configuration")
        agents = worker.get("agents")
        if agents is not None and (not isinstance(agents, list) or not agents
                                   or any(not isinstance(a, str) or not a for a in agents)):
            raise ValueError("Worker agents must be a nonempty list of agent names, e.g. [codex]")
        memory_max = worker.get("memory_max")
        if memory_max is not None:
            if worker.get("launch_command"):
                raise ValueError("memory_max applies only to local workers without a launch_command")
            if not isinstance(memory_max, str) or not re.fullmatch(r"[0-9]+[KMGT]?", memory_max):
                raise ValueError("Worker memory_max must be a systemd size such as 14G")
        memory_slice = worker.get("memory_slice")
        if memory_slice is not None and (not memory_max or not isinstance(memory_slice, str)
                                         or not re.fullmatch(r"[A-Za-z0-9_-]+\.slice", memory_slice)):
            raise ValueError("Worker memory_slice needs memory_max and a name such as shinka-agents.slice")
        name = worker.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", name) or name in names:
            raise ValueError("Worker names must be unique simple names")
        names.add(name)
        capacity = worker.get("capacity", 1)
        if isinstance(capacity, bool) or not isinstance(capacity, int) or capacity < 1:
            raise ValueError("Worker capacity must be a positive integer")
        _argv(worker.get("launch_command", []), "launch_command")
    if workspace is None:
        return
    if not isinstance(workspace, dict) or set(workspace) - {"mirrors", "prepare", "artifacts"}:
        raise ValueError("proposal_workspace accepts mirrors, prepare, and artifacts")
    _argv(workspace.get("prepare", []), "prepare")
    mirrors = workspace.get("mirrors", [])
    if not isinstance(mirrors, list) or any(not isinstance(p, str) or not Path(p).is_absolute()
            or ".." in Path(p).parts for p in mirrors):
        raise ValueError("Worker mirrors must be absolute file or directory paths")
    artifacts = workspace.get("artifacts", [])
    if not isinstance(artifacts, list) or any(not isinstance(p, str) or not safe_artifact(p)
                                           for p in artifacts):
        raise ValueError("Worker artifacts must be safe relative paths or glob patterns")


def _argv(value, name):
    if not isinstance(value, list) or any(not isinstance(arg, str) or not arg for arg in value):
        raise ValueError(f"Worker {name} must be an argv list")


class WorkerConnectionError(RuntimeError):
    pass


def local_endpoint_command(worker):
    """Command for a local worker endpoint.

    With ``memory_max`` (a systemd size such as ``14G``), the endpoint and every
    agent and Lean process it starts run in their own transient systemd scope
    with that memory limit and no swap, so a runaway agent is killed inside its
    scope instead of pushing the coordinator into swap.
    """
    endpoint = [sys.executable, str(Path(__file__).with_name("worker_endpoint.py"))]
    limit = worker.get("memory_max")
    if not limit:
        return endpoint
    # memory_slice (optional) groups every slot's scope under one systemd slice,
    # whose own MemoryMax caps all local agents together.
    slice_args = [f"--slice={worker['memory_slice']}"] if worker.get("memory_slice") else []
    return ["systemd-run", "--user", "--scope", "--quiet", "--collect", *slice_args,
            "-p", f"MemoryMax={limit}", "-p", "MemorySwapMax=0",
            *endpoint]


class Connection:
    def __init__(self, worker, workspace, results_dir, work_dir=None):
        self.worker = worker
        self.workspace = workspace
        self.results_dir = results_dir
        self.work_dir = work_dir
        self.process = None
        self.heartbeat = None
        self.stderr_task = None
        self.stderr = ""
        self.write_lock = asyncio.Lock()
        self.rpc_lock = asyncio.Lock()

    async def open(self):
        command = self.worker.get("launch_command") or local_endpoint_command(self.worker)
        self.process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            limit=32 * 1024 * 1024, start_new_session=True)
        self.stderr_task = asyncio.create_task(self._stderr())
        self.heartbeat = asyncio.create_task(self._heartbeat())
        try:
            await self.rpc("hello", worker=self.worker["name"], results_dir=str(self.results_dir),
                mirrors=self.workspace.get("mirrors", []), work_dir=str(self.work_dir) if self.work_dir else None)
        except BaseException:
            await self.close()
            raise
        return self

    async def _stderr(self):
        while block := await self.process.stderr.read(4096):
            self.stderr = (self.stderr + block.decode(errors="replace"))[-8192:]

    async def _heartbeat(self):
        try:
            while True:
                await self.send({"op": "heartbeat"})
                await asyncio.sleep(2)
        except (OSError, RuntimeError):
            pass

    async def send(self, request):
        async with self.write_lock:
            try:
                self.process.stdin.write((json.dumps(request, ensure_ascii=True) + "\n").encode())
                await self.process.stdin.drain()
            except (OSError, RuntimeError) as error:
                await asyncio.sleep(0.05)
                raise WorkerConnectionError(
                    f"Worker {self.worker['name']} write failed ({type(error).__name__}, "
                    f"exit={self.process.returncode}): {self.stderr.strip() or str(error)}"
                ) from error

    async def rpc(self, op, **values):
        async with self.rpc_lock:
            request = {"op": op, "id": uuid.uuid4().hex, **values}
            try:
                await self.send(request)
                line = await asyncio.wait_for(self.process.stdout.readline(), 300)
                if not line:
                    raise WorkerConnectionError(f"Worker {self.worker['name']} disconnected: {self.stderr.strip()}")
                reply = json.loads(line)
                if reply.get("id") != request["id"]:
                    raise WorkerConnectionError("Worker returned an unexpected response")
                if not reply.get("ok"):
                    raise RuntimeError(f"Worker {self.worker['name']}: {reply.get('error')}")
                return reply
            except (OSError, asyncio.TimeoutError, ValueError) as error:
                raise WorkerConnectionError(f"Worker {self.worker['name']} transport failed: {error}") from error

    async def close(self):
        if self.heartbeat:
            self.heartbeat.cancel()
        if not self.process:
            return
        if self.process.stdin:
            self.process.stdin.close()
        try:
            await asyncio.wait_for(self.process.wait(), 7)
        except asyncio.TimeoutError:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await self.process.wait()
        if self.stderr_task:
            await self.stderr_task


class WorkerPool:
    def __init__(self, configs, workspace, results_dir):
        validate_worker_config(configs, workspace)
        self.configs = configs
        self.workspace = workspace or {}
        self.results_dir = Path(results_dir).absolute()
        self.total_capacity = sum(worker.get("capacity", 1) for worker in configs)
        self.slots = asyncio.Queue()
        self.quarantined = set()
        self.connections = set()
        self.locks = {worker["name"]: asyncio.Lock() for worker in configs}
        self.hashes = {}
        self.baseline = {}
        self.synced = {worker["name"]: set() for worker in configs}
        self.prepared = False
        self.inventory_lock = asyncio.Lock()

    async def connection(self, worker, work_dir=None):
        connection = await Connection(worker, self.workspace, self.results_dir, work_dir).open()
        self.connections.add(connection)
        return connection

    async def disconnect(self, connection):
        await connection.close()
        self.connections.discard(connection)

    def entries(self, roots, immutable=False):
        entries = []
        def visit(path, explicit=False):
            if path.name in IGNORED:
                return
            if immutable and not explicit and path == self.results_dir:
                return
            info = path.lstat()
            entry = {"path": str(path), "mode": stat.S_IMODE(info.st_mode)}
            if path.is_symlink():
                entry.update(kind="symlink", target=os.readlink(path))
            elif path.is_dir():
                entry.update(kind="directory")
            elif path.is_file():
                signature = (info.st_size, info.st_mtime_ns, info.st_mode)
                cached = self.hashes.get(str(path))
                checksum = cached[1] if cached and cached[0] == signature else digest(path)
                self.hashes[str(path)] = signature, checksum
                entry.update(kind="file", sha256=checksum, size=info.st_size)
            else:
                return
            if immutable and entry["kind"] != "directory":
                previous = self.baseline.setdefault(str(path), entry)
                if previous != entry:
                    raise RuntimeError(f"Mirrored input changed during the run: {path}")
            entries.append(entry)
            if entry["kind"] == "directory":
                for child in sorted(path.iterdir()):
                    visit(child)
        for root in roots:
            visit(Path(root), explicit=True)
        return entries

    async def sync(self, connection, entries):
        transferred = 0
        reported_at = time.monotonic()
        for offset in range(0, len(entries), 256):
            reply = await connection.rpc("missing", entries=entries[offset:offset + 256])
            checked = min(offset + 256, len(entries))
            if time.monotonic() - reported_at >= 30:
                logger.info("Worker %s mirror: checked %d/%d entries, %.1f MiB sent",
                            connection.worker["name"], checked, len(entries), transferred / 1048576)
                reported_at = time.monotonic()
            for entry in reply["entries"]:
                await connection.send({"op": "begin", "entry": entry})
                if entry["kind"] == "file":
                    with Path(entry["path"]).open("rb") as stream:
                        while block := stream.read(CHUNK_SIZE):
                            packed = zlib.compress(block, level=1)
                            compressed = len(packed) < len(block)
                            await connection.send({"op": "chunk", "data": base64.b64encode(packed if compressed else block).decode(),
                                                   "compressed": compressed})
                            transferred += len(block)
                            if time.monotonic() - reported_at >= 30:
                                logger.info("Worker %s mirror: checked %d/%d entries, %.1f MiB sent",
                                            connection.worker["name"], checked, len(entries), transferred / 1048576)
                                reported_at = time.monotonic()
                    await connection.send({"op": "end"})
        await connection.rpc("sync_done")
        logger.info("Worker %s mirror complete: checked %d entries, %.1f MiB sent",
                    connection.worker["name"], len(entries), transferred / 1048576)

    async def mirrors(self, connection):
        if not connection.worker.get("launch_command"):
            return
        async with self.inventory_lock:
            entries = await asyncio.to_thread(self.entries, self.workspace.get("mirrors", []), True)
        # Shared inputs are immutable. After initial setup only append new paths;
        # never rewrite a baseline directory while another generation uses it.
        synced = self.synced[connection.worker["name"]]
        entries = [entry for entry in entries if entry["path"] not in synced]
        if not entries:
            return
        logger.info("Checking %s mirror: %d entries, %.1f MiB of files", connection.worker["name"],
                    len(entries), sum(entry.get("size", 0) for entry in entries) / 1048576)
        await self.sync(connection, entries)
        synced.update(entry["path"] for entry in entries)
        logger.info("Worker %s mirrors ready", connection.worker["name"])

    async def prepare(self):
        if self.prepared:
            return
        self.results_dir.mkdir(parents=True, exist_ok=True)
        for worker in self.configs:
            connection = None
            try:
                connection = await self.connection(worker)
                pending = await connection.rpc("pending")
                for attempt in pending["attempts"]:
                    state = await connection.rpc("cancel", attempt=attempt)
                    for _ in range(50):
                        if state["status"] != "running":
                            break
                        await asyncio.sleep(0.1)
                        state = await connection.rpc("status", attempt=attempt)
                    if state["status"] == "running":
                        raise WorkerConnectionError(f"Prior worker attempt {attempt} could not be confirmed stopped")
                await self.mirrors(connection)
            except Exception as error:
                self.quarantined.add(worker["name"])
                logger.error("Proposal worker %s is unavailable: %s", worker["name"], error)
            finally:
                if connection:
                    await self.disconnect(connection)
            if worker["name"] not in self.quarantined:
                for _ in range(worker.get("capacity", 1)):
                    self.slots.put_nowait(worker)
        if self.slots.empty():
            raise RuntimeError("No proposal workers are available")
        self.prepared = True

    @asynccontextmanager
    async def acquire(self, work_dir):
        if not self.prepared:
            raise RuntimeError("WorkerPool.prepare() must run before acquire()")
        while True:
            if len(self.quarantined) == len(self.configs):
                raise RuntimeError("All proposal workers are quarantined")
            try:
                worker = await asyncio.wait_for(self.slots.get(), 1)
            except asyncio.TimeoutError:
                continue
            if worker["name"] not in self.quarantined:
                break
        lease = WorkerLease(self, worker, Path(work_dir).absolute())
        token = None
        try:
            await lease.prepare()
            token = current_worker.set(lease)
            yield lease
        except WorkerConnectionError:
            self.quarantined.add(worker["name"])
            raise
        finally:
            if token is not None:
                current_worker.reset(token)
            try:
                await lease.close()
            finally:
                if not lease.uncertain and worker["name"] not in self.quarantined:
                    self.slots.put_nowait(worker)

    async def close(self):
        await asyncio.gather(*(self.disconnect(connection) for connection in list(self.connections)))


class WorkerLease:
    def __init__(self, pool, worker, work_dir):
        self.pool = pool
        self.worker = worker
        self.work_dir = work_dir
        self.connection = None
        self.attempt = uuid.uuid4().hex
        self.started_at = time.time()
        self.finished_at = None
        self.model = None
        self.effort = None
        self.active = None
        self.uncertain = False
        self.failed = False
        self.ready = False
        self.last_error = None

    def metadata(self):
        return {"worker_name": self.worker["name"], "worker_attempt_id": self.attempt,
                "worker_started_at": self.started_at, "worker_finished_at": self.finished_at,
                "worker_model": self.model, "worker_effort": self.effort,
                "worker_last_error": self.last_error}

    async def prepare(self):
        self.work_dir.mkdir(parents=True, exist_ok=True)
        command = self.pool.workspace.get("prepare", [])
        if command:
            local = await self.pool.connection({"name": self.worker["name"] + "-prepare"}, self.work_dir)
            try:
                result = await self.execute(command, 300, {"SHINKA_PROPOSAL_PREPARE": "coordinator"}, local)
                if result.returncode:
                    raise RuntimeError(f"Coordinator preparation failed: {result.stderr}")
            finally:
                await self.pool.disconnect(local)
        self.connection = await self.pool.connection(self.worker, self.work_dir)
        async with self.pool.locks[self.worker["name"]]:
            await self.pool.mirrors(self.connection)
            if self.worker.get("launch_command"):
                entries = await asyncio.to_thread(self.pool.entries, [self.work_dir])
                await self.pool.sync(self.connection, entries)
        if command:
            result = await self.execute(command, 300, {"SHINKA_PROPOSAL_PREPARE": "worker"})
            if result.returncode:
                raise RuntimeError(f"Worker preparation failed: {result.stderr}")
        self.ready = True

    async def execute(self, command, timeout, environment=None, connection=None):
        if self.uncertain or self.failed:
            raise WorkerConnectionError("Worker command state is uncertain; this lease cannot start another command")
        connection = connection or self.connection
        attempt = uuid.uuid4().hex
        self.active = attempt
        try:
            state = await connection.rpc("run", attempt=attempt, command=command, timeout=timeout,
                                         environment=environment or {}, generation_attempt=self.attempt)
            while state["status"] == "running":
                await asyncio.sleep(0.2)
                state = await connection.rpc("status", attempt=attempt)
            result = await connection.rpc("result", attempt=attempt)
        except (WorkerConnectionError, asyncio.CancelledError) as error:
            self.failed = True
            cancelled = isinstance(error, asyncio.CancelledError)
            # Never issue a second command after a lost acknowledgement. Reconnect
            # to inspect/cancel the existing UUID, then quarantine if uncertain.
            # Once the old command is confirmed stopped, the fresh connection
            # replaces the lost one, so the caller's retry can run on this lease.
            try:
                if not cancelled:
                    # A restarting worker host (e.g. a WSL instance) needs a moment.
                    await asyncio.sleep(RECONNECT_DELAY_SECONDS)
                recovery = await asyncio.shield(self.pool.connection(connection.worker, self.work_dir))
                adopted = False
                try:
                    state = await recovery.rpc("cancel", attempt=attempt)
                    for _ in range(50):
                        if state["status"] != "running":
                            break
                        await asyncio.sleep(0.1)
                        state = await recovery.rpc("status", attempt=attempt)
                    if state["status"] not in {"complete", "cancelled", "stopped"}:
                        raise WorkerConnectionError("Worker command could not be confirmed stopped")
                    if not cancelled and connection is self.connection:
                        try:
                            await self.pool.disconnect(connection)
                        except Exception:
                            pass
                        self.connection = recovery
                        self.failed = False
                        adopted = True
                        logger.warning("Worker %s reconnected after a lost command; the lease stays usable",
                                       self.worker["name"])
                finally:
                    if not adopted:
                        await self.pool.disconnect(recovery)
            except BaseException:
                self.uncertain = True
                self.pool.quarantined.add(self.worker["name"])
            raise
        finally:
            self.active = None
        if result["status"] == "cancelled":
            if "timed out" in (result.get("error") or ""):
                raise asyncio.TimeoutError(result["error"])
            raise RuntimeError(result.get("error") or "Worker command was cancelled")
        return subprocess.CompletedProcess(command, result["returncode"], result["stdout"], result["stderr"])

    async def run_headless(self, model, command, timeout):
        self.model = model.agent_model
        self.effort = model.effort
        if self.worker.get("launch_command"):
            # Providers create each prompt after acquiring the generation lease.
            for index, argument in enumerate(command[:-1]):
                if argument == "--prompt-file":
                    path = Path(command[index + 1]).absolute()
                    if self.work_dir not in path.parents:
                        raise ValueError("Headless prompt must be inside the leased generation")
                    await self.pool.sync(self.connection, await asyncio.to_thread(self.pool.entries, [path]))
        if model.agent == "claude":
            command = ["env", "-u", "ANTHROPIC_API_KEY", "-u", "CLAUDE_CODE_OAUTH_TOKEN",
                       "/bin/sh", "-c", shlex.join(command)]
        return await self.execute(command, timeout)

    async def artifacts(self):
        patterns = self.pool.workspace.get("artifacts", [])
        if not patterns or not self.worker.get("launch_command"):
            return
        reply = await self.connection.rpc("artifacts", patterns=patterns)
        staging = self.work_dir / ".worker-transfers" / self.attempt
        staged = []
        try:
            for entry in reply["entries"]:
                relative = entry["path"]
                if not safe_artifact(relative) or not any(fnmatch.fnmatchcase(relative, pattern)
                        or relative.startswith(pattern.rstrip("/") + "/") for pattern in patterns):
                    raise ValueError(f"Worker returned an unrequested artifact: {relative}")
                target = self.work_dir / relative
                if any(parent.is_symlink() for parent in target.parents if parent != self.work_dir):
                    raise ValueError("Artifact target traverses a symlink")
                path = staging / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                checksum = hashlib.sha256()
                size = 0
                with path.open("wb") as stream:
                    while size < entry["size"]:
                        block = await self.connection.rpc("read", path=relative, offset=size)
                        data = base64.b64decode(block["data"], validate=True)
                        if not data or len(data) > CHUNK_SIZE or size + len(data) > entry["size"]:
                            raise ValueError("Invalid worker artifact size")
                        stream.write(data)
                        checksum.update(data)
                        size += len(data)
                if checksum.hexdigest() != entry["sha256"]:
                    raise ValueError("Worker artifact checksum differs")
                staged.append((path, target))
            for path, target in staged:
                target.parent.mkdir(parents=True, exist_ok=True)
                path.replace(target)
        finally:
            import shutil
            shutil.rmtree(staging, ignore_errors=True)

    async def close(self):
        try:
            if self.connection and self.ready and not self.uncertain and not self.failed:
                await self.artifacts()
        finally:
            if self.connection:
                await self.pool.disconnect(self.connection)
            self.finished_at = time.time()
