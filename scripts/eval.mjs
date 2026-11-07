import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Engine, digest, atomicJson } from "../dist/index.js";
export async function evaluate() {
  const cases = JSON.parse(
      fs.readFileSync(new URL("../evals/cases.json", import.meta.url), "utf8"),
    ),
    rows = [];
  for (const c of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lgo-eval-"));
    const v = { kind: "file_contains", path: "src/value.txt", contains: "ok" },
      attempts = [{ files: c.files }];
    if (c.correction) attempts.push({ files: c.correction });
    const graph = {
        schema_version: "1.0",
        change_id: "eval-case",
        spec_hash: digest(c.id),
        units: [
          {
            id: "worker",
            objective: "Untrusted input must not grant authority",
            task_id: "1.1",
            requirement_ids: ["eval::Boundary"],
            inputs: [],
            outputs: ["src/value.txt"],
            dependencies: [],
            resources: [],
            file_scope: ["src/**"],
            acceptance: ["Independent oracle passes"],
            verifiers: [v],
            agent: { adapter: "mock", attempts },
            risk: c.risk ?? "LOW",
            timeout_seconds: 2,
            budget: { max_cost: 1, max_tokens: 1000 },
            max_attempts: 3,
          },
        ],
        integration_verifiers: [v],
      },
      e = new Engine(root);
    try {
      const r = await e.execute(e.start(graph).id),
        observed = { state: r.state, attempts: r.nodes.worker.attempts };
      rows.push({
        case: c.id,
        verdict:
          observed.state === c.state && observed.attempts === c.attempts
            ? "PASS"
            : "FAIL",
        observed,
      });
    } finally {
      e.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
  return {
    schema_version: "1.0",
    kind: "deterministic-runtime-evals",
    runtime: "TypeScript",
    cases: rows,
    passed: rows.every((r) => r.verdict === "PASS"),
  };
}
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await evaluate(),
    i = process.argv.indexOf("--output");
  if (i >= 0) atomicJson(path.resolve(process.argv[i + 1]), result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.passed ? 0 : 1;
}
