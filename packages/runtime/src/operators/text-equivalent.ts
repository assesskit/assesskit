import { type CompileXsdRegexOptions, compileXsdRegex, type Value, type XsdPattern } from "../values/index.js";
import { countLength } from "./count-length.js";
import { boundedEditDistance } from "./edit-distance.js";
import type { OperatorLimits } from "./limits.js";
import { augmentMatching } from "./matching.js";
import { checkOperandCount, isBlank, share, stringsOf } from "./operands.js";
import { type OptionsOf, optionsError, pathOf } from "./options.js";
import type { TextKeyData } from "./schemas.js";
import { collapseWhiteSpace, splitWhiteSpace } from "./white-space.js";

/** The Halfwidth and Fullwidth Forms block. */
const WIDTH_FORMS = /[\uff00-\uffef]/gu;
const NONSPACING_MARK = /\p{Mn}/gu;
/** The options of `compileXsdRegex` for a key's patterns: its defaults. */
const PATTERN_OPTIONS: CompileXsdRegexOptions = {};

/**
 * Normalizes a text as `text-equivalent` does, in this order: `form`; `foldWidth`, which maps the Halfwidth and Fullwidth
 * Forms block by NFKC; `ignoreMarks`, which removes nonspacing marks after NFD and normalizes back to `form`; lower case by
 * `toLowerCase` unless `caseSensitive`; `collapseWhitespace`, which turns runs of Unicode White_Space into one space and trims.
 *
 * @see {@link https://www.unicode.org/reports/tr15/ | Unicode Standard Annex #15, Unicode Normalization Forms}
 */
function normalizeText(text: string, normalization: TextKeyData["normalization"]): string {
  let result = text.normalize(normalization.form);
  if (normalization.foldWidth) result = result.replace(WIDTH_FORMS, (character) => character.normalize("NFKC"));
  if (normalization.ignoreMarks)
    result = result.normalize("NFD").replace(NONSPACING_MARK, "").normalize(normalization.form);
  if (!normalization.caseSensitive) result = result.toLowerCase();
  if (normalization.collapseWhitespace) result = collapseWhiteSpace(result);
  return result;
}

/** An answer of a text key, normalized, with its patterns compiled and its texts as code points for the credit tiers. */
interface PreparedAnswer {
  readonly texts: ReadonlySet<string>;
  readonly codePoints: readonly (readonly number[])[];
  readonly patterns: readonly XsdPattern[];
  readonly points: number;
}

/** A text key read once a call: its answers in descending points, the points of the `count` highest, its tiers. */
export interface PreparedText {
  readonly key: TextKeyData;
  readonly answers: readonly PreparedAnswer[];
  readonly maximum: number;
  /** The credit tiers, highest share first. */
  readonly tiers: TextKeyData["credit"];
}

/** The code points of a text. */
function codePointsOf(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

/**
 * Reads and checks the options of `text-equivalent`.
 *
 * @throws `DataError` for a `spelling` or a `numericEquivalence` other than the defaults, which the operator does not define,
 *   a count above the answers, an answer with no text or pattern, no points to earn, a pattern that does not compile, or a
 *   `below` or `above` effect without its bound.
 */
export function prepareText(options: OptionsOf<"text-equivalent">, prefix: string): PreparedText {
  const { key } = options;
  if (key.spelling !== "exact")
    throw optionsError(pathOf(prefix, "key.spelling"), 'the operator defines "exact" spelling alone.');
  if (key.numericEquivalence)
    throw optionsError(
      pathOf(prefix, "key.numericEquivalence"),
      "the operator defines no numeric equivalence of texts.",
    );
  if (key.count > key.answers.length)
    throw optionsError(
      pathOf(prefix, "key.count"),
      `the count ${key.count} is above the ${key.answers.length} answers.`,
    );
  checkLengthRule(key.length, pathOf(prefix, "key.length"));
  const answers = key.answers.map((answer, index) =>
    prepareAnswer(answer, key, pathOf(prefix, `key.answers[${index}]`)),
  );
  answers.sort((a, b) => b.points - a.points);
  const maximum = answers.slice(0, key.count).reduce((total, answer) => total + answer.points, 0);
  if (maximum <= 0)
    throw optionsError(pathOf(prefix, "key.answers"), "the answers that the count takes earn no points.");
  const tiers = [...key.credit].sort((a, b) => b.share - a.share);
  return { key, answers, maximum, tiers };
}

function checkLengthRule(rule: TextKeyData["length"], path: string): void {
  rule?.effects.forEach((effect, index) => {
    const bound = effect.when === "below" ? rule.min : rule.max;
    if (bound === null)
      throw optionsError(
        `${path}.effects[${index}]`,
        `an effect ${effect.when} a bound needs the rule's ${effect.when === "below" ? "min" : "max"}.`,
      );
  });
}

function prepareAnswer(answer: TextKeyData["answers"][number], key: TextKeyData, path: string): PreparedAnswer {
  if (answer.texts.length === 0 && answer.patterns.length === 0)
    throw optionsError(path, "an answer has a text or a pattern.");
  const patterns = answer.patterns.map((pattern, index) => {
    try {
      return compileXsdRegex(pattern, PATTERN_OPTIONS);
    } catch (error) {
      throw optionsError(`${path}.patterns[${index}]`, `the pattern does not compile: ${(error as Error).message}`, {
        cause: error,
      });
    }
  });
  const normalized = answer.texts.map((text) => normalizeText(text, key.normalization));
  return { texts: new Set(normalized), codePoints: normalized.map(codePointsOf), patterns, points: answer.points };
}

/** Whether a normalized string matches an answer: it equals one of its texts, or fully matches one of its patterns. */
function matches(answer: PreparedAnswer, text: string): boolean {
  return answer.texts.has(text) || answer.patterns.some((pattern) => pattern.matches(text));
}

/**
 * The share of an answer's points that a string earns by the credit tiers: the first tier, highest share first, whose
 * tolerance holds for the edit distance to one of the answer's texts, measured within `maxEditBand`.
 */
function creditOf(tiers: PreparedText["tiers"], answer: PreparedAnswer, text: readonly number[], band: number): number {
  for (const tier of tiers) {
    const holds = answer.codePoints.some((accepted) => {
      const { absolute, relative } = tier.tolerance;
      const allowed = Math.max(absolute ?? -1, relative === null ? -1 : relative * accepted.length);
      if (allowed < 0) return false;
      const distance = boundedEditDistance(text, accepted, Math.min(band, Math.floor(allowed)));
      return distance !== undefined;
    });
    if (holds) return tier.share;
  }
  return 0;
}

/**
 * The points that the strings the exact matching left earn by credit: each such string, in order, takes the answer not yet
 * kept for which its tier earns the most points, until `count` answers are kept.
 */
function creditedPoints(
  prepared: PreparedText,
  candidates: readonly string[],
  kept: readonly number[],
  used: ReadonlySet<number>,
  limits: OperatorLimits,
): number {
  if (prepared.tiers.length === 0) return 0;
  const taken = new Set(kept);
  let points = 0;
  candidates.forEach((candidate, index) => {
    if (used.has(index) || taken.size >= prepared.key.count) return;
    const text = codePointsOf(candidate);
    let best: { readonly answer: number; readonly points: number } | undefined;
    prepared.answers.forEach((answer, at) => {
      if (taken.has(at)) return;
      const earned = creditOf(prepared.tiers, answer, text, limits.maxEditBand) * answer.points;
      if (earned > 0 && (best === undefined || earned > best.points)) best = { answer: at, points: earned };
    });
    if (best === undefined) return;
    taken.add(best.answer);
    points += best.points;
  });
  return points;
}

/** The share after the effects of a length rule whose bound the response passes, in order. */
function applyLengthRule(value: number, strings: readonly string[], rule: TextKeyData["length"]): number {
  if (rule === null) return value;
  const length = strings.reduce((total, text) => total + countLength(text, rule.unit), 0);
  let result = value;
  for (const effect of rule.effects) {
    const passed =
      effect.when === "below"
        ? rule.min !== null && length < effect.share * rule.min
        : rule.max !== null && length > effect.share * rule.max;
    if (!passed) continue;
    result = effect.effect === "zero" ? 0 : Math.max(0, result - effect.effect.deduct);
  }
  return result;
}

/**
 * `text-equivalent`: the points of the answers a response's strings match over the points of the `count` highest. Each answer
 * and each string counts once: answers are taken in descending points, each kept when an augmenting path finds it a string,
 * the greedy rule of a transversal matroid, which keeps the most points. With `words` the response's words are its strings.
 * The strings that match no answer then earn by the credit tiers, and a length rule applies after. NULL when blank or past
 * the limit.
 */
export function scoreText(
  prepared: PreparedText,
  operands: readonly (Value | null)[],
  limits: OperatorLimits,
): Value | null {
  checkOperandCount(operands, 1);
  const strings = stringsOf(operands[0], 0, { containers: true, numbers: false });
  if (strings === null || strings.reduce((total, text) => total + text.length, 0) > limits.maxInputLength) return null;
  if (strings.every(isBlank)) return null;
  const { key } = prepared;
  const normalized = strings.map((text) => normalizeText(text, key.normalization));
  const candidates = key.scheme === "words" ? normalized.flatMap(splitWhiteSpace) : normalized;
  const edges = prepared.answers.map((answer) =>
    candidates.flatMap((text, index) => (matches(answer, text) ? [index] : [])),
  );
  const { kept, used } = augmentMatching(edges, candidates.length, key.count);
  const exact = kept.reduce((total, answer) => total + (prepared.answers[answer]?.points ?? 0), 0);
  const points = exact + creditedPoints(prepared, candidates, kept, used, limits);
  return share(applyLengthRule(points / prepared.maximum, strings, key.length));
}

/** Whether every string of a response is not blank. */
export function readsAsText(strings: readonly string[]): boolean {
  return strings.every((text) => !isBlank(text));
}
