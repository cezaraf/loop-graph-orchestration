import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  Engine,
  OpenSpecAdapter,
  readJson,
  validateGraph,
} from "../dist/index.js";
import type { ExecutionGraph } from "../dist/types.js";
import { temp } from "./helpers.ts";
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
  EXAMPLE = fileURLToPath(new URL("../examples/tipo-exame", import.meta.url)),
  BIN = fileURLToPath(
    new URL("../node_modules/.bin/openspec", import.meta.url),
  );
function call(root: string, ...args: string[]) {
  const r = spawnSync(
    process.execPath,
    [CLI, "--root", root, "--json", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, LGO_OPENSPEC: BIN },
      timeout: 30000,
    },
  );
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, data: JSON.parse(r.stdout) };
}

test("CLI help/version and bootstrap need only Node, preserve existing config", () => {
  const root = temp();
  const help = spawnSync(process.execPath, [CLI, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /migrate-state/);
  assert.equal(call(root, "--dry-run", "init").code, 0);
  assert.ok(!fs.existsSync(path.join(root, ".lgo")));
  assert.equal(call(root, "init").code, 0);
  const file = path.join(root, ".lgo/config.yaml"),
    before = fs.readFileSync(file);
  assert.equal(call(root, "init").code, 0);
  assert.ok(fs.readFileSync(file).equals(before));
  assert.equal(call(root, "update").code, 0);
  assert.equal(call(root, "uninstall").code, 0);
  assert.ok(fs.readFileSync(file).equals(before));
  assert.ok(!fs.existsSync(path.join(root, "openspec")));
});
test("CLI errors return structured JSON and nonzero exit status", () => {
  const r = call(temp(), "validate-plan", "missing");
  assert.equal(r.code, 2);
  assert.ok(r.data.error && r.data.reason);
});
test("CLI native plan/dryrun/sync/archive cannot bypass delivery evidence", () => {
  const root = temp();
  fs.cpSync(path.join(EXAMPLE, "openspec"), path.join(root, "openspec"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, ".lgo/bindings"), { recursive: true });
  fs.copyFileSync(
    path.join(EXAMPLE, ".lgo/bindings/add-tipo-exame.json"),
    path.join(root, ".lgo/bindings/add-tipo-exame.json"),
  );
  assert.equal(call(root, "--dry-run", "plan", "add-tipo-exame").code, 0);
  assert.ok(!fs.existsSync(path.join(root, ".lgo/plans/add-tipo-exame.json")));
  assert.equal(call(root, "plan", "add-tipo-exame").code, 0);
  assert.equal(call(root, "validate-plan", "add-tipo-exame").code, 0);
  assert.equal(call(root, "--dry-run", "run", "add-tipo-exame").code, 0);
  assert.ok(!fs.existsSync(path.join(root, ".lgo/state.sqlite")));
  const g = readJson<ExecutionGraph>(
      path.join(root, ".lgo/plans/add-tipo-exame.json"),
    ),
    e = new Engine(root);
  e.start(g);
  e.close();
  const blocked = call(root, "prepare-archive", "add-tipo-exame");
  assert.equal(blocked.code, 3);
  assert.ok(blocked.data.blockers.includes("UNACCEPTED_UNITS"));
  assert.ok(blocked.data.blockers.includes("AUTHORITY_GATE_NOT_PASSED"));
  assert.equal(call(root, "sync-progress", "add-tipo-exame").code, 0);
  assert.ok(
    new OpenSpecAdapter(root, BIN)
      .load("add-tipo-exame")
      .tasks.every((t) => !t.checked),
  );
});
test("runtime npm dependencies contain no proprietary SDK or native addon build", () => {
  const p = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(p.dependencies).sort(), ["ajv", "yaml"]);
  assert.ok(p.bin.lgo.endsWith(".js"));
});
