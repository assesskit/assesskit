import type { BodyNode } from "@luthfanwakan/olah/asi";
import { rubricBlocksFor, type View } from "@luthfanwakan/olah/content";
import type { ItemKey } from "@luthfanwakan/olah/delivery";
import { fromWireValue, type Value } from "@luthfanwakan/olah/values";
import type {
  Submission,
  SubmissionItem,
  SubmissionPart,
  SubmissionValue,
  SubmissionVariable,
} from "../../protocol/index.js";
import { html, uniqueId } from "../dom.js";
import { type ValueContext, valueNode } from "./value.js";

/** What the display shows content with: the places for it, and the settings of the display. */
export interface DisplayContext extends ValueContext {
  /** The language of the interface. */
  readonly language: string;
  /** Creates a content root of the given view in a new element, shows the nodes in it, and returns the element. */
  content(nodes: readonly BodyNode[], view: View, base: string): HTMLElement;
  /** Returns the path in the package of the document of an item instance. */
  itemPath(item: ItemKey): string;
}

/** Builds a name and its value as a group of a definition list. */
const fact = (name: string, ...value: (Node | string)[]): HTMLElement =>
  html("div", {}, html("dt", {}, name), html("dd", {}, ...value));

/** Builds a time in epoch milliseconds as a `time` element with the datestamp of olah's reports (RFC 3339, UTC). */
function timeNode(instant: number): HTMLElement {
  const datestamp = new Date(instant).toISOString();
  return html("time", { datetime: datestamp }, datestamp);
}

/** Decodes a value of the submission; `fromWireValue` of olah checks it. */
const decoded = (value: SubmissionValue): Value | null => (value === null ? null : fromWireValue(value));

/** Builds a section with a heading of the given level, labelled by it. */
function section(
  level: "h2" | "h3" | "h4",
  title: string,
  className: string,
  ...content: (Node | string)[]
): HTMLElement {
  const id = uniqueId("tempuh-submission-heading");
  return html("section", { class: className, "aria-labelledby": id }, html(level, { id }, title), ...content);
}

/** Builds the facts of the request: the outcome, who scores it, its declaration and the score given before. */
function factsNode(submission: Submission, context: DisplayContext): HTMLElement {
  const { messages } = context;
  const { outcome, mode, declaration, variableIdentifierRef, requestedAt, supplied } = submission;
  const facts: HTMLElement[] = [
    fact(messages.submissionOutcome, outcome),
    fact(messages.submissionScorer, mode === "human" ? messages.submissionHuman : messages.submissionMachine),
    fact(
      messages.submissionType,
      declaration.baseType === undefined
        ? declaration.cardinality
        : `${declaration.cardinality} ${declaration.baseType}`,
    ),
  ];
  const optional: readonly (readonly [string, number | string | undefined])[] = [
    [messages.submissionMinimum, declaration.normalMinimum],
    [messages.submissionMaximum, declaration.normalMaximum],
    [messages.submissionMastery, declaration.masteryValue],
    [messages.submissionMeaning, declaration.interpretation],
    [messages.submissionDetails, declaration.longInterpretation],
    [messages.submissionVariable, variableIdentifierRef],
  ];
  for (const [name, value] of optional) if (value !== undefined) facts.push(fact(name, String(value)));
  facts.push(fact(messages.submissionRequested, timeNode(requestedAt)));
  if (supplied !== undefined) {
    facts.push(
      fact(messages.submissionEarlier, valueNode(decoded(supplied.value), messages.submissionNoValue, context)),
      fact(
        messages.submissionEarlierBy,
        supplied.scorer === "human" ? messages.submissionHuman : messages.submissionMachine,
      ),
      fact(messages.submissionEarlierAt, timeNode(supplied.at)),
    );
  }
  return html("dl", { class: "tempuh-submission-facts" }, ...facts);
}

/** Builds the variables of an item as a list of names and values, or nothing when there are none. */
function variablesNode(
  title: string,
  variables: readonly SubmissionVariable[],
  context: DisplayContext,
): HTMLElement | undefined {
  if (variables.length === 0) return undefined;
  const groups = variables.map(({ identifier, value }) =>
    fact(identifier, valueNode(decoded(value), context.messages.submissionNoValue, context)),
  );
  return section(
    "h4",
    title,
    "tempuh-submission-section",
    html("dl", { class: "tempuh-submission-variables" }, ...groups),
  );
}

/** Builds one response that the outcome rates: where it is bound, and what the candidate answered. */
function partNode(part: SubmissionPart, context: DisplayContext): HTMLElement {
  const { messages } = context;
  const facts = [
    fact(messages.submissionResponseId, part.responseIdentifier),
    ...(part.interaction === undefined ? [] : [fact(messages.submissionInteraction, part.interaction)]),
    fact(messages.submissionResponse, valueNode(decoded(part.value), messages.submissionNoResponse, context)),
  ];
  return html(
    "li",
    { class: "tempuh-submission-part" },
    html("h4", {}, part.label ?? part.responseIdentifier),
    html("dl", { class: "tempuh-submission-facts" }, ...facts),
  );
}

/** Whether a node is a rubric block that only the scorer sees: the candidate's blocks are already in the body of an item. */
const isScorerBlock = (node: BodyNode): boolean =>
  node.kind === "rubric-block" && rubricBlocksFor([node], "candidate").length === 0;

/**
 * Builds the section of a covered item: its title, its body as the candidate saw it, the rubric blocks of the item for
 * the scorer, the responses the outcome rates, the correct responses and the template values.
 */
function itemNode(item: SubmissionItem, parts: readonly SubmissionPart[], context: DisplayContext): HTMLElement {
  const { messages } = context;
  const base = context.itemPath(item.key);
  const blocks = item.body.filter(isScorerBlock);
  const content: (Node | string)[] = [];
  if (!item.presented) content.push(html("p", { class: "tempuh-submission-note" }, messages.submissionNotPresented));
  const body = item.body.filter((node) => !isScorerBlock(node));
  if (body.length > 0) content.push(context.content(body, "candidate", base));
  if (blocks.length > 0) {
    content.push(
      section("h4", messages.submissionRubric, "tempuh-submission-section", context.content(blocks, "scorer", base)),
    );
  }
  if (parts.length > 0) {
    content.push(html("ol", { class: "tempuh-submission-parts" }, ...parts.map((part) => partNode(part, context))));
  }
  for (const [title, variables] of [
    [messages.submissionCorrect, item.correctResponses],
    [messages.submissionTemplates, item.templateValues],
  ] as const) {
    const node = variablesNode(title, variables, context);
    if (node !== undefined) content.push(node);
  }
  return section("h3", item.title, "tempuh-submission-section", ...content);
}

/** Whether two keys name the same item instance. */
const sameKey = (a: ItemKey, b: ItemKey): boolean => a.ref === b.ref && a.instance === b.instance;

/**
 * Builds the display of a submission, read-only: the facts of the request, the rubric for the scorer, and each covered
 * item with its responses in the order of the covers. Content goes through `context.content`.
 *
 * @throws `DataError` of olah when a value of the submission is not a wire value.
 */
export function buildSubmission(submission: Submission, context: DisplayContext): HTMLElement {
  const { messages, language } = context;
  const id = uniqueId("tempuh-submission-heading");
  const children: (Node | string)[] = [html("h2", { id }, messages.submissionTitle), factsNode(submission, context)];
  if (submission.lti === true)
    children.push(html("p", { class: "tempuh-submission-note" }, messages.submissionLinkedTool));
  if (submission.rubric.length > 0) {
    children.push(
      section(
        "h3",
        messages.submissionRubric,
        "tempuh-submission-section",
        context.content(submission.rubric, "scorer", ""),
      ),
    );
  }
  for (const item of submission.items) {
    const parts = submission.parts.filter((part) => sameKey(part.item, item.key));
    children.push(itemNode(item, parts, context));
  }
  return html("article", { class: "tempuh-submission", "aria-labelledby": id, lang: language }, ...children);
}
