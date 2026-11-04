import type { CustomOperator } from "../processing/index.js";
import type { Value } from "../values/index.js";
import { collectText, listChildElements, type XmlElement, type XmlNode } from "../xml/index.js";
import { type HtmlVisitor, writeHtml } from "./body-html.js";
import { findGrade, nearestGrade } from "./grades.js";
import type { ItemLoss } from "./item-build.js";
import type { ItemFormatLimits } from "./limits.js";
import type { FeedbackElement, Probe, ProbeResult } from "./probe.js";
import { type CombinedFeedback, emptyText, type FormattedText, percent } from "./question.js";

// What the writer knows of an item while it converts it, and the helpers that each type of question shares: the item's XML,
// the samples of its response processing, the feedback each shows, and Moodle's grades.

/** The share of the mark above which a response counts as right, and below which wrong, as Moodle's states. */
const RIGHT = 0.999999;
const WRONG = 0.000001;
/** How far two scores may differ and still be the same, as a share of the mark: floats of a sum differ in their last bits. */
export const SAME = 1e-9;

/** The context of the items that a writer converts. */
export interface ConvertContext {
  readonly operators: ReadonlyMap<string, CustomOperator>;
  readonly limits: Pick<ItemFormatLimits, "maxAnswers">;
}

/** An item left out, by the reason in the message. */
export class Omitted {
  readonly message: string;

  constructor(message: string) {
    this.message = message;
  }
}

/** What the writer knows of an item while it converts it. */
export interface ItemView {
  readonly tree: XmlElement;
  readonly feedback: readonly FeedbackElement[];
  /** The declaration of the interaction's response. */
  readonly declaration: XmlElement | undefined;
  /** The mark that the item declares, if it does. */
  readonly mark: number | undefined;
  readonly losses: ItemLoss[];
  readonly visitor: HtmlVisitor;
  /** The information for scorers of the item's rubric blocks. */
  readonly graderInfo: string[];
}

/** A response that the writer runs, with the answers of Moodle's question it stands for and the credit it earns. */
export interface Sample {
  readonly answers: readonly number[];
  readonly result: ProbeResult;
  readonly fraction: number;
}

/** The child elements of an element, of a name if one is given. */
export function elements(parent: XmlElement, name?: string): XmlElement[] {
  return listChildElements(parent).filter((child) => name === undefined || child.name === name);
}

/** The text of the first child element of a name, empty when there is none. */
export function firstText(parent: XmlElement, name: string): string {
  const [first] = elements(parent, name);
  return first === undefined ? "" : collectText(first);
}

/** The descendants of an element that pass a test, in document order. */
export function descendants(
  parent: XmlElement,
  test: (element: XmlElement) => boolean,
  found: XmlElement[] = [],
): XmlElement[] {
  for (const child of elements(parent)) {
    if (test(child)) found.push(child);
    descendants(child, test, found);
  }
  return found;
}

/** The values of a declaration's correct response. */
export function readCorrect(declaration: XmlElement | undefined): string[] {
  if (declaration === undefined) return [];
  const correct = elements(declaration, "qti-correct-response")[0];
  return correct === undefined ? [] : elements(correct, "qti-value").map((value) => collectText(value).trim());
}

/** The map entries of a declaration's mapping. */
export function mapEntries(declaration: XmlElement | undefined): XmlElement[] {
  const mapping = declaration === undefined ? undefined : elements(declaration, "qti-mapping")[0];
  return mapping === undefined ? [] : elements(mapping, "qti-map-entry");
}

/** The HTML of content as the item's conversion takes it. */
export function html(nodes: readonly XmlNode[], view: ItemView): FormattedText {
  return { text: writeHtml(nodes, view.visitor).trim(), format: "html" };
}

/** Runs a response and returns it as a sample of the given answers. */
export function sampleOf(probe: Probe, value: Value | null, answers: readonly number[], mark: number): Sample {
  const result = probe.run(value);
  return { answers, result, fraction: (result.score ?? 0) / mark };
}

/** Returns a credit as one of Moodle's grades, with a loss when it is not one. */
export function asGrade(fraction: number, what: string, view: ItemView): number {
  const grade = findGrade(fraction);
  if (grade !== undefined) return grade;
  const nearest = nearestGrade(Math.max(-1, Math.min(1, fraction)));
  view.losses.push({
    reason: "scoring",
    message: `The credit ${percent(fraction)}% of ${what} is not one of Moodle's grades: it is written as ${percent(nearest)}%.`,
  });
  return nearest;
}

/** What the feedback of an item becomes: general, per answer, or by how right a response is. */
export interface FeedbackUse {
  readonly general: FormattedText;
  readonly answers: ReadonlyMap<number, FormattedText>;
  readonly combined: CombinedFeedback;
}

/** Where a feedback goes: Moodle's general feedback, an answer's, the feedback of a state, or nowhere. */
type Place = "general" | number | keyof CombinedFeedback | "never" | "other";

/** Finds the place of a feedback from the samples that show it. */
function placeOf(shown: ReadonlySet<Sample>, answered: readonly Sample[], answerCount: number): Place {
  if (answered.length > 0 && answered.every((sample) => shown.has(sample))) return "general";
  if (shown.size === 0) return "never";
  const exactly = (test: (sample: Sample) => boolean) =>
    answered.some(test) && answered.every((sample) => shown.has(sample) === test(sample));
  for (let answer = 0; answer < answerCount; answer += 1) {
    if (exactly((sample) => sample.answers.includes(answer))) return answer;
  }
  if (exactly(({ fraction }) => fraction > RIGHT)) return "correct";
  if (exactly(({ fraction }) => fraction >= WRONG && fraction <= RIGHT)) return "partiallyCorrect";
  if (exactly(({ fraction }) => fraction < WRONG)) return "incorrect";
  return "other";
}

function joinText(texts: readonly FormattedText[] = []): FormattedText {
  return { text: texts.map(({ text }) => text).join(""), format: "html" };
}

/** The content of a feedback element: the body of modal feedback, or the children of feedback in the item's body. */
function feedbackContent(element: XmlElement): readonly XmlNode[] {
  return element.name === "qti-modal-feedback"
    ? elements(element, "qti-content-body").flatMap((body) => body.children)
    : element.children;
}

/**
 * Sorts the feedback of an item by the responses that show it: every response, those of one answer, those of a right,
 * partly right or wrong score; any other feedback is lost, which the losses say.
 */
export function classifyFeedback(view: ItemView, samples: readonly Sample[], answerCount: number): FeedbackUse {
  const placed = new Map<Place, FormattedText[]>();
  const answered = samples.filter(({ answers }) => answers.length > 0);
  for (const [index, feedback] of view.feedback.entries()) {
    const place = placeOf(new Set(samples.filter(({ result }) => result.shown.includes(index))), answered, answerCount);
    if (place === "never" || place === "other") {
      view.losses.push({
        reason: "feedback",
        message:
          place === "never"
            ? `The feedback ${feedback.identifier} shows for no response that Moodle tells apart: it is left out.`
            : `The feedback ${feedback.identifier} shows for responses that no answer or score of Moodle singles out: it is left out.`,
      });
      continue;
    }
    placed.set(place, [...(placed.get(place) ?? []), html(feedbackContent(feedback.element), view)]);
  }
  const answers = new Map<number, FormattedText>();
  for (const [place, texts] of placed) if (typeof place === "number") answers.set(place, joinText(texts));
  return {
    general: joinText(placed.get("general")),
    answers,
    combined: {
      correct: joinText(placed.get("correct")),
      partiallyCorrect: joinText(placed.get("partiallyCorrect")),
      incorrect: joinText(placed.get("incorrect")),
    },
  };
}

/** The mark of the answers that an item names: the declared mark, else the best score of their results. */
export function markOf(view: ItemView, results: readonly ProbeResult[], question: string): number {
  let best = 0;
  for (const { score } of results) best = Math.max(best, score ?? 0);
  const mark = view.mark ?? best;
  if (!(mark > 0))
    throw new Omitted(`No answer of the item earns credit, and Moodle's ${question} needs one that does.`);
  return mark;
}

/** The feedback of answers in Moodle's order, and the answer `*` for any other response when it earns credit or feedback. */
export interface RankedAnswers {
  readonly feedback: FeedbackUse;
  readonly other: { readonly fraction: number; readonly feedback: FormattedText } | undefined;
}

/** Sorts the feedback of answers that Moodle tries in order, with a response that matches none of them. */
export function rankAnswers(
  view: ItemView,
  ordered: readonly { readonly result: ProbeResult; readonly fraction: number }[],
  wrong: ProbeResult,
  mark: number,
): RankedAnswers {
  const wrongFraction = (wrong.score ?? 0) / mark;
  const samples: Sample[] = [
    ...ordered.map((answer, index) => ({ answers: [index], result: answer.result, fraction: answer.fraction })),
    { answers: [ordered.length], result: wrong, fraction: wrongFraction },
  ];
  const feedback = classifyFeedback(view, samples, ordered.length + 1);
  const wrongFeedback = feedback.answers.get(ordered.length);
  const other =
    wrongFraction !== 0 || wrongFeedback !== undefined
      ? { fraction: asGrade(wrongFraction, "any other answer", view), feedback: wrongFeedback ?? emptyText() }
      : undefined;
  return { feedback, other };
}
