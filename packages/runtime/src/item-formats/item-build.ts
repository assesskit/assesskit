import { type AssessmentItem, readAsi } from "../asi/index.js";
import { type TypeInfo, typeNamed } from "../asi/internal.js";
import { ReadError } from "../errors.js";
import type { XmlElement, XmlNode } from "../xml/index.js";
import { type Blank, type ContentState, childType, countElements, readMoodleText, startItem } from "./html-content.js";
import type { LossReason, TrueFalseLabels } from "./model.js";
import { baseValue, condition, floatOutcome, formatFloat, isNull, qti, setOutcome, variable } from "./qti-elements.js";
import {
  type CombinedFeedback,
  type EssayFormat,
  type FormattedText,
  hasCombined,
  type NumberAnswer,
  type Question,
  type TextAnswer,
} from "./question.js";

// The QTI item of a question, as Moodle scores it: QTI's own expressions in response processing, the per-answer, general and
// combined feedback as modal feedback that the outcome FEEDBACK shows, and the question's text as the item's content.

const RESPONSE = "RESPONSE";
const SCORE = "SCORE";
const MAXSCORE = "MAXSCORE";
const FEEDBACK = "FEEDBACK";
/** The feedback that every response shows, Moodle's general feedback. */
const GENERAL_FEEDBACK = "general";
/** The feedback by how right a response is, Moodle's combined feedback, as Moodle's states name it. */
const COMBINED_FEEDBACK = {
  correct: "correct",
  partiallyCorrect: "partially-correct",
  incorrect: "incorrect",
} as const;
/**
 * The share of the mark above which Moodle counts a response right, and below which wrong
 * (`question_state::graded_state_for_fraction`).
 */
const RIGHT = 0.999999;
const WRONG = 0.000001;

/** What a reader leaves out of an item, before it knows the item's position. */
export interface ItemLoss {
  readonly reason: LossReason;
  readonly message: string;
}

/** The item of a question, with what does not convert. */
export interface BuiltItem {
  readonly item: AssessmentItem;
  readonly losses: readonly ItemLoss[];
}

/** What a question's type adds to its item. */
interface Part {
  readonly declaration?: XmlElement;
  readonly interaction?: XmlElement;
  /** Whether the interaction may stand inside a line of text, at the missing word. */
  readonly inline: boolean;
  readonly rules: readonly XmlElement[];
  /** The least score of a response. */
  readonly minimum: number;
  /** Whether a person scores the response. */
  readonly human?: true;
  /** The feedback of single answers, by the identifier that `FEEDBACK` takes for them. */
  readonly answerFeedback: readonly (readonly [string, FormattedText])[];
  /** Whether `FEEDBACK` takes the identifiers of the chosen choices. */
  readonly feedbackOfChoices: boolean;
  /** Content of the body that follows the interaction, such as the information for scorers. */
  readonly after?: readonly XmlElement[];
  readonly combined?: CombinedFeedback;
}

/** The context of the items of one file. */
export interface BuildContext {
  readonly state: ContentState;
  readonly labels: TrueFalseLabels;
  /** The files that the items' texts embed, by the reference that their content gives them. */
  readonly files: Map<string, Uint8Array>;
}

/** Returns the identifier of the choice at a position: `A` to `Z`, then `AA`, `AB` and on. */
function choiceIdentifier(index: number): string {
  let rest = index;
  let name = "";
  do {
    name = String.fromCharCode(65 + (rest % 26)) + name;
    rest = Math.floor(rest / 26) - 1;
  } while (rest >= 0);
  return name;
}

/** The characters that a pattern of XSD escapes to stand for themselves. */
const PATTERN_MARKS = "\\|.-^?*+{}()[]";

/** The pattern of one character of an answer: itself, escaped, or with its other case. */
function characterPattern(character: string, caseSensitive: boolean): string {
  if (PATTERN_MARKS.includes(character)) return `\\${character}`;
  return caseSensitive ? character : (caseVariants(character) ?? character);
}

/**
 * The pattern of `qti-pattern-match` that a short answer is, as Moodle matches one: the answer between optional spaces,
 * which Moodle trims, a run of `*` for any characters and `\\*` for a star, and each letter in both cases unless the
 * question keeps case. The answer is in Unicode's form C, as Moodle normalizes it.
 *
 * @see {@link https://github.com/moodle/moodle/blob/v5.3.0/public/question/type/shortanswer/question.php | Moodle, compare_string_with_wildcard}
 */
function answerPattern(answer: string, caseSensitive: boolean): string {
  const characters = [...answer.normalize("NFC")];
  let pattern = "";
  for (let at = 0; at < characters.length; at += 1) {
    const character = characters[at] ?? "";
    if (character === "\\" && characters[at + 1] === "*") {
      pattern += "\\*";
      at += 1;
    } else if (character === "*") {
      while (characters[at + 1] === "*") at += 1;
      pattern += ".*";
    } else pattern += characterPattern(character, caseSensitive);
  }
  return `\\s*${pattern}\\s*`;
}

/** A class of a letter and its other case, when each case is one character of its own, the letter first. */
function caseVariants(character: string): string | undefined {
  const lower = character.toLowerCase();
  const upper = character.toUpperCase();
  if (lower === upper || [...lower].length !== 1 || [...upper].length !== 1) return undefined;
  // The letter as the answer writes it comes first, so that a writer reads the answer back as it was.
  return character === lower ? `[${lower}${upper}]` : `[${upper}${lower}]`;
}

/** The text a correct response of a short answer holds: the answer without its wildcards, as Moodle's `clean_response`. */
function cleanAnswer(answer: string): string {
  return answer.replaceAll(/(?<!\\)\*+/g, "").replaceAll("\\*", "*");
}

/** The least of 0 and the credits of the answers, times the mark: the least score of a response. */
function leastScore(answers: readonly { readonly fraction: number }[], mark: number): number {
  let least = 0;
  for (const { fraction } of answers) least = Math.min(least, fraction);
  return least * mark;
}

/** Returns the first answer of the most credit, which a correct response holds. */
function bestAnswer<T extends { readonly fraction: number }>(answers: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const answer of answers) if (best === undefined || answer.fraction > best.fraction) best = answer;
  return best !== undefined && best.fraction > 0 ? best : undefined;
}

function declaration(
  cardinality: string,
  baseType: string,
  correct: readonly string[],
  mapping?: XmlElement,
): XmlElement {
  return qti("qti-response-declaration", { identifier: RESPONSE, cardinality, "base-type": baseType }, [
    ...(correct.length === 0
      ? []
      : [
          qti(
            "qti-correct-response",
            {},
            correct.map((value) => qti("qti-value", {}, [value])),
          ),
        ]),
    ...(mapping === undefined ? [] : [mapping]),
  ]);
}

/** Response processing that sets `SCORE` from the mapping, and leaves it at 0 for no response. */
function mappedScore(): XmlElement {
  return condition([
    [qti("qti-not", {}, [isNull(RESPONSE)]), [setOutcome(SCORE, qti("qti-map-response", { identifier: RESPONSE }))]],
  ]);
}

/** Converts a text into the content of an element of the type, where `content` holds the item's texts. */
type Content = (text: FormattedText, parent: string | TypeInfo, blank?: Blank) => XmlNode[];

function choicePart(
  question: Extract<Question, { qtype: "multichoice" }>,
  inline: boolean,
  content: Content,
  mark: number,
): Part {
  const ids = question.answers.map((_, index) => choiceIdentifier(index));
  const mapped = question.answers.flatMap((answer, index) =>
    answer.fraction === 0
      ? []
      : [qti("qti-map-entry", { "map-key": ids[index], "mapped-value": formatFloat(answer.fraction * mark) })],
  );
  const mapping = qti(
    "qti-mapping",
    question.single
      ? { "default-value": "0" }
      : { "default-value": "0", "lower-bound": "0", "upper-bound": formatFloat(mark) },
    mapped,
  );
  const best = bestAnswer(question.answers);
  const correct = question.single
    ? best === undefined
      ? []
      : [ids[question.answers.indexOf(best)] ?? ""]
    : question.answers.flatMap((answer, index) => (answer.fraction > 0 ? [ids[index] ?? ""] : []));
  const interaction = inline
    ? qti(
        "qti-inline-choice-interaction",
        { "response-identifier": RESPONSE, shuffle: String(question.shuffle) },
        question.answers.map((answer, index) =>
          qti("qti-inline-choice", { identifier: ids[index] }, content(answer.text, typeNamed("InlineChoice"))),
        ),
      )
    : qti(
        "qti-choice-interaction",
        {
          "response-identifier": RESPONSE,
          shuffle: String(question.shuffle),
          "max-choices": question.single ? "1" : "0",
        },
        question.answers.map((answer, index) =>
          qti("qti-simple-choice", { identifier: ids[index] }, content(answer.text, typeNamed("SimpleChoice"))),
        ),
      );
  return {
    declaration: declaration(question.single ? "single" : "multiple", "identifier", correct, mapping),
    interaction,
    inline,
    rules: [mappedScore()],
    minimum: question.single ? leastScore(question.answers, mark) : 0,
    answerFeedback: question.answers.flatMap((answer, index) =>
      answer.feedback.text === "" ? [] : [[ids[index] ?? "", answer.feedback] as const],
    ),
    feedbackOfChoices: question.answers.some(({ feedback }) => feedback.text !== ""),
    combined: question.combined,
  };
}

function trueFalsePart(
  question: Extract<Question, { qtype: "truefalse" }>,
  labels: TrueFalseLabels,
  mark: number,
): Part {
  const right = String(question.correct);
  return {
    declaration: declaration(
      "single",
      "identifier",
      [right],
      qti("qti-mapping", { "default-value": "0" }, [
        qti("qti-map-entry", { "map-key": right, "mapped-value": formatFloat(mark) }),
      ]),
    ),
    interaction: qti(
      "qti-choice-interaction",
      { "response-identifier": RESPONSE, shuffle: "false", "max-choices": "1" },
      [
        qti("qti-simple-choice", { identifier: "true" }, [labels.true]),
        qti("qti-simple-choice", { identifier: "false" }, [labels.false]),
      ],
    ),
    inline: false,
    rules: [mappedScore()],
    minimum: 0,
    answerFeedback: [
      ...(question.feedbackTrue.text === "" ? [] : [["true", question.feedbackTrue] as const]),
      ...(question.feedbackFalse.text === "" ? [] : [["false", question.feedbackFalse] as const]),
    ],
    feedbackOfChoices: question.feedbackTrue.text !== "" || question.feedbackFalse.text !== "",
  };
}

/** The rules of answers that Moodle tries in order, the first that matches giving its credit and its feedback. */
function answerChain(
  tests: readonly (XmlElement | undefined)[],
  answers: readonly { readonly fraction: number; readonly feedback: FormattedText }[],
  mark: number,
): { rules: XmlElement[]; feedback: (readonly [string, FormattedText])[] } {
  const feedback: (readonly [string, FormattedText])[] = [];
  const branches: (readonly [XmlElement, readonly XmlElement[]])[] = [];
  for (const [index, answer] of answers.entries()) {
    // An answer that every response matches (`*`) ends the chain; the answers after it are never reached.
    const test = tests[index] ?? qti("qti-not", {}, [isNull(RESPONSE)]);
    const id = `answer-${index + 1}`;
    const rules = [setOutcome(SCORE, baseValue("float", formatFloat(answer.fraction * mark)))];
    if (answer.feedback.text !== "") {
      feedback.push([id, answer.feedback]);
      rules.push(setOutcome(FEEDBACK, qti("qti-multiple", {}, [baseValue("identifier", id)])));
    }
    branches.push([test, rules]);
    if (tests[index] === undefined) break;
  }
  return { rules: branches.length === 0 ? [] : [condition(branches)], feedback };
}

function textEntry(baseType: string): XmlElement {
  return qti("qti-text-entry-interaction", { "response-identifier": RESPONSE, "base-type": baseType });
}

function shortAnswerPart(answers: readonly TextAnswer[], caseSensitive: boolean, mark: number): Part {
  const best = bestAnswer(answers);
  const tests = answers.map(({ text }) =>
    qti("qti-pattern-match", { pattern: answerPattern(text, caseSensitive) }, [variable(RESPONSE)]),
  );
  const chain = answerChain(tests, answers, mark);
  return {
    declaration: declaration("single", "string", best === undefined ? [] : [cleanAnswer(best.text)]),
    interaction: textEntry("string"),
    inline: true,
    rules: chain.rules,
    minimum: leastScore(answers, mark),
    answerFeedback: chain.feedback,
    feedbackOfChoices: false,
  };
}

function numericalPart(answers: readonly NumberAnswer[], mark: number): Part {
  const best = bestAnswer(answers.filter(({ value }) => value !== null));
  const tests = answers.map(({ value, tolerance }) =>
    value === null
      ? undefined
      : qti(
          "qti-equal",
          tolerance === 0
            ? { "tolerance-mode": "exact" }
            : {
                "tolerance-mode": "absolute",
                tolerance: `${formatFloat(Math.abs(tolerance))} ${formatFloat(Math.abs(tolerance))}`,
              },
          [baseValue("float", formatFloat(value)), variable(RESPONSE)],
        ),
  );
  const chain = answerChain(tests, answers, mark);
  return {
    declaration: declaration("single", "float", best?.value == null ? [] : [formatFloat(best.value)]),
    interaction: textEntry("float"),
    inline: true,
    rules: chain.rules,
    minimum: leastScore(answers, mark),
    answerFeedback: chain.feedback,
    feedbackOfChoices: false,
  };
}

function matchPart(question: Extract<Question, { qtype: "match" }>, content: Content, mark: number): Part {
  const stems = question.subquestions.filter(({ text }) => text.text !== "");
  const choices: string[] = [];
  for (const { answer } of question.subquestions) if (answer !== "" && !choices.includes(answer)) choices.push(answer);
  const stemIds = stems.map((_, index) => `S${index + 1}`);
  const choiceIds = choices.map((_, index) => `T${index + 1}`);
  const pairs = stems.flatMap(({ answer }, index) => {
    const target = choices.indexOf(answer);
    return target < 0 ? [] : [`${stemIds[index]} ${choiceIds[target]}`];
  });
  const associable = typeNamed("SimpleAssociableChoice");
  return {
    declaration: declaration(
      "multiple",
      "directedPair",
      pairs,
      qti(
        "qti-mapping",
        { "default-value": "0" },
        pairs.map((pair) => qti("qti-map-entry", { "map-key": pair, "mapped-value": "1" })),
      ),
    ),
    interaction: qti(
      "qti-match-interaction",
      { "response-identifier": RESPONSE, shuffle: String(question.shuffle), "max-associations": String(stems.length) },
      [
        qti(
          "qti-simple-match-set",
          {},
          stems.map((stem, index) =>
            qti(
              "qti-simple-associable-choice",
              { identifier: stemIds[index], "match-max": "1" },
              content(stem.text, associable),
            ),
          ),
        ),
        qti(
          "qti-simple-match-set",
          {},
          choices.map((choice, index) =>
            qti("qti-simple-associable-choice", { identifier: choiceIds[index], "match-max": "0" }, [choice]),
          ),
        ),
      ],
    ),
    inline: false,
    rules:
      stems.length === 0
        ? []
        : [
            condition([
              [
                qti("qti-not", {}, [isNull(RESPONSE)]),
                [
                  setOutcome(
                    SCORE,
                    qti("qti-divide", {}, [
                      qti("qti-product", {}, [
                        qti("qti-map-response", { identifier: RESPONSE }),
                        baseValue("float", formatFloat(mark)),
                      ]),
                      baseValue("float", String(stems.length)),
                    ]),
                  ),
                ],
              ],
            ]),
          ],
    minimum: 0,
    answerFeedback: [],
    feedbackOfChoices: false,
    combined: question.combined,
  };
}

/** The format of the text of an extended text by the response format of an essay. */
const ESSAY_FORMATS: ReadonlyMap<string, string> = new Map<EssayFormat, string>([
  ["editor", "xhtml"],
  ["editorfilepicker", "xhtml"],
  ["plain", "plain"],
  ["monospaced", "preformatted"],
  ["noinline", "plain"],
]);

function essayPart(question: Extract<Question, { qtype: "essay" }>, content: Content, losses: ItemLoss[]): Part {
  const format = ESSAY_FORMATS.get(question.responseFormat);
  if (format === undefined) {
    losses.push({
      reason: "setting",
      message: `The response format ${question.responseFormat} is not one of Moodle's: the item takes rich text.`,
    });
  }
  if (question.responseFormat === "noinline" || question.attachments !== 0) {
    losses.push({
      reason: "setting",
      message: "The essay takes attached files, which a QTI extended text does not: the item takes a text alone.",
    });
  }
  if (question.minWords !== null || question.maxWords !== null) {
    losses.push({ reason: "setting", message: "The essay's limits of words have no place in QTI: the item has none." });
  }
  if (!question.responseRequired) {
    losses.push({
      reason: "setting",
      message: "The essay may be left without text in Moodle; the item does not say so.",
    });
  }
  const template = question.template.text;
  const rubric = typeNamed("RubricBlock");
  const body = childType(rubric, "qti-content-body");
  return {
    declaration: qti(
      "qti-response-declaration",
      { identifier: RESPONSE, cardinality: "single", "base-type": "string" },
      [...(template === "" ? [] : [qti("qti-default-value", {}, [qti("qti-value", {}, [template])])])],
    ),
    interaction: qti("qti-extended-text-interaction", {
      "response-identifier": RESPONSE,
      format: format ?? "xhtml",
      "expected-lines": String(question.fieldLines),
    }),
    inline: false,
    rules: [],
    minimum: 0,
    human: true,
    answerFeedback: [],
    feedbackOfChoices: false,
    after:
      question.graderInfo.text === "" || body === undefined
        ? []
        : [
            qti("qti-rubric-block", { use: "scoring", view: "scorer" }, [
              qti("qti-content-body", {}, content(question.graderInfo, body)),
            ]),
          ],
  };
}

function partOf(question: Question, context: BuildContext, content: Content, losses: ItemLoss[]): Part | undefined {
  const mark = question.defaultMark;
  switch (question.qtype) {
    case "description":
      return undefined;
    case "multichoice":
      return choicePart(question, question.single && question.blank !== null, content, mark);
    case "truefalse":
      return trueFalsePart(question, context.labels, mark);
    case "shortanswer":
      return shortAnswerPart(question.answers, question.caseSensitive, mark);
    case "numerical":
      if ((question.units ?? 0) > 0) {
        losses.push({
          reason: "setting",
          message: "The question's units have no place in a QTI number: a response is the number alone.",
        });
      }
      return numericalPart(question.answers, mark);
    case "match":
      return matchPart(question, content, mark);
    case "essay":
      return essayPart(question, content, losses);
  }
}

/** The rules that add the general and the combined feedback to `FEEDBACK`. */
function feedbackRules(
  part: Part | undefined,
  general: boolean,
  combined: CombinedFeedback | undefined,
  mark: number,
): XmlElement[] {
  const rules: XmlElement[] = [];
  const add = (id: string) =>
    setOutcome(FEEDBACK, qti("qti-multiple", {}, [variable(FEEDBACK), baseValue("identifier", id)]));
  if (part?.feedbackOfChoices === true) rules.push(setOutcome(FEEDBACK, qti("qti-multiple", {}, [variable(RESPONSE)])));
  if (general) rules.push(add(GENERAL_FEEDBACK));
  if (combined !== undefined) {
    const score = (share: number) => baseValue("float", formatFloat(share * mark));
    rules.push(
      condition(
        [
          [qti("qti-gt", {}, [variable(SCORE), score(RIGHT)]), [add(COMBINED_FEEDBACK.correct)]],
          [qti("qti-gte", {}, [variable(SCORE), score(WRONG)]), [add(COMBINED_FEEDBACK.partiallyCorrect)]],
        ],
        [add(COMBINED_FEEDBACK.incorrect)],
      ),
    );
  }
  return rules;
}

function modalFeedback(id: string, text: FormattedText, content: Content): XmlElement {
  const body = childType(typeNamed("ModalFeedback"), "qti-content-body");
  return qti("qti-modal-feedback", { "outcome-identifier": FEEDBACK, "show-hide": "show", identifier: id }, [
    qti("qti-content-body", {}, body === undefined ? [] : content(text, body)),
  ]);
}

/** Puts the marker of the missing word in place of the `_____` that Moodle wrote there. */
function markBlank(text: FormattedText, at: number, marker: string): FormattedText {
  return { ...text, text: `${text.text.slice(0, at)}${marker}${text.text.slice(at + 5)}` };
}

/** The content of a text with an inline interaction at its missing word, or after the text when it cannot stand there. */
function bodyWithBlank(
  question: Question,
  interaction: XmlElement,
  at: number,
  content: Content,
  losses: ItemLoss[],
): XmlNode[] {
  const marker = "\uE000";
  const blank: Blank = { marker, element: interaction, placed: false };
  const text = question.text.text.includes(marker) ? question.text : markBlank(question.text, at, marker);
  const body = content(text, typeNamed("ItemBody"), blank);
  if (blank.placed) return body;
  losses.push({
    reason: "content",
    message: "The missing word could not stay in its line: the interaction follows the text.",
  });
  return [...body, qti("div", {}, [interaction])];
}

/** The content of the item's body: the question's text, with the interaction at the missing word or after the text. */
function buildBody(question: Question, part: Part | undefined, content: Content, losses: ItemLoss[]): XmlNode[] {
  const interaction = part?.interaction;
  const inline = part?.inline === true;
  let body: XmlNode[];
  if (interaction !== undefined && inline && question.blank !== null) {
    body = bodyWithBlank(question, interaction, question.blank, content, losses);
  } else {
    body = content(question.text, typeNamed("ItemBody"));
    if (interaction !== undefined) body.push(inline ? qti("div", {}, [interaction]) : interaction);
  }
  for (const element of part?.after ?? []) body.push(element);
  return body;
}

/** The modal feedback of the item: per answer, general, and by how right a response is. */
function buildFeedback(
  question: Question,
  part: Part | undefined,
  combined: CombinedFeedback | undefined,
  content: Content,
  losses: ItemLoss[],
): XmlElement[] {
  if (part === undefined) {
    if (question.generalFeedback.text !== "") {
      losses.push({
        reason: "feedback",
        message: "A description has no response, so its general feedback has no place.",
      });
    }
    return [];
  }
  const combinedTexts: readonly (readonly [string, FormattedText])[] =
    combined === undefined
      ? []
      : [
          [COMBINED_FEEDBACK.correct, combined.correct],
          [COMBINED_FEEDBACK.partiallyCorrect, combined.partiallyCorrect],
          [COMBINED_FEEDBACK.incorrect, combined.incorrect],
        ];
  return [
    ...part.answerFeedback,
    ...(question.generalFeedback.text === "" ? [] : [[GENERAL_FEEDBACK, question.generalFeedback] as const]),
    ...combinedTexts.filter(([, text]) => text.text !== ""),
  ].map(([id, text]) => modalFeedback(id, text, content));
}

/** The outcomes of the item: `SCORE` and `MAXSCORE` of the mark, and `FEEDBACK` when it has feedback. */
function buildOutcomes(part: Part | undefined, mark: number, withFeedback: boolean): XmlElement[] {
  if (part === undefined) return [];
  return [
    floatOutcome(SCORE, 0, {
      "normal-maximum": formatFloat(mark),
      "normal-minimum": part.minimum < 0 ? formatFloat(part.minimum) : undefined,
      "external-scored": part.human === true ? "human" : undefined,
    }),
    floatOutcome(MAXSCORE, mark),
    ...(withFeedback
      ? [qti("qti-outcome-declaration", { identifier: FEEDBACK, cardinality: "multiple", "base-type": "identifier" })]
      : []),
  ];
}

function assemble(question: Question, identifier: string, context: BuildContext, content: Content): BuiltItem {
  const losses: ItemLoss[] = [];
  const part = partOf(question, context, content, losses);
  const mark = question.defaultMark;
  const combined = hasCombined(part?.combined) ? part.combined : undefined;
  const body = buildBody(question, part, content, losses);
  const feedback = buildFeedback(question, part, combined, content, losses);
  if (question.hints.length > 0) {
    losses.push({
      reason: "setting",
      message: `The ${question.hints.length === 1 ? "hint" : `${question.hints.length} hints`} of Moodle's interactive modes ${question.hints.length === 1 ? "has" : "have"} no place in a QTI item.`,
    });
  }
  const general = question.generalFeedback.text !== "" && part !== undefined;
  const rules = [...(part?.rules ?? []), ...feedbackRules(part, general, combined, mark)];
  const element = qti(
    "qti-assessment-item",
    {
      identifier,
      title: question.name === "" ? identifier : question.name,
      adaptive: "false",
      "time-dependent": "false",
    },
    [
      ...(part?.declaration === undefined ? [] : [part.declaration]),
      ...buildOutcomes(part, mark, feedback.length > 0),
      qti("qti-item-body", {}, body),
      ...(rules.length === 0 ? [] : [qti("qti-response-processing", {}, rules)]),
      ...feedback,
    ],
  );
  countElements(treeSize(element), context.state);
  const document = readAsi(element);
  if (document.kind !== "item") throw new ReadError("The built document is not an item.", []);
  return { item: document.item, losses };
}

/** The elements of a tree, itself included. */
function treeSize(element: XmlElement): number {
  let size = 1;
  for (const child of element.children) if (child.kind === "element") size += treeSize(child);
  return size;
}

/** The prefix by which Moodle's texts name the files of their area. */
const PLUGIN_FILE = "@@PLUGINFILE@@/";

/** Moodle's `rawurlencode` of each part of a path, which its texts write. */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replaceAll(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

/**
 * Names the files of a text by the item, `files/<identifier>/` in place of `@@PLUGINFILE@@/`, and adds each file the text
 * embeds to those of the file, by that reference.
 */
function withFiles(text: FormattedText, identifier: string, files: Map<string, Uint8Array>): FormattedText {
  if (!text.text.includes(PLUGIN_FILE)) return text;
  const base = `files/${encodePath(identifier)}/`;
  for (const { path, bytes } of text.files ?? []) files.set(`${base}${encodePath(path.replace(/^\//, ""))}`, bytes);
  return { ...text, text: text.text.replaceAll(PLUGIN_FILE, base) };
}

/** Removes the tags of a text, for content that QTI could not take as HTML. */
function asPlainText(text: FormattedText): FormattedText {
  return text.format === "plain" || text.format === "markdown"
    ? text
    : { text: text.text.replaceAll(/<[^>]*>/g, " ").replaceAll(/[ \t]+/g, " "), format: "plain" };
}

/** What the conversion of the item's texts left out or changed, one loss for each kind. */
function contentLosses(state: ContentState): ItemLoss[] {
  const list = (names: ReadonlySet<string>) => [...names].join(", ");
  return [
    ...(state.unwrapped.size === 0
      ? []
      : [
          `The elements ${list(state.unwrapped)} are not QTI content where they stand: their content is kept without them.`,
        ]),
    ...(state.dropped.size === 0
      ? []
      : [`The elements ${list(state.dropped)} are not QTI content: they are left out with what they hold.`]),
    ...(state.attributes.size === 0
      ? []
      : [`The attributes ${list(state.attributes)} are not QTI content or have invalid values: they are left out.`]),
    ...(state.markdown ? ["Moodle shows Markdown as formatted text; the item keeps it as plain text."] : []),
  ].map((message) => ({ reason: "content", message }));
}

/**
 * Builds the QTI item of a question. Its texts become content as `readMoodleText` keeps it; when that content does not
 * form a valid item, the texts are kept as plain text, which the losses say.
 *
 * @throws `SecurityError` when the texts pass the limits of the state.
 */
export function buildItem(question: Question, identifier: string, context: BuildContext): BuiltItem {
  const { state } = context;
  startItem(state);
  const content: Content = (text, parent, blank) =>
    readMoodleText(withFiles(text, identifier, context.files), parent, state, blank);
  let built: BuiltItem;
  try {
    built = assemble(question, identifier, context, content);
  } catch (error) {
    if (!(error instanceof ReadError)) throw error;
    startItem(state);
    const plain: Content = (text, parent, blank) =>
      readMoodleText(asPlainText(withFiles(text, identifier, context.files)), parent, state, blank);
    const fallback = assemble(question, identifier, context, plain);
    built = {
      item: fallback.item,
      losses: [
        ...fallback.losses,
        {
          reason: "content",
          message: `The HTML of the question does not form QTI content (${error.message}): its texts are kept as plain text.`,
        },
      ],
    };
  }
  const losses = [...built.losses, ...contentLosses(state)];
  return { item: built.item, losses };
}
