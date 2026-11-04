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
 * The default limits of a key: 64 responses, 1,000 entries and 1,000 characters of a pattern, set for keys that an author
 * or a generator writes for one item. An item that holds more is refused with a `SecurityError` that names the limit. An
 * operator reads its key within them; `compileScoring` takes up to 256 responses and lower limits of each.
 */
export const DEFAULT_KEY_LIMITS: KeyLimits = Object.freeze({ responses: 64, entries: 1_000, patternLength: 1_000 });
