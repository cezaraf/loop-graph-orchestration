#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { Engine } from "./engine.js";
import { OpenSpecAdapter } from "./openspec.js";
import { buildPlan, validateGraph, mermaid } from "./graph.js";
import { GateEngine, ApprovalAuthority } from "./gates.js";
import { StateStore, hasState } from "./state.js";
import { LearningEngine } from "./learning.js";
import { report } from "./observability.js";
import { migrateState } from "./migration.js";
import { loadConfig } from "./workspace.js";
import {
  PolicyError,
  atomicJson,
  exists,
  fileHash,
  readJson,
  safePath,
} from "./util.js";
import type {
  ApprovalToken,
  Config,
  ExecutionGraph,
  LearningCandidate,
} from "./types.js";
const HELP = `LGO 0.2 — OpenSpec define; Graph agenda; Loop verifica; Gate autoriza.
Usage: lgo [--root PROJECT] [--json] [--dry-run] COMMAND [arguments]

Commands:
 init | doctor | update | uninstall
 inspect CHANGE | plan CHANGE [--bindings FILE] | validate-plan CHANGE
 run CHANGE [--stop-after N] [--approval FILE] | status CHANGE
 graph CHANGE [--format mermaid|dot|json] | explain CHANGE
 resume RUN [--approval FILE] | verify RUN | report RUN | learn RUN
 invalidate RUN UNIT --reason TEXT | replan RUN --plan FILE --reason TEXT
 cancel RUN | export RUN | integrate RUN [--approval FILE]
 sync-progress CHANGE | prepare-archive CHANGE [--approval FILE]
 migrate-state --from-python [--dry-run]

Exit codes: 0 success; 2 invalid/config/environment; 3 paused/blocked/approval; 130 interrupted.
`;
interface Args {
  root: string;
  json: boolean;
  dryRun: boolean;
  command: string;
  positional: string[];
  options: Record<string, string | boolean>;
}
function parseArgs(argv: string[]): Args {
  const a: Args = {
    root: process.cwd(),
    json: false,
    dryRun: false,
    command: "",
    positional: [],
    options: {},
  };
  const values = new Set([
    "root",
    "bindings",
    "stop-after",
    "approval",
    "format",
    "reason",
    "plan",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") a.json = true;
    else if (arg === "--dry-run") a.dryRun = true;
    else if (arg === "--help" || arg === "-h") a.command = "help";
    else if (arg === "--version") a.command = "version";
    else if (arg === "--from-python") a.options["from-python"] = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (!values.has(key) || i + 1 >= argv.length)
        throw new PolicyError(`Unknown/missing option ${arg}`);
      const value = argv[++i];
      if (key === "root") a.root = path.resolve(value);
      else a.options[key] = value;
    } else if (!a.command) a.command = arg;
    else a.positional.push(arg);
  }
  return a;
}
function required(a: Args, index = 0): string {
  const value = a.positional[index];
  if (!value) throw new PolicyError("Required argument missing; use --help");
  return value;
}
function option(a: Args, key: string): string | undefined {
  return typeof a.options[key] === "string"
    ? (a.options[key] as string)
    : undefined;
}
function token(a: Args): ApprovalToken | undefined {
  const f = option(a, "approval");
  return f ? readJson<ApprovalToken>(path.resolve(f)) : undefined;
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
    if (args.command === "help" || !args.command) {
      console.log(HELP);
      return 0;
    }
    if (args.command === "version") {
      console.log("0.2.0");
      return 0;
    }
    const [result, code] = await dispatch(args);
    if (typeof result === "string") console.log(result);
    else console.log(JSON.stringify(result, null, 2));
    return code;
  } catch (e) {
    console.log(
      JSON.stringify({
        error: e instanceof Error ? e.name : "Error",
        reason: e instanceof Error ? e.message : String(e),
      }),
    );
    return e instanceof DOMException && e.name === "AbortError" ? 130 : 2;
  }
}
async function dispatch(a: Args): Promise<[unknown, number]> {
  const root = path.resolve(a.root),
    cmd = a.command;
  if (!exists(root) || !fs.statSync(root).isDirectory())
    throw new PolicyError("Project root missing");
  if (cmd === "migrate-state")
    return [
      await migrateState(root, {
        fromPython: a.options["from-python"] === true,
        dryRun: a.dryRun,
      }),
      0,
    ];
  const configPath = safePath(root, ".lgo/config.yaml");
  if (cmd === "init") {
    if (exists(configPath))
      return [
        {
          created: false,
          reason: "Existing configuration preserved",
          config: loadConfig(root),
        },
        0,
      ];
    const c: Config = {
      schema_version: "1.0",
      concurrency: 3,
      max_patch_bytes: 1048576,
      commands: {},
      allow_process_agents: false,
      retention_days: 30,
    };
    if (!a.dryRun) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, stringify(c));
      fs.writeFileSync(
        path.join(root, ".lgo/.gitignore"),
        "state.sqlite*\nbackups/\nruns/\nscheduler.lock\n",
      );
    }
    return [
      {
        created: !a.dryRun,
        dry_run: a.dryRun,
        config: c,
        next_action:
          "Define explicit bindings and trusted oracles. OpenSpec is initialized with its official CLI.",
      },
      0,
    ];
  }
  if (["doctor", "update", "uninstall"].includes(cmd)) {
    const c = loadConfig(root);
    if (cmd === "uninstall")
      return [
        {
          executed: false,
          instructions:
            "Stop scheduler, export evidence, uninstall npm package and remove only reviewed LGO files; preserve openspec and application code.",
        },
        0,
      ];
    if (cmd === "update")
      return [
        {
          executed: false,
          schema_version: c.schema_version,
          runtime_version: "0.2.0",
          instructions:
            "Run migrate-state --from-python for legacy stores. Preserve consumer configuration.",
        },
        0,
      ];
    return [
      {
        configuration: "PASS",
        openspec_version: new OpenSpecAdapter(root).version,
        node: process.version,
        platform: process.platform,
        store_version: 2,
        distributed: false,
      },
      0,
    ];
  }
  const adapter = new OpenSpecAdapter(root),
    change = a.positional[0];
  if (cmd === "inspect") return [adapter.load(required(a)), 0];
  let graph: ExecutionGraph | undefined;
  if (["plan", "validate-plan", "run", "graph", "explain"].includes(cmd)) {
    const model = adapter.load(required(a)),
      planFile = safePath(root, `.lgo/plans/${change}.json`);
    if (cmd === "plan") {
      const binding = option(a, "bindings")
        ? path.resolve(option(a, "bindings")!)
        : safePath(root, `.lgo/bindings/${change}.json`);
      if (!exists(binding))
        throw new PolicyError(
          `Explicit semantic bindings required: ${binding}`,
        );
      let rules: LearningCandidate[] = [];
      if (hasState(root)) {
        const store = new StateStore(path.join(root, ".lgo"));
        try {
          rules = store.rules();
        } finally {
          store.close();
        }
      }
      graph = buildPlan(model, readJson<ExecutionGraph>(binding), rules);
      if (!a.dryRun) atomicJson(planFile, graph);
      return [{ dry_run: a.dryRun, plan: graph, path: planFile }, 0];
    }
    graph = validateGraph(readJson<unknown>(planFile), model);
    if (graph.spec_hash !== model.spec_hash)
      throw new PolicyError("Plan stale relative to OpenSpec");
    if (cmd === "validate-plan") return [{ valid: true, change }, 0];
    if (cmd === "graph") {
      const format = option(a, "format") ?? "mermaid";
      if (format === "json") return [graph, 0];
      if (format === "dot")
        return [
          "digraph lgo {\n" +
            graph.units
              .flatMap((u) =>
                u.dependencies.map((d) => `"${d.unit}" -> "${u.id}";`),
              )
              .join("\n") +
            "\n}",
          0,
        ];
      if (format !== "mermaid") throw new PolicyError("Unknown graph format");
      return [mermaid(graph), 0];
    }
    if (cmd === "explain")
      return [
        {
          change,
          units: graph.units.map((u) => ({
            id: u.id,
            task: u.task_id,
            requirements: u.requirement_ids,
            dependencies: u.dependencies,
            risk: u.risk,
            resources: u.resources,
            verifiers: u.verifiers,
          })),
        },
        0,
      ];
    if (a.dryRun)
      return [
        {
          dry_run: true,
          valid: true,
          units: graph.units.length,
          will_execute: false,
        },
        0,
      ];
  }
  if (cmd === "status" && !hasState(root)) return [{ run: null }, 0];
  const authority = process.env.LGO_AUTHORITY_KEY_FILE
      ? new ApprovalAuthority(process.env.LGO_AUTHORITY_KEY_FILE, root)
      : undefined,
    engine = new Engine(root, { gate: new GateEngine(authority) }),
    controller = new AbortController();
  const interrupt = () =>
    controller.abort(new DOMException("Interrupted", "AbortError"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    if (cmd === "run") {
      const raw = option(a, "stop-after"),
        stopAfter = raw === undefined ? undefined : Number(raw);
      if (
        stopAfter !== undefined &&
        (!Number.isInteger(stopAfter) || stopAfter < 0)
      )
        throw new PolicyError("stop-after must be a nonnegative integer");
      const run = await engine.execute(engine.start(graph!).id, {
        stopAfter,
        approval: token(a),
        signal: controller.signal,
      });
      return [report(engine.store, run), run.state === "ACCEPTED" ? 0 : 3];
    }
    if (cmd === "status") {
      const run = engine.store.latest(required(a));
      return [
        run
          ? {
              run_id: run.id,
              state: run.state,
              nodes: Object.fromEntries(
                Object.entries(run.nodes).map(([id, n]) => [
                  id,
                  {
                    state: n.state,
                    attempts: n.attempts,
                    integrated: n.integrated,
                  },
                ]),
              ),
              workspace: run.workspace,
            }
          : { run: null },
        0,
      ];
    }
    if (cmd === "resume" || cmd === "verify") {
      const id = required(a),
        run = a.dryRun
          ? engine.store.get(id)
          : cmd === "resume"
            ? await engine.execute(id, {
                approval: token(a),
                signal: controller.signal,
              })
            : await engine.verify(id, controller.signal);
      return [
        report(engine.store, run),
        run.state === "ACCEPTED" || a.dryRun ? 0 : 3,
      ];
    }
    if (cmd === "report")
      return [report(engine.store, engine.store.get(required(a))), 0];
    if (cmd === "learn") {
      const run = engine.store.get(required(a));
      const candidates = a.dryRun
        ? []
        : engine.store.lockSync(() =>
            new LearningEngine(engine.store, engine.gate).propose(run),
          );
      return [{ candidates, dry_run: a.dryRun }, 0];
    }
    if (cmd === "export") return [engine.exportPatch(required(a)), 0];
    if (cmd === "integrate") {
      const run = engine.store.get(required(a)),
        t = token(a);
      if (a.dryRun || !t)
        return [
          engine.gate.authorize(run, undefined, undefined, "integrate"),
          3,
        ];
      const result = engine.integrateConsumer(run.id, t);
      return [
        result,
        "integrated_into_consumer" in result && result.integrated_into_consumer
          ? 0
          : 3,
      ];
    }
    if (cmd === "invalidate") {
      if (!option(a, "reason")) throw new PolicyError("reason required");
      const run = a.dryRun
        ? engine.store.get(required(a))
        : engine.invalidate(required(a), required(a, 1), option(a, "reason")!);
      return [{ run_id: run.id, state: run.state, dry_run: a.dryRun }, 0];
    }
    if (cmd === "replan") {
      const id = required(a),
        file = option(a, "plan"),
        reason = option(a, "reason");
      if (!file || !reason) throw new PolicyError("plan and reason required");
      const run = engine.store.get(id),
        model = adapter.load(run.graph.change_id),
        g = validateGraph(readJson<unknown>(path.resolve(file)), model);
      if (g.spec_hash !== model.spec_hash)
        throw new PolicyError("Replan stale spec");
      const next = a.dryRun ? run : engine.replan(id, g, reason);
      return [{ run_id: id, state: next.state, dry_run: a.dryRun }, 0];
    }
    if (cmd === "cancel") {
      const id = required(a);
      if (!a.dryRun) engine.cancel(id);
      return [{ run_id: id, state: "CANCELLED", dry_run: a.dryRun }, 0];
    }
    if (cmd === "sync-progress" || cmd === "prepare-archive") {
      const change = required(a),
        run = engine.store.latest(change);
      if (!run) throw new PolicyError("No execution with evidence");
      engine.assertIntegrity(run);
      if (cmd === "sync-progress") {
        const ids = [...new Set(run.graph.units.map((u) => u.task_id))].filter(
          (task) =>
            run.graph.units
              .filter((u) => u.task_id === task)
              .every((u) => {
                const n = run.nodes[u.id];
                return (
                  n.state === "PASSED" &&
                  n.integrated &&
                  n.verified &&
                  Object.entries(n.merge?.hashes ?? {}).every(
                    ([p, h]) => fileHash(safePath(root, p)) === h,
                  )
                );
              }),
        );
        return [
          a.dryRun
            ? { accepted_task_ids: ids, dry_run: true }
            : engine.store.lockSync(() =>
                adapter.syncTasks(change, ids, run.graph.spec_hash),
              ),
          0,
        ];
      }
      const quality = engine.gate.quality(run),
        gate = engine.gate.authorize(run, undefined, token(a), "archive"),
        result = adapter.prepareArchive(change, {
          allAccepted: quality.verdict === "PASS",
          integrationPassed: run.integration.passed,
          gatePassed: gate.verdict === "PASS",
        }),
        delivery = engine.deliveryStatus(run);
      if (!delivery.integrated_into_consumer) {
        result.ready = false;
        result.blockers.push("DELIVERY_NOT_CONFIRMED");
      }
      return [{ ...result, quality, gate, delivery }, result.ready ? 0 : 3];
    }
    throw new PolicyError(`Unknown command ${cmd}`);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    engine.close();
  }
}
if (
  process.argv[1] &&
  exists(process.argv[1]) &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await main();
