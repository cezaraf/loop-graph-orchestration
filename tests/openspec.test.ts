import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenSpecAdapter,
  validateContract,
  buildPlan,
  readJson,
} from "../dist/index.js";
import type { ExecutionGraph } from "../dist/types.js";
import { temp } from "./helpers.ts";
const binary = fileURLToPath(
  new URL("../node_modules/.bin/openspec", import.meta.url),
);
function project() {
  const root = temp(),
    base = path.join(root, "openspec/changes/add-demo");
  fs.mkdirSync(path.join(base, "specs/demo"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "openspec/config.yaml"),
    "schema: spec-driven\n",
  );
  fs.writeFileSync(
    path.join(base, ".openspec.yaml"),
    "schema: spec-driven\ncreated: 2026-11-06\n",
  );
  fs.writeFileSync(
    path.join(base, "proposal.md"),
    "## Why\n\nAgent orchestration needs independently verifiable execution.\n\n## What Changes\n\n- Add deterministic demonstration.\n\n## Capabilities\n\n### New Capabilities\n\n- `demo`: Demonstration behavior.\n\n### Modified Capabilities\n\nNone.\n\n## Impact\n\nTests and demonstration.\n",
  );
  fs.writeFileSync(
    path.join(base, "design.md"),
    "## Context\n\nNative demo.\n\n## Decisions\n\nDeterministic output.\n",
  );
  fs.writeFileSync(
    path.join(base, "specs/demo/spec.md"),
    "## ADDED Requirements\n\n### Requirement: Deterministic response\nThe system SHALL return the expected response.\n\n#### Scenario: Request succeeds\n- **WHEN** the request is valid\n- **THEN** return a valid response\n",
  );
  fs.writeFileSync(
    path.join(base, "tasks.md"),
    "## 1. Implement\n\n- [ ] 1.1 Implement response and verify unit test\n- [ ] 1.2 Document response and verify documentation\n",
  );
  return { root, base, a: new OpenSpecAdapter(root, binary) };
}

test("official CLI reads artifacts, scenarios, task source locations and planning status", () => {
  const { a } = project();
  assert.ok(a.validate("add-demo").valid);
  const m = a.load("add-demo");
  validateContract("parsed_specification", m);
  assert.equal(m.openspec_version, "1.16.1");
  assert.deepEqual(
    m.tasks.map((t) => t.id),
    ["1.1", "1.2"],
  );
  assert.ok(m.tasks.every((t) => t.sourcePath && t.line! > 0));
  assert.equal(m.requirements[0].id, "demo::Deterministic response");
  assert.equal(m.requirements[0].scenarios[0].name, "Request succeeds");
  assert.ok(JSON.stringify(a.discover()).includes("add-demo"));
});
test("invalid native specification blocks loading", () => {
  const { a, base } = project();
  fs.writeFileSync(
    path.join(base, "specs/demo/spec.md"),
    "## ADDED Requirements\n\n### Requirement: Invalid\nNo normative statement.\n",
  );
  assert.ok(!a.validate("add-demo").valid);
  assert.throws(() => a.load("add-demo"), /Invalid OpenSpec/);
});
test("task synchronization preserves native proposal/spec and stable plan fingerprint", () => {
  const { a, base } = project(),
    before = a.load("add-demo"),
    proposal = fs.readFileSync(path.join(base, "proposal.md")),
    spec = fs.readFileSync(path.join(base, "specs/demo/spec.md"));
  a.syncTasks("add-demo", ["1.1"], before.spec_hash);
  const after = a.load("add-demo");
  assert.equal(after.tasks[0].checked, true);
  assert.equal(after.tasks[1].checked, false);
  assert.deepEqual(after.artifacts, before.artifacts);
  assert.equal(after.spec_hash, before.spec_hash);
  assert.ok(fs.readFileSync(path.join(base, "proposal.md")).equals(proposal));
  assert.ok(
    fs.readFileSync(path.join(base, "specs/demo/spec.md")).equals(spec),
  );
  assert.throws(() => a.syncTasks("add-demo", ["9.9"]), /Unknown source/);
  assert.throws(() => a.syncTasks("add-demo", [], "f".repeat(64)), /changed/);
});
test("checked tasks cannot bypass additional archive gates", () => {
  const { a, base } = project();
  a.syncTasks("add-demo", ["1.1", "1.2"]);
  const blocked = a.prepareArchive("add-demo");
  assert.ok(!blocked.ready);
  assert.ok(blocked.blockers.includes("UNACCEPTED_UNITS"));
  const ready = a.prepareArchive("add-demo", {
    allAccepted: true,
    integrationPassed: true,
    gatePassed: true,
  });
  assert.ok(ready.ready);
  assert.equal(ready.executed, false);
  assert.ok(fs.existsSync(base));
});
test("OpenSpec symlinks and path traversal are rejected", () => {
  const { a, base } = project();
  assert.throws(() => a.load("../outside"));
  fs.symlinkSync("/etc/passwd", path.join(base, "leak.md"));
  assert.throws(() => a.load("add-demo"), /symlink/);
});
test("unsupported OpenSpec CLI version is rejected on every call", () => {
  class Fake extends OpenSpecAdapter {
    override call() {
      return { stdout: "99.0.0\n", stderr: "", status: 0 };
    }
  }
  const a = new Fake(temp(), "fake");
  assert.throws(() => a.version, /incompatible/);
  assert.throws(() => a.version, /incompatible/);
});
test("official MODIFIED, REMOVED and RENAMED operations remain interoperable", () => {
  const { a, base } = project();
  fs.writeFileSync(
    path.join(base, "specs/demo/spec.md"),
    "## MODIFIED Requirements\n\n### Requirement: Updated behavior\nThe system SHALL use updated deterministic behavior.\n\n#### Scenario: Updated request\n- **WHEN** a request arrives\n- **THEN** return the updated value\n\n## REMOVED Requirements\n\n### Requirement: Old behavior\n**Reason**: Replaced.\n**Migration**: Use updated behavior.\n\n## RENAMED Requirements\n\n- FROM: `### Requirement: Original name`\n- TO: `### Requirement: Current name`\n",
  );
  const m = a.load("add-demo");
  assert.deepEqual(
    new Set(m.requirements.map((r) => r.operation)),
    new Set(["MODIFIED", "REMOVED", "RENAMED"]),
  );
  assert.deepEqual(
    m.requirements.find((r) => r.operation === "RENAMED")!.rename,
    { from: "Original name", to: "Current name" },
  );
});
test("TipoExame source model and produced plan satisfy original wire contracts", () => {
  const root = fileURLToPath(
      new URL("../examples/tipo-exame", import.meta.url),
    ),
    a = new OpenSpecAdapter(root, binary),
    m = a.load("add-tipo-exame");
  assert.equal(m.requirements.length, 5);
  assert.equal(m.tasks.length, 5);
  const g = buildPlan(
    m,
    readJson<ExecutionGraph>(
      path.join(root, ".lgo/bindings/add-tipo-exame.json"),
    ),
  );
  validateContract("execution_graph", g);
  assert.equal(g.units.length, 5);
});
