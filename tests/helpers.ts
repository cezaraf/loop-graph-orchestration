import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExecutionGraph,
  WorkUnit,
  Config,
  ParsedSpecification,
  MockAttempt,
} from "../dist/types.js";
import { digest } from "../dist/util.js";
export function temp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lgo-ts-test-"));
}
export function unit(
  id: string,
  options: {
    deps?: string[];
    attempts?: MockAttempt[];
    scope?: string[];
    resources?: string[];
    risk?: WorkUnit["risk"];
  } = {},
): WorkUnit {
  const f = `src/${id}.txt`;
  return {
    id,
    objective: `Produce ${id}`,
    task_id: id,
    requirement_ids: [`cap::${id}`],
    inputs: [],
    outputs: [f],
    dependencies: (options.deps ?? []).map((unit) => ({
      unit,
      reason: `${unit} provides required interface`,
    })),
    resources: options.resources ?? [],
    file_scope: options.scope ?? [f],
    acceptance: ["Content is ok"],
    verifiers: [{ kind: "file_contains", path: f, contains: "ok" }],
    agent: {
      adapter: "mock",
      attempts: options.attempts ?? [
        { files: { [f]: "ok" }, delay_seconds: 0.04 },
      ],
    },
    risk: options.risk ?? "LOW",
    timeout_seconds: 2,
    budget: { max_cost: 1, max_tokens: 1000 },
    max_attempts: 3,
  };
}
export const graph = (...units: WorkUnit[]): ExecutionGraph => ({
  schema_version: "1.0",
  change_id: "test-change",
  spec_hash: digest("spec"),
  units,
  integration_verifiers: units.flatMap((u) => u.verifiers),
});
export const config = (extra: Partial<Config> = {}): Config => ({
  schema_version: "1.0",
  concurrency: 3,
  commands: {},
  ...extra,
});
export function modelFor(g: ExecutionGraph): ParsedSpecification {
  return {
    schema_version: "1.0",
    id: g.change_id,
    schema: "spec-driven",
    openspec_version: "1.16.1",
    metadata: {},
    tasks: [...new Set(g.units.map((u) => u.task_id))].map((id) => ({
      id,
      text: id,
      checked: false,
    })),
    requirements: [...new Set(g.units.flatMap((u) => u.requirement_ids))].map(
      (id) => ({
        id,
        name: id,
        text: "The system SHALL work",
        scenarios: [],
        capability: "cap",
        operation: "ADDED",
      }),
    ),
    capabilities: ["cap"],
    artifacts: {},
    spec_hash: g.spec_hash,
    planning_status: {},
    proposal: "Test",
    design: null,
  };
}
