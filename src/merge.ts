import fs from "node:fs";
import type { Hashes, Patch, MergeResult } from "./types.js";
import {
  atomicJson,
  atomicWrite,
  fileHash,
  readJson,
  safePath,
  sha256,
  PolicyError,
} from "./util.js";
interface Journal {
  unit: string;
  patch: Patch;
  base: Hashes;
  target: Hashes;
  originals: Patch;
  status: "PREPARED" | "COMMITTED";
}
export class MergeCoordinator {
  constructor(
    private readonly workspace: string,
    private readonly journal: string,
  ) {}
  integrate(unit: string, patch: Patch, base: Hashes): MergeResult {
    const target: Hashes = Object.fromEntries(
      Object.entries(patch).map(([p, c]) => [p, c === null ? null : sha256(c)]),
    );
    const originals: Patch = {};
    for (const p of Object.keys(patch)) {
      const dest = safePath(this.workspace, p),
        current = fileHash(dest);
      if (current !== (base[p] ?? null) && current !== target[p])
        throw new PolicyError(`Integration conflict: ${p}`);
      originals[p] = current === null ? null : fs.readFileSync(dest, "utf8");
    }
    atomicJson(this.journal, {
      unit,
      patch,
      base: Object.fromEntries(
        Object.keys(patch).map((p) => [p, base[p] ?? null]),
      ),
      target,
      originals,
      status: "PREPARED",
    } satisfies Journal);
    return this.recover();
  }
  recover(): MergeResult {
    const record = readJson<Journal>(this.journal);
    for (const [p, target] of Object.entries(record.target)) {
      const current = fileHash(safePath(this.workspace, p));
      if (current !== (record.base[p] ?? null) && current !== target)
        throw new PolicyError(`Merge journal conflict: ${p}`);
    }
    for (const [p, content] of Object.entries(record.patch)) {
      const dest = safePath(this.workspace, p);
      if (fileHash(dest) === record.target[p]) continue;
      if (content === null) fs.rmSync(dest, { force: true });
      else atomicWrite(dest, content);
    }
    record.status = "COMMITTED";
    atomicJson(this.journal, record);
    return {
      schema_version: "1.0",
      unit: record.unit,
      passed: true,
      status: "COMMITTED",
      files: Object.keys(record.patch),
      hashes: record.target,
      originals: record.originals,
    };
  }
}
