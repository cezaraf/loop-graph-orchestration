import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  Engine,
  ApprovalAuthority,
  GateEngine,
  VerificationEngine,
  loadConfig,
  digest,
  now,
  PolicyError,
  validateContract,
} from "../dist/index.js";
import type {
  AgentRequest,
  AgentResult,
  ApprovalToken,
} from "../dist/types.js";
import { temp, unit, graph, config } from "./helpers.ts";
function authority() {
  const root = temp(),
    project = path.join(root, "project");
  fs.mkdirSync(project);
  const key = path.join(root, "key");
  fs.writeFileSync(key, randomBytes(32), { mode: 0o600 });
  return { root, project, key, auth: new ApprovalAuthority(key, project) };
}

test("HIGH risk fake approval cannot dispatch the worker", async () => {
  const e = new Engine(temp(), { config: config() });
  try {
    const r = await e.execute(e.start(graph(unit("a", { risk: "HIGH" }))).id, {
      approval: { approved: true, actor: "human" },
    });
    assert.equal(r.state, "WAITING_APPROVAL");
    assert.equal(r.nodes.a.attempts, 0);
    assert.ok(!fs.existsSync(path.join(r.workspace, "src/a.txt")));
  } finally {
    e.close();
  }
});
test("signature binds actor, expiry, action and exact reviewed result", () => {
  const { auth } = authority(),
    payload = {
      binding: digest("review"),
      action: "execute",
      expires_at: now() + 60,
      actor: "test-only",
    },
    t = auth.sign(payload);
  assert.ok(auth.verify(t, payload.binding, "execute"));
  assert.ok(!auth.verify(t, digest("other"), "execute"));
  assert.ok(!auth.verify(t, payload.binding, "archive"));
  const altered = structuredClone(t);
  altered.payload.binding = digest("other");
  assert.ok(!auth.verify(altered, altered.payload.binding, "execute"));
  assert.ok(
    !auth.verify(
      auth.sign({ ...payload, expires_at: now() - 1 }),
      payload.binding,
      "execute",
    ),
  );
  assert.ok(
    !auth.verify(
      auth.sign({ ...payload, actor: "" }),
      payload.binding,
      "execute",
    ),
  );
});
test("authority keys inside project or with public permissions are rejected", () => {
  const { project, key } = authority();
  const internal = path.join(project, "key");
  fs.writeFileSync(internal, randomBytes(32), { mode: 0o600 });
  assert.throws(
    () => new ApprovalAuthority(internal, project),
    /outside project/,
  );
  fs.chmodSync(key, 0o644);
  assert.throws(() => new ApprovalAuthority(key, project), /0600/);
});
test("Python approval binding cannot authorize the TypeScript runtime", () => {
  const { auth, project } = authority(),
    gate = new GateEngine(auth),
    e = new Engine(project, { config: config(), gate });
  try {
    const u = unit("a", { risk: "HIGH" }),
      r = e.start(graph(u)),
      legacyBinding = digest({
        run_id: r.id,
        graph: r.graph,
        unit: u.id,
        evidence: null,
        policy_hash: r.policy_hash,
      }),
      t = auth.sign({
        binding: legacyBinding,
        action: "execute",
        expires_at: now() + 60,
        actor: "test-only",
      });
    assert.equal(gate.authorize(r, u, t).verdict, "HUMAN_APPROVAL_REQUIRED");
  } finally {
    e.close();
  }
});

test("interrupted non-idempotent effect is not called a second time", async () => {
  const root = temp(),
    marker = path.join(root, "external-effect");
  const a = unit("a");
  a.agent = { adapter: "process", profile: "effect" };
  const e = new Engine(root, {
    config: config({
      allow_process_agents: true,
      agent_commands: {
        effect: [
          process.execPath,
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(marker)},'effect')`,
        ],
      },
    }),
  });
  try {
    const r = e.start(graph(a));
    r.nodes.a.state = "RUNNING";
    r.nodes.a.attempts = 1;
    e.store.save(r);
    const result = await e.execute(r.id);
    assert.equal(result.nodes.a.state, "BLOCKED");
    assert.match(result.nodes.a.reason!, /Ambiguous external effect/);
    assert.ok(!fs.existsSync(marker));
  } finally {
    e.close();
  }
});
for (const target of ["output", "history", "oracle"])
  test(`tampered ${target} blocks recovery`, async () => {
    const root = temp();
    if (target === "oracle") {
      fs.mkdirSync(path.join(root, "verification"));
      fs.writeFileSync(
        path.join(root, "verification/check.mjs"),
        'console.log("original")',
      );
    }
    const e = new Engine(root, { config: config() });
    try {
      const r =
        target === "output"
          ? await e.execute(e.start(graph(unit("a"))).id)
          : e.start(graph(unit("a")));
      if (target === "output")
        fs.writeFileSync(path.join(r.workspace, "src/a.txt"), "tampered");
      if (target === "history")
        e.store.db
          .prepare("UPDATE events SET data=? WHERE seq=1")
          .run('{"forged":true}');
      if (target === "oracle")
        fs.writeFileSync(
          path.join(root, "verification/check.mjs"),
          'console.log("modified")',
        );
      await assert.rejects(
        () => e.execute(r.id),
        /tampered|history corrupted|Policy\/spec\/verifier changed/i,
      );
    } finally {
      e.close();
    }
  });
for (const p of [
  "../escape.txt",
  "/tmp/escape.txt",
  ".lgo/config.yaml",
  "openspec/specs/cap/spec.md",
  "verification/oracle.mjs",
  "src/.env",
])
  test(`scope/control escape denied: ${p}`, async () => {
    const e = new Engine(temp(), { config: config() });
    try {
      const a = unit("a", {
        scope: ["src/**"],
        attempts: [{ files: { [p]: "forged" } }],
      });
      const r = await e.execute(e.start(graph(a)).id);
      assert.equal(r.nodes.a.state, "BLOCKED");
      assert.equal(r.nodes.a.attempts, 1);
      assert.equal(r.nodes.a.correction!.failure_class, "POLICY_VIOLATION");
    } finally {
      e.close();
    }
  });

test("context omits secrets/binaries and supplies declared readonly contracts", async () => {
  const root = temp();
  for (const d of ["src", "contracts", "secrets"])
    fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, "src/file.txt"), "existing");
  fs.writeFileSync(path.join(root, "contracts/api.json"), '{"response":404}');
  fs.writeFileSync(path.join(root, ".env"), "SECRET=root");
  fs.writeFileSync(path.join(root, "src/.env"), "SECRET=nested");
  fs.writeFileSync(path.join(root, "secrets/password.txt"), "SECRET=secret");
  fs.writeFileSync(
    path.join(root, "src/logo.bin"),
    Buffer.from([137, 80, 78, 71, 255, 0]),
  );
  const requests: AgentRequest[] = [];
  const e = new Engine(root, {
    config: config(),
    adapterFactory: () => ({
      idempotent: true,
      execute: async (request: AgentRequest) => {
        requests.push(request);
        return {
          schema_version: "1.0",
          files: { "src/a.txt": "ok" },
          usage: { cost: 0, tokens: 0 },
          summary: "fixture",
          idempotency_key: request.idempotency_key,
        };
      },
    }),
  });
  try {
    const a = unit("a", { scope: ["src/**"] });
    a.inputs = ["contracts/api.json"];
    const g = graph(a);
    g.external_inputs = ["contracts/api.json"];
    const r = await e.execute(e.start(g).id);
    assert.equal(r.state, "ACCEPTED");
    assert.equal(requests[0].inputs["contracts/api.json"], '{"response":404}');
    assert.ok(!JSON.stringify(requests).includes("SECRET="));
    assert.ok(!Object.hasOwn(requests[0].inputs, "src/logo.bin"));
    assert.ok(
      fs
        .readFileSync(path.join(r.workspace, "src/logo.bin"))
        .equals(Buffer.from([137, 80, 78, 71, 255, 0])),
    );
  } finally {
    e.close();
  }
});
test("correction receives newly produced code and updated remaining budget", async () => {
  const requests: AgentRequest[] = [];
  const e = new Engine(temp(), {
    config: config(),
    adapterFactory: () => ({
      idempotent: true,
      execute: async (request: AgentRequest): Promise<AgentResult> => {
        requests.push(structuredClone(request));
        const first = request.attempt === 1;
        return {
          schema_version: "1.0",
          files: { "src/a.txt": first ? "incorrect" : "ok" },
          usage: { cost: first ? 0.7 : 0.1, tokens: first ? 60 : 10 },
          summary: "fixture",
          idempotency_key: request.idempotency_key,
        };
      },
    }),
  });
  try {
    const a = unit("a", { scope: ["src/**"] });
    a.budget.max_tokens = 100;
    const r = await e.execute(e.start(graph(a)).id);
    assert.equal(r.state, "ACCEPTED");
    assert.equal(requests[1].inputs["src/a.txt"], "incorrect");
    assert.ok(Math.abs(requests[1].budget.max_cost - 0.3) < 1e-9);
    assert.equal(requests[1].correction!.remaining_budget.max_tokens, 40);
    assert.ok(
      Math.abs(requests[1].correction!.remaining_budget.max_cost - 0.3) < 1e-9,
    );
  } finally {
    e.close();
  }
});
test("reported budget excess is terminal policy failure", async () => {
  const a = unit("a", {
      attempts: [
        { files: { "src/a.txt": "ok" }, usage: { cost: 2, tokens: 1001 } },
      ],
    }),
    e = new Engine(temp(), { config: config() });
  try {
    const r = await e.execute(e.start(graph(a)).id);
    assert.equal(r.nodes.a.state, "BLOCKED");
    assert.equal(r.nodes.a.attempts, 1);
    assert.match(r.nodes.a.correction!.reason, /budget exceeded/);
  } finally {
    e.close();
  }
});
for (const keyword of ["$ref", "$dynamicRef"])
  test(`schema blocks remote ${keyword} without fetching it`, async () => {
    const root = temp();
    fs.writeFileSync(path.join(root, "payload.json"), "{}");
    const old = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("Network forbidden");
    };
    try {
      const r = await new VerificationEngine(config()).check(
        [
          {
            kind: "json_schema",
            path: "payload.json",
            schema: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              [keyword]: "https://untrusted.example/leak",
            },
          },
        ],
        root,
      );
      assert.equal(r.results[0].failure_class, "POLICY_VIOLATION");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = old;
    }
  });
for (const value of ["'false'", "1", "[]", "{}"])
  test(`process permission rejects ambiguous YAML ${value}`, () => {
    const root = temp();
    fs.mkdirSync(path.join(root, ".lgo"));
    fs.writeFileSync(
      path.join(root, ".lgo/config.yaml"),
      `schema_version: '1.0'\nconcurrency: 3\ncommands: {}\nallow_process_agents: ${value}\n`,
    );
    assert.throws(() => loadConfig(root));
  });

test("all active nodes are preflighted before invalidation modifies files", async () => {
  const e = new Engine(temp(), { config: config() });
  try {
    const r = await e.execute(
      e.start(graph(unit("a"), unit("b", { deps: ["a"] }))).id,
    );
    r.nodes.b.state = "RUNNING";
    e.store.save(r);
    const before = fs.readFileSync(path.join(r.workspace, "src/a.txt"));
    assert.throws(
      () => e.invalidate(r.id, "a", "Consumer active"),
      /Stop scheduler/,
    );
    assert.ok(
      fs.readFileSync(path.join(r.workspace, "src/a.txt")).equals(before),
    );
  } finally {
    e.close();
  }
});
test("operational symlink cannot redirect writes outside project", () => {
  const root = temp(),
    project = path.join(root, "p"),
    outside = path.join(root, "outside");
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(project, ".lgo"));
  assert.throws(() => new Engine(project), /Symlink/);
  assert.deepEqual(fs.readdirSync(outside), []);
});
test("configured immutable oracle fixture cannot be rewritten by worker", async () => {
  const root = temp();
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/test.txt"), "frozen");
  const e = new Engine(root, {
    config: config({ protected_paths: ["src/test.txt"] }),
  });
  try {
    const a = unit("a", {
      scope: ["src/**"],
      attempts: [{ files: { "src/a.txt": "ok", "src/test.txt": "bypassed" } }],
    });
    const r = await e.execute(e.start(graph(a)).id);
    assert.equal(r.state, "BLOCKED");
    assert.equal(
      fs.readFileSync(path.join(r.workspace, "src/test.txt"), "utf8"),
      "frozen",
    );
  } finally {
    e.close();
  }
});
test("operator policy can raise risk before dispatch", async () => {
  const root = temp();
  fs.mkdirSync(path.join(root, ".lgo"));
  fs.writeFileSync(
    path.join(root, ".lgo/policies.yaml"),
    "schema_version: '1.0'\nhigh_risk_paths: ['src/a.txt']\n",
  );
  const e = new Engine(root, { config: config() });
  try {
    const r = await e.execute(e.start(graph(unit("a"))).id);
    assert.equal(r.nodes.a.state, "WAITING_APPROVAL");
    assert.equal(r.nodes.a.attempts, 0);
  } finally {
    e.close();
  }
});
