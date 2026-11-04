import { SecurityError } from "../errors.js";
import { findGrade } from "./grades.js";
import type { ItemFormatLimits } from "./limits.js";
import { phpEmpty, phpExplode, phpIsNumeric, phpNumber, phpSubstr, phpTrim } from "./php-strings.js";
import {
  type ChoiceAnswer,
  emptyText,
  type FormattedText,
  NO_COMBINED_FEEDBACK,
  type NumberAnswer,
  type Question,
  type QuestionCommon,
  Refused,
  type Subquestion,
  type TextAnswer,
  type TextFormat,
} from "./question.js";

// The answers of a GIFT question by the type that their marks give it, as Moodle 5.3's importer reads them
// (question/format/gift/format.php, readquestion): the split at "~", "=", "#" and "->", the weights in percent, and the
// formats that a text names in brackets.

/** The marks that a backslash escapes, and the placeholders that hide them while the importer splits the text. */
const ESCAPES: readonly (readonly [string, string, string])[] = [
  ["\\:", "&&058;", ":"],
  ["\\#", "&&035;", "#"],
  ["\\=", "&&061;", "="],
  ["\\{", "&&123;", "{"],
  ["\\}", "&&125;", "}"],
  ["\\~", "&&126;", "~"],
  ["\\n", "&&010", "\n"],
];

/** The weight of an answer, `%50%` or `%-33.33333%`, as the importer finds it. */
const WEIGHT = /^%-*([0-9]{1,2})\.?([0-9]*)%/;

/** The formats that a text may name in brackets at its start. */
const FORMATS: ReadonlyMap<string, TextFormat> = new Map([
  ["moodle", "moodle"],
  ["html", "html"],
  ["plain", "plain"],
  ["markdown", "markdown"],
]);

/** The answers of a true-false question. */
const TRUE_FALSE: ReadonlySet<string> = new Set(["T", "TRUE", "F", "FALSE"]);

/** Hides the escaped marks behind placeholders, as `escapedchar_pre` does; `\\` stands for a backslash. */
export function escapePre(text: string): string {
  let result = text.replaceAll("\\\\", "&&092;");
  for (const [escaped, placeholder] of ESCAPES) result = result.replaceAll(escaped, placeholder);
  return result.replaceAll("&&092;", "\\");
}

/** Puts the marks back in place of their placeholders, as `escapedchar_post` does. */
export function escapePost(text: string): string {
  let result = text;
  for (const [, placeholder, character] of ESCAPES) result = result.replaceAll(placeholder, character);
  return result;
}

/** Reads a text that may name its format in brackets, as `parse_text_with_format` does. */
export function withFormat(text: string, defaultFormat: TextFormat): FormattedText {
  if (!text.startsWith("[")) return { text: phpTrim(escapePost(text)), format: defaultFormat };
  // Without "]", PHP's strpos gives false, which counts as 0: the name is all but the first and last characters.
  const end = text.indexOf("]");
  const named = FORMATS.get(end < 0 ? phpSubstr(text, 1, -1) : text.slice(1, end));
  const body = named === undefined ? text : text.slice(Math.max(end, 0) + 1);
  return { text: phpTrim(escapePost(body)), format: named ?? defaultFormat };
}

/** Splits an answer at its first `#` into the answer and its feedback, as `commentparser` does. */
function splitFeedback(answer: string, format: TextFormat): readonly [FormattedText, FormattedText] {
  const [text = "", feedback] = phpExplode("#", answer, 2);
  return [
    withFormat(phpTrim(text), format),
    feedback === undefined ? emptyText(format) : withFormat(phpTrim(feedback), format),
  ];
}

/** Reads the weight that starts an answer, and returns it with the rest of the answer; `fallback` without one. */
function readWeight(answer: string, fallback: number): readonly [number, string] {
  if (!WEIGHT.test(answer)) return [fallback, answer];
  const rest = answer.slice(1);
  const end = rest.indexOf("%");
  const weight = rest.slice(0, end);
  // PHP's division throws on a string that is not numeric, as "--50" is, and Moodle's import stops there.
  if (!phpIsNumeric(weight)) throw new Refused(`The weight %${weight}% is not a number.`);
  return [phpNumber(weight) / 100, rest.slice(end + 1)];
}

/** Returns a credit as Moodle stores it: the grade of its list within 0.00001, or the credit as written. */
function asGrade(credit: number): number {
  return findGrade(credit) ?? credit;
}

/** Splits the answers at a mark and removes a first one that is empty, as the importer does. */
function splitAnswers(answerText: string, mark: string, min: number, limits: ItemFormatLimits): string[] {
  const parts = phpExplode(mark, answerText);
  parts[0] = phpTrim(parts[0] ?? "");
  if (phpEmpty(parts[0])) parts.shift();
  if (parts.length < min) throw new Refused(`A question of this type needs at least ${min} answers.`);
  if (parts.length > limits.maxAnswers) {
    throw new SecurityError(
      `A question has ${parts.length} answers, over the limit maxAnswers of ${limits.maxAnswers}.`,
      "maxAnswers",
      limits.maxAnswers,
    );
  }
  return parts;
}

function readChoices(answerText: string, format: TextFormat, limits: ItemFormatLimits): readonly ChoiceAnswer[] {
  return splitAnswers(answerText.replaceAll("=", "~="), "~", 2, limits).map((raw) => {
    const answer = phpTrim(raw);
    const [fraction, rest] = answer.startsWith("=") ? [1, answer.slice(1)] : readWeight(answer, 0);
    const [text, feedback] = splitFeedback(rest, format);
    return { text, fraction: asGrade(fraction), feedback };
  });
}

function readTextAnswers(answerText: string, format: TextFormat, limits: ItemFormatLimits): readonly TextAnswer[] {
  return splitAnswers(answerText, "=", 1, limits).map((raw) => {
    const [fraction, rest] = readWeight(phpTrim(raw), 1);
    const [text, feedback] = splitFeedback(rest, format);
    return { text: text.text, fraction: asGrade(fraction), feedback };
  });
}

/** Reads a bound of a range as PHP's arithmetic does, which throws on a string that is not a number. */
function rangeNumber(text: string): number {
  if (phpIsNumeric(text)) return phpNumber(text);
  throw new Refused(`The bound ${text} of a range is not a number.`);
}

/** Reads a value: `min..max`, `value:tolerance` or `value`; a value that is not a number becomes `*`, as in the importer. */
function readValue(written: string): Pick<NumberAnswer, "value" | "tolerance"> {
  const range = written.indexOf("..");
  if (range > 0) {
    const max = rangeNumber(phpTrim(written.slice(range + 2)));
    const min = rangeNumber(phpTrim(written.slice(0, range)));
    const middle = (max + min) / 2;
    return { value: middle, tolerance: max - middle };
  }
  const colon = written.indexOf(":");
  const tolerance = colon > 0 ? phpTrim(written.slice(colon + 1)) : "0";
  const number = phpTrim(colon > 0 ? written.slice(0, colon) : written);
  if (!phpIsNumeric(tolerance)) throw new Refused(`The tolerance ${tolerance} is not a number.`);
  // The importer tests `is_numeric($ans) || $ans = '*'`: an answer that is not a number becomes `*`.
  return phpIsNumeric(number)
    ? { value: phpNumber(number), tolerance: phpNumber(tolerance) }
    : { value: null, tolerance: 0 };
}

function readNumbers(answerText: string, format: TextFormat, limits: ItemFormatLimits): readonly NumberAnswer[] {
  const text = answerText.slice(1);
  const tilde = text.indexOf("~");
  const right = tilde < 0 ? text : text.slice(0, tilde);
  const answers: NumberAnswer[] = splitAnswers(right, "=", 1, limits).map((raw) => {
    const [fraction, rest] = readWeight(phpTrim(raw), 1);
    const [value, feedback] = splitFeedback(rest, format);
    return { ...readValue(value.text), fraction: asGrade(fraction), feedback };
  });
  if (tilde >= 0)
    answers.push({ value: null, tolerance: 0, fraction: 0, feedback: splitFeedback(text.slice(tilde), format)[1] });
  return answers;
}

function readSubquestions(answerText: string, format: TextFormat, limits: ItemFormatLimits): readonly Subquestion[] {
  return splitAnswers(answerText, "=", 2, limits).map((raw) => {
    const pair = phpTrim(raw);
    const arrow = pair.indexOf("->");
    if (arrow < 0) throw new Refused(`The pair ${escapePost(pair)} of a matching question has no "->".`);
    return { text: withFormat(pair.slice(0, arrow), format), answer: phpTrim(escapePost(pair.slice(arrow + 2))) };
  });
}

function readTrueFalse(common: QuestionCommon, answerText: string): Question {
  const format = common.text.format;
  const [answer = "", wrong, right] = phpExplode("#", answerText, 3);
  const value = withFormat(phpTrim(answer), format).text;
  const wrongFeedback = wrong === undefined ? emptyText(format) : withFormat(phpTrim(wrong), format);
  const rightFeedback = right === undefined ? emptyText(format) : withFormat(phpTrim(right), format);
  const correct = value === "T" || value === "TRUE";
  return {
    ...common,
    qtype: "truefalse",
    penalty: 1,
    correct,
    feedbackTrue: correct ? rightFeedback : wrongFeedback,
    feedbackFalse: correct ? wrongFeedback : rightFeedback,
  };
}

function isTrueFalse(answerText: string): boolean {
  const hash = answerText.indexOf("#");
  return TRUE_FALSE.has(hash > 0 ? phpTrim(answerText.slice(0, hash)) : answerText);
}

/**
 * Reads the answers of a question by the type that their marks give it, in the importer's order: none for an essay, `#`
 * first for a numerical question, `~` for a multiple choice, `=` with `->` for a matching question, T or F for true or
 * false, and a short answer otherwise.
 *
 * @throws `Refused` for a question that Moodle refuses.
 * @throws `SecurityError` past `maxAnswers`.
 */
export function readAnswers(common: QuestionCommon, answerText: string, limits: ItemFormatLimits): Question {
  const format = common.text.format;
  if (answerText === "") {
    return {
      ...common,
      qtype: "essay",
      responseFormat: "editor",
      responseRequired: true,
      fieldLines: 15,
      minWords: null,
      maxWords: null,
      attachments: 0,
      graderInfo: emptyText(),
      template: emptyText(),
    };
  }
  if (answerText.startsWith("#"))
    return { ...common, qtype: "numerical", answers: readNumbers(answerText, format, limits) };
  if (answerText.includes("~")) {
    return {
      ...common,
      qtype: "multichoice",
      single: answerText.includes("="),
      shuffle: true,
      numbering: "abc",
      answers: readChoices(answerText, format, limits),
      combined: NO_COMBINED_FEEDBACK,
    };
  }
  if (answerText.includes("=") && answerText.includes("->")) {
    const subquestions = readSubquestions(answerText, format, limits);
    return { ...common, qtype: "match", shuffle: true, subquestions, combined: NO_COMBINED_FEEDBACK };
  }
  if (isTrueFalse(answerText)) return readTrueFalse(common, answerText);
  return {
    ...common,
    qtype: "shortanswer",
    caseSensitive: false,
    answers: readTextAnswers(answerText, format, limits),
  };
}
