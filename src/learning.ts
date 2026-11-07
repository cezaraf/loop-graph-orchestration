import type {
  ExecutionManifest,
  LearningCandidate,
  ApprovalToken,
  CorrectionRequest,
} from "./types.js";
import { StateStore } from "./state.js";
import { GateEngine } from "./gates.js";
import { PolicyError, digest, canonical } from "./util.js";
export class LearningEngine {
  constructor(
    private readonly store: StateStore,
    private readonly gate: GateEngine,
  ) {}
  propose(run: ExecutionManifest): LearningCandidate[] {
    if (this.gate.quality(run).verdict !== "PASS")
      throw new PolicyError("Learning requires validated integration");
    const failures = this.store
      .events(run.id)
      .filter((e) => e.kind === "correction");
    if (!failures.length) return [];
    const finding =
        "A localized verification failure was corrected without rerunning independent passed units.",
      affected = new Set(failures.map((e) => e.unit as string)),
      scopes = [
        ...new Set(
          run.graph.units
            .filter((u) => affected.has(u.id))
            .flatMap((u) => u.file_scope),
        ),
      ].sort();
    if (!scopes.length) throw new PolicyError("No scoped correction evidence");
    const scope = scopes[0];
    const rule: LearningCandidate = {
      schema_version: "1.0",
      id:
        "learning-" +
        digest({ change: run.graph.change_id, finding, scope }).slice(0, 12),
      finding,
      root_cause: "An implementation violated an external acceptance oracle.",
      kind: "resource_constraint",
      category: "Constraint",
      target: "graph-planner",
      status: "PROPOSED",
      version: 1,
      constraint: {
        scope,
        resource: "contract-review-" + digest(scope).slice(0, 8),
      },
      evidence: {
        run_id: run.id,
        evidence_digest: run.evidence_digest!,
        corrections: failures.length,
      },
      applicability: `Only projects with ${scope} and the same oracle family; proposed serialization is a conservative experiment, not a proven causal fix.`,
      regressions: [],
      revoked: false,
    };
    const existing = this.store.rules().find((r) => r.id === rule.id);
    if (existing) return [existing];
    this.store.saveRule(rule);
    this.store.event(run.id, "learning_proposed", { candidate: rule.id });
    return [rule];
  }
  promote(
    run: ExecutionManifest,
    ruleId: string,
    token: ApprovalToken,
    regressionRunIds: string[],
  ): LearningCandidate {
    const rule = this.store.rules().find((r) => r.id === ruleId);
    if (!rule || rule.status !== "PROPOSED")
      throw new PolicyError("Only proposed candidates can be promoted");
    const ids = [...new Set(regressionRunIds)].sort();
    if (ids.length < 2 || !ids.includes(rule.evidence.run_id))
      throw new PolicyError(
        "Generalization needs two validated regression runs",
      );
    for (const id of ids) {
      const r = this.store.get(id);
      if (this.gate.quality(r).verdict !== "PASS")
        throw new PolicyError("Regression run not accepted");
      if (r.graph.change_id !== run.graph.change_id)
        throw new PolicyError("Regression applicability mismatch");
      if (
        id !== rule.evidence.run_id &&
        !r.graph.applied_rules?.some(
          (a) => a.id === rule.id && a.version === rule.version,
        )
      )
        throw new PolicyError(
          "Regression must exercise candidate constraint in an isolated trial plan",
        );
    }
    const binding = digest({
      authority_domain: "lgo-typescript-0.2",
      rule,
      regressions: ids,
    });
    if (!this.gate.authority?.verify(token, binding, "promote-learning"))
      throw new PolicyError("External signed rule approval required");
    for (const other of this.store.rules())
      if (
        other.status === "ACTIVE" &&
        other.constraint.scope === rule.constraint.scope &&
        canonical(other.constraint) !== canonical(rule.constraint)
      )
        throw new PolicyError(
          "Contradictory constraint requires explicit resolution",
        );
    Object.assign(rule, {
      status: "ACTIVE",
      version: rule.version + 1,
      regressions: ids,
      approval_actor: token.payload.actor,
    });
    this.store.saveRule(rule);
    this.store.event(run.id, "learning_promoted", {
      candidate: rule.id,
      version: rule.version,
    });
    return rule;
  }
  revoke(
    run: ExecutionManifest,
    id: string,
    token: ApprovalToken,
  ): LearningCandidate {
    const rule = this.store.rules().find((r) => r.id === id);
    if (!rule) throw new PolicyError("Unknown learning candidate");
    if (
      !this.gate.authority?.verify(
        token,
        digest({ authority_domain: "lgo-typescript-0.2", rule }),
        "revoke-learning",
      )
    )
      throw new PolicyError("Signed revocation required");
    Object.assign(rule, {
      status: "REVOKED",
      revoked: true,
      version: rule.version + 1,
    });
    this.store.saveRule(rule);
    this.store.event(run.id, "learning_revoked", { candidate: id });
    return rule;
  }
}
export type LearningCorrection = CorrectionRequest;
