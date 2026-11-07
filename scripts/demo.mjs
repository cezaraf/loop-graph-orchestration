#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  Engine,
  OpenSpecAdapter,
  copyWorkspace,
  buildPlan,
  mermaid,
  LearningEngine,
  report,
  atomicJson,
} from "../dist/index.js";
export async function demo(output) {
  const source = fileURLToPath(
    new URL("../examples/tipo-exame", import.meta.url),
  );
  output = path.resolve(output);
  assert.ok(
    !fs.existsSync(output),
    "Use a new output directory; demo does not overwrite",
  );
  const project = path.join(output, "consumer");
  fs.mkdirSync(project, { recursive: true });
  copyWorkspace(source, project);
  fs.mkdirSync(path.join(project, ".lgo/bindings"), { recursive: true });
  fs.copyFileSync(
    path.join(source, ".lgo/config.yaml"),
    path.join(project, ".lgo/config.yaml"),
  );
  const bindings = JSON.parse(
    fs.readFileSync(
      path.join(source, ".lgo/bindings/add-tipo-exame.json"),
      "utf8",
    ),
  );
  delete bindings.spec_hash;
  atomicJson(path.join(project, ".lgo/bindings/add-tipo-exame.json"), bindings);
  for (const u of bindings.units)
    if (["contract", "backend", "frontend"].includes(u.id))
      for (const f of u.outputs)
        if (!f.includes("/src/test/"))
          fs.rmSync(path.join(project, f), { force: true });
  const executable =
      process.env.LGO_OPENSPEC ??
      fileURLToPath(new URL("../node_modules/.bin/openspec", import.meta.url)),
    adapter = new OpenSpecAdapter(project, executable),
    model = adapter.load("add-tipo-exame"),
    graph = buildPlan(model, bindings);
  atomicJson(path.join(project, ".lgo/plans/add-tipo-exame.json"), graph);
  fs.writeFileSync(path.join(output, "graph.mmd"), mermaid(graph) + "\n");
  let e = new Engine(project),
    r = await e.execute(e.start(graph).id, { stopAfter: 3 });
  assert.equal(r.state, "PAUSED");
  const before = Object.fromEntries(
      Object.entries(r.nodes)
        .filter(([, n]) => n.state === "PASSED")
        .map(([id, n]) => [id, n.attempts]),
    ),
    id = r.id;
  e.close();
  e = new Engine(project);
  try {
    r = await e.execute(id);
    assert.equal(r.state, "ACCEPTED");
    for (const [unit, n] of Object.entries(before))
      assert.equal(r.nodes[unit].attempts, n);
    assert.equal(r.nodes.backend.attempts, 2);
    r = await e.verify(id);
    const candidates = new LearningEngine(e.store, e.gate).propose(r);
    assert.equal(candidates[0].status, "PROPOSED");
    const high = structuredClone(graph);
    high.units[0].risk = "HIGH";
    const highRun = await e.execute(e.start(high).id);
    assert.equal(highRun.nodes.contract.state, "WAITING_APPROVAL");
    assert.equal(highRun.nodes.contract.attempts, 0);
    const preview = structuredClone(candidates[0]);
    preview.status = "ACTIVE";
    preview.version = 2;
    const whatIf = buildPlan(model, bindings, [preview]);
    assert.ok(whatIf.applied_rules.length);
    const archive = adapter.prepareArchive("add-tipo-exame", {
      allAccepted: true,
      integrationPassed: true,
      gatePassed: false,
    });
    archive.authority_gate = e.gate.authorize(
      r,
      undefined,
      undefined,
      "archive",
    );
    archive.delivery = e.deliveryStatus(r);
    if (!archive.delivery.integrated_into_consumer)
      archive.blockers.push("DELIVERY_NOT_CONFIRMED");
    const progress = adapter.syncTasks("add-tipo-exame", [], model.spec_hash);
    assert.ok(adapter.load("add-tipo-exame").tasks.every((t) => !t.checked));
    const metrics = report(e.store, r);
    assert.ok(metrics.peak_workers >= 3);
    const result = {
      schema_version: "1.0",
      runtime: "TypeScript/Node.js",
      run_id: id,
      metrics,
      verified_recovery: {
        before,
        after: Object.fromEntries(
          Object.keys(before).map((uid) => [uid, r.nodes[uid].attempts]),
        ),
      },
      corrections: e.store.events(id).filter((ev) => ev.kind === "correction"),
      risk_gate: highRun.gates,
      archive_preparation: archive,
      progress_sync: progress,
      learning: {
        candidates,
        promotion: "NOT_AUTHORIZED",
        what_if_only: true,
        preview_resources: Object.fromEntries(
          whatIf.units.map((u) => [u.id, u.resources]),
        ),
      },
      consumer_project: project,
      workspace: r.workspace,
      limits: [
        "Mock adapters; no LLM cost/token measurement",
        "Offline Java policy/contract/source oracles; Spring/browser suites are separate",
        "No consumer delivery or archive without external authority",
        "Learning preview is not an approved global rule",
      ],
    };
    atomicJson(path.join(output, "demo-report.json"), result);
    return result;
  } finally {
    e.close();
  }
}
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const i = process.argv.indexOf("--output");
  if (i < 0 || !process.argv[i + 1])
    throw new Error("Use --output NEW_DIRECTORY");
  const r = await demo(process.argv[i + 1]);
  console.log(
    JSON.stringify(
      {
        run_id: r.run_id,
        state: r.metrics.state,
        peak_workers: r.metrics.peak_workers,
        attempts: r.metrics.attempts,
        report: path.resolve(process.argv[i + 1], "demo-report.json"),
      },
      null,
      2,
    ),
  );
}
