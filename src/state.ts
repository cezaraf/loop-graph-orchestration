import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  ExecutionManifest,
  ExecutionEvent,
  UnitState,
  NodeExecution,
  LearningCandidate,
} from "./types.js";
import {
  canonical,
  sha256,
  PolicyError,
  now,
  safePath,
  exists,
} from "./util.js";
import { validateContract } from "./contracts.js";
export const STORE_VERSION = 2;
export class MigrationRequired extends PolicyError {
  override name = "MigrationRequired";
}
export const TRANSITIONS: Record<UnitState, readonly UnitState[]> = {
  PENDING: ["READY", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"],
  READY: ["RUNNING", "BLOCKED", "WAITING_APPROVAL", "CANCELLED"],
  RUNNING: ["VERIFYING", "RETRYING", "FAILED", "BLOCKED", "CANCELLED"],
  VERIFYING: ["PASSED", "RETRYING", "FAILED", "BLOCKED", "CANCELLED"],
  RETRYING: ["RUNNING", "FAILED", "BLOCKED", "CANCELLED"],
  PASSED: ["INVALIDATED", "BLOCKED"],
  FAILED: ["INVALIDATED"],
  BLOCKED: ["INVALIDATED", "CANCELLED"],
  INVALIDATED: ["READY", "BLOCKED", "CANCELLED"],
  WAITING_APPROVAL: ["READY", "CANCELLED", "INVALIDATED"],
  CANCELLED: ["INVALIDATED"],
};
export class StateStore {
  readonly db: DatabaseSync;
  readonly root: string;
  constructor(root: string, options: { allowLegacy?: boolean } = {}) {
    this.root = path.resolve(root);
    safePath(path.dirname(this.root), path.basename(this.root));
    safePath(this.root, "state.sqlite");
    fs.mkdirSync(this.root, { recursive: true });
    this.db = new DatabaseSync(path.join(this.root, "state.sqlite"));
    this.db.exec(
      "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
    );
    const version = Number(
      (this.db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    );
    const hasRuns = Boolean(
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='runs'").get(),
    );
    if (
      (version !== 0 && version !== STORE_VERSION) ||
      (version === 0 && hasRuns && !options.allowLegacy)
    ) {
      this.db.close();
      throw new MigrationRequired(
        "Legacy/unknown state store. Stop the old controller and run lgo migrate-state --from-python; backup is mandatory.",
      );
    }
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,run TEXT,data TEXT,prev TEXT,hash TEXT);CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS rule_versions(id TEXT,version INTEGER,data TEXT NOT NULL,PRIMARY KEY(id,version));CREATE TABLE IF NOT EXISTS controller_lease(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,owner TEXT NOT NULL);`,
    );
    if (!hasRuns) this.db.exec(`PRAGMA user_version=${STORE_VERSION}`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  save(run: ExecutionManifest): void {
    validateContract("execution_manifest", run);
    this.db
      .prepare(
        "INSERT INTO runs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(run.id, canonical(run));
  }
  get(id: string): ExecutionManifest {
    const row = this.db.prepare("SELECT data FROM runs WHERE id=?").get(id) as
      { data: string } | undefined;
    if (!row) throw new PolicyError(`Unknown run ${id}`);
    return validateContract<ExecutionManifest>(
      "execution_manifest",
      JSON.parse(row.data),
    );
  }
  allRuns(): ExecutionManifest[] {
    return (
      this.db.prepare("SELECT data FROM runs ORDER BY rowid DESC").all() as {
        data: string;
      }[]
    ).map((r) =>
      validateContract<ExecutionManifest>(
        "execution_manifest",
        JSON.parse(r.data),
      ),
    );
  }
  latest(change: string): ExecutionManifest | undefined {
    return this.allRuns().find((r) => r.graph.change_id === change);
  }
  event(
    runId: string,
    kind: string,
    fields: Record<string, unknown> = {},
  ): ExecutionEvent {
    const data: ExecutionEvent = {
      schema_version: "1.0",
      run_id: runId,
      kind,
      timestamp: now(),
      ...fields,
    };
    validateContract("execution_event", data);
    const prev =
        (
          this.db
            .prepare("SELECT hash FROM events ORDER BY seq DESC LIMIT 1")
            .get() as { hash: string } | undefined
        )?.hash ?? "0".repeat(64),
      encoded = canonical(data);
    this.db
      .prepare("INSERT INTO events(run,data,prev,hash) VALUES(?,?,?,?)")
      .run(runId, encoded, prev, sha256(prev + encoded));
    return data;
  }
  transition(
    run: ExecutionManifest,
    id: string,
    target: UnitState,
    fields: Partial<NodeExecution> = {},
  ): void {
    const node = run.nodes[id],
      old = node.state;
    if (!TRANSITIONS[old].includes(target))
      throw new PolicyError(`Illegal transition ${old} -> ${target}`);
    this.transaction(() => {
      Object.assign(node, { state: target }, fields);
      this.save(run);
      this.event(run.id, "transition", {
        unit: id,
        old,
        state: target,
        ...fields,
      });
    });
  }
  events(runId: string): ExecutionEvent[] {
    return (
      this.db
        .prepare("SELECT data FROM events WHERE run=? ORDER BY seq")
        .all(runId) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as ExecutionEvent);
  }
  verifyHistory(): true {
    let prev = "0".repeat(64);
    for (const row of this.db
      .prepare("SELECT data,prev,hash FROM events ORDER BY seq")
      .all() as { data: string; prev: string; hash: string }[]) {
      if (row.prev !== prev || sha256(prev + row.data) !== row.hash)
        throw new PolicyError("Audit history corrupted");
      prev = row.hash;
    }
    return true;
  }
  rules(): LearningCandidate[] {
    return (
      this.db.prepare("SELECT data FROM rules ORDER BY id").all() as {
        data: string;
      }[]
    ).map((r) =>
      validateContract<LearningCandidate>(
        "learning_candidate",
        JSON.parse(r.data),
      ),
    );
  }
  saveRule(rule: LearningCandidate): void {
    validateContract("learning_candidate", rule);
    const encoded = canonical(rule);
    this.transaction(() => {
      const existing = this.db
        .prepare("SELECT data FROM rule_versions WHERE id=? AND version=?")
        .get(rule.id, rule.version) as { data: string } | undefined;
      if (existing && existing.data !== encoded)
        throw new PolicyError("Rule versions are immutable");
      this.db
        .prepare("INSERT OR IGNORE INTO rule_versions VALUES(?,?,?)")
        .run(rule.id, rule.version, encoded);
      this.db
        .prepare(
          "INSERT INTO rules VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(rule.id, encoded);
    });
  }
  ruleHistory(id: string): LearningCandidate[] {
    return (
      this.db
        .prepare("SELECT data FROM rule_versions WHERE id=? ORDER BY version")
        .all(id) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as LearningCandidate);
  }
  acquire(): () => void {
    const owner = randomUUID();
    this.transaction(() => {
      const lease = this.db
        .prepare("SELECT pid,owner FROM controller_lease WHERE id=1")
        .get() as { pid: number; owner: string } | undefined;
      if (lease) {
        try {
          process.kill(lease.pid, 0);
          throw new PolicyError("Another scheduler owns this project");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
        }
      }
      this.db
        .prepare("INSERT OR REPLACE INTO controller_lease VALUES(1,?,?)")
        .run(process.pid, owner);
    });
    return () => {
      this.db
        .prepare("DELETE FROM controller_lease WHERE id=1 AND owner=?")
        .run(owner);
    };
  }
  lockSync<T>(fn: () => T): T {
    const release = this.acquire();
    try {
      return fn();
    } finally {
      release();
    }
  }
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const release = this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
  close(): void {
    this.db.close();
  }
}
export function hasState(root: string): boolean {
  return exists(path.join(root, ".lgo/state.sqlite"));
}
