"""Foreground, standard-library-only worker endpoint. Run this file over SSH."""

import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import threading
import time
import uuid
import zlib


CHUNK_SIZE = 768 * 1024
# Long enough to ride out a coordinator pause (swap, a big evaluation) without
# killing agents that are still working.
HEARTBEAT_GRACE = 120


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    temporary.replace(path)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK_SIZE), b""):
            result.update(block)
    return result.hexdigest()


def process_identity(pid):
    """Linux start ticks distinguish a saved process from a reused PID."""
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def stop_process(state):
    pid = state.get("pid")
    owner = state.get("owner_pid")
    root = owner if owner and process_identity(owner) == state.get("owner_identity") else pid
    if not root or process_identity(root) is None:
        return
    if root == pid and process_identity(pid) != state.get("process_identity"):
        return
    descendants = process_children(root)
    for child, identity in reversed(descendants):
        if process_identity(child) == identity:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
    if pid and process_identity(pid) == state.get("process_identity"):
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def process_children(root):
    parents = {}
    for path in Path("/proc").glob("[0-9]*/stat"):
        try:
            fields = path.read_text().rsplit(")", 1)[1].split()
            parents.setdefault(int(fields[1]), []).append((int(path.parent.name), fields[19]))
        except (OSError, IndexError, ValueError):
            continue
    children = list(parents.get(root, []))
    for pid, _ in children:
        children.extend(parents.get(pid, []))
    return children


def safe_artifact(relative):
    path = Path(relative)
    return (
        not path.is_absolute() and ".." not in path.parts and bool(path.parts)
        and path.parts[0] not in {"results", ".workers", ".worker-transfers", ".git", "attempts"}
        and not path.parts[0].startswith(("main.", ".generation_lock"))
        and path.name not in {"programs.sqlite", "prompts.sqlite", "task.json",
                              "launch.json", "resume.json", "evolution_run.log"}
        and not path.name.endswith((".sqlite-wal", ".sqlite-shm"))
    )


class Endpoint:
    def __init__(self):
        # Adopt detached grandchildren so they cannot escape session cleanup.
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0):
            raise OSError(ctypes.get_errno(), "Cannot supervise worker descendants")
        self.last_heartbeat = time.monotonic()
        self.active = None
        self.cancel_reason = None
        self.upload = None
        self.cache = {}
        self.cache_changes = {}
        self.cache_saved_at = time.monotonic()
        self.closed = False
        self.lock = threading.Lock()
        self.finish_thread = None
        self.states = {}
        threading.Thread(target=self.watchdog, daemon=True).start()

    def watchdog(self):
        while not self.closed:
            if self.active and time.monotonic() - self.last_heartbeat > HEARTBEAT_GRACE:
                self.cancel("Coordinator heartbeat expired")
            time.sleep(0.25)

    def cancel(self, reason):
        with self.lock:
            if self.active:
                self.cancel_reason = reason
                stop_process(self.active)

    def hello(self, request):
        self.results = Path(request["results_dir"])
        self.roots = [Path(path) for path in request["mirrors"]]
        self.work = Path(request["work_dir"]) if request.get("work_dir") else None
        self.state_dir = self.results / ".workers" / request["worker"]
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.cache_path = self.state_dir / "mirror-cache.json"
        try:
            self.cache = json.loads(self.cache_path.read_text())
        except (OSError, ValueError):
            self.cache = {}
        return {"platform": sys.platform, "python": sys.executable}

    def allowed(self, path):
        path = Path(path)
        if not path.is_absolute() or ".." in path.parts:
            raise ValueError("Worker transfer requires an absolute path")
        roots = [*self.roots, *([self.work] if self.work else [])]
        if not any(path == root or root in path.parents for root in roots):
            raise ValueError(f"Transfer path is outside configured roots: {path}")
        return path

    def missing(self, entries):
        missing = []
        for entry in entries:
            path = self.allowed(entry["path"])
            kind = entry["kind"]
            matches = False
            try:
                info = path.lstat()
            except FileNotFoundError:
                info = None
            if kind == "directory":
                matches = info is not None and stat.S_ISDIR(info.st_mode)
            elif kind == "symlink":
                matches = info is not None and stat.S_ISLNK(info.st_mode) and os.readlink(path) == entry["target"]
            elif info is not None and stat.S_ISREG(info.st_mode):
                signature = [info.st_size, info.st_mtime_ns, stat.S_IMODE(info.st_mode)]
                cached = self.cache.get(str(path))
                checksum = cached[1] if cached and cached[0] == signature else digest(path)
                if not cached or cached[0] != signature:
                    self.cache[str(path)] = [signature, checksum]
                    self.cache_changes[str(path)] = [signature, checksum]
                matches = checksum == entry["sha256"] and signature[2] == entry["mode"]
            if not matches:
                missing.append(entry)
        if time.monotonic() - self.cache_saved_at >= 30:
            self.save_cache()
        return {"entries": missing}

    def save_cache(self):
        import fcntl

        if not self.cache_changes:
            return
        # Concurrent leases validate different files; merge only this session's
        # changes so an older connection cannot discard another one's progress.
        with self.cache_path.with_suffix(".lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                cache = json.loads(self.cache_path.read_text())
            except (OSError, ValueError):
                cache = {}
            cache.update(self.cache_changes)
            save_json(self.cache_path, cache)
            self.cache = cache
            self.cache_changes.clear()
            self.cache_saved_at = time.monotonic()

    def begin(self, entry):
        if self.upload is not None:
            raise ValueError("An upload is already active")
        path = self.allowed(entry["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        if entry["kind"] == "directory":
            if path.is_symlink():
                raise ValueError(f"Mirror directory is an existing symlink: {path}")
            path.mkdir(exist_ok=True)
            return {}
        temporary = path.with_name("." + path.name + ".transfer-" + uuid.uuid4().hex)
        if entry["kind"] == "symlink":
            try:
                temporary.symlink_to(entry["target"])
                temporary.replace(path)
            finally:
                temporary.unlink(missing_ok=True)
            return {}
        self.upload = (entry, path, temporary, temporary.open("wb"), hashlib.sha256())
        return {}

    def chunk(self, data, compressed=False):
        if self.upload is None:
            raise ValueError("No active upload")
        block = base64.b64decode(data, validate=True)
        if compressed:
            block = zlib.decompress(block)
        if len(block) > CHUNK_SIZE:
            raise ValueError("Transfer chunk is too large")
        self.upload[3].write(block)
        self.upload[4].update(block)

    def end(self):
        entry, path, temporary, stream, checksum = self.upload
        self.upload = None
        stream.close()
        try:
            if checksum.hexdigest() != entry["sha256"]:
                raise ValueError("Transferred file checksum differs")
            temporary.chmod(entry["mode"])
            temporary.replace(path)
            info = path.stat()
            self.cache[str(path)] = [[info.st_size, info.st_mtime_ns, entry["mode"]], entry["sha256"]]
            self.cache_changes[str(path)] = self.cache[str(path)]
        finally:
            temporary.unlink(missing_ok=True)
        return {}

    def state_path(self, attempt):
        if not isinstance(attempt, str) or len(attempt) != 32 or any(c not in "0123456789abcdef" for c in attempt):
            raise ValueError("Invalid worker attempt ID")
        return self.state_dir / attempt / "state.json"

    def run(self, request):
        state_path = self.state_path(request["attempt"])
        if state_path.exists():
            return self.status(request["attempt"])
        with self.lock:
            if self.active:
                raise ValueError("This worker session already has a running command")
            directory = state_path.parent
            directory.mkdir(parents=True)
            cwd = self.work or self.results
            cwd.mkdir(parents=True, exist_ok=True)
            environment = dict(os.environ, **request.get("environment", {}))
            environment["SHINKA_WORKER_SUPERVISED"] = "1"
            stdout = (directory / "stdout").open("wb")
            stderr = (directory / "stderr").open("wb")
            try:
                process = subprocess.Popen(request["command"], cwd=cwd, env=environment,
                                           stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                           start_new_session=True)
            finally:
                stdout.close()
                stderr.close()
            state = {"attempt": request["attempt"], "status": "running", "pid": process.pid,
                     "process_identity": process_identity(process.pid), "started_at": time.time(),
                     "owner_pid": os.getpid(), "owner_identity": process_identity(os.getpid()),
                     "generation_attempt": request.get("generation_attempt"), "work_dir": str(cwd)}
            self.active = state
            self.states[request["attempt"]] = state
            self.cancel_reason = None
            try:
                save_json(state_path, state)
            except BaseException:
                stop_process(state)
                process.wait()
                self.active = None
                self.states.pop(request["attempt"], None)
                raise
        self.finish_thread = threading.Thread(target=self.finish,
            args=(process, state, state_path, request.get("timeout")), daemon=True)
        self.finish_thread.start()
        return state

    def finish(self, process, state, state_path, timeout):
        try:
            returncode = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self.cancel("Worker command timed out")
            returncode = process.wait()
        stop_process(state)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        with self.lock:
            state.update(status="cancelled" if self.cancel_reason else "complete",
                         returncode=returncode, finished_at=time.time(), error=self.cancel_reason)
            try:
                save_json(state_path, state)
            except OSError as error:
                state.update(status="cancelled", error=f"Could not save worker result: {error}")
            finally:
                self.active = None

    def status(self, attempt):
        if attempt in self.states and self.states[attempt]["status"] != "running":
            return self.states[attempt]
        path = self.state_path(attempt)
        if not path.exists():
            return {"attempt": attempt, "status": "missing"}
        state = json.loads(path.read_text())
        owner_alive = process_identity(state.get("owner_pid")) == state.get("owner_identity")
        if (state["status"] == "running" and not owner_alive
                and process_identity(state["pid"]) != state["process_identity"]):
            state.update(status="stopped", error="Worker exited without a completed result")
        return state

    def result(self, attempt):
        state = self.status(attempt)
        if state["status"] not in {"complete", "cancelled"}:
            raise ValueError("Worker result is not complete")
        directory = self.state_path(attempt).parent
        return {**state, "stdout": (directory / "stdout").read_text(encoding="utf-8", errors="replace"),
                "stderr": (directory / "stderr").read_text(encoding="utf-8", errors="replace")}

    def artifacts(self, patterns):
        entries = {}
        for pattern in patterns:
            for match in self.work.glob(pattern):
                paths = match.rglob("*") if match.is_dir() and not match.is_symlink() else [match]
                for path in paths:
                    relative = str(path.relative_to(self.work))
                    if (safe_artifact(relative) and path.is_file() and not path.is_symlink()
                            and not any(parent.is_symlink() for parent in path.parents if parent != self.work)):
                        entries[relative] = {"path": relative, "size": path.stat().st_size,
                                             "sha256": digest(path)}
        return {"entries": list(entries.values())}

    def handle(self, request):
        op = request["op"]
        if op == "hello":
            return self.hello(request)
        if op == "heartbeat":
            self.last_heartbeat = time.monotonic()
            return {}
        if op == "missing":
            return self.missing(request["entries"])
        if op == "begin":
            return self.begin(request["entry"])
        if op == "chunk":
            self.chunk(request["data"], request.get("compressed", False))
            return {}
        if op == "end":
            return self.end()
        if op == "sync_done":
            self.save_cache()
            return {}
        if op == "run":
            return self.run(request)
        if op == "status":
            return self.status(request["attempt"])
        if op == "pending":
            return {"attempts": [path.parent.name for path in self.state_dir.glob("*/state.json")
                                  if self.status(path.parent.name)["status"] == "running"]}
        if op == "cancel":
            state = self.status(request["attempt"])
            if self.active and self.active["attempt"] == request["attempt"]:
                self.cancel("Coordinator cancelled the command")
            elif state["status"] == "running":
                stop_process(state)
            return self.status(request["attempt"])
        if op == "result":
            return self.result(request["attempt"])
        if op == "artifacts":
            return self.artifacts(request["patterns"])
        if op == "read":
            relative = request["path"]
            if not safe_artifact(relative):
                raise ValueError("Invalid artifact path")
            path = self.work / relative
            if path.is_symlink() or self.work not in path.resolve().parents:
                raise ValueError("Artifact path escapes the generation directory")
            with path.open("rb") as stream:
                stream.seek(request["offset"])
                return {"data": base64.b64encode(stream.read(CHUNK_SIZE)).decode()}
        raise ValueError(f"Unknown worker operation: {op}")

    def close(self):
        self.cancel("Coordinator disconnected")
        if self.finish_thread:
            self.finish_thread.join(timeout=5)
        self.closed = True
        if self.upload:
            self.upload[3].close()
            self.upload[2].unlink(missing_ok=True)
        self.save_cache()


def main():
    if sys.platform != "linux":
        raise SystemExit("Proposal workers require Linux, including Ubuntu in WSL")
    endpoint = Endpoint()
    try:
        for line in sys.stdin:
            request = json.loads(line)
            try:
                reply = {"ok": True, **endpoint.handle(request)}
            except Exception as error:
                reply = {"ok": False, "error": str(error)}
            if "id" in request:
                print(json.dumps({"id": request["id"], **reply}), flush=True)
            elif not reply["ok"]:
                raise RuntimeError(reply["error"])
    finally:
        endpoint.close()


if __name__ == "__main__":
    main()
