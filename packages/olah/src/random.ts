import { checkArray, checkSeed, describe } from "./checks.js";
import { DataError } from "./errors.js";

/**
 * A source of random numbers. Functions that draw take one, so that a seeded source reproduces their results. takar's
 * `Random` has this shape, so a takar generator can be passed wherever olah takes a `Random`.
 */
export interface Random {
  /** Returns a uniform draw from [0, 1). */
  uniform(): number;
}

/** The four 32-bit words of the generator state, each an integer from 0 to 4294967295. */
export type RandomState = readonly [number, number, number, number];

/** A seeded random number generator whose state can be saved and restored. */
export interface SeededRandom extends Random {
  /** Returns the current state; `restoreRandom` continues the sequence from it. */
  state(): RandomState;
}

const TWO_TO_26 = 2 ** 26;
const TWO_TO_32 = 2 ** 32;
const TWO_TO_53 = 2 ** 53;
/** 2³² divided by the golden ratio, which spaces the four seed words of the state. */
const GOLDEN_GAMMA = 0x9e3779b9;

/**
 * Creates a seeded random number generator: xoshiro128** seeded through the MurmurHash3 finalizer. Equal seeds give
 * equal sequences, and the same sequence as takar's `createRandom`. Uniform draws have 53 random bits from integer
 * arithmetic, identical in every JavaScript runtime.
 *
 * @param seed - A safe integer.
 * @throws `DataError` when `seed` is not a safe integer.
 */
export function createRandom(seed: number): SeededRandom {
  checkSeed(seed);
  const high = mix(Math.floor(seed / TWO_TO_32) >>> 0);
  const state = new Uint32Array(4);
  for (let i = 0; i < 4; i++) state[i] = mix((seed >>> 0) + Math.imul(i + 1, GOLDEN_GAMMA) + high);
  return generator(state);
}

/**
 * Restores a generator from a state that `SeededRandom.state` returned. It continues the sequence where that state was
 * taken.
 *
 * @param state - Four integers from 0 to 4294967295, not all 0.
 * @throws `DataError` when `state` is not such a list.
 */
export function restoreRandom(state: RandomState): SeededRandom {
  checkArray(state, "A random state must be an array of four integers");
  const valid = state.length === 4 && state.every((word) => Number.isInteger(word) && word >= 0 && word < TWO_TO_32);
  if (!valid || state.every((word) => word === 0)) {
    throw new DataError(
      `A random state must be four integers from 0 to 4294967295, not all 0, found ${describe(state)}.`,
    );
  }
  return generator(Uint32Array.from(state));
}

/** Builds the generator over a four-word state, which it advances in place. */
function generator(words: Uint32Array): SeededRandom {
  const bits53 = (): number => (next(words) >>> 5) * TWO_TO_26 + (next(words) >>> 6);
  return {
    uniform: () => bits53() / TWO_TO_53,
    state: () => [words[0] ?? 0, words[1] ?? 0, words[2] ?? 0, words[3] ?? 0],
  };
}

/** The MurmurHash3 32-bit finalizer, a bijection that spreads every input bit over the output. */
function mix(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Advances xoshiro128** (Blackman and Vigna) and returns its next 32-bit output. */
function next(s: Uint32Array): number {
  const s0 = s[0] ?? 0;
  const s1 = s[1] ?? 0;
  const s2 = s[2] ?? 0;
  const s3 = s[3] ?? 0;
  const result = Math.imul(rotate(Math.imul(s1, 5), 7), 9) >>> 0;
  const t = s1 << 9;
  const n2 = s2 ^ s0;
  const n3 = s3 ^ s1;
  s[0] = s0 ^ n3;
  s[1] = s1 ^ n2;
  s[2] = n2 ^ t;
  s[3] = rotate(n3, 11);
  return result;
}

function rotate(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
