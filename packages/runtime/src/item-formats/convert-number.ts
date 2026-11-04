import { isRecord } from "../checks.js";
import { buildSingle, type Value } from "../values/index.js";
import type { XmlElement } from "../xml/index.js";
import {
  asGrade,
  type ConvertContext,
  descendants,
  elements,
  type ItemView,
  mapEntries,
  markOf,
  Omitted,
  rankAnswers,
  readCorrect,
  SAME,
  textOf,
} from "./item-view.js";
import { attribute, type Probe, type ProbeResult } from "./probe.js";
import { emptyText, type NumberAnswer, type Question, type QuestionCommon } from "./question.js";

// A text entry of a number as Moodle's numerical question: the values and intervals that the item's declaration and
// processing name, each an answer of a value and a tolerance with the credit that the item gives it, in order of credit.

/** An interval of numbers that an item accepts as one answer: a value, and how far below and above it reaches. */
interface Interval {
  readonly value: number;
  readonly below: number;
  readonly above: number;
}

/** An interval that earns credit or shows feedback of its own. */
interface Kept {
  readonly interval: Interval;
  readonly result: ProbeResult;
  readonly fraction: number;
}

function low({ value, below }: Interval): number {
  return value - below;
}

function high({ value, above }: Interval): number {
  return value + above;
}

function numberAttribute(element: XmlElement, name: string): number[] {
  return (attribute(element, name) ?? "")
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "")
    .map(Number);
}

/** The interval of a `qti-equal` of a value and its tolerance, absolute or in percent of the value. */
function equalInterval(element: XmlElement, value: number, view: ItemView): Interval {
  const mode = attribute(element, "tolerance-mode") ?? "exact";
  const [lower = 0, upper = lower] = numberAttribute(element, "tolerance");
  if (attribute(element, "include-lower-bound") === "false" || attribute(element, "include-upper-bound") === "false") {
    view.losses.push({
      reason: "scoring",
      message: `The interval around ${value} leaves out its bounds; Moodle's tolerance holds them.`,
    });
  }
  if (mode === "absolute") return { value, below: Math.abs(lower), above: Math.abs(upper) };
  if (mode === "relative")
    return { value, below: (Math.abs(value) * lower) / 100, above: (Math.abs(value) * upper) / 100 };
  return { value, below: 0, above: 0 };
}

/** The interval of a key of `number-equivalent`: its value and the wider of its tolerances. */
function keyInterval(key: Readonly<Record<string, unknown>>): Interval | undefined {
  if (typeof key.value !== "number") return undefined;
  const tolerance = isRecord(key.tolerance) ? key.tolerance : {};
  const absolute = typeof tolerance.absolute === "number" ? tolerance.absolute : 0;
  const relative = typeof tolerance.relative === "number" ? Math.abs(key.value) * tolerance.relative : 0;
  const width = Math.max(absolute, relative);
  return { value: key.value, below: width, above: width };
}

/** Collects the intervals of every object in the JSON of a key. */
function collectIntervals(value: unknown, intervals: Interval[]): void {
  if (Array.isArray(value)) for (const item of value) collectIntervals(item, intervals);
  if (!isRecord(value)) return;
  const interval = keyInterval(value);
  if (interval !== undefined) intervals.push(interval);
  for (const item of Object.values(value)) collectIntervals(item, intervals);
}

/** The values and tolerances in the key of a call of `number-equivalent`. */
function operatorIntervals(element: XmlElement): Interval[] {
  const options = element.attributes.find(({ name }) => name === "options")?.value;
  if (options === undefined) return [];
  const intervals: Interval[] = [];
  try {
    collectIntervals(JSON.parse(options), intervals);
  } catch {
    return [];
  }
  return intervals;
}

/** The intervals that one element of the response processing names. */
function intervalsOf(element: XmlElement, view: ItemView): Interval[] {
  if (element.name === "qti-custom-operator") return operatorIntervals(element);
  const value = elements(element, "qti-base-value").map((base) => Number(textOf(base)))[0];
  if (value === undefined || !Number.isFinite(value)) return [];
  if (element.name === "qti-equal") return [equalInterval(element, value, view)];
  if (element.name === "qti-equal-rounded") {
    view.losses.push({
      reason: "scoring",
      message: `The rounding to compare with ${value} has no place in Moodle: the value must be exact.`,
    });
  }
  return element.name === "qti-match" || element.name === "qti-equal-rounded" ? [{ value, below: 0, above: 0 }] : [];
}

/** The values and intervals of numbers that an item's declaration and processing name, each once. */
function numberCandidates(view: ItemView): Interval[] {
  const intervals: Interval[] = [
    ...readCorrect(view.declaration),
    ...mapEntries(view.declaration).map((entry) => attribute(entry, "map-key") ?? ""),
  ]
    .map(Number)
    .filter(Number.isFinite)
    .map((value) => ({ value, below: 0, above: 0 }));
  const processing = elements(view.tree, "qti-response-processing")[0];
  for (const element of processing === undefined ? [] : descendants(processing, () => true)) {
    for (const interval of intervalsOf(element, view)) intervals.push(interval);
  }
  const unique = new Map<string, Interval>();
  for (const interval of intervals) unique.set(`${low(interval)} ${high(interval)}`, interval);
  return [...unique.values()];
}

/**
 * The point of an interval that the fewest other intervals hold: its value, or a bound, so that the credit of an interval
 * around a narrower one is read where the narrower one does not answer first.
 */
function ownPoint(interval: Interval, all: readonly Interval[]): number {
  const holders = (point: number) =>
    all.filter((other) => other !== interval && low(other) <= point && point <= high(other)).length;
  let best = interval.value;
  for (const point of [low(interval), high(interval)]) if (holders(point) < holders(best)) best = point;
  return best;
}

/** Whether an answer lies within another of the same credit, which Moodle's order makes useless. */
function isRedundant(answer: Kept, index: number, all: readonly Kept[]): boolean {
  return all.some(
    (other, at) =>
      at !== index &&
      other.fraction === answer.fraction &&
      low(other.interval) <= low(answer.interval) &&
      high(answer.interval) <= high(other.interval) &&
      (low(other.interval) < low(answer.interval) || high(answer.interval) < high(other.interval) || at < index),
  );
}

/** Checks that the item scores the bounds of an interval as its value, as Moodle's tolerance does. */
function checkBounds(
  probe: Probe,
  value: (number: number) => Value | null,
  kept: Kept,
  mark: number,
  view: ItemView,
): void {
  for (const bound of [low(kept.interval), high(kept.interval)]) {
    if (Math.abs((probe.run(value(bound)).score ?? 0) / mark - kept.fraction) > SAME) {
      view.losses.push({
        reason: "scoring",
        message: `The item scores ${bound} unlike ${kept.interval.value}, which Moodle's tolerance around it holds alike.`,
      });
    }
  }
}

/** The answer of an interval: its value and tolerance, from its middle when it reaches unlike below and above. */
function answerOf({ interval }: Kept): Pick<NumberAnswer, "value" | "tolerance"> {
  if (interval.below === interval.above) return { value: interval.value, tolerance: interval.below };
  return { value: (low(interval) + high(interval)) / 2, tolerance: (high(interval) - low(interval)) / 2 };
}

/** Converts a text entry of a number into a numerical question. */
export function convertNumerical(
  probe: Probe,
  view: ItemView,
  common: QuestionCommon,
  baseType: "integer" | "float",
  context: ConvertContext,
): Question {
  const candidates = numberCandidates(view);
  if (candidates.length > context.limits.maxAnswers) {
    throw new Omitted(
      `The item names ${candidates.length} answers, over the limit maxAnswers of ${context.limits.maxAnswers}.`,
    );
  }
  const value = (number: number) => {
    if (baseType === "float") return buildSingle("float", number);
    const rounded = Math.round(number);
    return Number.isSafeInteger(rounded) ? buildSingle("integer", rounded) : null;
  };
  const results = candidates.map((interval) => probe.run(value(ownPoint(interval, candidates))));
  const mark = markOf(view, results, "numerical question");
  let outside = 1;
  for (const interval of candidates)
    outside = Math.max(outside, Math.abs(high(interval)) * 2 + Math.abs(low(interval)) + 1);
  const wrong = probe.run(value(Math.round(outside)));
  const kept: Kept[] = candidates.flatMap((interval, index) => {
    const result = results[index];
    return result === undefined || ((result.score ?? 0) === 0 && result.shown.length === 0)
      ? []
      : [{ interval, result, fraction: (result.score ?? 0) / mark }];
  });
  for (const answer of kept) checkBounds(probe, value, answer, mark, view);
  const ordered = [...kept]
    .sort((left, right) => right.fraction - left.fraction)
    .filter((answer, index, all) => !isRedundant(answer, index, all));
  const { feedback, other } = rankAnswers(view, ordered, wrong, mark);
  const answers: NumberAnswer[] = ordered.map((answer, index) => ({
    ...answerOf(answer),
    fraction: asGrade(answer.fraction, `the answer ${answer.interval.value}`, view),
    feedback: feedback.answers.get(index) ?? emptyText(),
  }));
  if (other !== undefined) answers.push({ value: null, tolerance: 0, ...other });
  if (answers.length === 0) throw new Omitted("The item names no number that earns credit.");
  return { ...common, defaultMark: mark, generalFeedback: feedback.general, qtype: "numerical", answers };
}
