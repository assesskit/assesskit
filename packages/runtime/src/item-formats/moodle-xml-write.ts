import { parseWith } from "../checks.js";
import { encodeBase64 } from "../values/index.js";
import { serializeXml, type XmlElement, type XmlNode } from "../xml/index.js";
import { elementBuilder } from "../xml/internal.js";
import {
  addLoss,
  type ExportEntry,
  type ExportPlan,
  moodleRefusal,
  omitEntry,
  planExport,
  sortedLosses,
  writeMoodleXmlOptionsSchema,
} from "./export-items.js";
import { isRelative, renameReferences } from "./file-references.js";
import type { BankItem, ExportedItems, WriteMoodleXmlOptions } from "./model.js";
import { type CombinedFeedback, type FormattedText, percent, type Question } from "./question.js";

// Moodle XML as Moodle's exporter writes it (question/format/xml/format.php, writequestion), so that its importer reads each
// question back with every field that the question model holds.

/** Moodle's names of the text formats. */
const FORMAT_NAMES = { html: "html", moodle: "moodle_auto_format", plain: "plain_text", markdown: "markdown" } as const;

/** Moodle's names of the question types in its XML. */
const TYPE_NAMES: Readonly<Record<Question["qtype"], string>> = {
  description: "description",
  essay: "essay",
  multichoice: "multichoice",
  truefalse: "truefalse",
  shortanswer: "shortanswer",
  numerical: "numerical",
  match: "matching",
};

/** The prefix by which Moodle's texts name the files of their area. */
const PLUGIN_FILE = "@@PLUGINFILE@@/";

const build = elementBuilder("");

/** An element of no namespace with its attributes and its children; a string is a text, and Moodle writes an empty one as `<text></text>`. */
function el(
  name: string,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly (XmlNode | string)[] = [],
): XmlElement {
  return build(
    name,
    attributes,
    children.map((node) => (node === "" ? ({ kind: "text", value: "" } as const) : node)),
  );
}

/** An element that holds a value as its text. */
function value(name: string, text: string | number | boolean): XmlElement {
  return el(name, {}, [String(text)]);
}

/** The files of the writer's option and what a text of an entry names of them. */
interface Files {
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly plan: ExportPlan;
  readonly entry: ExportEntry;
  /** The references that no file of the option holds, each once for the entry. */
  readonly missing: Set<string>;
}

/** The path of a reference with its escapes decoded, or as written when they do not decode. */
function decodePath(reference: string): string {
  try {
    return decodeURIComponent(reference);
  } catch {
    return reference;
  }
}

/**
 * The `text` element of a text, and a `file` element of each file of the option that the text names, which the text then
 * names by `@@PLUGINFILE@@/` and its path.
 */
function textContent(text: FormattedText, files: Files): XmlElement[] {
  const embedded: XmlElement[] = [];
  const named = renameReferences(text.text, (reference) => {
    if (!isRelative(reference)) return undefined;
    const bytes = files.files.get(reference);
    if (bytes === undefined) {
      files.missing.add(reference);
      return undefined;
    }
    // The reference is a URL, whose escapes a file's path and name hold decoded.
    const path = decodePath(reference);
    const slash = path.lastIndexOf("/");
    const attributes = { name: path.slice(slash + 1), path: `/${path.slice(0, slash + 1)}`, encoding: "base64" };
    embedded.push(el("file", attributes, [encodeBase64(bytes)]));
    return `${PLUGIN_FILE}${reference}`;
  });
  return [value("text", named), ...embedded];
}

/** A field of a text: its format as an attribute, its text and its files. */
function field(name: string, text: FormattedText, files: Files): XmlElement {
  return el(name, { format: FORMAT_NAMES[text.format] }, textContent(text, files));
}

function combined(feedback: CombinedFeedback, files: Files): XmlElement[] {
  return [
    field("correctfeedback", feedback.correct, files),
    field("partiallycorrectfeedback", feedback.partiallyCorrect, files),
    field("incorrectfeedback", feedback.incorrect, files),
  ];
}

/** The answer of a short or numerical question, of plain text, with its feedback. */
function plainAnswer(
  text: string,
  fraction: number,
  feedback: FormattedText,
  files: Files,
  extra: XmlElement[] = [],
): XmlElement {
  return el("answer", { fraction: percent(fraction), format: "moodle_auto_format" }, [
    value("text", text),
    ...extra,
    field("feedback", feedback, files),
  ]);
}

/** The fields of a question by its type, after its common fields. */
function typeFields(question: Question, files: Files): XmlElement[] {
  switch (question.qtype) {
    case "description":
      return [];
    case "truefalse":
      return [
        plainAnswer("true", question.correct ? 1 : 0, question.feedbackTrue, files),
        plainAnswer("false", question.correct ? 0 : 1, question.feedbackFalse, files),
      ];
    case "multichoice":
      return [
        value("single", question.single),
        value("shuffleanswers", question.shuffle),
        value("answernumbering", question.numbering),
        value("showstandardinstruction", 0),
        ...combined(question.combined, files),
        ...question.answers.map((answer) =>
          el("answer", { fraction: percent(answer.fraction), format: FORMAT_NAMES[answer.text.format] }, [
            ...textContent(answer.text, files),
            field("feedback", answer.feedback, files),
          ]),
        ),
      ];
    case "shortanswer":
      return [
        value("usecase", question.caseSensitive ? 1 : 0),
        ...question.answers.map((answer) => plainAnswer(answer.text, answer.fraction, answer.feedback, files)),
      ];
    case "numerical":
      return question.answers.map((answer) =>
        plainAnswer(answer.value === null ? "*" : String(answer.value), answer.fraction, answer.feedback, files, [
          value("tolerance", answer.tolerance),
        ]),
      );
    case "match":
      return [
        value("shuffleanswers", question.shuffle),
        ...combined(question.combined, files),
        ...question.subquestions.map((subquestion) =>
          el("subquestion", { format: FORMAT_NAMES[subquestion.text.format] }, [
            ...textContent(subquestion.text, files),
            el("answer", {}, [value("text", subquestion.answer)]),
          ]),
        ),
      ];
    case "essay":
      return [
        value("responseformat", question.responseFormat),
        value("responserequired", question.responseRequired ? 1 : 0),
        value("responsefieldlines", question.fieldLines),
        value("minwordlimit", question.minWords ?? ""),
        value("maxwordlimit", question.maxWords ?? ""),
        value("attachments", question.attachments),
        value("attachmentsrequired", 0),
        field("graderinfo", question.graderInfo, files),
        el("responsetemplate", { format: FORMAT_NAMES[question.template.format] }, [
          value("text", question.template.text),
        ]),
      ];
  }
}

/** One question as the exporter writes it: its common fields, those of its type, and its tags. */
function writeQuestion(entry: ExportEntry, plan: ExportPlan, options: ReadonlyMap<string, Uint8Array>): XmlElement {
  const { question } = entry;
  const files: Files = { files: options, plan, entry, missing: new Set() };
  const element = el("question", { type: TYPE_NAMES[question.qtype] }, [
    el("name", {}, [value("text", question.name)]),
    field("questiontext", question.text, files),
    field("generalfeedback", question.generalFeedback, files),
    value("defaultgrade", question.defaultMark),
    value("penalty", question.penalty),
    value("hidden", 0),
    value("idnumber", question.idNumber),
    ...typeFields(question, files),
    ...(question.tags.length === 0
      ? []
      : [
          el(
            "tags",
            {},
            question.tags.map((tag) => el("tag", {}, [value("text", tag)])),
          ),
        ]),
  ]);
  if (files.missing.size > 0) {
    addLoss(plan, entry, {
      reason: "content",
      message: `The files ${[...files.missing].join(", ")} are not in the option files: the question names them as the item does, where Moodle finds none.`,
    });
  }
  return element;
}

function category(path: string): XmlElement {
  return el("question", { type: "category" }, [
    el("category", {}, [value("text", path)]),
    el("info", { format: "html" }, [value("text", "")]),
  ]);
}

/**
 * Writes items as a Moodle XML file that Moodle imports: each item that a question type holds, with its mark, the credit of
 * each answer and the feedback each shows learned by running the item's response processing, shuffling, case, the feedback by
 * how right a response is, an essay's options and information for graders, and the files of the option that its content
 * names; and a list of what does not convert, every item left out among it.
 *
 * @remarks
 * The question types are those of `writeGift`; Moodle XML holds every field of them that the items carry. An inline
 * interaction leaves `_____` in the text, where `readMoodleXml` puts it back. A reference of the content to a file beside
 * the item that `files` holds becomes a `file` of the question in base64, which the text names by `@@PLUGINFILE@@/`.
 *
 * @param items - The items, each with its category and tags.
 * @param options - The custom operators that the items call, the files that their content names, and the limits.
 * @returns The file and the losses, in the order of the items.
 * @throws `DataError` when `items` is not an array of bank items, an item is not an object of the model of
 * `qti-assessment-item`, or an option has the wrong type.
 * @see {@link https://docs.moodle.org/en/Moodle_XML_format | Moodle, Moodle XML format}
 * @example
 * ```ts
 * import { readGift, writeMoodleXml } from "@assesskit/runtime/item-formats";
 *
 * const { items } = readGift("::Capital::The capital of Indonesia is {=Jakarta}.");
 * writeMoodleXml(items).text.includes("<usecase>0</usecase>"); // => true
 * ```
 */
export function writeMoodleXml(items: readonly BankItem[], options: WriteMoodleXmlOptions = {}): ExportedItems {
  const { files = new Map<string, Uint8Array>(), ...writeOptions } = parseWith(
    writeMoodleXmlOptionsSchema,
    options,
    "The options object",
  );
  const plan = planExport(items, writeOptions);
  const questions: XmlElement[] = [];
  let current: string | undefined;
  for (const entry of plan.entries) {
    const refusal = moodleRefusal(entry.question);
    if (refusal !== undefined) {
      omitEntry(plan, entry, refusal);
      continue;
    }
    if (entry.category !== undefined && entry.category !== current) {
      current = entry.category;
      questions.push(category(current));
    }
    questions.push(writeQuestion(entry, plan, files));
  }
  return { text: `${serializeXml(el("quiz", {}, questions))}\n`, losses: sortedLosses(plan) };
}
