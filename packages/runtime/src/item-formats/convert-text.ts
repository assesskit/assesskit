import { buildSingle } from "../values/index.js";
import { collectText, findAttribute, type XmlElement } from "../xml/index.js";
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
} from "./item-view.js";
import { operatorKey } from "./operator-key.js";
import type { Probe, ProbeResult } from "./probe.js";
import { emptyText, type Question, type QuestionCommon, type TextAnswer } from "./question.js";

// A text entry of a string as Moodle's short answer: the answers that the item's declaration and processing name, each with
// the credit that the item's response processing gives it, in order of credit, Moodle taking the first that matches.

/** The characters that a pattern of XSD escapes to stand for themselves. */
const PATTERN_MARKS = "\\|.-^?*+{}()[]";

/** An answer that the item names: its text in Moodle's terms, and the response that stands for it. */
interface Candidate {
  readonly text: string;
  readonly sample: string;
  /** Whether a pattern names it, which says how its case is matched; `undefined` when it holds no letter. */
  readonly pattern: boolean;
  readonly caseSensitive?: boolean | undefined;
}

/** An answer that earns credit or shows feedback of its own. */
interface Kept extends Candidate {
  readonly result: ProbeResult;
  readonly fraction: number;
}

/** A pattern read as an answer: its text with Moodle's wildcards, and whether its letters keep their case. */
interface PatternAnswer {
  readonly text: string;
  readonly caseSensitive: boolean | undefined;
}

/** One piece of a pattern: what it adds to the answer, and whether it is a class of both cases or a letter of one. */
type Piece =
  | { readonly text: string; readonly length: number; readonly kind: "class" | "letter" | "other" }
  | undefined;

/** A class of a letter in both cases, the letter as the answer writes it first. */
function classPiece(rest: string): Piece {
  const close = rest.indexOf("]");
  const [first = "", other = "", ...more] = [...rest.slice(1, close)];
  const pair =
    (first.toUpperCase() === other && other.toLowerCase() === first) ||
    (first.toLowerCase() === other && other.toUpperCase() === first);
  return close > 0 && more.length === 0 && pair && first !== other
    ? { text: first, length: close + 1, kind: "class" }
    : undefined;
}

function readPiece(rest: string): Piece {
  if (rest.startsWith(".*")) return { text: "*", length: 2, kind: "other" };
  if (rest.startsWith("\\")) {
    const escaped = rest.charAt(1);
    if (escaped === "" || !PATTERN_MARKS.includes(escaped)) return undefined;
    return { text: escaped === "*" ? "\\*" : escaped, length: 2, kind: "other" };
  }
  if (rest.startsWith("[")) return classPiece(rest);
  const character = String.fromCodePoint(rest.codePointAt(0) ?? 0);
  if ("|.?*+{}()]".includes(character)) return undefined;
  const letter = character.toLowerCase() !== character.toUpperCase();
  return { text: character, length: character.length, kind: letter ? "letter" : "other" };
}

/**
 * Reads a pattern that is an answer with Moodle's wildcards between optional spaces, as `answerPattern` writes one: its
 * answer, and whether its letters keep their case. Any other pattern returns `undefined`.
 */
function readPattern(pattern: string): PatternAnswer | undefined {
  if (!pattern.startsWith("\\s*") || !pattern.endsWith("\\s*") || pattern.length < 6) return undefined;
  const body = pattern.slice(3, -3);
  let text = "";
  const kinds = new Set<string>();
  for (let at = 0; at < body.length; ) {
    const piece = readPiece(body.slice(at));
    if (piece === undefined) return undefined;
    text += piece.text;
    kinds.add(piece.kind);
    at += piece.length;
  }
  if (kinds.has("class") && kinds.has("letter")) return undefined;
  return { text, caseSensitive: kinds.has("class") ? false : kinds.has("letter") ? true : undefined };
}

/** The accepted texts in the key of an operator call, as `buildOperatorCall` writes it in the attribute `options`. */
function operatorTexts(element: XmlElement): string[] {
  const key = operatorKey(element);
  return key?.kind === "text" ? key.answers.flatMap(({ texts }) => texts) : [];
}

/** Collects the answers that one element of the response processing names. */
function collect(element: XmlElement, texts: string[], patterns: Candidate[], view: ItemView): void {
  if (element.name === "qti-base-value" && findAttribute(element, "base-type") === "string")
    texts.push(collectText(element));
  else if (element.name === "qti-custom-operator") for (const text of operatorTexts(element)) texts.push(text);
  else if (element.name === "qti-pattern-match") {
    const answer = readPattern(findAttribute(element, "pattern") ?? "");
    if (answer === undefined) {
      view.losses.push({
        reason: "scoring",
        message: `The pattern ${findAttribute(element, "pattern")} is not an answer with Moodle's wildcards: it is left out.`,
      });
    } else {
      const sample = answer.text.replaceAll(/(?<!\\)\*+/g, "").replaceAll("\\*", "*");
      patterns.push({ text: answer.text, sample, pattern: true, caseSensitive: answer.caseSensitive });
    }
  }
}

/** The answers of a short answer that an item's declaration and processing name: the responses to try. */
function textCandidates(view: ItemView): Candidate[] {
  const texts = [
    ...readCorrect(view.declaration),
    ...mapEntries(view.declaration).map((entry) => findAttribute(entry, "map-key") ?? ""),
  ];
  const patterns: Candidate[] = [];
  const processing = elements(view.tree, "qti-response-processing")[0];
  for (const element of processing === undefined ? [] : descendants(processing, () => true)) {
    collect(element, texts, patterns, view);
  }
  // A pattern says how its answer is matched; the same text named elsewhere adds nothing.
  const plain = [...new Set(texts.filter((text) => text.trim() !== ""))]
    .filter((text) => !patterns.some(({ sample }) => sample === text))
    .map((text) => ({ text, sample: text, pattern: false }));
  return [...plain, ...patterns];
}

function swapCase(text: string): string {
  return [...text]
    .map((character) => (character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase()))
    .join("");
}

/** A string that no answer is, for the response that matches none. */
function noAnswer(answers: readonly string[]): string {
  let text = "";
  while (answers.includes(text)) text += "";
  return text;
}

/** Whether Moodle's one rule of case holds the item's answers: case-sensitive when every answer with letters keeps it. */
function caseOf(probe: Probe, kept: readonly Kept[], view: ItemView): boolean {
  const cased = kept.flatMap(({ sample, pattern, caseSensitive, result }) => {
    if (pattern) return caseSensitive === undefined ? [] : [caseSensitive];
    if (swapCase(sample) === sample) return [];
    return [probe.run(buildSingle("string", swapCase(sample))).score !== result.score];
  });
  const sensitive = cased.length > 0 && cased.every(Boolean);
  if (cased.some(Boolean) && !sensitive) {
    view.losses.push({
      reason: "scoring",
      message:
        "Some answers keep their case and others do not; Moodle's short answer does one for all: case is ignored.",
    });
  }
  return sensitive;
}

/** Converts a text entry of a string into a short answer. */
export function convertShortAnswer(
  probe: Probe,
  view: ItemView,
  common: QuestionCommon,
  context: ConvertContext,
): Question {
  if (descendants(view.tree, ({ name }) => name === "qti-custom-operator").length > 0) {
    view.losses.push({
      reason: "scoring",
      message:
        "The item scores the text with a custom operator: Moodle takes the operator's answers as written, ignoring case at most.",
    });
  }
  const candidates = textCandidates(view);
  if (candidates.length > context.limits.maxAnswers) {
    throw new Omitted(
      `The item names ${candidates.length} answers, over the limit maxAnswers of ${context.limits.maxAnswers}.`,
    );
  }
  const results = candidates.map(({ sample }) => probe.run(sample === "" ? null : buildSingle("string", sample)));
  const mark = markOf(view, results, "short answer");
  const wrong = probe.run(buildSingle("string", noAnswer(candidates.map(({ sample }) => sample))));
  const kept: Kept[] = candidates.flatMap((candidate, index) => {
    const result = results[index];
    if (result === undefined) return [];
    const ownFeedback = result.shown.some((shown) => !wrong.shown.includes(shown));
    return (result.score ?? 0) !== 0 || ownFeedback
      ? [{ ...candidate, result, fraction: (result.score ?? 0) / mark }]
      : [];
  });
  const caseSensitive = caseOf(probe, kept, view);
  const ordered = [...kept].sort((left, right) => right.fraction - left.fraction);
  const { feedback, other } = rankAnswers(view, ordered, wrong, mark);
  const answers: TextAnswer[] = ordered.map((answer, index) => ({
    text: answer.pattern ? answer.text : answer.text.replaceAll("*", "\\*"),
    fraction: asGrade(answer.fraction, `the answer ${answer.text}`, view),
    feedback: feedback.answers.get(index) ?? emptyText(),
  }));
  if (other !== undefined) answers.push({ text: "*", ...other });
  if (answers.length === 0) throw new Omitted("The item names no answer that earns credit.");
  return {
    ...common,
    defaultMark: mark,
    generalFeedback: feedback.general,
    qtype: "shortanswer",
    caseSensitive,
    answers,
  };
}
