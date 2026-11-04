import { ReadError, SecurityError } from "../errors.js";
import { collectText, findAttribute, listChildElements, parseXml, type XmlElement } from "../xml/index.js";
import { findGrade } from "./grades.js";
import { importEntries, resolveReadOptions } from "./import-items.js";
import type { ItemFormatLimits } from "./limits.js";
import type { ImportedItems, ReadItemsOptions } from "./model.js";
import { phpBase64Decode, phpIsNumeric, phpNumber, phpTrim } from "./php-strings.js";
import {
  type ChoiceAnswer,
  type CombinedFeedback,
  type EmbeddedFile,
  emptyText,
  type FormattedText,
  type NumberAnswer,
  type Question,
  type QuestionCommon,
  type ReadEntry,
  Refused,
  type TextFormat,
} from "./question.js";

// The XML importer of Moodle 5.3 (question/format/xml/format.php): each question element by its type, with the paths and
// defaults of the importer's `getpath`, which trims a text and takes the first element of a name.

/** Moodle's names of the text formats. */
const FORMATS: ReadonlyMap<string, TextFormat> = new Map([
  ["moodle_auto_format", "moodle"],
  ["html", "html"],
  ["plain_text", "plain"],
  ["markdown", "markdown"],
]);

/** The question types that Moodle imports and this reader does not convert, with the reason. */
const UNCONVERTED: ReadonlyMap<string, string> = new Map([
  ["cloze", "A cloze question holds several answers in its text, which a QTI item of one interaction does not."],
  ["multianswer", "A cloze question holds several answers in its text, which a QTI item of one interaction does not."],
  [
    "calculated",
    "A calculated question draws its values from datasets, which QTI's template processing does not read.",
  ],
  [
    "calculatedsimple",
    "A calculated question draws its values from datasets, which QTI's template processing does not read.",
  ],
  [
    "calculatedmulti",
    "A calculated question draws its values from datasets, which QTI's template processing does not read.",
  ],
]);

/** The child elements of a name; none for an element that is not there. */
function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element === undefined ? [] : listChildElements(element).filter((node) => node.name === name);
}

/** The first child element of a name. */
function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return children(element, name)[0];
}

/** The trimmed text of the first element of a path of names, or the default, as `getpath` with `istext` reads it. */
function pathText(element: XmlElement | undefined, names: readonly string[], fallback: string): string {
  let at = element;
  for (const name of names) {
    at = child(at, name);
    if (at === undefined) return fallback;
  }
  return phpTrim(at === undefined ? "" : collectText(at));
}

function attributeOf(element: XmlElement | undefined, name: string): string | undefined {
  return element === undefined ? undefined : findAttribute(element, name);
}

/** Moodle's `trans_format`: a name it does not know is HTML. */
function formatOf(name: string | undefined, fallback: TextFormat): TextFormat {
  return name === undefined
    ? fallback
    : (FORMATS.get(phpTrim(name)) ?? (phpTrim(name) === "wiki_like" ? "plain" : "html"));
}

/** Moodle's `trans_single`: "false" and the empty string are false. */
function isTrue(text: string): boolean {
  return text !== "false" && text !== "" && text !== "0";
}

/** The files of a text, which `@@PLUGINFILE@@/` names in it, decoded as PHP decodes base64 that is not. */
function filesOf(element: XmlElement | undefined): EmbeddedFile[] {
  return children(element, "file").map((file) => ({
    path: `${attributeOf(file, "path") ?? "/"}${attributeOf(file, "name") ?? ""}`,
    bytes: phpBase64Decode(collectText(file)),
  }));
}

/** A text with its format and files, as `import_text_with_files` reads it. */
function formattedText(element: XmlElement | undefined, fallback: TextFormat): FormattedText {
  const files = filesOf(element);
  return {
    text: pathText(element, ["text"], ""),
    format: formatOf(attributeOf(element, "format"), fallback),
    ...(files.length === 0 ? {} : { files }),
  };
}

/** A number of the file, as PHP's arithmetic reads it, which throws on a string that is not a number. */
function numberOf(text: string, what: string): number {
  if (phpIsNumeric(text)) return phpNumber(text);
  throw new Refused(`The ${what} ${text} is not a number.`);
}

/** The credit of an answer: its attribute `fraction` in percent, as a grade of Moodle's list when it is one. */
function fractionOf(answer: XmlElement): number {
  const credit = numberOf(attributeOf(answer, "fraction") ?? "0", "fraction") / 100;
  return findGrade(credit) ?? credit;
}

function checkAnswers(count: number, limits: ItemFormatLimits): void {
  if (count > limits.maxAnswers) {
    throw new SecurityError(
      `A question has ${count} answers, over the limit maxAnswers of ${limits.maxAnswers}.`,
      "maxAnswers",
      limits.maxAnswers,
    );
  }
}

/** The answers of a question, within `maxAnswers`. */
function answerElements(question: XmlElement, limits: ItemFormatLimits): XmlElement[] {
  const answers = children(question, "answer");
  checkAnswers(answers.length, limits);
  return answers;
}

function combinedOf(question: XmlElement, format: TextFormat): CombinedFeedback {
  return {
    correct: formattedText(child(question, "correctfeedback"), format),
    partiallyCorrect: formattedText(child(question, "partiallycorrectfeedback"), format),
    incorrect: formattedText(child(question, "incorrectfeedback"), format),
  };
}

/** The fields of every question, as `import_headers` reads them. */
function readHeaders(question: XmlElement): QuestionCommon {
  // Moodle reports a question without a name and imports it with an empty one.
  const name = pathText(question, ["name", "text"], "");
  const text = formattedText(child(question, "questiontext"), "html");
  const format = text.format;
  return {
    name: phpTrim(name.replaceAll(/<[^>]*>/g, "")),
    text,
    generalFeedback: formattedText(child(question, "generalfeedback"), format),
    defaultMark: numberOf(pathText(question, ["defaultgrade"], "1"), "mark"),
    penalty: numberOf(pathText(question, ["penalty"], "0.3333333"), "penalty"),
    idNumber: pathText(question, ["idnumber"], ""),
    tags: children(child(question, "tags"), "tag").map((tag) => pathText(tag, ["text"], "")),
    blank: null,
    hints: children(question, "hint").map((hint) => formattedText(hint, format)),
  };
}

function readMultichoice(question: XmlElement, common: QuestionCommon, limits: ItemFormatLimits): Question {
  const format = common.text.format;
  const answers = answerElements(question, limits);
  const read: ChoiceAnswer[] = answers.map((answer) => ({
    text: formattedText(answer, format),
    fraction: fractionOf(answer),
    feedback: formattedText(child(answer, "feedback"), format),
  }));
  if (read.length < 2) throw new Refused("A multiple choice needs at least two answers.");
  const numbering = pathText(question, ["answernumbering"], "abc");
  return {
    ...common,
    qtype: "multichoice",
    single: isTrue(pathText(question, ["single"], "true")),
    shuffle: isTrue(pathText(question, ["shuffleanswers"], "false")),
    numbering: numbering === "" ? "abc" : numbering,
    answers: read,
    combined: combinedOf(question, format),
  };
}

function readTrueFalse(question: XmlElement, common: QuestionCommon): Question {
  const format = common.text.format;
  let feedbackTrue = emptyText(format);
  let feedbackFalse = emptyText(format);
  let correct = false;
  for (const [index, answer] of children(question, "answer").entries()) {
    const written = pathText(answer, ["text"], "");
    // An old file names the answers in its language; the importer then takes the first as true.
    const isTrueAnswer = written === "true" || (written !== "false" && index === 0);
    const feedback = formattedText(child(answer, "feedback"), format);
    const full = attributeOf(answer, "fraction") !== undefined && Number(attributeOf(answer, "fraction")) === 100;
    if (isTrueAnswer) {
      correct = full;
      feedbackTrue = feedback;
    } else {
      correct = !full;
      feedbackFalse = feedback;
    }
  }
  return { ...common, qtype: "truefalse", correct, feedbackTrue, feedbackFalse };
}

function readShortAnswer(question: XmlElement, common: QuestionCommon, limits: ItemFormatLimits): Question {
  const format = common.text.format;
  const answers = answerElements(question, limits);
  return {
    ...common,
    qtype: "shortanswer",
    caseSensitive: isTrue(pathText(question, ["usecase"], "0")),
    answers: answers.map((answer) => ({
      text: pathText(answer, ["text"], ""),
      fraction: fractionOf(answer),
      feedback: formattedText(child(answer, "feedback"), format),
    })),
  };
}

/** A tolerance, which Moodle stores empty, and grades as none, when it is not a number. */
function toleranceOf(text: string): number {
  return phpIsNumeric(text) ? Math.abs(phpNumber(text)) : 0;
}

function readNumerical(question: XmlElement, common: QuestionCommon, limits: ItemFormatLimits): Question {
  const format = common.text.format;
  const answers = answerElements(question, limits);
  const read: NumberAnswer[] = answers.map((answer) => {
    const text = pathText(answer, ["text"], "");
    const deprecated = child(answer, "fraction");
    const credit =
      deprecated === undefined ? fractionOf(answer) : numberOf(phpTrim(collectText(deprecated)), "fraction");
    const value = text === "*" || text === "" ? null : numberOf(text, "answer");
    return {
      value,
      tolerance: value === null ? 0 : toleranceOf(pathText(answer, ["tolerance"], "0")),
      fraction: findGrade(credit) ?? credit,
      feedback: formattedText(child(answer, "feedback"), format),
    };
  });
  return { ...common, qtype: "numerical", answers: read, units: children(child(question, "units"), "unit").length };
}

function readMatch(question: XmlElement, common: QuestionCommon, limits: ItemFormatLimits): Question {
  const format = common.text.format;
  const subquestions = children(question, "subquestion");
  checkAnswers(subquestions.length, limits);
  return {
    ...common,
    qtype: "match",
    shuffle: isTrue(pathText(question, ["shuffleanswers"], "1")),
    subquestions: subquestions.map((subquestion) => ({
      text: formattedText(subquestion, format),
      answer: pathText(subquestion, ["answer", "text"], ""),
    })),
    combined: combinedOf(question, format),
  };
}

function readEssay(question: XmlElement, common: QuestionCommon): Question {
  const format = common.text.format;
  const words = (name: string) => {
    const text = pathText(question, [name], "");
    return text === "" || text === "0" ? null : numberOf(text, name);
  };
  return {
    ...common,
    qtype: "essay",
    responseFormat: pathText(question, ["responseformat"], "editor"),
    responseRequired: isTrue(pathText(question, ["responserequired"], "1")),
    fieldLines: numberOf(pathText(question, ["responsefieldlines"], "15"), "number of lines"),
    minWords: words("minwordlimit"),
    maxWords: words("maxwordlimit"),
    attachments: numberOf(pathText(question, ["attachments"], "0"), "number of attachments"),
    graderInfo: formattedText(child(question, "graderinfo"), format),
    template: {
      text: pathText(question, ["responsetemplate", "text"], ""),
      format: formatOf(attributeOf(child(question, "responsetemplate"), "format"), format),
    },
  };
}

/**
 * The question with its missing word: the first `_____` of its text, which Moodle shows where GIFT's answers stood and an
 * inline interaction of the item takes.
 */
function withBlank(question: Question): Question {
  const at = question.text.text.indexOf("_____");
  return at < 0 ? question : { ...question, blank: at };
}

/** Reads one question element by its type, as `import_question` does. */
function readQuestion(question: XmlElement, limits: ItemFormatLimits): ReadEntry {
  const type = attributeOf(question, "type") ?? "";
  if (type === "category") return { kind: "category", category: pathText(question, ["category", "text"], "") };
  const name = pathText(question, ["name", "text"], "") || type;
  const unconverted = UNCONVERTED.get(type);
  if (unconverted !== undefined) return { kind: "unconverted", name, message: unconverted };
  try {
    const common = readHeaders(question);
    switch (type) {
      case "multichoice":
        return { kind: "question", question: withBlank(readMultichoice(question, common, limits)) };
      case "truefalse":
        return { kind: "question", question: readTrueFalse(question, common) };
      case "shortanswer":
        return { kind: "question", question: withBlank(readShortAnswer(question, common, limits)) };
      case "numerical":
        return { kind: "question", question: withBlank(readNumerical(question, common, limits)) };
      case "matching":
      case "match":
        return { kind: "question", question: readMatch(question, common, limits) };
      case "essay":
        return { kind: "question", question: readEssay(question, common) };
      case "description":
        return { kind: "question", question: { ...common, qtype: "description", defaultMark: 0 } };
      default:
        return { kind: "unconverted", name, message: `Moodle's question type ${type} has no conversion to QTI here.` };
    }
  } catch (error) {
    if (error instanceof Refused) return { kind: "error", name, message: error.message };
    throw error;
  }
}

/**
 * Reads a Moodle XML file into QTI items, as Moodle's importer reads it: each question of a type that converts, with its
 * name, text, answers, credits, feedback, mark, identifier, tags and the files its texts embed, under the category that the
 * file last named. Each item scores as Moodle grades the question, by QTI's own expressions; what has no place in QTI, a
 * question of another type, or a question that Moodle refuses is in the losses.
 *
 * @remarks
 * The types convert as GIFT's do ([the guide](https://github.com/assesskit/assesskit/blob/main/docs/runtime/item-formats.md)),
 * and Moodle XML holds more of them: the mark, shuffling, case, the feedback by how right a response is, an essay's options and
 * information for graders. A file that a text names with `@@PLUGINFILE@@/` is in `files`, under `files/<item>/` and the name
 * that the text writes, which the item's content then names. The file is read with the runtime's XML reader and its limits:
 * a DOCTYPE is refused.
 *
 * @param input - The file, as text or as bytes.
 * @param options - The labels of true and false, and the limits.
 * @returns The items in the order of the file, the files they name, and the losses.
 * @throws `DataError` when an argument has the wrong type, or a limit is not a positive integer.
 * @throws `ReadError` when the file is not well-formed XML, or its root is not `quiz`.
 * @throws `SecurityError` when the file has a DOCTYPE or passes a limit of the XML reader or of `ItemFormatLimits`.
 * @see {@link https://docs.moodle.org/en/Moodle_XML_format | Moodle, Moodle XML format}
 * @see {@link https://github.com/moodle/moodle/blob/v5.3.0/public/question/format/xml/format.php | Moodle 5.3, the XML importer}
 * @example
 * ```ts
 * import { readMoodleXml } from "@assesskit/runtime/item-formats";
 * const { items } = readMoodleXml(xml);
 * ```
 */
export function readMoodleXml(input: string | Uint8Array, options: ReadItemsOptions = {}): ImportedItems {
  const resolved = resolveReadOptions(options);
  const root = parseXml(input, { path: "The Moodle XML file", limits: { maxBytes: resolved.limits.maxBytes } });
  if (root.namespace !== "" || root.name !== "quiz") {
    throw new ReadError(`The root element of a Moodle XML file must be quiz, found ${root.name}.`, []);
  }
  const questions = children(root, "question");
  const { maxQuestions } = resolved.limits;
  if (questions.length > maxQuestions) {
    throw new SecurityError(
      `The file holds more than ${maxQuestions} questions, the limit maxQuestions.`,
      "maxQuestions",
      maxQuestions,
    );
  }
  return importEntries(
    questions.map((question) => readQuestion(question, resolved.limits)),
    resolved,
  );
}
