import { checkPositiveInteger, checkProperties, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";

/** The limits of a file that a reader takes, and of the items that a writer converts; each bounds memory or time. */
export interface ItemFormatLimits {
  /**
   * The most bytes of a file, as UTF-8.
   *
   * @defaultValue `10485760` (10 MiB, as `DEFAULT_XML_LIMITS`)
   */
  readonly maxBytes: number;
  /**
   * The most questions of a file, categories included.
   *
   * @defaultValue `10000`
   */
  readonly maxQuestions: number;
  /**
   * The most answers of a question, or choices of an interaction that a writer converts.
   *
   * @defaultValue `100`
   */
  readonly maxAnswers: number;
  /**
   * The most HTML elements of all the texts of a file together, which become the content of its items.
   *
   * @defaultValue `100000`
   */
  readonly maxNodes: number;
  /**
   * The most tags of one text, each of which may become an element: the parser of HTML moves the children of an element one
   * by one when it mends tags that close out of order, in time that grows with their square.
   *
   * @defaultValue `4096`
   */
  readonly maxTextTags: number;
  /**
   * The most levels of HTML elements in a text.
   *
   * @defaultValue `64`
   */
  readonly maxDepth: number;
}

/** The default limits, set so that the worst file within all of them stays near 256 MiB of heap (docs/runtime/item-formats.md). */
export const DEFAULT_ITEM_FORMAT_LIMITS: ItemFormatLimits = Object.freeze({
  maxBytes: 10_485_760,
  maxQuestions: 10_000,
  maxAnswers: 100,
  maxNodes: 100_000,
  maxTextTags: 4096,
  maxDepth: 64,
});

const NAMES: readonly (keyof ItemFormatLimits)[] = [
  "maxBytes",
  "maxQuestions",
  "maxAnswers",
  "maxNodes",
  "maxTextTags",
  "maxDepth",
];

/**
 * Applies the defaults to the limits that a caller sets.
 *
 * @param names - The limits that the caller may set: all of them for a reader, `maxAnswers` alone for a writer.
 * @throws `DataError` when `limits` is not an object, names a limit not in `names` or a limit is not a positive integer.
 */
export function resolveItemFormatLimits(
  limits: unknown,
  names: readonly (keyof ItemFormatLimits)[] = NAMES,
): ItemFormatLimits {
  checkRecord(limits, `The option limits must be an object, found ${describe(limits)}`);
  checkProperties(limits, "The option limits", names);
  const resolved: Record<keyof ItemFormatLimits, number> = { ...DEFAULT_ITEM_FORMAT_LIMITS };
  for (const name of names) {
    const value = limits[name];
    if (value === undefined) continue;
    checkPositiveInteger(value, `The limit ${name}`);
    resolved[name] = value;
  }
  if (resolved.maxDepth > DEFAULT_ITEM_FORMAT_LIMITS.maxDepth * 4) {
    throw new DataError(
      `The limit maxDepth must be at most ${DEFAULT_ITEM_FORMAT_LIMITS.maxDepth * 4}, found ${resolved.maxDepth}: deeper content is read recursively.`,
    );
  }
  return Object.freeze(resolved);
}
