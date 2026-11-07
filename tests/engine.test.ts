import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  Engine,
  StateStore,
  validateGraph,
  buildPlan,
  MergeCoordinator,
  VerificationEngine,
  report,
  GateEngine,
  ApprovalAuthority,
  LearningEngine,
  digest,
  fileHash,
  now,
  delay,
  PolicyError,
  validateContract,
} from "../dist/index.js";
import type {
  ExecutionGraph,
  AgentRequest,
  AgentResult,
  ApprovalToken,
  LearningCandidate,
  ParsedSpecification,
} from "../dist/types.js";
import { temp, unit, graph, config, modelFor } from "./helpers.ts";

for (const [name, mutate] of Object.entries({
  missing: (g: ExecutionGraph): void => {
    g.units[0].dependencies.push({ unit: "absent", reason: "missing" });
  },
  cycle: (g: ExecutionGraph): void => {
    g.units[0].dependencies.push({ unit: "b", reason: "cycle" });
  },
  reason: (g: ExecutionGraph): void => {
    g.units[1].dependencies[0].reason = "";
  },
  duplicate: (g: ExecutionGraph): void => {
    g.units.push(structuredClone(g.units[0]));
  },
}))
  test(`graph rejects ${name}`, () => {
    const g = graph(unit("a"), unit("b", { deps: ["a"] }));
    mutate(g);
    assert.throws(() => validateGraph(g));
  });

test("traceability covers real tasks/requirements, independent of textual order", () => {
  const g = graph(unit("a"), unit("b")),
    m = modelFor(g);
  m.tasks.reverse();
  const planned = buildPlan(m, g);
  assert.ok(planned.units.every((u) => !u.dependencies.length));
  g.units[0].task_id = "absent";
  assert.throws(() => validateGraph(g, m), /Unknown source task/);
  g.units[0].task_id = "a";
  m.requirements.push({ ...m.requirements[0], id: "cap::missing" });
  assert.throws(() => validateGraph(g, m), /Requirements without/);
});

test("artifact producers generate justified edges; raw missing edges fail", () => {
  const g = graph(unit("a"), unit("b"));
  g.units[1].inputs = ["src/a.txt"];
  assert.throws(() => validateGraph(g), /missing dependency/);
  const planned = buildPlan(modelFor(g), g);
  assert.equal(planned.units[1].dependencies[0].unit, "a");
  assert.match(planned.units[1].dependencies[0].reason, /src\/a.txt/);
});
test("predictable write conflict needs explicit ordering or resource lock", () => {
  const a = unit("a"),
    b = unit("b", { scope: ["src/*"] });
  assert.throws(() => validateGraph(graph(a, b)), /write conflict/);
  a.resources = ["shared"];
  b.resources = ["shared"];
  assert.doesNotThrow(() => validateGraph(graph(a, b)));
});

test("three workers genuinely overlap and consumers wait for all producers", async () => {
  const root = temp(),
    e = new Engine(root, { config: config() });
  try {
    const r = await e.execute(
      e.start(
        graph(
          unit("a"),
          unit("b"),
          unit("c"),
          unit("d", { deps: ["a", "b", "c"] }),
        ),
      ).id,
    );
    assert.equal(r.state, "ACCEPTED");
    const events = e.store.events(r.id),
      starts = Object.fromEntries(
        events
          .filter((x) => x.kind === "attempt_started")
          .map((x) => [x.unit, x.timestamp]),
      ),
      ends = Object.fromEntries(
        events
          .filter((x) => x.kind === "transition" && x.state === "PASSED")
          .map((x) => [x.unit, x.timestamp]),
      );
    assert.ok(
      Math.max(starts.a, starts.b, starts.c) < Math.min(ends.a, ends.b, ends.c),
    );
    assert.ok(starts.d >= Math.max(ends.a, ends.b, ends.c));
    assert.equal(report(e.store, r).peak_workers, 3);
    assert.ok(!fs.existsSync(path.join(root, "src")));
  } finally {
    e.close();
  }
});
test("shared resources serialize execution", async () => {
  const e = new Engine(temp(), { config: config() });
  try {
    const r = await e.execute(
        e.start(
          graph(
            unit("a", { resources: ["db"] }),
            unit("b", { resources: ["db"] }),
          ),
        ).id,
      ),
      events = e.store.events(r.id);
    assert.ok(
      events.find((x) => x.kind === "attempt_started" && x.unit === "b")!
        .timestamp >=
        events.find(
          (x) =>
            x.kind === "transition" && x.unit === "a" && x.state === "PASSED",
        )!.timestamp,
    );
  } finally {
    e.close();
  }
});

test("local correction preserves independent accepted units and structured feedback", async () => {
  const e = new Engine(temp(), { config: config() });
  try {
    const r = await e.execute(
      e.start(
        graph(
          unit("a", {
            attempts: [
              { files: { "src/a.txt": "bad" } },
              { files: { "src/a.txt": "ok" } },
            ],
          }),
          unit("b"),
          unit("c"),
        ),
      ).id,
    );
    assert.equal(r.state, "ACCEPTED");
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(r.nodes).map(([id, n]) => [id, n.attempts]),
      ),
      { a: 2, b: 1, c: 1 },
    );
    const c = e.store.events(r.id).find((x) => x.kind === "correction")!;
    validateContract("correction_request", c.feedback);
    assert.equal(r.nodes.a.correction!.remaining_attempts, 2);
    assert.deepEqual(r.nodes.a.correction!.scope.allowed, ["src/a.txt"]);
    for (const event of e.store.events(r.id))
      validateContract("execution_event", event);
    validateContract("execution_manifest", r);
  } finally {
    e.close();
  }
});
for (const [name, attempts, expected] of [
  [
    "budget",
    Array.from({ length: 5 }, (_, i) => ({
      files: { "src/a.txt": String(i) },
    })),
    3,
  ],
  ["no-progress", [{ files: { "src/a.txt": "bad" } }], 2],
] as const)
  test(`loop stops at ${name}`, async () => {
    const e = new Engine(temp(), { config: config() });
    try {
      const r = await e.execute(
        e.start(graph(unit("a", { attempts: structuredClone([...attempts]) })))
          .id,
      );
      assert.equal(r.state, "BLOCKED");
      assert.equal(r.nodes.a.attempts, expected);
    } finally {
      e.close();
    }
  });

test("timeout blocks environment failure rather than retrying blindly", async () => {
  const a = unit("a", { attempts: [{ files: {}, delay_seconds: 10 }] });
  a.timeout_seconds = 0.015;
  const e = new Engine(temp(), { config: config() });
  try {
    const r = await e.execute(e.start(graph(a)).id);
    assert.equal(r.nodes.a.attempts, 1);
    assert.equal(r.nodes.a.correction!.failure_class, "ENVIRONMENT_FAILURE");
  } finally {
    e.close();
  }
});
test("an adapter ignoring AbortSignal cannot block the scheduler deadline", async () => {
  const a = unit("a");
  a.timeout_seconds = 0.01;
  const e = new Engine(temp(), {
    config: config(),
    adapterFactory: () => ({
      idempotent: true,
      execute: async () => new Promise<AgentResult>(() => {}),
    }),
  });
  try {
    const r = await e.execute(e.start(graph(a)).id);
    assert.equal(r.state, "BLOCKED");
  } finally {
    e.close();
  }
});

test("pause/resume and invalidation preserve independent results and roll back consumers", async () => {
  const root = temp();
  let e = new Engine(root, { config: config() });
  try {
    let r = await e.execute(
      e.start(graph(unit("a"), unit("b"), unit("c", { deps: ["a"] }))).id,
      { stopAfter: 2 },
    );
    assert.equal(r.state, "PAUSED");
    const id = r.id;
    e.close();
    e = new Engine(root, { config: config() });
    r = await e.execute(id);
    assert.ok(Object.values(r.nodes).every((n) => n.attempts === 1));
    r = e.invalidate(id, "a", "Contract changed");
    assert.equal(r.nodes.b.state, "PASSED");
    assert.equal(r.nodes.c.state, "INVALIDATED");
    assert.ok(!fs.existsSync(path.join(r.workspace, "src/a.txt")));
    r = await e.execute(id);
    assert.equal(r.state, "ACCEPTED");
    assert.equal(r.nodes.b.attempts, 1);
  } finally {
    e.close();
  }
});
test("replan fixes a blocked unit without replaying independent work", async () => {
  const e = new Engine(temp(), { config: config() });
  try {
    let r = await e.execute(
      e.start(
        graph(
          unit("a", { attempts: [{ files: { "src/a.txt": "bad" } }] }),
          unit("b"),
        ),
      ).id,
    );
    r = e.replan(
      r.id,
      graph(unit("a"), unit("b")),
      "Change implementation strategy",
    );
    assert.equal(r.nodes.b.state, "PASSED");
    r = await e.execute(r.id);
    assert.equal(r.state, "ACCEPTED");
    assert.equal(r.nodes.b.attempts, 1);
  } finally {
    e.close();
  }
});
for (const change of ["spec", "policy"])
  test(`replan invalidates all results when ${change} changes`, async () => {
    const e = new Engine(temp(), { config: config() });
    try {
      const g = graph(unit("a")),
        r = await e.execute(e.start(g).id);
      if (change === "spec") g.spec_hash = digest("updated");
      else e.config.concurrency = 2;
      assert.notEqual(
        e.replan(r.id, g, "Reviewed change").nodes.a.state,
        "PASSED",
      );
    } finally {
      e.close();
    }
  });

test("merge journal replays partial integration and refuses external divergence", () => {
  const root = temp(),
    w = path.join(root, "w");
  fs.mkdirSync(w);
  fs.writeFileSync(path.join(w, "a"), "old-a");
  fs.writeFileSync(path.join(w, "b"), "old-b");
  const base = {
      a: fileHash(path.join(w, "a")),
      b: fileHash(path.join(w, "b")),
    },
    m = new MergeCoordinator(w, path.join(root, "journal.json"));
  const result = m.integrate("writer", { a: "new-a", b: "new-b" }, base);
  assert.deepEqual(result.originals, { a: "old-a", b: "old-b" });
  fs.writeFileSync(path.join(w, "b"), "old-b");
  assert.ok(m.recover().passed);
  assert.equal(fs.readFileSync(path.join(w, "b"), "utf8"), "new-b");
  fs.writeFileSync(path.join(w, "b"), "other");
  assert.throws(() => m.recover(), /conflict/);
});

test("actual failed command, missing allowlist and JSON schema can reject output", async () => {
  const root = temp(),
    v = new VerificationEngine(
      config({
        commands: {
          fail: { argv: [process.execPath, "-e", "process.exit(7)"] },
        },
      }),
    );
  let r = await v.check([{ kind: "command", command: "fail" }], root);
  assert.equal(r.results[0].evidence.exit_code, 7);
  r = await v.check([{ kind: "command", command: "unknown" }], root);
  assert.equal(r.results[0].failure_class, "POLICY_VIOLATION");
  fs.writeFileSync(path.join(root, "bad.json"), '{"answer":false}');
  r = await v.check(
    [
      {
        kind: "json_schema",
        path: "bad.json",
        schema: { type: "object", properties: { answer: { const: true } } },
      },
    ],
    root,
  );
  assert.equal(r.passed, false);
});
test("deterministic file comparison, duplicate detection, CI revision and human gate", async () => {
  const root = temp();
  fs.writeFileSync(path.join(root, "a"), "same");
  fs.writeFileSync(path.join(root, "b"), "same");
  fs.writeFileSync(path.join(root, "list.json"), "[1,1]");
  const v = new VerificationEngine(
    config({
      ci_results: { build: { conclusion: "success", revision: "abc" } },
    }),
  );
  assert.ok(
    (await v.check([{ kind: "equal_files", left: "a", right: "b" }], root))
      .passed,
  );
  assert.ok(
    !(await v.check([{ kind: "no_duplicates", path: "list.json" }], root))
      .passed,
  );
  assert.ok(
    (await v.check([{ kind: "ci", check: "build", revision: "abc" }], root))
      .passed,
  );
  assert.ok(
    !(await v.check([{ kind: "ci", check: "build", revision: "other" }], root))
      .passed,
  );
  assert.ok(!(await v.check([{ kind: "human" }], root)).passed);
});

test("learning requires validated baseline, signed trial, immutable versions and revocation", async () => {
  const root = temp(),
    project = path.join(root, "project");
  fs.mkdirSync(project);
  const key = path.join(root, "key");
  fs.writeFileSync(key, "a".repeat(32), { mode: 0o600 });
  const authority = new ApprovalAuthority(key, project),
    gate = new GateEngine(authority),
    e = new Engine(project, { config: config(), gate });
  try {
    const a = unit("a", {
      scope: ["backend/**"],
      attempts: [
        { files: { "backend/a": "bad" } },
        { files: { "backend/a": "ok" } },
      ],
    });
    a.outputs = ["backend/a"];
    a.verifiers = [
      { kind: "file_contains", path: "backend/a", contains: "ok" },
    ];
    const learner = new LearningEngine(e.store, gate),
      initial = e.start(graph(a));
    assert.throws(() => learner.propose(initial));
    const r = await e.execute(initial.id),
      candidate = learner.propose(r)[0];
    assert.equal(candidate.status, "PROPOSED");
    validateContract("learning_candidate", candidate);
    assert.throws(() =>
      learner.promote(r, candidate.id, {} as ApprovalToken, [r.id]),
    );
    const trial = {
        ...structuredClone(candidate),
        status: "ACTIVE",
      } as LearningCandidate,
      m = modelFor(graph(a)),
      g = buildPlan(m, graph(a), [trial]);
    const r2 = await e.execute(e.start(g).id),
      ids = [r.id, r2.id].sort(),
      token = authority.sign({
        binding: digest({
          authority_domain: "lgo-typescript-0.2",
          rule: candidate,
          regressions: ids,
        }),
        action: "promote-learning",
        expires_at: now() + 60,
        actor: "test-only",
      });
    const active = learner.promote(r, candidate.id, token, ids);
    assert.ok(
      buildPlan(m, graph(a), e.store.rules()).units[0].resources.includes(
        active.constraint.resource,
      ),
    );
    learner.revoke(
      r,
      candidate.id,
      authority.sign({
        binding: digest({
          authority_domain: "lgo-typescript-0.2",
          rule: active,
        }),
        action: "revoke-learning",
        expires_at: now() + 60,
        actor: "test-only",
      }),
    );
    assert.equal(
      buildPlan(m, graph(a), e.store.rules()).applied_rules!.length,
      0,
    );
    assert.deepEqual(
      e.store.ruleHistory(candidate.id).map((v) => v.version),
      [1, 2, 3],
    );
  } finally {
    e.close();
  }
});

test("signed consumer delivery is idempotent and fake approvals have no effect", async () => {
  const root = temp(),
    project = path.join(root, "project");
  fs.mkdirSync(project);
  const key = path.join(root, "key");
  fs.writeFileSync(key, "a".repeat(32), { mode: 0o600 });
  const authority = new ApprovalAuthority(key, project),
    e = new Engine(project, {
      config: config(),
      gate: new GateEngine(authority),
    });
  try {
    const r = await e.execute(e.start(graph(unit("a"))).id);
    assert.equal(
      (
        e.integrateConsumer(r.id, {
          approved: true,
        } as unknown as ApprovalToken) as { verdict: string }
      ).verdict,
      "HUMAN_APPROVAL_REQUIRED",
    );
    const request = e.gate.authorize(
        r,
        undefined,
        undefined,
        "integrate",
      ).approval_request!,
      t = authority.sign({
        ...request,
        expires_at: now() + 60,
        actor: "test-only",
      });
    assert.ok("integrated_into_consumer" in e.integrateConsumer(r.id, t));
    assert.ok("integrated_into_consumer" in e.integrateConsumer(r.id, t));
    assert.equal(
      fs.readFileSync(path.join(project, "src/a.txt"), "utf8"),
      "ok",
    );
  } finally {
    e.close();
  }
});

test("SQL lease rejects another controller in the same process", () => {
  const root = temp(),
    a = new StateStore(path.join(root, ".lgo")),
    b = new StateStore(path.join(root, ".lgo"));
  const release = a.acquire();
  try {
    assert.throws(() => b.acquire(), /Another scheduler/);
  } finally {
    release();
    a.close();
    b.close();
  }
});

test("actual SIGKILL recovery preserves the accepted unit and reclaims a dead lease", async () => {
  const root = temp();
  const g = graph(
    unit("fast"),
    unit("slow", {
      deps: ["fast"],
      attempts: [{ files: { "src/slow.txt": "ok" }, delay_seconds: 0.7 }],
    }),
  );
  fs.writeFileSync(path.join(root, "plan.json"), JSON.stringify(g));
  const module = new URL("../dist/index.js", import.meta.url).href;
  const code = `import fs from 'node:fs';import {Engine} from ${JSON.stringify(module)};const root=process.argv[1],e=new Engine(root,{config:${JSON.stringify(config())}});await e.execute(e.start(JSON.parse(fs.readFileSync(root+'/plan.json','utf8'))).id);`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", code, root],
    { stdio: "ignore" },
  );
  let id: string | undefined;
  try {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (fs.existsSync(path.join(root, ".lgo/state.sqlite"))) {
        const store = new StateStore(path.join(root, ".lgo"));
        try {
          const r = store.latest("test-change");
          if (
            r?.nodes.fast.state === "PASSED" &&
            r.nodes.slow.state === "RUNNING"
          ) {
            id = r.id;
            break;
          }
        } finally {
          store.close();
        }
      }
      await delay(15);
    }
    assert.ok(id, "Persisted mid-flight checkpoint must be observable");
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const e = new Engine(root, { config: config() });
    try {
      const r = await e.execute(id!);
      assert.equal(r.state, "ACCEPTED");
      assert.equal(r.nodes.fast.attempts, 1);
      assert.equal(r.nodes.slow.attempts, 2);
      assert.ok(e.store.events(r.id).some((x) => x.kind === "recovered_retry"));
    } finally {
      e.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
});
