import { checkChoice, checkString } from "../checks.js";
import type { LengthUnit } from "./keys.js";
import { GRAPHEME_RUNS } from "./unicode-graphemes.js";
import { isWhiteSpace, splitWhiteSpace } from "./white-space.js";

/** The Grapheme_Cluster_Break values, by the codes of `GRAPHEME_RUNS`. */
const BREAK = Object.freeze({
  CR: 1,
  LF: 2,
  CONTROL: 3,
  EXTEND: 4,
  ZWJ: 5,
  REGIONAL_INDICATOR: 6,
  PREPEND: 7,
  SPACING_MARK: 8,
  L: 9,
  V: 10,
  T: 11,
  LV: 12,
  LVT: 13,
});

/** The Indic_Conjunct_Break values, as the second field of a code. */
const CONJUNCT = Object.freeze({ CONSONANT: 1, LINKER: 2, EXTEND: 3 });

/** A code of `GRAPHEME_RUNS`: the break value, then the conjunct value times 16, then Extended_Pictographic times 64. */
const CONJUNCT_SHIFT = 16;
const PICTOGRAPHIC_SHIFT = 64;

const UNITS: readonly LengthUnit[] = ["words", "characters", "characters-without-spaces", "manuscript-squares"];

/** The line breaks, which take no square of a manuscript sheet. */
const LINE_BREAKS = /^[\n-\r\u0085\u2028\u2029]+$/u;

/** The first code point of each run and its code, decoded once. */
let table: { readonly starts: Uint32Array; readonly codes: Uint8Array } | undefined;

function decodeTable(): { readonly starts: Uint32Array; readonly codes: Uint8Array } {
  if (table !== undefined) return table;
  const tokens = GRAPHEME_RUNS.split(" ");
  const starts = new Uint32Array(tokens.length);
  const codes = new Uint8Array(tokens.length);
  let start = 0;
  tokens.forEach((token, index) => {
    const [code = "0", length = "0"] = token.split(":");
    starts[index] = start;
    codes[index] = Number.parseInt(code, 36);
    start += Number.parseInt(length, 36);
  });
  table = { starts, codes };
  return table;
}

/** The code of a code point: a binary search for the last run that starts at or before it. */
function codeOf(codePoint: number): number {
  const { starts, codes } = decodeTable();
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= codePoint) low = middle;
    else high = middle - 1;
  }
  return codes[low] ?? 0;
}

/** What the rules remember of the cluster so far: the runs of regional indicators, pictographs and conjuncts. */
interface ClusterState {
  regional: number;
  /** 0: none; 1: a pictograph and its extenders; 2: then a zero-width joiner. */
  pictograph: number;
  /** 0: none; 1: a consonant and its extenders; 2: then a linker. */
  conjunct: number;
}

/** The Hangul syllable sequences that stay one cluster, GB6 to GB8: each value of the left with the values on its right. */
const HANGUL: ReadonlyMap<number, readonly number[]> = new Map([
  [BREAK.L, [BREAK.L, BREAK.V, BREAK.LV, BREAK.LVT]],
  [BREAK.LV, [BREAK.V, BREAK.T]],
  [BREAK.V, [BREAK.V, BREAK.T]],
  [BREAK.LVT, [BREAK.T]],
  [BREAK.T, [BREAK.T]],
]);

/** Whether a value is a control, a carriage return or a line feed, which a cluster ends at, GB4 and GB5. */
function isControl(value: number): boolean {
  return value >= BREAK.CR && value <= BREAK.CONTROL;
}

/** Whether the rules of UAX #29 keep two code points in one cluster, GB3 to GB13. */
function joins(before: number, after: number, state: ClusterState): boolean {
  const left = before % CONJUNCT_SHIFT;
  const right = after % CONJUNCT_SHIFT;
  if (left === BREAK.CR && right === BREAK.LF) return true;
  if (isControl(left) || isControl(right)) return false;
  if (HANGUL.get(left)?.includes(right) === true) return true;
  if (right === BREAK.EXTEND || right === BREAK.ZWJ || right === BREAK.SPACING_MARK || left === BREAK.PREPEND)
    return true;
  if (state.conjunct === 2 && Math.floor(after / CONJUNCT_SHIFT) % 4 === CONJUNCT.CONSONANT) return true;
  if (state.pictograph === 2 && after >= PICTOGRAPHIC_SHIFT) return true;
  return right === BREAK.REGIONAL_INDICATOR && state.regional % 2 === 1;
}

/** Updates what the rules remember with the code point that now ends the cluster. */
function advance(code: number, state: ClusterState): void {
  const value = code % CONJUNCT_SHIFT;
  const conjunct = Math.floor(code / CONJUNCT_SHIFT) % 4;
  state.regional = value === BREAK.REGIONAL_INDICATOR ? state.regional + 1 : 0;
  if (code >= PICTOGRAPHIC_SHIFT) state.pictograph = 1;
  else if (value === BREAK.EXTEND && state.pictograph === 1) state.pictograph = 1;
  else if (value === BREAK.ZWJ && state.pictograph === 1) state.pictograph = 2;
  else state.pictograph = 0;
  if (conjunct === CONJUNCT.CONSONANT) state.conjunct = 1;
  else if (conjunct === CONJUNCT.LINKER && state.conjunct > 0) state.conjunct = 2;
  else if (conjunct !== CONJUNCT.EXTEND || state.conjunct === 0) state.conjunct = 0;
}

/**
 * Splits a text into its extended grapheme clusters, by the rules of UAX #29 on the Unicode data that the runtime pins, so
 * that every JavaScript runtime and browser splits alike, `Intl.Segmenter` or not.
 *
 * @see {@link https://www.unicode.org/reports/tr29/ | Unicode Standard Annex #29, Unicode Text Segmentation}
 */
export function listGraphemes(text: string): readonly string[] {
  const clusters: string[] = [];
  const state: ClusterState = { regional: 0, pictograph: 0, conjunct: 0 };
  let current = "";
  let previous = -1;
  for (const character of text) {
    const code = codeOf(character.codePointAt(0) ?? 0);
    if (previous !== -1 && !joins(previous, code, state)) {
      clusters.push(current);
      current = "";
      state.regional = 0;
      state.pictograph = 0;
      state.conjunct = 0;
    }
    current += character;
    advance(code, state);
    previous = code;
  }
  if (current !== "") clusters.push(current);
  return clusters;
}

/**
 * Counts the length of a text in a unit: `words`, the runs between Unicode White_Space; `characters`, its extended grapheme
 * clusters; `characters-without-spaces`, those that are not White_Space; `manuscript-squares`, one square for each cluster but
 * the line breaks, punctuation and spaces included, as a manuscript sheet counts them, without its rules for the start of a
 * line.
 *
 * @remarks
 * A text written without spaces between its words, such as Japanese or Thai, has one word for each run: count its
 * `characters` instead.
 *
 * @param text - The text, such as a response.
 * @param unit - The unit of the count.
 * @returns The count, a non-negative integer.
 * @throws `DataError` when the text is not a string or the unit is not one of the four.
 * @see {@link https://www.unicode.org/reports/tr29/ | Unicode Standard Annex #29, Unicode Text Segmentation}
 */
export function countLength(text: string, unit: LengthUnit): number {
  checkString(text, "The text");
  checkChoice(unit, "The unit", UNITS);
  if (unit === "words") return splitWhiteSpace(text).length;
  const clusters = listGraphemes(text);
  if (unit === "characters") return clusters.length;
  const skipped = unit === "manuscript-squares" ? (cluster: string) => LINE_BREAKS.test(cluster) : isWhiteSpace;
  return clusters.filter((cluster) => !skipped(cluster)).length;
}
