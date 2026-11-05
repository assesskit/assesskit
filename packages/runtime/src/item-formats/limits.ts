import { limitsSchema } from "../checks-internal.js";

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

/** The most that `maxDepth` may be: content deeper than four times its default is read recursively. */
const MAX_DEPTH_CAP = DEFAULT_ITEM_FORMAT_LIMITS.maxDepth * 4;

/** The schema of the limits that a reader's caller sets: a limit left out has its default. */
export const readLimitsSchema = limitsSchema(DEFAULT_ITEM_FORMAT_LIMITS, { maxDepth: MAX_DEPTH_CAP });

/** The schema of the limits that a writer's caller sets, which is `maxAnswers` alone: the others bound what a reader reads. */
export const writeLimitsSchema = limitsSchema(DEFAULT_ITEM_FORMAT_LIMITS, {}, ["maxAnswers"]);
