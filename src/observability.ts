import type { ExecutionManifest, CorrectionRequest } from "./types.js";
import { StateStore } from "./state.js";
import { ancestors } from "./graph.js";
export function report(
  store: StateStore,
  run: ExecutionManifest,
): Record<string, unknown> {
  const events = store.events(run.id),
    nodes = run.nodes,
    index = Object.fromEntries(run.graph.units.map((u) => [u.id, u])),
    durations = Object.fromEntries(
      Object.entries(nodes).map(([id, n]) => [
        id,
        n.history.reduce((s, h) => s + h.duration_seconds, 0),
      ]),
    );
  const memo = new Map<string, { duration: number; nodes: string[] }>();
  function critical(id: string): { duration: number; nodes: string[] } {
    let value = memo.get(id);
    if (!value) {
      const best = index[id].dependencies
        .map((d) => critical(d.unit))
        .sort((a, b) => b.duration - a.duration)[0] ?? {
        duration: 0,
        nodes: [],
      };
      value = {
        duration: best.duration + durations[id],
        nodes: [...best.nodes, id],
      };
      memo.set(id, value);
    }
    return value;
  }
  const longest = run.graph.units
    .map((u) => critical(u.id))
    .sort((a, b) => b.duration - a.duration)[0] ?? { duration: 0, nodes: [] };
  const complete = Object.values(nodes).filter(
      (n) => n.started_at && n.finished_at,
    ),
    wall = complete.length
      ? Math.max(...complete.map((n) => n.finished_at!)) -
        Math.min(...complete.map((n) => n.started_at!))
      : 0;
  const preserved = new Set<string>();
  for (const c of events.filter((e) => e.kind === "correction")) {
    const related = ancestors(index, c.unit as string);
    related.add(c.unit as string);
    for (const e of events)
      if (
        e.kind === "transition" &&
        e.state === "PASSED" &&
        e.timestamp < c.timestamp &&
        !related.has(e.unit as string) &&
        nodes[e.unit as string].attempts === 1
      )
        preserved.add(e.unit as string);
  }
  return {
    schema_version: "1.0",
    run_id: run.id,
    state: run.state,
    worker_span_wall_seconds: wall,
    run_elapsed_seconds:
      Math.max(run.created_at, ...events.map((e) => e.timestamp)) -
      run.created_at,
    worker_seconds: Object.values(durations).reduce((a, b) => a + b, 0),
    peak_workers: Math.max(
      0,
      ...events
        .filter((e) => e.kind === "scheduled")
        .map((e) => e.active_workers as number),
    ),
    critical_path: longest.nodes,
    critical_path_worker_seconds: longest.duration,
    bottlenecks: Object.keys(durations)
      .sort((a, b) => durations[b] - durations[a])
      .slice(0, 3),
    first_attempt_pass_rate:
      Object.values(nodes).filter(
        (n) => n.state === "PASSED" && n.attempts === 1,
      ).length / Object.keys(nodes).length,
    attempts: Object.fromEntries(
      Object.entries(nodes).map(([id, n]) => [id, n.attempts]),
    ),
    corrections: events.filter((e) => e.kind === "correction").length,
    replans: events.filter((e) => e.kind === "replan").length,
    invalidations: events.filter((e) => e.kind === "invalidated").length,
    human_interventions_required: events.filter(
      (e) =>
        e.kind === "gate" &&
        (e.decision as { verdict: string }).verdict ===
          "HUMAN_APPROVAL_REQUIRED",
    ).length,
    validated_independent_units_preserved: preserved.size,
    avoided_cost_estimate: null,
    adapter_reported_cost: Object.values(nodes).reduce((s, n) => s + n.cost, 0),
    adapter_reported_tokens: Object.values(nodes).reduce(
      (s, n) => s + n.tokens,
      0,
    ),
    cost_source: run.graph.units.every((u) => u.agent.adapter === "mock")
      ? "mock fixtures"
      : "adapter reports; not billing proof",
    integration_passed: run.integration.passed,
    queue_wait_seconds: Object.fromEntries(
      Object.entries(nodes).map(([id, n]) => [
        id,
        Math.max(0, (n.started_at ?? 0) - (n.ready_at ?? n.started_at ?? 0)),
      ]),
    ),
    failure_classes: events
      .filter((e) => e.kind === "correction")
      .map((e) => (e.feedback as CorrectionRequest).failure_class),
    learning_events: events.filter((e) => e.kind.startsWith("learning_"))
      .length,
  };
}
