import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Engine,
  StateStore,
  MigrationRequired,
  migrateState,
  atomicJson,
} from "../dist/index.js";
import type { ExecutionManifest } from "../dist/types.js";
import { temp, config } from "./helpers.ts";
interface LegacyFixture {
  producer: string;
  run: ExecutionManifest;
  events: {
    seq: number;
    run: string;
    data: string;
    prev: string;
    hash: string;
  }[];
  workspace_files: Record<string, string>;
}
const fixture = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/python-0.1-state.json", import.meta.url),
    "utf8",
  ),
) as LegacyFixture;
function legacy() {
  const root = temp(),
    dir = path.join(root, ".lgo");
  fs.mkdirSync(dir);
  const file = path.join(dir, "state.sqlite"),
    db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE events(seq INTEGER PRIMARY KEY,run TEXT,data TEXT,prev TEXT,hash TEXT);CREATE TABLE rules(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE rule_versions(id TEXT,version INTEGER,data TEXT NOT NULL,PRIMARY KEY(id,version));",
  );
  const run = structuredClone(fixture.run);
  run.workspace = path.join(dir, "runs", run.id, "workspace");
  for (const [p, content] of Object.entries(fixture.workspace_files)) {
    const dest = path.join(run.workspace, p);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  db.prepare("INSERT INTO runs VALUES(?,?)").run(run.id, JSON.stringify(run));
  for (const e of fixture.events)
    db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(
      e.seq,
      e.run,
      e.data,
      e.prev,
      e.hash,
    );
  db.close();
  return { root, file, run };
}

test("Python state cannot be resumed without explicit migration", () => {
  const { root } = legacy();
  assert.throws(() => new Engine(root), MigrationRequired);
});
test("legacy dry-run validates source/evidence without changing the store", async () => {
  const { root, file } = legacy();
  const r = await migrateState(root, { fromPython: true, dryRun: true });
  assert.equal(r.from, 0);
  assert.equal(r.to, 2);
  assert.equal(r.preserved_passed_units, 1);
  assert.equal(r.changed, false);
  assert.ok(!fs.existsSync(path.join(root, ".lgo/backups")));
  const db = new DatabaseSync(file);
  assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 0);
  assert.ok(
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='controller_lease'")
      .get(),
  );
  db.close();
});
test("real Python checkpoint migrates with backup and resumes without replaying PASSED", async () => {
  const { root, run } = legacy();
  const r = await migrateState(root, { fromPython: true });
  assert.ok(r.backup && fs.existsSync(r.backup));
  const old = new DatabaseSync(r.backup!, { readOnly: true });
  assert.equal(old.prepare("PRAGMA user_version").get()!.user_version, 0);
  old.close();
  const e = new Engine(root, { config: config() });
  try {
    assert.ok(e.store.verifyHistory());
    const migrated = e.store.get(run.id);
    assert.equal(migrated.nodes.fast.state, "PASSED");
    assert.equal(migrated.nodes.fast.attempts, 1);
    assert.equal(migrated.integration.passed, false);
    assert.deepEqual(migrated.gates, []);
    const complete = await e.execute(run.id);
    assert.equal(complete.state, "ACCEPTED");
    assert.equal(complete.nodes.fast.attempts, 1);
    assert.equal(complete.nodes.slow.attempts, 1);
    const again = await migrateState(root, { fromPython: true });
    assert.equal(again.changed, false);
  } finally {
    e.close();
  }
});
for (const attack of ["history", "output", "policy"])
  test(`migration blocks tampered legacy ${attack} before backup/write`, async () => {
    const { root, file, run } = legacy();
    if (attack === "history") {
      const db = new DatabaseSync(file);
      db.exec("UPDATE events SET data='{}' WHERE seq=1");
      db.close();
    }
    if (attack === "output")
      fs.writeFileSync(path.join(run.workspace, "src/fast.txt"), "forged");
    if (attack === "policy")
      fs.writeFileSync(
        path.join(root, ".lgo/policies.yaml"),
        "schema_version: '1.0'\nmedium_requires_approval: true\n",
      );
    await assert.rejects(() => migrateState(root, { fromPython: true }));
    assert.ok(!fs.existsSync(path.join(root, ".lgo/backups")));
    const db = new DatabaseSync(file);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 0);
    db.close();
  });
test("unknown store version cannot be silently downgraded", () => {
  const root = temp(),
    store = new StateStore(path.join(root, ".lgo"));
  store.db.exec("PRAGMA user_version=99");
  store.close();
  assert.throws(() => new Engine(root), MigrationRequired);
});

test("migration interoperates with a stopped Python fcntl lock file", async () => {
  const { root } = legacy();
  fs.writeFileSync(path.join(root, ".lgo/scheduler.lock"), "");
  const result = await migrateState(root, { fromPython: true });
  assert.equal(result.changed, true);
});
