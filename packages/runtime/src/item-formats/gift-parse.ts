import { SecurityError } from "../errors.js";
import { escapePost, escapePre, readAnswers, withFormat } from "./gift-answers.js";
import { importEntries, readFileText, resolveReadOptions } from "./import-items.js";
import type { ItemFormatLimits } from "./limits.js";
import type { ImportedItems, ReadItemsOptions } from "./model.js";
import { phpEmpty, phpExplode, phpSubstr, phpSubstrReplace, phpTrim } from "./php-strings.js";
import { type QuestionCommon, type ReadEntry, Refused } from "./question.js";

// The GIFT importer of Moodle 5.3 (question/format/gift/format.php), step by step: a file means what that importer reads,
// with its edge cases, such as a line "0" that ends a question and an answer of a numerical question that is not a number,
// which every response matches.

/** The blank that a missing word leaves in the text. */
const BLANK = "_____";

/** The longest name that Moodle keeps, in characters. */
const MAX_NAME_LENGTH = 255;

/** The characters of a name that Moodle makes from the start of a question's text. */
const DEFAULT_NAME_LENGTH = 80;

/** What `shorten_text` puts after a text it cuts. */
const ELLIPSIS = "...";

/** The characters that end a value in brackets of a comment: control characters, and for a tag `<`, `>` and a backtick. */
function isControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/**
 * Returns where the value of a mark that starts at `start` ends, as the importer's pattern finds it: at the first `]` that
 * `\\` does not escape, or, when a character it may not hold comes first, at the last escaped `]` before it; -1 for none.
 */
function bracketEnd(comments: string, start: number, refused: (character: string) => boolean): number {
  let lastEscaped = -1;
  for (let at = start; at < comments.length; at += 1) {
    const character = comments.charAt(at);
    if (character === "\\" && comments.charAt(at + 1) === "]") {
      lastEscaped = at + 1;
      at += 1;
    } else if (character === "]") return at;
    else if (refused(character)) break;
  }
  return lastEscaped;
}

/**
 * Finds the values of the marks `[id:...]` or `[tag:...]` in the comments, as the importer's patterns do: the first one,
 * which may not be empty, or every one.
 */
function bracketValues(
  comments: string,
  opening: string,
  refused: (character: string) => boolean,
  all: boolean,
): string[] {
  const values: string[] = [];
  for (let from = comments.indexOf(opening); from >= 0; from = comments.indexOf(opening, from + 1)) {
    const start = from + opening.length;
    const end = bracketEnd(comments, start, refused);
    if (end < start || (end === start && !all)) continue;
    values.push(phpTrim(comments.slice(start, end)).replaceAll("\\]", "]"));
    if (!all) break;
    from = end;
  }
  return values;
}

/** Strips tags and trims a name, as `clean_question_name` cleans it. */
function cleanName(name: string): string {
  return phpTrim(name.replaceAll(/<[^>]*>/g, "")).slice(0, MAX_NAME_LENGTH);
}

/** Whether `shorten_text` may cut a text after a character: a point, a space, or a character of three bytes of UTF-8 or more. */
function endsWord(character: string | undefined): boolean {
  return character === "." || character === " " || (character?.codePointAt(0) ?? 0) >= 0x800;
}

/**
 * The name that Moodle gives a question without one: its text, cut by `shorten_text` to 80 characters with `...` after the
 * last word that fits, without its tags; "Question name" when nothing is left.
 */
function defaultName(text: string): string {
  const segments = [...text.matchAll(/(?:<[^>]+>)?([^<>]*)/g)].map((match) => [...(match[1] ?? "")]);
  let name = "";
  if (segments.reduce((length, segment) => length + segment.length, 0) <= DEFAULT_NAME_LENGTH) {
    name = segments.map((segment) => segment.join("")).join("");
  } else {
    let length = ELLIPSIS.length;
    for (const segment of segments) {
      if (length + segment.length <= DEFAULT_NAME_LENGTH) {
        name += segment.join("");
        length += segment.length;
        continue;
      }
      const left = DEFAULT_NAME_LENGTH - length;
      let end = left;
      while (end > 0 && !endsWord(segment[end])) end -= 1;
      name += segment.slice(0, end === 0 ? left : Math.min(end + 1, left)).join("");
      break;
    }
    name += ELLIPSIS;
  }
  return phpTrim(name) || "Question name";
}

/** Returns a character that the text does not hold, to mark the missing word while the importer trims the text around it. */
function unusedCharacter(text: string): string {
  let code = 0xe000;
  while (text.includes(String.fromCharCode(code))) code += 1;
  return String.fromCharCode(code);
}

/** Takes the comment lines out of a question, as the importer does, leaving a space in their place. */
function separateComments(lines: readonly string[]): { readonly text: string; readonly comments: string } {
  let comments = "";
  const kept = lines.map((line) => {
    const trimmed = phpTrim(line);
    if (!trimmed.startsWith("//")) return line;
    comments += `${trimmed}\n`;
    return " ";
  });
  return { text: phpTrim(kept.join("\n")), comments };
}

/** Takes the name between `::` off the start of a question; without a second `::`, the question has none. */
function separateName(text: string): { readonly text: string; readonly name: string | undefined } {
  if (!text.startsWith("::")) return { text, name: undefined };
  const rest = text.slice(2);
  const end = rest.indexOf("::");
  if (end < 0) return { text: rest, name: undefined };
  return { text: phpTrim(rest.slice(end + 2)), name: cleanName(escapePost(rest.slice(0, end))) };
}

/** The text of a question and its answers, split at the first `{` and `}`; `undefined` when only one of them is there. */
interface Split {
  readonly questionText: string;
  readonly answerText: string;
  readonly generalFeedback: string;
  readonly description: boolean;
  readonly missingWord: boolean;
}

/** Splits a question at its braces, as the importer does, with the marker in place of a missing word's answers. */
function splitBraces(text: string, marker: string): Split | undefined {
  const start = text.indexOf("{");
  const finish = text.indexOf("}");
  if (start < 0 && finish < 0) {
    return { questionText: text, answerText: "", generalFeedback: "", description: true, missingWord: false };
  }
  if (start < 0 || finish < 0) return undefined;
  const length = finish - start;
  const answers = phpTrim(phpSubstr(text, start + 1, length - 1));
  const missingWord = !text.endsWith("}");
  const questionText = phpSubstrReplace(text, missingWord ? marker : "", start, length + 1);
  const separator = answers.lastIndexOf("####");
  return separator < 0
    ? { questionText, answerText: answers, generalFeedback: "", description: false, missingWord }
    : {
        questionText,
        answerText: phpTrim(answers.slice(0, separator)),
        generalFeedback: answers.slice(separator + 4),
        description: false,
        missingWord,
      };
}

/** Reads the lines of one question, as `readquestion` does. */
function readQuestion(lines: readonly string[], limits: ItemFormatLimits): ReadEntry | undefined {
  const { text: joined, comments } = separateComments(lines);
  if (joined === "") return undefined;
  const escaped = escapePre(joined);
  if (escaped.startsWith("$CATEGORY:")) return { kind: "category", category: phpTrim(escaped.slice(10)) };
  const { text, name } = separateName(escaped);
  const marker = unusedCharacter(text);
  const split = splitBraces(text, marker);
  if (split === undefined) {
    return { kind: "error", name: name ?? defaultName(text), message: "The braces of the answers do not match." };
  }
  const parsed = withFormat(split.questionText, "moodle");
  const blank = split.missingWord ? parsed.text.indexOf(marker) : -1;
  const bodyText = parsed.text.replaceAll(marker, BLANK);
  const common: QuestionCommon = {
    name: name ?? defaultName(bodyText),
    text: { text: bodyText, format: parsed.format },
    generalFeedback: withFormat(split.generalFeedback, parsed.format),
    defaultMark: 1,
    penalty: 0.3333333,
    idNumber: bracketValues(comments, "[id:", isControl, false)[0] ?? "",
    tags: bracketValues(comments, "[tag:", (character) => isControl(character) || "<>`".includes(character), true),
    blank: blank < 0 ? null : blank,
    hints: [],
  };
  if (split.description) return { kind: "question", question: { ...common, qtype: "description", defaultMark: 0 } };
  try {
    return { kind: "question", question: readAnswers(common, split.answerText, limits) };
  } catch (error) {
    if (error instanceof Refused) return { kind: "error", name: common.name, message: error.message };
    throw error;
  }
}

/**
 * Splits a GIFT file into its entries as Moodle's importer does: lines, trimmed, in blocks between empty lines, of which
 * each is a question, a change of category or a question that Moodle refuses.
 *
 * @throws `SecurityError` when the file holds more questions than `maxQuestions` or a question more answers than
 * `maxAnswers`.
 */
function parseGift(text: string, limits: ItemFormatLimits): readonly ReadEntry[] {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  // A file of old Macintosh line ends is one line with carriage returns, which `readdata` splits on them.
  const lines =
    !withoutBom.includes("\n") && withoutBom.includes("\r") ? withoutBom.split("\r") : phpExplode("\n", withoutBom);
  const entries: ReadEntry[] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.length === 0) return;
    if (entries.length >= limits.maxQuestions) {
      throw new SecurityError(
        `The file holds more than ${limits.maxQuestions} questions, the limit maxQuestions.`,
        "maxQuestions",
        limits.maxQuestions,
      );
    }
    const entry = readQuestion(block, limits);
    if (entry !== undefined) entries.push(entry);
    block = [];
  };
  for (const line of lines) {
    const trimmed = phpTrim(line);
    if (phpEmpty(trimmed)) flush();
    else block.push(trimmed);
  }
  flush();
  return entries;
}

/**
 * Reads a GIFT file into QTI items, as Moodle's importer reads it: each question with its name, its text in its format,
 * its answers and their credits and feedback, its general feedback, its identifier and tags from the comments, and the
 * category the file last named. Each item scores as Moodle scores the question, by QTI's own expressions, and what has no
 * place in QTI, or a question that Moodle refuses, is in the losses.
 *
 * @remarks
 * A multiple choice becomes a choice interaction, or an inline choice at the missing word when one answer is right; a true
 * or false question a choice of the identifiers `true` and `false`; a short answer and a numerical question a text entry,
 * at the missing word or after the text; a matching question a match interaction; an essay an extended text; a description
 * an item without an interaction. The texts become QTI content as a browser parses their HTML.
 *
 * @param input - The file, as text or as UTF-8 bytes.
 * @param options - The labels of true and false, and the limits.
 * @returns The items in the order of the file, and the losses.
 * @throws `DataError` when an argument has the wrong type, or a limit is not a positive integer.
 * @throws `ReadError` when the bytes are not UTF-8.
 * @throws `SecurityError` when the file passes a limit: `maxBytes`, `maxQuestions`, `maxAnswers`, `maxNodes` or `maxDepth`.
 * @see {@link https://docs.moodle.org/en/GIFT_format | Moodle, GIFT format}
 * @see {@link https://github.com/moodle/moodle/blob/v5.3.0/public/question/format/gift/format.php | Moodle 5.3, the GIFT importer}
 * @example
 * ```ts
 * import { readGift } from "@assesskit/runtime/item-formats";
 * const { items, losses } = readGift("::Capital::The capital of Indonesia is {=Jakarta}.");
 * items[0].item.title; // => "Capital"
 * ```
 */
export function readGift(input: string | Uint8Array, options: ReadItemsOptions = {}): ImportedItems {
  const resolved = resolveReadOptions(options);
  const text = readFileText(input, resolved.limits, "The GIFT file");
  return importEntries(parseGift(text, resolved.limits), resolved);
}
