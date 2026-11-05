import { createRandom } from "../random.js";
import { complex } from "./complex.js";
import { evaluate, type Measured, measured, type Point } from "./evaluate.js";
import type { Node } from "./tree.js";

/** The points at which the comparator evaluates both sides. */
export const POINT_COUNT = 24;
/** The fewest points at which both sides must be finite for a verdict; fewer leave it undecided. */
export const MIN_POINTS = 12;
/** The range a variable is drawn from when its key names none. */
const DEFAULT_RANGE = Object.freeze({ min: -10, max: 10 });

/** The sample range of each variable, by its name. */
export type Ranges = ReadonlyMap<string, { readonly min: number; readonly max: number }>;

/** The text before a variable's name whose hash seeds its draws, which every item's processing fixes. */
const SEED_PREFIX = "expression-equivalent:";
/** The offset basis and the prime of FNV-1a for 32 bits (Fowler, Noll and Vo). */
const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_PRIME = 16_777_619;
const ENCODER = new TextEncoder();

/**
 * The FNV-1a 32-bit hash of the UTF-8 bytes of a text.
 *
 * @see {@link https://datatracker.ietf.org/doc/draft-eastlake-fnv/ | Eastlake, Hansen, Fowler, Vo and Noll, The FNV non-cryptographic hash algorithm}
 */
export function fnv1a32(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of ENCODER.encode(text)) hash = Math.imul(hash ^ byte, FNV_PRIME);
  return hash >>> 0;
}

/**
 * The values of every variable at the sample points. A variable's values are drawn from `createRandom` seeded with the
 * FNV-1a hash of `"expression-equivalent:" + name`, uniform in its range, so they depend on its name and range alone: the
 * same in every call, whatever the other variables or the order of the calls.
 */
export class Sample {
  private readonly ranges: Ranges;
  private readonly drawn = new Map<string, readonly Measured[]>();

  constructor(ranges: Ranges) {
    this.ranges = ranges;
  }

  /** The value of a variable at the point of an index. */
  value(name: string, index: number): Measured {
    let values = this.drawn.get(name);
    if (values === undefined) {
      const { min, max } = this.ranges.get(name) ?? DEFAULT_RANGE;
      const random = createRandom(fnv1a32(SEED_PREFIX + name));
      values = Array.from({ length: POINT_COUNT }, () => measured(complex(min + (max - min) * random.uniform())));
      this.drawn.set(name, values);
    }
    return values[index] ?? measured(complex(Number.NaN));
  }

  /**
   * The point of an index. A variable that `bindings` names takes the value of its tree at the same point, as the earlier
   * response does in a follow-through; `signs` is the mask of the sides that the `\pm` signs take, bit i for the sign of index i.
   */
  point(index: number, bindings?: ReadonlyMap<string, Node>, signs = 0): Point {
    const plain: Point = { value: (name) => this.value(name, index), sign: () => 1 };
    return {
      value: (name) => {
        const bound = bindings?.get(name);
        return bound === undefined ? this.value(name, index) : evaluate(bound, plain);
      },
      sign: (bit) => ((signs >> bit) & 1 ? -1 : 1),
    };
  }
}
