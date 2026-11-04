/**
 * Matches sources, in order, to targets: each source is kept when an augmenting path finds it a target, and the matching
 * stops once `limit` sources are kept. Taken in descending weight, this is the greedy rule of a transversal matroid, which
 * keeps the most weight.
 *
 * @param edges - The targets each source may take, by source.
 * @param targets - The count of targets.
 * @returns The sources kept, in order, and the targets the matching uses.
 * @see {@link https://doi.org/10.1007/BF01584082 | Edmonds (1971), Matroids and the greedy algorithm}
 */
export function augmentMatching(
  edges: readonly (readonly number[])[],
  targets: number,
  limit: number,
): { readonly kept: readonly number[]; readonly used: ReadonlySet<number> } {
  const owner = new Int32Array(targets).fill(-1);
  const kept: number[] = [];
  for (let source = 0; source < edges.length && kept.length < limit; source += 1) {
    if (augment(source, edges, owner)) kept.push(source);
  }
  const used = new Set<number>();
  owner.forEach((source, target) => {
    if (source !== -1) used.add(target);
  });
  return { kept, used };
}

/** A step of the search: a source, the index of its next target to try, and the target it was reached through. */
interface Step {
  readonly source: number;
  next: number;
  readonly via: number;
}

/**
 * Looks for an augmenting path from a source by depth-first search with an explicit stack, a free target first, and moves
 * the matching along it when it finds one.
 */
function augment(start: number, edges: readonly (readonly number[])[], owner: Int32Array): boolean {
  const free = edges[start]?.find((target) => owner[target] === -1);
  if (free !== undefined) {
    owner[free] = start;
    return true;
  }
  const visited = new Uint8Array(owner.length);
  const stack: Step[] = [{ source: start, next: 0, via: -1 }];
  for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
    const target = edges[frame.source]?.[frame.next];
    frame.next += 1;
    if (target === undefined) stack.pop();
    else if (visited[target] !== 1) {
      visited[target] = 1;
      const holder = owner[target] ?? -1;
      if (holder === -1) {
        shiftAlong(stack, target, owner);
        return true;
      }
      stack.push({ source: holder, next: 0, via: target });
    }
  }
  return false;
}

/** Moves the matching along a path: each source takes the target the next one came through, and the last the free one. */
function shiftAlong(stack: readonly Step[], free: number, owner: Int32Array): void {
  let taken = free;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const step = stack[index];
    if (step === undefined) return;
    owner[taken] = step.source;
    taken = step.via;
  }
}

/**
 * The size of a maximum matching of a bipartite graph, by Hopcroft and Karp: breadth-first layers from the free sources,
 * then depth-first augmenting paths along them, in O(E·√V).
 *
 * @see {@link https://doi.org/10.1137/0202019 | Hopcroft and Karp (1973), An n^5/2 algorithm for maximum matchings in bipartite graphs}
 *
 * @param edges - The targets each source may take, by source.
 * @param targets - The count of targets.
 */
export function maximumMatching(edges: readonly (readonly number[])[], targets: number): number {
  const sources = edges.length;
  const matchOfSource = new Int32Array(sources).fill(-1);
  const matchOfTarget = new Int32Array(targets).fill(-1);
  const layer = new Int32Array(sources);
  let size = 0;
  for (;;) {
    if (!buildLayers(edges, matchOfSource, matchOfTarget, layer)) return size;
    for (let source = 0; source < sources; source += 1) {
      if (matchOfSource[source] === -1 && layeredAugment(source, edges, matchOfSource, matchOfTarget, layer)) size += 1;
    }
  }
}

const UNREACHED = -1;

/** Layers the sources by breadth-first search from the free ones; whether a free target is reached. */
function buildLayers(
  edges: readonly (readonly number[])[],
  matchOfSource: Int32Array,
  matchOfTarget: Int32Array,
  layer: Int32Array,
): boolean {
  const queue: number[] = [];
  layer.fill(UNREACHED);
  matchOfSource.forEach((match, source) => {
    if (match === -1) {
      layer[source] = 0;
      queue.push(source);
    }
  });
  let found = false;
  for (let head = 0; head < queue.length; head += 1) {
    const source = queue[head] ?? 0;
    for (const target of edges[source] ?? []) {
      const next = matchOfTarget[target] ?? -1;
      if (next === -1) found = true;
      else if (layer[next] === UNREACHED) {
        layer[next] = (layer[source] ?? 0) + 1;
        queue.push(next);
      }
    }
  }
  return found;
}

/** Augments along the layers from a free source, depth-first with an explicit stack; whether a path was found. */
function layeredAugment(
  start: number,
  edges: readonly (readonly number[])[],
  matchOfSource: Int32Array,
  matchOfTarget: Int32Array,
  layer: Int32Array,
): boolean {
  const stack: { source: number; next: number }[] = [{ source: start, next: 0 }];
  const path: number[] = [];
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (frame === undefined) break;
    const target = edges[frame.source]?.[frame.next];
    frame.next += 1;
    if (target === undefined) {
      layer[frame.source] = UNREACHED;
      stack.pop();
      path.pop();
      continue;
    }
    const next = matchOfTarget[target] ?? -1;
    if (next === -1) {
      path.push(target);
      stack.forEach((step, index) => {
        const taken = path[index] ?? -1;
        matchOfSource[step.source] = taken;
        matchOfTarget[taken] = step.source;
      });
      return true;
    }
    if (layer[next] === (layer[frame.source] ?? 0) + 1) {
      path.push(target);
      stack.push({ source: next, next: 0 });
    }
  }
  return false;
}
