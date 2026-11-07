import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Hashes } from "./types.js";
export class PolicyError extends Error {
  override name = "PolicyError";
}
export class TimeoutError extends Error {
  override name = "TimeoutError";
}
export const now = (): number => Date.now() / 1000;
export function canonical(value: unknown): string {
  function sorted(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sorted);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
      );
    if (typeof v === "number" && !Number.isFinite(v))
      throw new PolicyError("Non-finite JSON number");
    return v;
  }
  const text = JSON.stringify(sorted(value));
  if (text === undefined) throw new PolicyError("Not a JSON value");
  return text;
}
export const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");
export const digest = (value: unknown): string => sha256(canonical(value));
export function fileHash(file: string): string | null {
  try {
    return fs.statSync(file).isFile() ? sha256(fs.readFileSync(file)) : null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(file, "utf8")) as T;
export function atomicWrite(file: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.lgo-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
  }
}
export const atomicJson = (file: string, value: unknown): void =>
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
export function safePath(root: string, relative: string): string {
  if (
    !relative ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.split("/").includes("..") ||
    relative.includes("\\") ||
    relative.includes("\0")
  )
    throw new PolicyError(`Unsafe path: ${relative}`);
  const base = path.resolve(root);
  let current = base;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (exists(current) && fs.lstatSync(current).isSymbolicLink())
      throw new PolicyError(`Symlink rejected: ${relative}`);
  }
  const target = path.resolve(base, relative);
  if (target !== base && !target.startsWith(base + path.sep))
    throw new PolicyError("Path escapes workspace");
  return target;
}
// Glob semantics deliberately preserve Python fnmatch: '*' may span '/'.
export function matches(file: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    let re = "^";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "*") re += ".*";
      else if (c === "?") re += ".";
      else if (c === "[") {
        const end = pattern.indexOf("]", i + 1);
        if (end < 0) re += "\\[";
        else {
          let cl = pattern.slice(i + 1, end);
          if (cl.startsWith("!")) cl = "^" + cl.slice(1);
          re += "[" + cl + "]";
          i = end;
        }
      } else re += c.replace(/[\\^$+.(){}|]/g, "\\$&");
    }
    return (
      new RegExp(re + "$", "u").test(file) ||
      (pattern.endsWith("/**") && file.startsWith(pattern.slice(0, -3) + "/"))
    );
  });
}
const PROTECTED = new Set([
  ".lgo",
  "openspec",
  ".git",
  "verification",
  ".env",
  "secrets",
  "node_modules",
  ".venv",
]);
export function permitted(file: string, scope: string[]): boolean {
  if (file.split("/").some((p) => PROTECTED.has(p) || p.startsWith(".env")))
    return false;
  return matches(file, scope);
}
export function files(root: string): string[] {
  if (!exists(root)) return [];
  const result: string[] = [];
  function visit(dir: string) {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const p = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(p);
      else if (entry.isFile()) result.push(p);
    }
  }
  visit(root);
  return result.sort();
}
export const snapshot = (root: string): Hashes =>
  Object.fromEntries(
    files(root).map((p) => [
      path.relative(root, p).split(path.sep).join("/"),
      fileHash(p),
    ]),
  );
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Cancelled", "AbortError");
}
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
