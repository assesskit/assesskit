import { checkArray, describe } from "./checks.js";
import { checkSeed } from "./checks-internal.js";
import { DataError } from "./errors.js";

/**
 * A source of random numbers. Functions that draw take one, so that a seeded source reproduces their results. Any object
 * with a `uniform` method is one.
 */
export interface Random {
  /** Returns a uniform draw from [0, 1). */
  uniform(): number;
}

/**
 * The four 32-bit words of the generator state, in order, each an integer from 0 to 4294967295 and not all 0.
 *
 * @remarks
 * `restoreRandom` takes it back and continues the sequence from it.
 */
export type RandomState = readonly [first: number, second: number, third: number, fourth: number];

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
 * equal sequences. Uniform draws have 53 random bits from integer arithmetic, identical in every JavaScript runtime.
 *
 * @param seed - A safe integer.
 * @throws `DataError` when `seed` is not a safe integer.
 */
export function createRandom(seed: number): SeededRandom {
  checkSeed(seed);
  const high = mix(Math.floor(seed / TWO_TO_32) >>> 0);
  const word = (index: number): number => mix((seed >>> 0) + Math.imul(index + 1, GOLDEN_GAMMA) + high);
  return generator([word(0), word(1), word(2), word(3)]);
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
  return generator(state);
}

/**
 * Builds the generator over a four-word state. The words are held as 32-bit integers, signed or not, because every
 * operation on them reads them as 32 bits; `state` gives them back unsigned.
 */
function generator(initial: RandomState): SeededRandom {
  let [s0, s1, s2, s3] = initial;
  /** Advances xoshiro128** (Blackman and Vigna) and returns its next 32-bit output. */
  const next = (): number => {
    const result = Math.imul(rotate(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    const n2 = s2 ^ s0;
    const n3 = s3 ^ s1;
    s0 ^= n3;
    s1 ^= n2;
    s2 = n2 ^ t;
    s3 = rotate(n3, 11);
    return result;
  };
  const bits53 = (): number => (next() >>> 5) * TWO_TO_26 + (next() >>> 6);
  return {
    uniform: () => bits53() / TWO_TO_53,
    state: () => [s0 >>> 0, s1 >>> 0, s2 >>> 0, s3 >>> 0],
  };
}

/** The MurmurHash3 32-bit finalizer, a bijection that spreads every input bit over the output. */
function mix(value: number): number {
  let h = value >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function rotate(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/**
 * Draws a number in [0, 1) from a source of random numbers.
 *
 * @throws `DataError` when the source returns anything but a number in [0, 1).
 */
export function drawUniform(random: Random): number {
  const draw: unknown = random.uniform();
  if (!(typeof draw === "number" && draw >= 0 && draw < 1)) {
    throw new DataError(
      `The function uniform of the option random must return a number in [0, 1), found ${describe(draw)}.`,
    );
  }
  return draw;
}

/**
 * Draws an index in [0, size) as `floor(uniform() × size)`, the fixed draw procedure of the runtime.
 *
 * @param size - The number of places, at least 1.
 * @throws `DataError` when the source returns anything but a number in [0, 1).
 */
export function drawIndex(random: Random, size: number): number {
  return Math.min(Math.floor(drawUniform(random) * size), size - 1);
}

/** Swaps two places of an array. It moves values with `splice`, because an indexed read is `T | undefined`. */
function swap<T>(items: T[], first: number, second: number): void {
  const atFirst = items.splice(first, 1, ...items.slice(second, second + 1));
  items.splice(second, 1, ...atFirst);
}

/**
 * Returns the items in a random order, except that the items `isFixed` names keep their places. The movable items are
 * permuted by Fisher–Yates from the last index: for i from the last movable place down to 1, the item at i swaps with
 * the item at `drawIndex(random, i + 1)`, counting the movable places only. Equal draws give equal orders, and fewer
 * than two movable items take no draw.
 *
 * @throws `DataError` when the source returns anything but a number in [0, 1).
 */
export function shuffle<T>(items: readonly T[], isFixed: (item: T) => boolean, random: Random): T[] {
  const slots = items.map((item) => ({ item, fixed: isFixed(item) }));
  const movable = slots.filter(({ fixed }) => !fixed).map(({ item }) => item);
  for (let at = movable.length - 1; at > 0; at--) swap(movable, at, drawIndex(random, at + 1));
  return slots.flatMap(({ item, fixed }) => (fixed ? [item] : movable.splice(0, 1)));
}
