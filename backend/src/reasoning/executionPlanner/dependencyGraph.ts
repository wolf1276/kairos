// Generic dependency-graph validation and deterministic topological sort. Used by the planner to
// order PlanSteps, and independently testable against synthetic graphs (including cyclic ones)
// to prove circular-dependency detection without needing a real ExecutionPlan.
export interface DependencyNode {
  id: string;
  dependsOn: string[];
}

export interface TopologicalSortResult {
  ok: boolean;
  order: string[];
  errors: string[];
}

/**
 * Deterministic topological sort (Kahn's algorithm with a stable tie-break on node id) — the same
 * set of nodes/edges always produces the same order, regardless of input array order. Detects
 * circular dependencies and references to nonexistent nodes; both fail closed (`ok: false`).
 */
export function topologicalSort(nodes: DependencyNode[]): TopologicalSortResult {
  const errors: string[] = [];
  const ids = new Set(nodes.map((n) => n.id));

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!ids.has(dep)) errors.push(`node '${node.id}' depends on unknown node '${dep}'`);
    }
  }
  if (errors.length > 0) return { ok: false, order: [], errors };

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, node.dependsOn.length);
    for (const dep of node.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), node.id]);
    }
  }

  const ready = [...nodes].filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id).sort();
  const order: string[] = [];

  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next);
    const toDecrement = (dependents.get(next) ?? []).sort();
    for (const dependent of toDecrement) {
      const newDegree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        // Insert keeping `ready` sorted, so tie-breaks between simultaneously-ready nodes are
        // always resolved the same way regardless of processing order.
        const insertAt = ready.findIndex((id) => id > dependent);
        if (insertAt === -1) ready.push(dependent);
        else ready.splice(insertAt, 0, dependent);
      }
    }
  }

  if (order.length !== nodes.length) {
    const cyclic = nodes.map((n) => n.id).filter((id) => !order.includes(id)).sort();
    return { ok: false, order: [], errors: [`circular dependency detected among: ${cyclic.join(', ')}`] };
  }

  return { ok: true, order, errors: [] };
}
