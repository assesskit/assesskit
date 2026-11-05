import {
  addLoss,
  type ExportEntry,
  type ExportPlan,
  moodleRefusal,
  omitEntry,
  planExport,
  sortedLosses,
} from "./export-items.js";
import { isRelative, listReferences } from "./file-references.js";
import type { BankItem, ExportedItems, WriteItemsOptions } from "./model.js";
import { type FormattedText, hasCombined, type Question } from "./question.js";

// GIFT as Moodle's exporter writes it (question/format/gift/format.php), so that its importer reads each question back: the
// reserved marks escaped, the text of each question in HTML, and the answers in braces after the text or at the missing word.

/** Escapes the marks that GIFT reserves, and line breaks, as the exporter's `repchar` does. */
function escapeGift(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("#", "\\#")
    .replaceAll("=", "\\=")
    .replaceAll("~", "\\~")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll(":", "\\:")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "");
}

/** The names of formats that a text in brackets at its start would be read as. */
const FORMAT_NAMES = ["[html]", "[moodle]", "[plain]", "[markdown]"];

/** Writes a text of the question's format, naming the format when the text itself starts with a bracket. */
function writeText(text: string): string {
  const named = text.startsWith("[") ? "[html]" : "";
  return named + escapeGift(text);
}

/** Writes a credit in percent as the exporter does, `fraction * 100` to seven significant decimals of the fraction. */
function weight(fraction: number): string {
  return `%${Math.round(fraction * 1e7) / 1e5}%`;
}

function feedbackOf(text: FormattedText): string {
  return text.text === "" ? "" : `#${writeText(text.text)}`;
}

function generalFeedback(question: Question): string {
  return question.generalFeedback.text === "" ? "" : `\t####${writeText(question.generalFeedback.text)}\n`;
}

type Of<T extends Question["qtype"]> = Extract<Question, { qtype: T }>;

function writeTrueFalse(question: Of<"truefalse">): string {
  const right = question.correct ? question.feedbackTrue : question.feedbackFalse;
  const wrong = question.correct ? question.feedbackFalse : question.feedbackTrue;
  let answer = question.correct ? "TRUE" : "FALSE";
  if (wrong.text !== "") answer += `#${writeText(wrong.text)}`;
  else if (right.text !== "") answer += "#";
  if (right.text !== "") answer += `#${writeText(right.text)}`;
  const general = question.generalFeedback.text === "" ? "" : `####${writeText(question.generalFeedback.text)}`;
  return `{${answer}${general}}`;
}

function writeChoices(question: Of<"multichoice">, entry: ExportEntry, plan: ExportPlan): string {
  if (question.single && !question.answers.some(({ fraction }) => fraction === 1)) {
    addLoss(plan, entry, {
      reason: "scoring",
      message:
        "No answer earns 100%, and GIFT reads such a question as one of several answers: Moodle lets a candidate choose more than one.",
    });
  }
  // GIFT knows a multiple choice by its "~": only the first right answer takes "=", which also makes it single.
  const first = question.single ? question.answers.findIndex(({ fraction }) => fraction === 1) : -1;
  const lines = question.answers.map(({ text, fraction, feedback }, index) => {
    const mark = index === first ? "=" : fraction === 0 ? "~" : `~${weight(fraction)}`;
    return `\t${mark}${writeText(text.text)}${feedbackOf(feedback)}\n`;
  });
  return `{\n${lines.join("")}${generalFeedback(question)}}`;
}

function writeShortAnswers(question: Of<"shortanswer">, entry: ExportEntry, plan: ExportPlan): string {
  if (question.caseSensitive) {
    addLoss(plan, entry, {
      reason: "scoring",
      message: "GIFT's short answers ignore case: the answers' case no longer counts.",
    });
  }
  const lines = question.answers.map(({ text, fraction, feedback }) => {
    const answer = FORMAT_NAMES.some((name) => text.startsWith(name)) ? `[plain]${text}` : text;
    return `\t=${fraction === 1 ? "" : weight(fraction)}${escapeGift(answer)}${feedbackOf(feedback)}\n`;
  });
  return `{\n${lines.join("")}${generalFeedback(question)}}`;
}

function writeNumbers(question: Of<"numerical">, entry: ExportEntry, plan: ExportPlan): string {
  const lines: string[] = [];
  for (const { value, tolerance, fraction, feedback } of question.answers) {
    if (value !== null) {
      lines.push(`\t=${fraction === 1 ? "" : weight(fraction)}${value}:${tolerance}${feedbackOf(feedback)}\n`);
      continue;
    }
    if (fraction !== 0) {
      addLoss(plan, entry, {
        reason: "scoring",
        message: `GIFT gives any other number no credit, where the item gives ${weight(fraction).slice(1, -1)}.`,
      });
    }
    lines.push(`\t~${feedbackOf(feedback)}\n`);
    break;
  }
  return `{#\n${lines.join("")}${generalFeedback(question)}}`;
}

function writeMatch(question: Of<"match">, entry: ExportEntry, plan: ExportPlan): string {
  const lines = question.subquestions.map(({ text, answer }) => {
    if (answer.includes("->")) {
      addLoss(plan, entry, {
        reason: "content",
        message: `The answer "${answer}" holds "->", which GIFT reads as a pair: it is written "- >".`,
      });
    }
    return `\t=${writeText(text.text)} -> ${escapeGift(answer.replaceAll("->", "- >"))}\n`;
  });
  return `{\n${lines.join("")}${generalFeedback(question)}}`;
}

/** Writes the answers of a question in braces, or returns `undefined` for a description, which has none. */
function writeAnswers(question: Question, entry: ExportEntry, plan: ExportPlan): string | undefined {
  switch (question.qtype) {
    case "description":
      return undefined;
    case "essay":
      return `{${question.generalFeedback.text === "" ? "" : `####${writeText(question.generalFeedback.text)}`}}`;
    case "truefalse":
      return writeTrueFalse(question);
    case "multichoice":
      return writeChoices(question, entry, plan);
    case "shortanswer":
      return writeShortAnswers(question, entry, plan);
    case "numerical":
      return writeNumbers(question, entry, plan);
    case "match":
      return writeMatch(question, entry, plan);
  }
}

/** Records what GIFT does not hold of an essay. */
function recordEssayLosses(question: Of<"essay">, entry: ExportEntry, plan: ExportPlan): void {
  if (question.graderInfo.text !== "") {
    addLoss(plan, entry, {
      reason: "content",
      message: "GIFT has no information for graders: the scorers' rubric is left out.",
    });
  }
  if (question.template.text !== "" || question.responseFormat !== "editor" || question.fieldLines !== 15) {
    addLoss(plan, entry, {
      reason: "setting",
      message: "GIFT has no options of an essay: Moodle's defaults replace the item's format, lines and starting text.",
    });
  }
}

/** Whether a question has feedback by how right a response is. */
function hasCombinedFeedback(question: Question): boolean {
  return (question.qtype === "multichoice" || question.qtype === "match") && hasCombined(question.combined);
}

/** Records what GIFT does not hold of a question. */
function recordLosses(question: Question, entry: ExportEntry, plan: ExportPlan): void {
  const files = textsOf(question).flatMap((text) => listReferences(text).filter(isRelative));
  if (files.length > 0) {
    addLoss(plan, entry, {
      reason: "content",
      message: `GIFT holds no files: the references ${[...new Set(files)].join(", ")} stay as written, where Moodle finds none.`,
    });
  }
  if (question.defaultMark !== 1 && question.qtype !== "description") {
    addLoss(plan, entry, {
      reason: "setting",
      message: `GIFT has no mark: Moodle gives the question 1 mark, not ${question.defaultMark}, and its credits stay shares of it.`,
    });
  }
  if ((question.qtype === "multichoice" || question.qtype === "match") && !question.shuffle) {
    addLoss(plan, entry, {
      reason: "setting",
      message: "GIFT does not say whether to shuffle: Moodle shuffles the answers, as is its default.",
    });
  }
  if (hasCombinedFeedback(question)) {
    addLoss(plan, entry, {
      reason: "feedback",
      message: "GIFT has no feedback by how right a response is: it is left out.",
    });
  }
  if (question.qtype === "description" && question.generalFeedback.text !== "") {
    addLoss(plan, entry, {
      reason: "feedback",
      message: "A description of GIFT has no general feedback: it is left out.",
    });
  }
  if (question.qtype === "essay") recordEssayLosses(question, entry, plan);
}

/**
 * The reason Moodle's GIFT importer would refuse a question, which Moodle 5.3 does by stopping the whole file: a numerical
 * question of no number, and a matching question of fewer than two pairs.
 */
function refusalOf(question: Question): string | undefined {
  if (question.qtype === "numerical" && question.answers.every(({ value }) => value === null)) {
    return "Every number earns the item's credit, and GIFT holds a numerical question only with a number.";
  }
  if (question.qtype === "match" && question.subquestions.length < 2) {
    return "GIFT holds a matching question of two pairs or more, and this item has one.";
  }
  return moodleRefusal(question);
}

/** The texts of a question, whose references a writer checks. */
function textsOf(question: Question): string[] {
  const texts = [question.text.text, question.generalFeedback.text];
  if (question.qtype === "multichoice")
    for (const { text, feedback } of question.answers) texts.push(text.text, feedback.text);
  if (question.qtype === "match") for (const { text } of question.subquestions) texts.push(text.text);
  return texts;
}

/** Writes one question as the exporter does: comments with its identifier and tags, its name, its text, its answers. */
function writeQuestion(entry: ExportEntry, plan: ExportPlan): string {
  const { question } = entry;
  recordLosses(question, entry, plan);
  const marks: string[] = [];
  if (question.idNumber !== "") marks.push(`[id:${question.idNumber.replaceAll("]", "\\]")}]`);
  // A line break would end the comment, and the rest of the tag would be read as the question's text.
  for (const tag of question.tags) marks.push(`[tag:${tag.replaceAll(/[\r\n]+/g, " ").replaceAll("]", "\\]")}]`);
  const comment = marks.length === 0 ? "" : `// ${marks.join(" ")}\n`;
  const answers = writeAnswers(question, entry, plan);
  const text = question.text.text;
  const name = `::${escapeGift(question.name)}::`;
  if (answers === undefined) return `${comment}${name}[html]${escapeGift(text)}\n`;
  if (question.blank === null) return `${comment}${name}[html]${escapeGift(text)}${answers}\n`;
  const before = text.slice(0, question.blank);
  const after = text.slice(question.blank + 5);
  return `${comment}${name}[html]${escapeGift(before)}${answers}${escapeGift(after)}\n`;
}

/**
 * Writes items as a GIFT file that Moodle imports: each item that a question type holds, with the credit of each answer
 * and the feedback each shows learned by running the item's response processing, and a list of what does not convert,
 * every item left out among it.
 *
 * @remarks
 * A choice interaction becomes a multiple choice, or a true-false question when its two choices are `true` and `false`; an
 * inline choice and a text entry stand at their place in the text, GIFT's missing word; a text entry of a string is a short
 * answer and one of a number a numerical question; a match interaction a matching question; an extended text an essay; an
 * item without an interaction a description. The credits are Moodle's grades, and a rule that is not a sum of credits per
 * answer is listed with what Moodle does instead.
 *
 * @param items - The items, each with its category and tags.
 * @param options - The custom operators that the items call, and the limits.
 * @returns The file and the losses, in the order of the items.
 * @throws `DataError` when `items` is not an array of bank items, an item is not an object of the model of
 * `qti-assessment-item`, or an option has the wrong type.
 * @see {@link https://docs.moodle.org/en/GIFT_format | Moodle, GIFT format}
 * @example
 * ```ts
 * import { readAsi } from "@assesskit/runtime/asi";
 * import { writeGift } from "@assesskit/runtime/item-formats";
 * const { item } = readAsi(xml);
 * const { text, losses } = writeGift([{ item }]);
 * ```
 */
export function writeGift(items: readonly BankItem[], options: WriteItemsOptions = {}): ExportedItems {
  const plan = planExport(items, options);
  let text = "";
  let category: string | undefined;
  for (const entry of plan.entries) {
    const refusal = refusalOf(entry.question);
    if (refusal !== undefined) {
      omitEntry(plan, entry, refusal);
      continue;
    }
    if (entry.category !== undefined && entry.category !== category) {
      category = entry.category;
      text += `$CATEGORY: ${category.replaceAll(/[\r\n]+/g, " ")}\n\n`;
    }
    text += `${writeQuestion(entry, plan)}\n`;
  }
  return { text, losses: sortedLosses(plan) };
}
