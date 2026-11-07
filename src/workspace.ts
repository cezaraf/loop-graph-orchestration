import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Config, WorkUnit } from "./types.js";
import {
  PolicyError,
  exists,
  files,
  digest,
  permitted,
  safePath,
  snapshot,
} from "./util.js";
const EXCLUDE = new Set([
  ".lgo",
  ".git",
  ".venv",
  "node_modules",
  "target",
  "dist",
  ".angular",
  ".cache",
  "__pycache__",
  ".pytest_cache",
]);
export function copyWorkspace(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  function copy(src: string, dest: string) {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (
        EXCLUDE.has(e.name) ||
        e.name.startsWith(".env") ||
        e.name === "secrets" ||
        e.isSymbolicLink()
      )
        continue;
      const s = path.join(src, e.name),
        d = path.join(dest, e.name);
      if (e.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        copy(s, d);
      } else if (e.isFile()) fs.copyFileSync(s, d);
    }
  }
  copy(source, destination);
}
export function validateConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PolicyError("Configuration must be an object");
  const c = value as Config;
  if (c.schema_version !== "1.0")
    throw new PolicyError("Unsupported configuration version");
  if (
    !Number.isInteger(c.concurrency ?? 3) ||
    (c.concurrency ?? 3) < 1 ||
    (c.concurrency ?? 3) > 32
  )
    throw new PolicyError("concurrency must be 1..32");
  if (
    c.allow_process_agents !== undefined &&
    typeof c.allow_process_agents !== "boolean"
  )
    throw new PolicyError("allow_process_agents must be boolean");
  for (const list of [c.allowed_agent_endpoints ?? [], c.protected_paths ?? []])
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string"))
      throw new PolicyError("Expected string list");
  if (
    !Number.isInteger(c.max_patch_bytes ?? 1048576) ||
    (c.max_patch_bytes ?? 1048576) < 1 ||
    (c.max_patch_bytes ?? 1048576) > 100 * 2 ** 20
  )
    throw new PolicyError("Invalid max_patch_bytes");
  if (
    c.commands &&
    (!c.commands || typeof c.commands !== "object" || Array.isArray(c.commands))
  )
    throw new PolicyError("commands must be a map");
  for (const cmd of Object.values(c.commands ?? {}))
    if (
      !cmd ||
      !Array.isArray(cmd.argv) ||
      !cmd.argv.length ||
      cmd.argv.some((x) => typeof x !== "string") ||
      !Number.isFinite(cmd.timeout_seconds ?? 30) ||
      (cmd.timeout_seconds ?? 30) <= 0
    )
      throw new PolicyError("Command requires argv and positive timeout");
  return c;
}
export function loadConfig(root: string): Config {
  const file = safePath(root, ".lgo/config.yaml");
  return exists(file)
    ? validateConfig(parse(fs.readFileSync(file, "utf8")))
    : { schema_version: "1.0", concurrency: 3, commands: {} };
}
export function sourceFingerprint(root: string): string {
  const result: Record<string, string> = {};
  for (const prefix of [
    ".lgo/config.yaml",
    ".lgo/policies.yaml",
    "verification",
    "openspec",
  ]) {
    const p = safePath(root, prefix);
    const entries = exists(p) ? (fs.statSync(p).isFile() ? [p] : files(p)) : [];
    for (const f of entries) {
      let text = fs.readFileSync(f, "utf8");
      if (path.basename(f) === "tasks.md")
        text = text.replace(/^(\s*-\s+)\[[ xX]\]/gm, "$1[ ]");
      result[path.relative(root, f).split(path.sep).join("/")] = digest(text);
    }
  }
  return digest(result);
}
export function buildContext(
  workspace: string,
  unit: WorkUnit,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const p of Object.keys(snapshot(workspace))) {
    if (
      !(permitted(p, unit.file_scope) || unit.inputs.includes(p)) ||
      p.split("/").some((x) => x.startsWith(".env") || x === "secrets")
    )
      continue;
    const f = safePath(workspace, p);
    if (fs.statSync(f).size >= 100000) continue;
    try {
      result[p] = new TextDecoder("utf-8", { fatal: true }).decode(
        fs.readFileSync(f),
      );
    } catch {
      continue;
    }
  }
  return result;
}
