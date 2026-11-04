import type { AssessmentItem } from "../asi/index.js";
import { typeNamed, writeElement } from "../asi/internal.js";
import { DataError } from "../errors.js";
import { collectText, findAttribute, type XmlElement } from "../xml/index.js";
import { type HtmlVisitor, writeHtml } from "./body-html.js";
import { type Choice, convertChoices } from "./convert-choices.js";
import { convertEssay } from "./convert-essay.js";
import { convertMatch } from "./convert-match.js";
import { convertNumerical } from "./convert-number.js";
import { convertShortAnswer } from "./convert-text.js";
import type { ItemLoss } from "./item-build.js";
import { type ConvertContext, descendants, elements, html, type ItemView, Omitted } from "./item-view.js";
import { createProbe, type FeedbackElement, isProcessingFailure, type Probe } from "./probe.js";
import { emptyText, type Question, type QuestionCommon } from "./question.js";

// An item as Moodle's question model: the interaction gives the question type, its response processing run on the responses
// that matter gives each answer's credit and the feedback each shows, and its body gives the question's text.

/** An item as a question, or the reason it is left out, with what does not convert. */
export interface ConvertedItem {
  readonly question: Question | undefined;
  readonly losses: readonly ItemLoss[];
}

/** The interactions that convert. */
const INTERACTIONS: ReadonlySet<string> = new Set([
  "qti-choice-interaction",
  "qti-inline-choice-interaction",
  "qti-text-entry-interaction",
  "qti-match-interaction",
  "qti-extended-text-interaction",
]);
/** The interactions that stand in a line of text, which a missing word takes. */
const INLINE: ReadonlySet<string> = new Set(["qti-text-entry-interaction", "qti-inline-choice-interaction"]);
/** The text that stands for an interaction in the HTML of the body until the writer splits it there. */
const MARKER = "\uE000";

/** Returns the HTML of content, with interactions, feedback and rubric blocks as the item's conversion takes them. */
function createVisitor(interaction: XmlElement | undefined, graderInfo: string[]): HtmlVisitor {
  const omitted = new Set<string>();
  const rubric = (element: XmlElement) => {
    const views = (findAttribute(element, "view") ?? "").split(/\s+/);
    const content = elements(element, "qti-content-body").flatMap((body) => body.children);
    if (views.includes("candidate")) return writeHtml(content, visitor);
    if (views.includes("scorer")) graderInfo.push(writeHtml(content, visitor));
    return "";
  };
  const visitor: HtmlVisitor = {
    omitted,
    visit(element) {
      if (element === interaction) {
        const prompt = elements(element, "qti-prompt")[0];
        return `${prompt === undefined ? "" : writeHtml(prompt.children, visitor)}${MARKER}`;
      }
      if (element.name === "qti-feedback-inline" || element.name === "qti-feedback-block") return "";
      return element.name === "qti-rubric-block" ? rubric(element) : undefined;
    },
  };
  return visitor;
}

/** Reads the mark of an item: the default of `MAXSCORE`, else the `normal-maximum` of `SCORE`. */
function readMark(tree: XmlElement): number | undefined {
  const outcomes = elements(tree, "qti-outcome-declaration");
  const max = outcomes.find((outcome) => findAttribute(outcome, "identifier") === "MAXSCORE");
  const defaultValue = max === undefined ? undefined : elements(max, "qti-default-value")[0];
  const value = defaultValue === undefined ? undefined : elements(defaultValue, "qti-value")[0];
  const declared = value === undefined ? Number.NaN : Number(collectText(value).trim());
  if (Number.isFinite(declared) && declared > 0) return declared;
  const score = outcomes.find((outcome) => findAttribute(outcome, "identifier") === "SCORE");
  const normal = Number(score === undefined ? Number.NaN : findAttribute(score, "normal-maximum"));
  return Number.isFinite(normal) && normal > 0 ? normal : undefined;
}

/** The feedback of an item that an outcome shows: its modal feedback and the feedback in its body. */
function feedbackElements(tree: XmlElement, body: XmlElement | undefined): FeedbackElement[] {
  const inBody =
    body === undefined
      ? []
      : descendants(body, ({ name }) => name === "qti-feedback-inline" || name === "qti-feedback-block");
  return [...elements(tree, "qti-modal-feedback"), ...inBody].map((element) => ({
    element,
    outcome: findAttribute(element, "outcome-identifier") ?? "",
    identifier: findAttribute(element, "identifier") ?? "",
    showHide: findAttribute(element, "show-hide") === "hide" ? "hide" : "show",
  }));
}

/** Finds the one interaction of an item that converts, or leaves the item out with the reason. */
function findInteraction(tree: XmlElement, body: XmlElement | undefined): XmlElement | undefined {
  if (elements(tree).some(({ name }) => name === "qti-template-declaration" || name === "qti-template-processing")) {
    throw new Omitted("The item has template variables, which GIFT and Moodle XML do not hold.");
  }
  const interactions =
    body === undefined ? [] : descendants(body, ({ name }) => name.startsWith("qti-") && name.endsWith("-interaction"));
  if (interactions.length > 1) {
    throw new Omitted(`The item has ${interactions.length} interactions; a question of GIFT or Moodle XML holds one.`);
  }
  const [interaction] = interactions;
  if (interaction !== undefined && !INTERACTIONS.has(interaction.name)) {
    throw new Omitted(`The ${interaction.name} has no question type in GIFT or Moodle XML.`);
  }
  return interaction;
}

/**
 * The text of the question: the HTML of the body with the interaction's prompt in its place, and the place of an inline
 * interaction as the missing word, unless no text follows it, where Moodle puts the answers anyway.
 */
function questionText(
  body: XmlElement | undefined,
  interaction: XmlElement | undefined,
  view: ItemView,
): Pick<QuestionCommon, "text" | "blank"> {
  const bodyHtml = body === undefined ? "" : writeHtml(body.children, view.visitor);
  const at = bodyHtml.indexOf(MARKER);
  const before = at < 0 ? bodyHtml : bodyHtml.slice(0, at);
  const after = at < 0 ? "" : bodyHtml.slice(at + MARKER.length);
  const textAfter = after.replaceAll(/<[^>]*>/g, "").trim() !== "";
  const inline = interaction !== undefined && INLINE.has(interaction.name);
  if (!inline && textAfter) {
    view.losses.push({
      reason: "content",
      message:
        "The content after the interaction comes before the answers, where Moodle puts all of a question's text.",
    });
  }
  if (inline && textAfter) {
    const text = `${before}${MARKER}${after}`.trim();
    return { text: { text: text.replace(MARKER, "_____"), format: "html" }, blank: text.indexOf(MARKER) };
  }
  const text = `${before}${after}`.replace(/<(div|p)>\s*<\/\1>\s*$/, "").trim();
  return { text: { text, format: "html" }, blank: null };
}

/** Converts the interaction by its kind and the base type of its response. */
function convertInteraction(
  interaction: XmlElement,
  probe: Probe,
  view: ItemView,
  common: QuestionCommon,
  context: ConvertContext,
): Question {
  const baseType = view.declaration === undefined ? undefined : findAttribute(view.declaration, "base-type");
  switch (interaction.name) {
    case "qti-choice-interaction":
    case "qti-inline-choice-interaction": {
      const choiceName = interaction.name === "qti-choice-interaction" ? "qti-simple-choice" : "qti-inline-choice";
      const choices: Choice[] = elements(interaction, choiceName).map((choice) => ({
        id: findAttribute(choice, "identifier") ?? "",
        content: html(choice.children, view),
      }));
      return convertChoices(interaction, choices, probe, view, common, context);
    }
    case "qti-text-entry-interaction":
      if (baseType === "string") return convertShortAnswer(probe, view, common, context);
      if (baseType === "float" || baseType === "integer")
        return convertNumerical(probe, view, common, baseType, context);
      throw new Omitted(`A text entry of the base type ${baseType} has no question type in Moodle.`);
    case "qti-match-interaction":
      return convertMatch(interaction, probe, view, common, context);
    default:
      return convertEssay(interaction, probe, view, common);
  }
}

/** Converts an item whose interaction the view holds, or a description when it has none. */
function convertView(
  item: AssessmentItem,
  interaction: XmlElement | undefined,
  view: ItemView,
  common: QuestionCommon,
  context: ConvertContext,
): Question {
  if (interaction === undefined) {
    if (view.feedback.length > 0) {
      view.losses.push({
        reason: "feedback",
        message: "An item without an interaction has no response to show feedback for.",
      });
    }
    return { ...common, defaultMark: 0, qtype: "description" };
  }
  if (view.declaration === undefined) throw new Omitted("The interaction's response has no declaration.");
  const probe = createProbe(
    item,
    findAttribute(interaction, "response-identifier") ?? "",
    view.feedback,
    context.operators,
  );
  return convertInteraction(interaction, probe, view, common, context);
}

/**
 * Converts an item into Moodle's question model, running its response processing to learn each answer's credit and the
 * feedback each shows. An item that no question type holds is left out with its reason; what does not convert of another
 * is in the losses.
 *
 * @throws `DataError` when the item is not an object of the model of `qti-assessment-item`.
 */
export function convertItem(item: AssessmentItem, context: ConvertContext): ConvertedItem {
  const tree = writeElement(typeNamed("AssessmentItem"), "qti-assessment-item", item);
  const losses: ItemLoss[] = [];
  try {
    const body = elements(tree, "qti-item-body")[0];
    const interaction = findInteraction(tree, body);
    const graderInfo: string[] = [];
    const view: ItemView = {
      tree,
      feedback: feedbackElements(tree, body),
      declaration:
        interaction === undefined
          ? undefined
          : elements(tree, "qti-response-declaration").find(
              (declaration) =>
                findAttribute(declaration, "identifier") === findAttribute(interaction, "response-identifier"),
            ),
      mark: readMark(tree),
      losses,
      visitor: createVisitor(interaction, graderInfo),
      graderInfo,
    };
    const common: QuestionCommon = {
      ...questionText(body, interaction, view),
      name: item.title,
      generalFeedback: emptyText(),
      defaultMark: 1,
      penalty: 0.3333333,
      idNumber: item.identifier,
      tags: [],
      hints: [],
    };
    const question = convertView(item, interaction, view, common, context);
    if (view.visitor.omitted.size > 0) {
      losses.push({
        reason: "content",
        message: `The elements ${[...view.visitor.omitted].join(", ")} have no place in a question of Moodle: they are left out.`,
      });
    }
    return { question, losses };
  } catch (error) {
    if (error instanceof Omitted) return { question: undefined, losses: [{ reason: "item", message: error.message }] };
    if (isProcessingFailure(error) || error instanceof DataError) {
      return {
        question: undefined,
        losses: [{ reason: "item", message: `The item's response processing fails: ${error.message}` }],
      };
    }
    throw error;
  }
}
