export type Risk = "LOW" | "MEDIUM" | "HIGH";
export type UnitState =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "VERIFYING"
  | "PASSED"
  | "FAILED"
  | "RETRYING"
  | "BLOCKED"
  | "INVALIDATED"
  | "CANCELLED"
  | "WAITING_APPROVAL";
export type RunState =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED"
  | "WAITING_APPROVAL"
  | "ACCEPTED";
export type Verdict =
  "PASS" | "FAIL" | "RETRY" | "REPLAN" | "BLOCKED" | "HUMAN_APPROVAL_REQUIRED";
export type FailureClass =
  | "TEST_FAILURE"
  | "PLANNING_FAILURE"
  | "SPECIFICATION_FAILURE"
  | "ENVIRONMENT_FAILURE"
  | "TRANSIENT_FAILURE"
  | "POLICY_VIOLATION";
export type Patch = Record<string, string | null>;
export type Hashes = Record<string, string | null>;
export interface Budget {
  max_cost: number;
  max_tokens: number;
}
export type Verifier =
  | { kind: "command"; command: string; timeout_seconds?: number }
  | { kind: "file_contains"; path: string; contains: string }
  | {
      kind: "json_schema";
      path: string;
      schema?: Record<string, unknown>;
      schema_path?: string;
    }
  | { kind: "equal_files"; left: string; right: string }
  | { kind: "no_duplicates"; path: string }
  | { kind: "ci"; check: string; revision: string }
  | { kind: "human" };
export interface MockAttempt {
  files?: Patch;
  delay_seconds?: number;
  raise?: string;
  usage?: { cost: number; tokens: number };
}
export interface AgentConfig {
  adapter: string;
  profile?: string;
  attempts?: MockAttempt[];
  config?: Record<string, unknown>;
}
export interface WorkUnit {
  id: string;
  objective: string;
  task_id: string;
  requirement_ids: string[];
  inputs: string[];
  outputs: string[];
  dependencies: { unit: string; reason: string }[];
  resources: string[];
  file_scope: string[];
  acceptance: string[];
  verifiers: Verifier[];
  agent: AgentConfig;
  risk: Risk;
  timeout_seconds: number;
  budget: Budget;
  max_attempts: number;
  priority?: number;
}
export interface ExecutionGraph {
  schema_version: "1.0";
  change_id: string;
  spec_hash: string;
  units: WorkUnit[];
  integration_verifiers: Verifier[];
  external_inputs?: string[];
  applied_rules?: { id: string; version: number }[];
  metadata?: Record<string, unknown>;
}
export interface Requirement {
  id: string;
  name: string;
  text: string;
  scenarios: { name?: string; rawText: string }[];
  capability: string;
  operation: "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";
  rename?: { from: string; to: string };
}
export interface SourceTask {
  id: string;
  official_id?: string;
  text: string;
  checked: boolean;
  sourcePath?: string;
  line?: number;
}
export interface ParsedSpecification {
  schema_version: "1.0";
  id: string;
  schema: "spec-driven";
  openspec_version: string;
  metadata: Record<string, unknown>;
  tasks: SourceTask[];
  requirements: Requirement[];
  capabilities: string[];
  artifacts: Record<string, string>;
  spec_hash: string;
  planning_status: Record<string, unknown>;
  proposal: string;
  design: string | null;
}
export interface AgentRequest {
  schema_version: "1.0";
  run_id: string;
  unit_id: string;
  objective: string;
  attempt: number;
  idempotency_key: string;
  allowed_scope: string[];
  requirements: string[];
  inputs: Record<string, string>;
  budget: Budget;
  correction: CorrectionRequest | null;
  instruction: string;
}
export interface AgentResult {
  schema_version: "1.0";
  files: Patch;
  usage: { cost: number; tokens: number };
  summary: string;
  idempotency_key: string;
}
export interface AgentAdapter {
  readonly idempotent: boolean;
  execute(request: AgentRequest, signal?: AbortSignal): Promise<AgentResult>;
}
export interface VerificationResult {
  schema_version: "1.0";
  kind: string;
  passed: boolean;
  failure_class: FailureClass | null;
  evidence: Record<string, unknown>;
  duration_seconds: number;
}
export interface VerificationReport {
  passed: boolean;
  results: VerificationResult[];
}
export interface CorrectionRequest {
  schema_version: "1.0";
  unit_id: string;
  verdict: "FAIL";
  failure_class: FailureClass;
  reason: string;
  evidence: VerificationResult[];
  scope: { allowed: string[]; forbidden: string[] };
  remaining_attempts: number;
  remaining_budget: Budget;
  next_action: "CORRECT" | "REPLAN";
}
export interface MergeResult {
  schema_version: "1.0";
  unit: string;
  passed: boolean;
  status: "COMMITTED";
  files: string[];
  hashes: Hashes;
  originals?: Patch;
}
export interface ApprovalRequest {
  binding: string;
  action: string;
  run_id: string;
  unit: string | null;
}
export interface ApprovalToken {
  payload: {
    binding: string;
    action: string;
    expires_at: number;
    actor: string;
    [key: string]: unknown;
  };
  signature: string;
}
export interface GateDecision {
  schema_version: "1.0";
  verdict: Verdict;
  reason: string;
  unit: string | null;
  evidence: (Record<string, unknown> | string | null)[];
  policy: string;
  next_action: string;
  approval_request?: ApprovalRequest;
}
export interface AttemptEvidence {
  attempt: number;
  verification: VerificationReport;
  patch_hash: string;
  duration_seconds: number;
  usage: { cost: number; tokens: number };
  failure_fingerprint?: string;
}
export interface NodeExecution {
  state: UnitState;
  attempts: number;
  history: AttemptEvidence[];
  cost: number;
  tokens: number;
  integrated: boolean;
  verified?: boolean;
  merge?: MergeResult;
  correction?: CorrectionRequest;
  pending_patch?: Patch;
  last_evidence?: string;
  reason?: string;
  finished_at?: number;
  ready_at?: number;
  started_at?: number;
}
export interface ExecutionManifest {
  schema_version: "1.0";
  id: string;
  graph: ExecutionGraph;
  graph_hash: string;
  policy_hash: string;
  source_fingerprint: string;
  state: RunState;
  created_at: number;
  updated_at?: number;
  workspace: string;
  nodes: Record<string, NodeExecution>;
  integration: { passed: boolean; results?: VerificationResult[] };
  gates: GateDecision[];
  evidence_digest?: string;
  source_snapshot?: Hashes;
}
export interface ExecutionEvent {
  schema_version: "1.0";
  run_id: string;
  kind: string;
  timestamp: number;
  [key: string]: unknown;
}
export interface LearningCandidate {
  schema_version: "1.0";
  id: string;
  finding: string;
  root_cause: string;
  kind: "resource_constraint";
  category: "Constraint";
  target: string;
  status: "PROPOSED" | "ACTIVE" | "REVOKED";
  version: number;
  constraint: { scope: string; resource: string };
  evidence: { run_id: string; evidence_digest: string; corrections: number };
  applicability: string;
  regressions: string[];
  revoked: boolean;
  approval_actor?: string;
}
export interface CommandConfig {
  argv: string[];
  timeout_seconds?: number;
  write_scope?: string[];
}
export interface Config {
  schema_version: "1.0";
  concurrency?: number;
  commands?: Record<string, CommandConfig>;
  allow_process_agents?: boolean;
  max_patch_bytes?: number;
  retention_days?: number;
  protected_paths?: string[];
  agent_commands?: Record<string, string[]>;
  agent_endpoints?: Record<string, string>;
  allowed_agent_endpoints?: string[];
  ci_results?: Record<string, { conclusion: string; revision: string }>;
}
export interface Policy {
  schema_version: "1.0";
  high_risk_paths: string[];
  medium_requires_approval: boolean;
  max_files_per_patch: number;
}
