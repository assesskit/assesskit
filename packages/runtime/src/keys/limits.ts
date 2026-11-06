/** The limits of a key that an operator reads and `compileScoring` writes. */
export interface KeyLimits {
  /** The most responses of an item that keys score. */
  readonly responses: number;
  /** The most entries of one key: its keys, answers, texts and patterns together, pairs, areas, options or units. */
  readonly entries: number;
  /** The most characters of one pattern, as UTF-16 code units. */
  readonly patternLength: number;
}

/**
 * The limits of a key: 256 responses, 1,000 entries and 1,000 characters of a pattern, set for keys that an author or a
 * generator writes for one item; 256 responses of 1,000 choices each end in a heap of 224 MiB, within the 256 MB that the worst input may peak at.
 * An item that holds more is refused with a `SecurityError` that names the limit. An operator reads its key within them,
 * and so does `compileScoring`.
 */
export const DEFAULT_KEY_LIMITS: KeyLimits = Object.freeze({ responses: 256, entries: 1_000, patternLength: 1_000 });
