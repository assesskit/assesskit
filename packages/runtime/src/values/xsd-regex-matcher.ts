import { checkString } from "../checks.js";
import { type CodePointSet, contains, MAX_CODE_POINT } from "./code-point-set.js";
import { ACCEPT, buildNfa, NONE, type State } from "./xsd-regex-nfa.js";
import type { RegexNode } from "./xsd-regex-parser.js";

/** A compiled XML Schema regular expression. */
export interface XsdPattern {
  /**
   * Returns whether the whole text matches the pattern. The time is linear in the length of the text.
   *
   * @param text - The text.
   * @throws `DataError` when `text` is not a string.
   */
  matches(text: string): boolean;
}

/**
 * The most entries, states and transitions together, that a matcher keeps of its deterministic automaton; beyond it the
 * matcher starts again. It bounds the memory a text can make a matcher use.
 */
const MAX_CACHED_ENTRIES = 1_000_000;

/** A state of the deterministic automaton: the set of states of the Thompson automaton that the text so far can reach. */
interface DfaState {
  readonly states: readonly number[];
  readonly accepting: boolean;
  /** The state after a character, by the class of the character. */
  readonly next: Map<number, DfaState>;
}

/**
 * Matches by simulating the Thompson automaton through a deterministic automaton that it builds as the text needs it,
 * one state for each set of states met. Characters are grouped into the classes that no set of the pattern tells
 * apart, so a state has as many transitions as the pattern has classes, however many different characters the text
 * has. Time is linear in the text, and memory is bounded by `MAX_CACHED_ENTRIES`, whatever the pattern and the text.
 */
class Matcher implements XsdPattern {
  private readonly states: readonly State[];
  /** The first code point of every class but the first, ascending. */
  private readonly boundaries: readonly number[];
  private readonly start: readonly number[];
  // Float64Array holds a generation that can never wrap around, which would loop on an empty cycle such as `(a*)*`.
  private readonly marks: Float64Array;
  private generation = 0;
  private cache = new Map<string, DfaState>();
  private cachedEntries = 0;

  constructor(states: readonly State[], entry: number) {
    this.states = states;
    this.boundaries = classBoundaries(states);
    this.marks = new Float64Array(states.length);
    this.start = this.closure([entry]);
  }

  matches(text: string): boolean {
    checkString(text, "The text");
    let current = this.intern(this.start);
    for (const character of text) {
      const kind = this.classOf(character.codePointAt(0) ?? 0);
      let next = current.next.get(kind);
      if (next === undefined) {
        if (this.cachedEntries >= MAX_CACHED_ENTRIES) {
          // A fresh cache drops every state built so far, and the links between them with it.
          this.cache = new Map();
          this.cachedEntries = 0;
          current = this.intern(current.states);
        }
        next = this.intern(this.step(current.states, this.representative(kind)));
        current.next.set(kind, next);
        this.cachedEntries++;
      }
      if (next.states.length === 0) return false;
      current = next;
    }
    return current.accepting;
  }

  /** Returns the index of the class of a code point: the number of boundaries at or below it. */
  private classOf(codePoint: number): number {
    let low = 0;
    let high = this.boundaries.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.boundaries[middle] ?? 0) <= codePoint) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private representative(kind: number): number {
    return kind === 0 ? 0 : (this.boundaries[kind - 1] ?? 0);
  }

  private intern(states: readonly number[]): DfaState {
    const key = states.join(",");
    let state = this.cache.get(key);
    if (state === undefined) {
      state = { states, accepting: states.includes(ACCEPT), next: new Map() };
      this.cache.set(key, state);
      this.cachedEntries += states.length + 1;
    }
    return state;
  }

  private step(states: readonly number[], codePoint: number): number[] {
    const targets: number[] = [];
    for (const index of states) {
      const state = this.states[index];
      if (state?.set !== undefined && contains(state.set, codePoint)) targets.push(state.out);
    }
    return this.closure(targets);
  }

  /** Returns the states that reach no further without reading: the reading states and the accepting one, sorted. */
  private closure(from: readonly number[]): number[] {
    this.generation++;
    const found: number[] = [];
    const pending = [...from];
    for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
      if (index === NONE || this.marks[index] === this.generation) continue;
      this.marks[index] = this.generation;
      const state = this.states[index];
      if (state === undefined) continue;
      if (state.set !== undefined || index === ACCEPT) found.push(index);
      else pending.push(state.alternative, state.out);
    }
    return found.sort((a, b) => a - b);
  }
}

/** Returns the code points where a set of the automaton starts or stops, ascending: they separate the classes. */
function classBoundaries(states: readonly State[]): number[] {
  const sets = new Set<CodePointSet>();
  for (const { set } of states) if (set !== undefined) sets.add(set);
  const points = new Set<number>();
  for (const set of sets) {
    for (const [first, last] of set) {
      if (first > 0) points.add(first);
      if (last < MAX_CODE_POINT) points.add(last + 1);
    }
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * Builds the matcher of a parsed pattern.
 *
 * @param tree - The pattern, within the limit on its states.
 */
export function buildMatcher(tree: RegexNode): XsdPattern {
  const { states, entry } = buildNfa(tree);
  return new Matcher(states, entry);
}
