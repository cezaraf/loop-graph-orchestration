from __future__ import annotations
import contextlib
import hashlib
import json
import sqlite3
import time
from pathlib import Path
from .util import canonical, PolicyError

STATES = {
    "PENDING",
    "READY",
    "RUNNING",
    "VERIFYING",
    "PASSED",
    "FAILED",
    "RETRYING",
    "BLOCKED",
    "INVALIDATED",
    "CANCELLED",
    "WAITING_APPROVAL",
}
TRANSITIONS = {
    "PENDING": {"READY", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"},
    "READY": {"RUNNING", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"},
    "RUNNING": {"VERIFYING", "RETRYING", "FAILED", "BLOCKED", "CANCELLED"},
    "VERIFYING": {"PASSED", "RETRYING", "FAILED", "BLOCKED", "CANCELLED"},
    "RETRYING": {"RUNNING", "FAILED", "BLOCKED", "CANCELLED"},
    "PASSED": {"INVALIDATED", "BLOCKED"},
    "FAILED": {"INVALIDATED"},
    "BLOCKED": {"INVALIDATED", "CANCELLED"},
    "INVALIDATED": {"READY", "BLOCKED", "CANCELLED"},
    "WAITING_APPROVAL": {"READY", "CANCELLED", "INVALIDATED"},
    "CANCELLED": {"INVALIDATED"},
}


class StateStore:
    def __init__(self, root):
        self.root = Path(root)
        if self.root.is_symlink() or (self.root / "state.sqlite").is_symlink():
            raise PolicyError("Symlink state store rejected")
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / "state.sqlite", isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY, run TEXT, data TEXT, prev TEXT, hash TEXT);
        CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS rule_versions(id TEXT,version INTEGER,data TEXT NOT NULL,PRIMARY KEY(id,version));
        """)

    @contextlib.contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def save(self, run):
        from .contracts import validate_contract

        validate_contract("execution_manifest", run)
        self.db.execute(
            "INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            (run["id"], canonical(run)),
        )

    def get(self, run_id):
        row = self.db.execute("SELECT data FROM runs WHERE id=?", (run_id,)).fetchone()
        if not row:
            raise ValueError(f"Unknown run {run_id}")
        from .contracts import validate_contract

        return validate_contract("execution_manifest", json.loads(row[0]))

    def latest(self, change):
        rows = self.db.execute("SELECT data FROM runs ORDER BY rowid DESC").fetchall()
        return next(
            (
                json.loads(r[0])
                for r in rows
                if json.loads(r[0])["graph"]["change_id"] == change
            ),
            None,
        )

    def event(self, run_id, kind, **fields):
        data = {
            "schema_version": "1.0",
            "run_id": run_id,
            "kind": kind,
            "timestamp": time.time(),
            **fields,
        }
        from .contracts import validate_contract

        validate_contract("execution_event", data)
        prev = self.db.execute(
            "SELECT hash FROM events ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        prev = prev[0] if prev else "0" * 64
        value = hashlib.sha256((prev + canonical(data)).encode()).hexdigest()
        self.db.execute(
            "INSERT INTO events(run,data,prev,hash) VALUES(?,?,?,?)",
            (run_id, canonical(data), prev, value),
        )
        return data

    def transition(self, run, unit, target, **fields):
        node = run["nodes"][unit]
        old = node["state"]
        if target not in TRANSITIONS[old]:
            raise PolicyError(f"Illegal transition {old} -> {target}")
        with self.transaction():
            node.update(state=target, **fields)
            self.save(run)
            self.event(
                run["id"], "transition", unit=unit, old=old, state=target, **fields
            )

    def events(self, run_id):
        return [
            json.loads(r[0])
            for r in self.db.execute(
                "SELECT data FROM events WHERE run=? ORDER BY seq", (run_id,)
            )
        ]

    def verify_history(self):
        prev = "0" * 64
        for data, stored_prev, value in self.db.execute(
            "SELECT data,prev,hash FROM events ORDER BY seq"
        ):
            if (
                stored_prev != prev
                or hashlib.sha256((prev + data).encode()).hexdigest() != value
            ):
                raise PolicyError("Audit history corrupted")
            prev = value
        return True

    def rules(self):
        return [
            json.loads(x[0])
            for x in self.db.execute("SELECT data FROM rules ORDER BY id")
        ]

    def save_rule(self, rule):
        from .contracts import validate_contract

        validate_contract("learning_candidate", rule)
        encoded = canonical(rule)
        with self.transaction():
            existing = self.db.execute(
                "SELECT data FROM rule_versions WHERE id=? AND version=?",
                (rule["id"], rule["version"]),
            ).fetchone()
            if existing and existing[0] != encoded:
                raise PolicyError("Rule versions are immutable")
            self.db.execute(
                "INSERT OR IGNORE INTO rule_versions VALUES(?,?,?)",
                (rule["id"], rule["version"], encoded),
            )
            self.db.execute(
                "INSERT INTO rules VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                (rule["id"], encoded),
            )

    def rule_history(self, rule_id):
        return [
            json.loads(r[0])
            for r in self.db.execute(
                "SELECT data FROM rule_versions WHERE id=? ORDER BY version", (rule_id,)
            )
        ]

    def close(self):
        self.db.close()


@contextlib.contextmanager
def run_lock(root):
    """Single local scheduler per project. POSIX reference implementation."""
    import fcntl

    path = Path(root) / "scheduler.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise PolicyError("Symlink lock rejected")
    with path.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise PolicyError("Another scheduler owns this project")
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
