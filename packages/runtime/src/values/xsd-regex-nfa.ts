import type { CodePointSet } from "./code-point-set.js";
import type { RegexNode } from "./xsd-regex-parser.js";

/** A state of the automaton: it reads a character of `set` and goes to `out`, or it goes to `out` and `alternative`. */
export interface State {
  readonly set: CodePointSet | undefined;
  out: number;
  alternative: number;
}

/** No state: the end of a path. */
export const NONE = -1;

/** The state that accepts. */
export const ACCEPT = 0;

/** A Thompson automaton: its states, and the state where a match starts. */
export interface Nfa {
  readonly states: readonly State[];
  readonly entry: number;
}

/**
 * Returns how many states a node needs once its repeats are expanded, or a number above `limit` when it needs more.
 *
 * @remarks
 * The count is capped at `limit + 1` at every step, so that a pattern such as `((a{9999}){9999}){9999}` is refused before
 * any state is built, and the count itself cannot overflow.
 *
 * @param node - The pattern.
 * @param limit - The most states that the caller allows.
 */
export function countStates(node: RegexNode, limit: number): number {
  const capped = (count: number): number => Math.min(count, limit + 1);
  switch (node.kind) {
    case "set":
      return 1;
    case "sequence":
      return node.items.reduce((total, item) => capped(total + countStates(item, limit)), 0);
    case "choice":
      return node.options.reduce(
        (total, option) => capped(total + countStates(option, limit)),
        node.options.length - 1,
      );
    case "repeat": {
      const each = countStates(node.node, limit);
      const optional = node.max === undefined ? each + 1 : (node.max - node.min) * (each + 1);
      return capped(node.min * each + optional);
    }
  }
}

/** Builds a Thompson automaton: each node becomes states that lead to `next`. */
class NfaBuilder {
  readonly states: State[] = [{ set: undefined, out: NONE, alternative: NONE }];

  private add(state: State): number {
    this.states.push(state);
    return this.states.length - 1;
  }

  build(node: RegexNode, next: number): number {
    switch (node.kind) {
      case "set":
        return this.add({ set: node.set, out: next, alternative: NONE });
      case "sequence":
        return node.items.reduceRight((after, item) => this.build(item, after), next);
      case "choice":
        return node.options.reduceRight(
          (after, option, index) =>
            index === node.options.length - 1
              ? this.build(option, next)
              : this.add({ set: undefined, out: this.build(option, next), alternative: after }),
          next,
        );
      case "repeat":
        return this.repeat(node, next);
    }
  }

  private repeat(node: Extract<RegexNode, { kind: "repeat" }>, next: number): number {
    let tail = next;
    if (node.max === undefined) {
      const loop = this.add({ set: undefined, out: NONE, alternative: next });
      const state = this.states[loop];
      if (state !== undefined) state.out = this.build(node.node, loop);
      tail = loop;
    } else {
      for (let optional = node.min; optional < node.max; optional++) {
        tail = this.add({ set: undefined, out: this.build(node.node, tail), alternative: next });
      }
    }
    for (let required = 0; required < node.min; required++) {
      const built = this.build(node.node, tail);
      // A node that adds no state, such as an empty group, repeats to itself however many times the pattern says.
      if (built === tail) break;
      tail = built;
    }
    return tail;
  }
}

/**
 * Builds the automaton of a parsed pattern.
 *
 * @param tree - The pattern. Its states, once its repeats are expanded, must be within the caller's limit: see
 * {@link countStates}.
 */
export function buildNfa(tree: RegexNode): Nfa {
  const builder = new NfaBuilder();
  const entry = builder.build(tree, ACCEPT);
  return { states: builder.states, entry };
}
