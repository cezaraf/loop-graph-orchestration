import fs from "node:fs";
import type { AnySchema } from "ajv";
import type {
  Config,
  ExecutionGraph,
  ParsedSpecification,
  Verifier,
  VerificationReport,
  VerificationResult,
  FailureClass,
} from "./types.js";
import { runProcess } from "./adapters.js";
import { validateSchema, validateContract } from "./contracts.js";
import {
  PolicyError,
  TimeoutError,
  digest,
  fileHash,
  safePath,
  snapshot,
  matches,
  readJson,
  exists,
  now,
  throwIfAborted,
} from "./util.js";
export class OracleBuilder {
  static coverage(
    model: ParsedSpecification,
    graph: ExecutionGraph,
  ): Record<string, unknown> {
    return Object.fromEntries(
      model.requirements.map((r) => [
        r.id,
        graph.units
          .filter((u) => u.requirement_ids.includes(r.id))
          .map((u) => ({ unit: u.id, checks: u.verifiers })),
      ]),
    );
  }
}
export class VerificationEngine {
  constructor(private readonly config: Config) {}
  async check(
    verifiers: Verifier[],
    workspace: string,
    signal?: AbortSignal,
  ): Promise<VerificationReport> {
    const results: VerificationResult[] = [];
    for (const v of verifiers) {
      throwIfAborted(signal);
      const started = now();
      let evidence: Record<string, unknown> = {},
        passed = false,
        failure: FailureClass | null = null;
      try {
        switch (v.kind) {
          case "command": {
            const c = this.config.commands?.[v.command];
            if (!c)
              throw new PolicyError(`Command not allowlisted: ${v.command}`);
            const before = snapshot(workspace);
            const r = await runProcess(c.argv, {
              cwd: workspace,
              timeoutSeconds: c.timeout_seconds ?? 30,
              signal,
            });
            evidence = {
              exit_code: r.code,
              stdout: r.stdout,
              stderr: r.stderr,
              command: v.command,
            };
            const after = snapshot(workspace),
              unexpected = [
                ...new Set([...Object.keys(before), ...Object.keys(after)]),
              ].filter(
                (p) =>
                  before[p] !== after[p] && !matches(p, c.write_scope ?? []),
              );
            if (unexpected.length)
              throw new PolicyError(
                `Oracle modified undeclared files: ${unexpected.join(", ")}`,
              );
            passed = r.code === 0;
            break;
          }
          case "file_contains": {
            const f = safePath(workspace, v.path);
            passed =
              exists(f) && fs.readFileSync(f, "utf8").includes(v.contains);
            evidence = {
              path: v.path,
              expected_contains: v.contains,
              actual_sha256: fileHash(f),
            };
            break;
          }
          case "json_schema": {
            const data = readJson<unknown>(safePath(workspace, v.path)),
              schema =
                v.schema ??
                (v.schema_path
                  ? readJson<AnySchema>(safePath(workspace, v.schema_path))
                  : undefined);
            if (!schema) throw new PolicyError("JSON schema missing");
            const issues = validateSchema(schema, data);
            passed = !issues.length;
            evidence = { errors: issues, path: v.path };
            break;
          }
          case "equal_files": {
            const left = safePath(workspace, v.left),
              right = safePath(workspace, v.right);
            passed =
              fileHash(left) !== null &&
              fileHash(right) !== null &&
              fs.readFileSync(left).equals(fs.readFileSync(right));
            evidence = { left: fileHash(left), right: fileHash(right) };
            break;
          }
          case "no_duplicates": {
            const data = readJson<unknown[]>(safePath(workspace, v.path));
            if (!Array.isArray(data))
              throw new PolicyError("Duplicate oracle requires array");
            passed = data.length === new Set(data.map(digest)).size;
            evidence = { count: data.length };
            break;
          }
          case "ci": {
            const report = this.config.ci_results?.[v.check];
            passed = Boolean(
              report &&
              report.conclusion === "success" &&
              report.revision === v.revision,
            );
            evidence = {
              trusted_host_report: report ?? null,
              expected_revision: v.revision,
            };
            break;
          }
          case "human":
            passed = false;
            evidence = {
              reason: "Human evidence requires external GateEngine authority",
            };
            break;
        }
        failure = passed ? null : "TEST_FAILURE";
      } catch (e) {
        if (signal?.aborted) throw signal.reason;
        passed = false;
        failure =
          e instanceof PolicyError
            ? "POLICY_VIOLATION"
            : e instanceof TimeoutError
              ? "ENVIRONMENT_FAILURE"
              : "ENVIRONMENT_FAILURE";
        evidence = { error: e instanceof Error ? e.message : String(e) };
      }
      results.push(
        validateContract<VerificationResult>("verification_result", {
          schema_version: "1.0",
          kind: v.kind,
          passed,
          failure_class: failure,
          evidence,
          duration_seconds: now() - started,
        }),
      );
    }
    return {
      passed: results.length > 0 && results.every((r) => r.passed),
      results,
    };
  }
}
