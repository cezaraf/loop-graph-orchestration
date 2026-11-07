import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import type { ParsedSpecification, Requirement, SourceTask } from "./types.js";
import {
  PolicyError,
  atomicWrite,
  files,
  safePath,
  sha256,
  exists,
} from "./util.js";
import { validateContract } from "./contracts.js";
export const SUPPORTED_OPENSPEC_VERSION = "1.16.1";
interface NativeTask {
  id: string;
  description: string;
  done: boolean;
  sourcePath: string;
  line: number;
}
interface NativeDelta {
  spec: string;
  operation: Requirement["operation"];
  description: string;
  requirement?: Omit<Requirement, "id" | "capability" | "operation">;
  requirements?: Omit<Requirement, "id" | "capability" | "operation">[];
  rename?: { from: string; to: string };
}
export class OpenSpecAdapter {
  readonly root: string;
  readonly executable: string;
  constructor(root: string, executable?: string) {
    this.root = path.resolve(root);
    this.executable =
      executable ??
      process.env.LGO_OPENSPEC ??
      (exists(path.join(this.root, "node_modules/.bin/openspec"))
        ? path.join(this.root, "node_modules/.bin/openspec")
        : "openspec");
  }
  call(
    args: string[],
    requireSuccess = true,
  ): { stdout: string; stderr: string; status: number | null } {
    const r = spawnSync(this.executable, args, {
      cwd: this.root,
      env: {
        ...process.env,
        OPENSPEC_TELEMETRY: "0",
        DO_NOT_TRACK: "1",
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 45000,
      maxBuffer: 8 * 2 ** 20,
      shell: false,
    });
    if (r.error)
      throw new PolicyError(`OpenSpec CLI unavailable: ${r.error.message}`);
    if (requireSuccess && r.status !== 0)
      throw new PolicyError(
        `OpenSpec ${args[0]} failed (${r.status}): ${r.stderr} ${r.stdout}`,
      );
    return r;
  }
  get version(): string {
    const v = this.call(["--version"]).stdout.trim();
    if (v !== SUPPORTED_OPENSPEC_VERSION)
      throw new PolicyError(
        `OpenSpec incompatible: ${v}; supported: ${SUPPORTED_OPENSPEC_VERSION}`,
      );
    return v;
  }
  json<T>(...args: string[]): T {
    this.version;
    return JSON.parse(this.call(args).stdout) as T;
  }
  changePath(change: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change) || change === "archive")
      throw new PolicyError("Invalid change ID");
    const base = safePath(this.root, `openspec/changes/${change}`);
    if (!exists(base) || !fs.statSync(base).isDirectory())
      throw new PolicyError(`Change missing: ${change}`);
    function check(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink())
          throw new PolicyError(`Artifact symlink rejected: ${e.name}`);
        if (e.isDirectory()) check(path.join(dir, e.name));
      }
    }
    check(base);
    return base;
  }
  discover(): unknown {
    return this.json("list", "--json");
  }
  validate(change: string): {
    valid: boolean;
    details: unknown;
    openspec_version: string;
  } {
    this.changePath(change);
    const version = this.version;
    const r = this.call(
      [
        "validate",
        change,
        "--type",
        "change",
        "--strict",
        "--json",
        "--no-interactive",
      ],
      false,
    );
    let details: unknown;
    try {
      details = JSON.parse(r.stdout);
    } catch {
      details = { error: r.stderr || r.stdout };
    }
    return { valid: r.status === 0, details, openspec_version: version };
  }
  load(change: string): ParsedSpecification {
    const base = this.changePath(change),
      validation = this.validate(change);
    if (!validation.valid)
      throw new PolicyError(
        `Invalid OpenSpec change: ${JSON.stringify(validation.details)}`,
      );
    const native = this.json<{ deltas: NativeDelta[] }>(
        "show",
        change,
        "--type",
        "change",
        "--json",
        "--no-interactive",
      ),
      status = this.json<Record<string, unknown>>(
        "status",
        "--change",
        change,
        "--json",
      );
    const schema = status.schemaName ?? status.schema ?? "spec-driven";
    if (schema !== "spec-driven")
      throw new PolicyError(`Unsupported OpenSpec schema: ${String(schema)}`);
    const apply = this.json<{ tasks: NativeTask[] }>(
      "instructions",
      "apply",
      "--change",
      change,
      "--json",
    );
    const tasks: SourceTask[] = (apply.tasks ?? []).map((t) => ({
      id: /^(\d+(?:\.\d+)+)\s+/.exec(t.description)?.[1] ?? t.id,
      official_id: t.id,
      text: t.description,
      checked: t.done,
      sourcePath: t.sourcePath,
      line: t.line,
    }));
    if (new Set(tasks.map((t) => t.id)).size !== tasks.length)
      throw new PolicyError("Duplicate source task IDs");
    const requirements: Requirement[] = [];
    for (const delta of native.deltas ?? []) {
      let reqs =
        delta.requirements ?? (delta.requirement ? [delta.requirement] : []);
      if (delta.operation === "RENAMED") {
        if (!delta.rename) throw new PolicyError("Rename metadata missing");
        reqs = [
          { name: delta.rename.to, text: delta.description, scenarios: [] },
        ];
      }
      for (const req of reqs) {
        const name = req.name || req.text.split("\n")[0];
        requirements.push({
          id: `${delta.spec}::${name}`,
          name,
          text: req.text,
          scenarios: req.scenarios ?? [],
          capability: delta.spec,
          operation: delta.operation,
          ...(delta.rename ? { rename: delta.rename } : {}),
        });
      }
    }
    if (new Set(requirements.map((r) => r.id)).size !== requirements.length)
      throw new PolicyError("Duplicate requirements");
    const artifacts: Record<string, string> = {};
    for (const f of files(base)) {
      let content = fs.readFileSync(f);
      if (f.endsWith(".md"))
        content = Buffer.from(
          content.toString().replace(/^(\s*[-*+] )\[[xX ]\]/gm, "$1[ ]"),
        );
      artifacts[path.relative(this.root, f).split(path.sep).join("/")] =
        sha256(content);
    }
    // Preserve OpenSpec adapter 0.1 hash format (Python json.dumps sorted, default separators).
    const ascii = (s: string) =>
      JSON.stringify(s).replace(
        /[\u007f-\uffff]/g,
        (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
      );
    const specHash = sha256(
      "{" +
        Object.keys(artifacts)
          .sort()
          .map((k) => ascii(k) + ": " + ascii(artifacts[k]))
          .join(", ") +
        "}",
    );
    const metadata = path.join(base, ".openspec.yaml");
    return validateContract<ParsedSpecification>("parsed_specification", {
      schema_version: "1.0",
      id: change,
      schema: "spec-driven",
      openspec_version: this.version,
      metadata: exists(metadata)
        ? (parse(fs.readFileSync(metadata, "utf8")) ?? {})
        : {},
      tasks,
      requirements,
      capabilities: [...new Set(requirements.map((r) => r.capability))].sort(),
      artifacts,
      spec_hash: specHash,
      planning_status: status,
      proposal: fs.readFileSync(path.join(base, "proposal.md"), "utf8"),
      design: exists(path.join(base, "design.md"))
        ? fs.readFileSync(path.join(base, "design.md"), "utf8")
        : null,
    });
  }
  syncTasks(
    change: string,
    acceptedTaskIds: string[],
    expectedSpecHash?: string,
  ): { change: string; accepted_task_ids: string[]; updated: string[] } {
    const model = this.load(change);
    if (expectedSpecHash && model.spec_hash !== expectedSpecHash)
      throw new PolicyError("Specification changed since execution");
    const accepted = new Set(acceptedTaskIds),
      known = new Set(model.tasks.map((t) => t.id));
    if ([...accepted].some((id) => !known.has(id)))
      throw new PolicyError("Unknown source task");
    const contents = new Map<string, string[]>();
    for (const task of model.tasks) {
      if (!task.sourcePath || !task.line)
        throw new PolicyError("Official source location missing");
      const rel = path.relative(
        this.root,
        path.resolve(this.root, task.sourcePath),
      );
      const f = safePath(this.root, rel);
      if (!f.startsWith(this.changePath(change) + path.sep))
        throw new PolicyError("Task outside change");
      let lines = contents.get(f);
      if (!lines) {
        lines = fs.readFileSync(f, "utf8").split(/(?<=\n)/);
        contents.set(f, lines);
      }
      const i = task.line - 1;
      const match = /^(\s*[-*+] )\[([xX ])\](\s+)(.*?)(\r?\n)?$/.exec(
        lines[i] ?? "",
      );
      if (!match || match[4].trim() !== task.text.trim())
        throw new PolicyError(
          "Task source changed; reload official instructions",
        );
      lines[i] =
        `${match[1]}[${accepted.has(task.id) ? "x" : " "}]${match[3]}${match[4]}${match[5] ?? ""}`;
    }
    for (const [f, lines] of contents) atomicWrite(f, lines.join(""));
    return {
      change,
      accepted_task_ids: [...accepted].sort(),
      updated: [...contents.keys()].map((f) => path.relative(this.root, f)),
    };
  }
  prepareArchive(
    change: string,
    options: {
      allAccepted?: boolean;
      integrationPassed?: boolean;
      gatePassed?: boolean;
    } = {},
  ): {
    change: string;
    ready: boolean;
    blockers: string[];
    operations: string[];
    archive_argv: string[];
    executed: false;
  } {
    const validation = this.validate(change),
      blockers: string[] = [];
    if (!validation.valid) blockers.push("OPENSPEC_INVALID");
    if (!options.allAccepted) blockers.push("UNACCEPTED_UNITS");
    if (!options.integrationPassed) blockers.push("INTEGRATION_NOT_PASSED");
    if (!options.gatePassed) blockers.push("AUTHORITY_GATE_NOT_PASSED");
    return {
      change,
      ready: !blockers.length,
      blockers,
      operations: [
        "Use official openspec-sync-specs skill to synchronize only, or archive command to synchronize and archive",
      ],
      archive_argv: ["openspec", "archive", change],
      executed: false,
    };
  }
}
