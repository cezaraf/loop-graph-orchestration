import type {
  ExecutionGraph,
  ParsedSpecification,
  LearningCandidate,
  WorkUnit,
} from "./types.js";
import { validateContract } from "./contracts.js";
import { PolicyError, matches } from "./util.js";
export function overlaps(a: string, b: string): boolean {
  if (a === b || matches(a, [b]) || matches(b, [a])) return true;
  const prefix = (s: string) =>
    s.split("*")[0].split("?")[0].replace(/\/+$/, "");
  const x = prefix(a),
    y = prefix(b);
  return !x || !y || x.startsWith(y + "/") || y.startsWith(x + "/") || x === y;
}
export function ancestors(
  index: Record<string, WorkUnit>,
  node: string,
): Set<string> {
  const result = new Set<string>();
  function visit(n: string) {
    for (const d of index[n].dependencies) {
      if (!result.has(d.unit)) {
        result.add(d.unit);
        visit(d.unit);
      }
    }
  }
  visit(node);
  return result;
}
export function descendants(graph: ExecutionGraph, node: string): Set<string> {
  const found = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const u of graph.units)
      if (
        !found.has(u.id) &&
        u.dependencies.some((d) => d.unit === node || found.has(d.unit))
      ) {
        found.add(u.id);
        changed = true;
      }
  }
  return found;
}
export function validateGraph(
  value: unknown,
  model?: ParsedSpecification,
): ExecutionGraph {
  const graph = validateContract<ExecutionGraph>("execution_graph", value),
    errors: string[] = [];
  const index = Object.fromEntries(graph.units.map((u) => [u.id, u]));
  if (Object.keys(index).length !== graph.units.length)
    errors.push("Duplicate unit id");
  for (const u of graph.units) {
    for (const p of u.file_scope)
      if (
        p.split("/").includes("..") ||
        p.startsWith("/") ||
        p.includes("\\") ||
        [".lgo", "openspec", ".git", "verification"].some((x) =>
          p.startsWith(x),
        )
      )
        errors.push(`${u.id}: unsafe scope ${p}`);
    for (const d of u.dependencies)
      if (!index[d.unit] || d.unit === u.id)
        errors.push(`${u.id}: missing/self dependency`);
    for (const p of [...u.inputs, ...u.outputs])
      if (p.startsWith("/") || p.includes("\\") || p.split("/").includes(".."))
        errors.push(`${u.id}: unsafe artifact ${p}`);
  }
  if (errors.length) throw new PolicyError(errors.join("; "));
  const visiting = new Set<string>(),
    done = new Set<string>();
  function walk(id: string) {
    if (visiting.has(id)) throw new PolicyError(`DAG cycle at ${id}`);
    if (done.has(id)) return;
    visiting.add(id);
    for (const d of index[id].dependencies) walk(d.unit);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of Object.keys(index)) walk(id);
  const producers = new Map<string, string[]>();
  for (const u of graph.units)
    for (const output of u.outputs)
      producers.set(output, [...(producers.get(output) ?? []), u.id]);
  for (const u of graph.units)
    for (const input of u.inputs) {
      const owners = producers.get(input) ?? [];
      if (!owners.length && !graph.external_inputs?.includes(input))
        errors.push(`${u.id}: input without producer ${input}`);
      if (owners.length > 1) errors.push(`Ambiguous producers: ${input}`);
      for (const owner of owners)
        if (owner !== u.id && !ancestors(index, u.id).has(owner))
          errors.push(`${u.id}: missing dependency on producer ${owner}`);
    }
  for (let i = 0; i < graph.units.length; i++)
    for (const b of graph.units.slice(i + 1)) {
      const a = graph.units[i],
        conflict = a.file_scope.some((x) =>
          b.file_scope.some((y) => overlaps(x, y)),
        ),
        related =
          ancestors(index, a.id).has(b.id) || ancestors(index, b.id).has(a.id),
        locked = a.resources.some((r) => b.resources.includes(r));
      if (conflict && !related && !locked)
        errors.push(
          `Predictable write conflict ${a.id} / ${b.id}; require dependency or resource lock`,
        );
    }
  if (model) {
    const tasks = new Set(model.tasks.map((t) => t.id)),
      reqs = new Set(model.requirements.map((r) => r.id));
    for (const u of graph.units) {
      if (!tasks.has(u.task_id))
        errors.push(`Unknown source task ${u.task_id}`);
      if (u.requirement_ids.some((id) => !reqs.has(id)))
        errors.push(`Unknown requirements ${u.id}`);
    }
    if ([...tasks].some((id) => !graph.units.some((u) => u.task_id === id)))
      errors.push("Tasks without work units");
    if (
      [...reqs].some(
        (id) => !graph.units.some((u) => u.requirement_ids.includes(id)),
      )
    )
      errors.push("Requirements without work units");
  }
  if (!graph.integration_verifiers.length)
    errors.push("Integration oracle required");
  if (errors.length) throw new PolicyError(errors.join("; "));
  return graph;
}
export function buildPlan(
  model: ParsedSpecification,
  bindings: ExecutionGraph,
  rules: LearningCandidate[] = [],
): ExecutionGraph {
  const g = structuredClone(bindings);
  Object.assign(g, {
    schema_version: "1.0",
    change_id: model.id,
    spec_hash: model.spec_hash,
  });
  const producers = new Map<string, string[]>();
  for (const u of g.units)
    for (const output of u.outputs)
      producers.set(output, [...(producers.get(output) ?? []), u.id]);
  for (const u of g.units) {
    u.priority ??= 0;
    for (const input of u.inputs) {
      const owners = producers.get(input) ?? [];
      if (owners.length > 1)
        throw new PolicyError(`Ambiguous producers: ${input}`);
      for (const owner of owners)
        if (owner !== u.id && !u.dependencies.some((d) => d.unit === owner))
          u.dependencies.push({
            unit: owner,
            reason: `Consumes declared artifact ${input} produced by ${owner}`,
          });
    }
  }
  g.applied_rules = [];
  for (const rule of rules)
    if (rule.status === "ACTIVE" && rule.kind === "resource_constraint") {
      for (const u of g.units)
        if (
          u.file_scope.some((p) => overlaps(rule.constraint.scope, p)) &&
          !u.resources.includes(rule.constraint.resource)
        )
          u.resources.push(rule.constraint.resource);
      g.applied_rules.push({ id: rule.id, version: rule.version });
    }
  return validateGraph(g, model);
}
export function mermaid(graph: ExecutionGraph): string {
  const aliases = Object.fromEntries(
    graph.units.map((u, i) => [u.id, `n${i}`]),
  );
  return [
    "flowchart TD",
    ...graph.units.map((u) => `  ${aliases[u.id]}["${u.id}"]`),
    ...graph.units.flatMap((u) =>
      u.dependencies.map((d) => `  ${aliases[d.unit]} --> ${aliases[u.id]}`),
    ),
  ].join("\n");
}
