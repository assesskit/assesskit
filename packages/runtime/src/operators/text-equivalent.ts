import { SecurityError } from "../errors.js";
import { DEFAULT_XSD_REGEX_LIMITS, type Value, type XsdPattern } from "../values/index.js";
import { compileCountedXsdRegex } from "../values/internal.js";
import { countLength } from "./count-length.js";
import { boundedEditDistance } from "./edit-distance.js";
import type { OperatorLimits } from "./limits.js";
import { augmentMatching } from "./matching.js";
import { readNumberText } from "./number-text.js";
import { checkOperandCount, isBlank, share, stringsOf } from "./operands.js";
import { type OptionsOf, optionsError, pathOf } from "./options.js";
import { canonicalText } from "./rational.js";
import type { TextKeyData } from "./schemas.js";
import { collapseWhiteSpace, splitWhiteSpace } from "./white-space.js";

/** The Halfwidth and Fullwidth Forms block. */
const WIDTH_FORMS = /[\uff00-\uffef]/gu;
const NONSPACING_MARK = /\p{Mn}/gu;
/**
 * The most states of the automata of a key's patterns together, as of one pattern. The patterns of a key are kept together
 * while it scores, and a pattern of 100,000 states takes about 5 MiB of heap: 1,000 such patterns, which the limits of a key
 * allow otherwise, would take 5 GiB.
 */
const { maxStates: KEY_PATTERN_STATES } = DEFAULT_XSD_REGEX_LIMITS;

/**
 * Normalizes a text as `text-equivalent` does, in this order: `form`; `foldWidth`, which maps the Halfwidth and Fullwidth
 * Forms block by NFKC and normalizes the text to `form` again, so that `ｶﾞ` is `ガ`; `ignoreMarks`, which removes nonspacing marks after NFD and normalizes back to `form`; lower case by
 * `toLowerCase` unless `caseSensitive`; `collapseWhitespace`, which turns runs of Unicode White_Space into one space and trims.
 *
 * @see {@link https://www.unicode.org/reports/tr15/ | Unicode Standard Annex #15, Unicode Normalization Forms}
 */
function normalizeText(text: string, normalization: TextKeyData["normalization"]): string {
  let result = text.normalize(normalization.form);
  if (normalization.foldWidth)
    result = result.replace(WIDTH_FORMS, (character) => character.normalize("NFKC")).normalize(normalization.form);
  if (normalization.ignoreMarks)
    result = result.normalize("NFD").replace(NONSPACING_MARK, "").normalize(normalization.form);
  if (!normalization.caseSensitive) result = result.toLowerCase();
  if (normalization.collapseWhitespace) result = collapseWhiteSpace(result);
  return result;
}

/**
 * An answer of a text key, normalized, with its patterns compiled, its texts as code points for the credit tiers, and with
 * `numericEquivalence` the values of its texts that read as numbers.
 */
interface PreparedAnswer {
  readonly texts: ReadonlySet<string>;
  readonly numbers: ReadonlySet<string>;
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

/**
 * The value of a string that reads as a number with nothing after it, as `numericEquivalence` reads it: a sign, digits with
 * the decimal mark `.`, `a/b` and `a b/c`, a power of ten; as the text of the value in lowest terms, so that equal values
 * compare equal.
 */
function numberOf(text: string): string | undefined {
  const written = readNumberText(text, { separator: ".", fractions: true });
  return written === undefined || written.unit !== "" ? undefined : canonicalText(written.value);
}

/** The code points of a text. */
function codePointsOf(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

/**
 * Reads and checks the options of `text-equivalent`.
 *
 * @throws `DataError` for a count above the answers, an answer with no text or pattern, no points to earn, a pattern that
 *   does not compile, or a `below` or `above` effect without its bound.
 * @throws `SecurityError` when the patterns of the key need more than `maxStates` of `DEFAULT_XSD_REGEX_LIMITS` together.
 */
export function prepareText(options: OptionsOf<"text-equivalent">, prefix: string): PreparedText {
  const { key } = options;
  if (key.count > key.answers.length)
    throw optionsError(
      pathOf(prefix, "key.count"),
      `the count ${key.count} is above the ${key.answers.length} answers.`,
    );
  checkLengthRule(key.length, pathOf(prefix, "key.length"));
  let states = 0;
  const compile = (pattern: string, path: string): XsdPattern => {
    let compiled: ReturnType<typeof compileCountedXsdRegex>;
    try {
      compiled = compileCountedXsdRegex(pattern, KEY_PATTERN_STATES - states);
    } catch (error) {
      throw optionsError(path, `the pattern does not compile: ${(error as Error).message}`, { cause: error });
    }
    if (compiled === undefined)
      throw new SecurityError(
        `The patterns of the key at ${pathOf(prefix, "key")} need more than ${KEY_PATTERN_STATES} states together, over the limit maxStates.`,
        "maxStates",
        KEY_PATTERN_STATES,
      );
    states += compiled.states;
    return compiled.pattern;
  };
  const answers = key.answers.map((answer, index) =>
    prepareAnswer(answer, key, pathOf(prefix, `key.answers[${index}]`), compile),
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

/**
 * Prepares an answer of a text key.
 *
 * @param compile - Compiles a pattern of the key, within the states that the key's patterns share.
 */
function prepareAnswer(
  answer: TextKeyData["answers"][number],
  key: TextKeyData,
  path: string,
  compile: (pattern: string, path: string) => XsdPattern,
): PreparedAnswer {
  if (answer.texts.length === 0 && answer.patterns.length === 0)
    throw optionsError(path, "an answer has a text or a pattern.");
  const patterns = answer.patterns.map((pattern, index) => compile(pattern, `${path}.patterns[${index}]`));
  const normalized = answer.texts.map((text) => normalizeText(text, key.normalization));
  const numbers = key.numericEquivalence ? normalized.flatMap((text) => numberOf(text) ?? []) : [];
  return {
    texts: new Set(normalized),
    numbers: new Set(numbers),
    codePoints: normalized.map(codePointsOf),
    patterns,
    points: answer.points,
  };
}

/**
 * Whether a normalized string matches an answer: it equals one of its texts, fully matches one of its patterns, or with
 * `numericEquivalence` reads as the value of one of its texts.
 */
function matches(answer: PreparedAnswer, text: string, number: string | undefined): boolean {
  return (
    answer.texts.has(text) ||
    (number !== undefined && answer.numbers.has(number)) ||
    answer.patterns.some((pattern) => pattern.matches(text))
  );
}

/** The most edits that a tier's tolerance allows from an accepted text of a length, or -1 when it allows none. */
function allowedEdits({ absolute, relative }: PreparedText["tiers"][number]["tolerance"], length: number): number {
  return Math.floor(Math.max(absolute ?? -1, relative === null ? -1 : relative * length));
}

/**
 * The share of an answer's points that a string earns by the credit tiers: the first tier, highest share first, whose
 * tolerance holds for the edit distance to one of the answer's texts, measured within `maxEditBand`. Each distance is measured
 * once, as far as the widest tier reaches, whatever the count of tiers.
 */
function creditOf(tiers: PreparedText["tiers"], answer: PreparedAnswer, text: readonly number[], band: number): number {
  const distances = answer.codePoints.map((accepted) => {
    const widest = tiers.reduce((most, tier) => Math.max(most, allowedEdits(tier.tolerance, accepted.length)), -1);
    return widest < 0 ? undefined : boundedEditDistance(text, accepted, Math.min(band, widest));
  });
  const tier = tiers.find(({ tolerance }) =>
    answer.codePoints.some((accepted, at) => {
      const distance = distances[at];
      return distance !== undefined && distance <= allowedEdits(tolerance, accepted.length);
    }),
  );
  return tier?.share ?? 0;
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
  const numbers = candidates.map((text) => (key.numericEquivalence ? numberOf(text) : undefined));
  const edges = prepared.answers.map((answer) =>
    candidates.flatMap((text, index) => (matches(answer, text, numbers[index]) ? [index] : [])),
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
