import fs from "node:fs";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parse } from "yaml";
import type {
  ApprovalToken,
  GateDecision,
  Verdict,
  ExecutionManifest,
  WorkUnit,
  Policy,
  Risk,
} from "./types.js";
import {
  PolicyError,
  canonical,
  digest,
  exists,
  matches,
  now,
} from "./util.js";
export function decision(
  verdict: Verdict,
  reason: string,
  unit: string | null = null,
  evidence: GateDecision["evidence"] = [],
  policy = "default",
  nextAction?: string,
): GateDecision {
  return {
    schema_version: "1.0",
    verdict,
    reason,
    unit,
    evidence,
    policy,
    next_action: nextAction ?? verdict.toLowerCase(),
  };
}
export class ApprovalAuthority {
  private readonly key: Buffer;
  constructor(keyFile: string, project: string) {
    const file = fs.realpathSync(keyFile),
      base = path.resolve(project);
    if (file === base || file.startsWith(base + path.sep))
      throw new PolicyError("Authority key must be outside project");
    if (fs.statSync(file).mode & 0o077)
      throw new PolicyError("Authority key must have permissions 0600");
    this.key = fs.readFileSync(file);
    if (this.key.length < 32)
      throw new PolicyError("Authority key needs at least 32 bytes");
  }
  sign(payload: ApprovalToken["payload"]): ApprovalToken {
    return {
      payload,
      signature: createHmac("sha256", this.key)
        .update(canonical(payload))
        .digest("hex"),
    };
  }
  verify(token: unknown, binding: string, action: string): boolean {
    try {
      const t = token as ApprovalToken;
      if (
        !t ||
        typeof t !== "object" ||
        typeof t.signature !== "string" ||
        !/^[a-f0-9]{64}$/.test(t.signature)
      )
        return false;
      const expected = this.sign(t.payload).signature;
      return (
        timingSafeEqual(
          Buffer.from(expected, "hex"),
          Buffer.from(t.signature, "hex"),
        ) &&
        t.payload.binding === binding &&
        t.payload.action === action &&
        Number.isFinite(t.payload.expires_at) &&
        t.payload.expires_at > now() &&
        typeof t.payload.actor === "string" &&
        t.payload.actor.trim().length > 0
      );
    } catch {
      return false;
    }
  }
}
export class GateEngine {
  policy: Policy = {
    schema_version: "1.0",
    high_risk_paths: [],
    medium_requires_approval: false,
    max_files_per_patch: 100,
  };
  constructor(readonly authority?: ApprovalAuthority) {}
  configure(file: string): void {
    if (!exists(file)) return;
    const data: unknown = parse(fs.readFileSync(file, "utf8"));
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).some((k) => !Object.hasOwn(this.policy, k)) ||
      (data as Policy).schema_version !== "1.0"
    )
      throw new PolicyError("Invalid policies configuration");
    const next = { ...this.policy, ...data } as Policy;
    if (
      typeof next.medium_requires_approval !== "boolean" ||
      !Number.isInteger(next.max_files_per_patch) ||
      next.max_files_per_patch < 1 ||
      !Array.isArray(next.high_risk_paths) ||
      next.high_risk_paths.some((p) => typeof p !== "string" || !p)
    )
      throw new PolicyError("Invalid policies types");
    this.policy = next;
  }
  effectiveRisk(unit: WorkUnit, paths = unit.file_scope): Risk {
    const high = new Set([
      "auth",
      "authentication",
      "authorization",
      "migrations",
      "infrastructure",
      "production",
      "payments",
      "financial",
      "secrets",
      ".github",
    ]);
    if (unit.risk === "MEDIUM" && this.policy.medium_requires_approval)
      return "HIGH";
    if (
      paths.some(
        (p) =>
          matches(p, this.policy.high_risk_paths) ||
          p.split("/").some((s) => high.has(s.toLowerCase())),
      )
    )
      return "HIGH";
    return unit.risk;
  }
  authorize(
    run: ExecutionManifest,
    unit?: WorkUnit,
    token?: unknown,
    action = "execute",
  ): GateDecision {
    if (unit && this.effectiveRisk(unit) !== "HIGH")
      return decision(
        "PASS",
        "Reversible local patch within configured policy",
        unit.id,
      );
    const binding = digest({
      authority_domain: "lgo-typescript-0.2",
      run_id: run.id,
      graph: run.graph,
      unit: unit?.id ?? null,
      evidence: run.evidence_digest ?? null,
      policy_hash: run.policy_hash,
    });
    if (
      this.authority &&
      token &&
      this.authority.verify(token, binding, action)
    )
      return decision(
        "PASS",
        "External authority signature verified",
        unit?.id ?? null,
        [],
        "external-authority",
      );
    const d = decision(
      "HUMAN_APPROVAL_REQUIRED",
      "External authority approval required",
      unit?.id ?? null,
      [],
      "blast-radius",
      "obtain signed approval from operator/service",
    );
    d.approval_request = {
      binding,
      action,
      run_id: run.id,
      unit: unit?.id ?? null,
    };
    return d;
  }
  quality(run: ExecutionManifest): GateDecision {
    if (
      !Object.keys(run.nodes).length ||
      Object.values(run.nodes).some(
        (n) => n.state !== "PASSED" || !n.verified || !n.integrated,
      )
    )
      return decision(
        "FAIL",
        "Not all units verified and integrated",
        null,
        [],
        "quality",
      );
    if (!run.integration.passed)
      return decision(
        "FAIL",
        "Integration checks absent or failing",
        null,
        [],
        "quality",
      );
    return decision(
      "PASS",
      "Unit and integration evidence available",
      null,
      [run.evidence_digest ?? null],
      "quality",
    );
  }
}
