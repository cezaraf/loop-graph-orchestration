import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StateStore, STORE_VERSION } from "./state.js";
import type { ExecutionManifest } from "./types.js";
import { GateEngine } from "./gates.js";
import { loadConfig, sourceFingerprint } from "./workspace.js";
import { validateContract } from "./contracts.js";
import {
  PolicyError,
  digest,
  sha256,
  safePath,
  fileHash,
  exists,
  now,
} from "./util.js";
interface MigrationResult {
  dry_run: boolean;
  from: number;
  to: number;
  runs: number;
  preserved_passed_units: number;
  backup?: string;
  changed: boolean;
}
async function legacyLock(root: string): Promise<() => Promise<void>> {
  const lock = safePath(root, ".lgo/scheduler.lock");
  if (!exists(lock)) return async () => {};
  if (!fs.statSync(lock).isFile())
    throw new PolicyError("Legacy lock is not a file");
  // A small OS helper interoperates with Python fcntl; it is needed only for legacy migration.
  const p = spawn(
    "flock",
    [
      "--exclusive",
      "--nonblock",
      lock,
      process.execPath,
      "-e",
      "process.stdout.write('LOCKED\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));",
    ],
    { stdio: ["pipe", "pipe", "pipe"], shell: false },
  );
  await new Promise<void>((resolve, reject) => {
    let got = false;
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new PolicyError("Legacy lock timeout"));
    }, 5000);
    p.once("error", (e) => {
      clearTimeout(timer);
      reject(
        new PolicyError(`Legacy migration requires POSIX flock: ${e.message}`),
      );
    });
    p.stdout.once("data", (data) => {
      clearTimeout(timer);
      if (data.toString().trim() === "LOCKED") {
        got = true;
        resolve();
      } else reject(new PolicyError("Unexpected legacy lock response"));
    });
    p.once("exit", () => {
      clearTimeout(timer);
      if (!got)
        reject(
          new PolicyError(
            "Python scheduler is active; stop it before migrating",
          ),
        );
    });
  });
  return () =>
    new Promise<void>((resolve) => {
      p.once("exit", () => resolve());
      p.stdin.end();
    });
}
export async function migrateState(
  project: string,
  options: { fromPython: boolean; dryRun?: boolean },
): Promise<MigrationResult> {
  if (!options.fromPython)
    throw new PolicyError("Explicit --from-python is required");
  const root = path.resolve(project),
    file = safePath(root, ".lgo/state.sqlite");
  if (!exists(file)) throw new PolicyError("No state store to migrate");
  const release = await legacyLock(root);
  try {
    const source = new DatabaseSync(file, { readOnly: true });
    try {
      const version = Number(
        (
          source.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      );
      if (version === STORE_VERSION)
        return {
          dry_run: options.dryRun ?? false,
          from: version,
          to: version,
          runs: 0,
          preserved_passed_units: 0,
          changed: false,
        };
      if (version !== 0)
        throw new PolicyError("Unsupported legacy store version");
      let prev = "0".repeat(64);
      for (const row of source
        .prepare("SELECT data,prev,hash FROM events ORDER BY seq")
        .all() as { data: string; prev: string; hash: string }[]) {
        if (row.prev !== prev || sha256(prev + row.data) !== row.hash)
          throw new PolicyError("Legacy audit history corrupted");
        prev = row.hash;
      }
      const config = loadConfig(root),
        gate = new GateEngine();
      gate.configure(path.join(root, ".lgo/policies.yaml"));
      const runs = (
        source.prepare("SELECT data FROM runs").all() as { data: string }[]
      ).map((row) =>
        validateContract<ExecutionManifest>(
          "execution_manifest",
          JSON.parse(row.data),
        ),
      );
      let passed = 0;
      for (const run of runs) {
        if (
          digest(run.graph) !== run.graph_hash ||
          digest({ config, policy: gate.policy }) !== run.policy_hash ||
          sourceFingerprint(root) !== run.source_fingerprint
        )
          throw new PolicyError(
            "Legacy plan/policy/spec hash differs; reconcile before migrating",
          );
        const latest = new Map<string, string | null>();
        for (const n of Object.values(run.nodes).sort(
          (a, b) => (a.finished_at ?? 0) - (b.finished_at ?? 0),
        ))
          if (n.state === "PASSED") {
            passed++;
            for (const [p, h] of Object.entries(n.merge?.hashes ?? {}))
              latest.set(p, h);
          }
        for (const [p, h] of latest)
          if (fileHash(safePath(run.workspace, p)) !== h)
            throw new PolicyError(`Legacy accepted result tampered: ${p}`);
      }
      const result: MigrationResult = {
        dry_run: options.dryRun ?? false,
        from: 0,
        to: STORE_VERSION,
        runs: runs.length,
        preserved_passed_units: passed,
        changed: !options.dryRun,
      };
      if (options.dryRun) return result;
      const backupFile = safePath(
        root,
        `.lgo/backups/state-python-${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`,
      );
      fs.mkdirSync(path.dirname(backupFile), { recursive: true, mode: 0o700 });
      await backup(source, backupFile);
      fs.chmodSync(backupFile, 0o600);
      result.backup = backupFile;
      const store = new StateStore(path.join(root, ".lgo"), {
        allowLegacy: true,
      });
      try {
        const lease = store.acquire();
        try {
          store.transaction(() => {
            for (const run of runs) {
              run.state = "PAUSED";
              run.integration = { passed: false };
              run.gates = [];
              delete run.evidence_digest;
              run.updated_at = now();
              store.save(run);
              store.event(run.id, "state_migration", {
                reason:
                  "Python 0.1 -> TypeScript 0.2; accepted patches retained; gates and integration require revalidation",
              });
            }
            store.db.exec(`PRAGMA user_version=${STORE_VERSION}`);
          });
        } finally {
          lease();
        }
      } finally {
        store.close();
      }
      return result;
    } finally {
      source.close();
    }
  } finally {
    await release();
  }
}
