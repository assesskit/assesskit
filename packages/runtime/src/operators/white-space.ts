/** Runs of Unicode White_Space, the characters to which PropList.txt gives that property. */
const RUNS = /[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
/** White_Space at either end of a text. */
const ENDS =
  /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;
/** A text of White_Space alone, with at least one character. */
const ONLY = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/u;

/**
 * Turns each run of Unicode White_Space into one space and trims the ends.
 *
 * @see {@link https://www.unicode.org/Public/17.0.0/ucd/PropList.txt | Unicode Character Database, PropList.txt, White_Space}
 */
export function collapseWhiteSpace(text: string): string {
  return text.replace(RUNS, " ").replace(ENDS, "");
}

/** Trims Unicode White_Space at either end of a text. */
export function trimWhiteSpace(text: string): string {
  return text.replace(ENDS, "");
}

/** The runs between Unicode White_Space, none of them empty. */
export function splitWhiteSpace(text: string): string[] {
  return text.split(RUNS).filter((part) => part !== "");
}

/** Whether a text holds only Unicode White_Space, and at least one character. */
export function isWhiteSpace(text: string): boolean {
  return ONLY.test(text);
}
