import type { AssessmentItem } from "../asi/index.js";
import { checkArray, checkRecord } from "../checks.js";
import {
  INTERACTION_TYPES,
  type InteractionType,
  type PciContext,
  type QtiMetadata,
  SCORING_MODES,
  type ScoringMode,
} from "./qti-metadata.js";
import { MAX_TOOL_STRING_LENGTH } from "./text.js";

/** Returns the kind of the model of an interaction type: `choiceInteraction` is `choice-interaction`. */
function kindOf(type: InteractionType): string {
  return type.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The interaction type of each interaction (MD §2.6.2: the names of the leaf classes derived from interaction). */
const TYPE_OF_KIND: ReadonlyMap<string, InteractionType> = new Map(
  INTERACTION_TYPES.map((type) => [kindOf(type), type]),
);

const PORTABLE_CUSTOM_INTERACTION = "portable-custom-interaction";
const FEEDBACK_KINDS: ReadonlySet<string> = new Set(["feedback-block", "feedback-inline"]);

/** What the body of an item holds that the metadata is about. */
interface BodyFacts {
  readonly interactions: InteractionType[];
  customTypeIdentifier: string | undefined;
  feedback: boolean;
}

/** Records what a node of the body is: an interaction, the first portable custom interaction, or feedback. */
function record(kind: string, node: object, facts: BodyFacts): void {
  const type = TYPE_OF_KIND.get(kind);
  if (type !== undefined) facts.interactions.push(type);
  if (
    kind === PORTABLE_CUSTOM_INTERACTION &&
    facts.customTypeIdentifier === undefined &&
    "customInteractionTypeIdentifier" in node &&
    typeof node.customInteractionTypeIdentifier === "string"
  ) {
    facts.customTypeIdentifier = node.customInteractionTypeIdentifier;
  }
  facts.feedback ||= FEEDBACK_KINDS.has(kind);
}

/**
 * Walks the body in the order of the model and collects its interactions, the type identifier of the first portable
 * custom interaction, and whether it has feedback. MathML, SSML and includes, which the model keeps as XML, are not
 * entered.
 */
function inspectBody(model: unknown, facts: BodyFacts): void {
  if (Array.isArray(model)) {
    for (const member of model) inspectBody(member, facts);
  } else if (typeof model === "object" && model !== null) {
    if ("kind" in model && typeof model.kind === "string") {
      if (model.kind === "element") return;
      record(model.kind, model, facts);
    }
    for (const member of Object.values(model)) inspectBody(member, facts);
  }
}

/** Collects the identifiers that a `qti-set-correct-response` rule sets, anywhere in a model of template processing. */
function correctResponsesSet(model: unknown, identifiers: Set<string>): void {
  if (Array.isArray(model)) {
    for (const member of model) correctResponsesSet(member, identifiers);
  } else if (typeof model === "object" && model !== null) {
    if (
      "kind" in model &&
      model.kind === "set-correct-response" &&
      "identifier" in model &&
      typeof model.identifier === "string"
    ) {
      identifiers.add(model.identifier);
    }
    for (const member of Object.values(model)) correctResponsesSet(member, identifiers);
  }
}

/** Returns whether every declared response has a correct response, in its declaration or set by template processing (MD §2.3.1.7). */
function solutionAvailable(item: AssessmentItem): boolean {
  const set = new Set<string>();
  correctResponsesSet(item.templateProcessing, set);
  return (
    item.responseDeclarations.length > 0 &&
    item.responseDeclarations.every(
      (declaration) => declaration.correctResponse !== undefined || set.has(declaration.identifier),
    )
  );
}

function scoringModesOf(item: AssessmentItem): ScoringMode[] {
  const present = new Set<ScoringMode>();
  if (item.responseProcessing !== undefined) present.add("responseprocessing");
  for (const { externalScored } of item.outcomeDeclarations) {
    if (externalScored === "human") present.add("human");
    if (externalScored === "externalMachine") present.add("externalmachine");
  }
  return SCORING_MODES.filter((mode) => present.has(mode));
}

/** Returns a tool string of the item when it fits the 256 characters of `String256` (MD §2.5.1), otherwise nothing. */
function toolString(value: string | undefined): string | undefined {
  return value !== undefined && [...value].length <= MAX_TOOL_STRING_LENGTH ? value : undefined;
}

/**
 * Derives the QTI metadata that an item shows (MD §2.3.1):
 *
 * - `itemTemplate` is true when the item has template processing.
 * - `timeDependent` is the attribute of the item.
 * - `composite` is true when the item has more than one interaction.
 * - `interactionTypes` are the types of the interactions of the body, each once, in the order of the model: document order, except that the places of one element come in schema order. A portable custom
 *   interaction also gives `portableCustomInteractionContext` with the `customTypeIdentifier` of the first one;
 *   `interactionKind` is not in the item.
 * - `feedbackType` is `none` without feedback (`qti-modal-feedback`, `qti-feedback-block`, `qti-feedback-inline`), and
 *   with feedback `adaptive` for an adaptive item and `nonadaptive` otherwise (MD §2.6.1).
 * - `solutionAvailable` is true when the item declares a response and every declared response has a correct response,
 *   in its declaration or set by `qti-set-correct-response` in the template processing.
 * - `scoringModes` are `human` and `externalmachine` for outcomes with `external-scored`, and `responseprocessing` when
 *   the item has response processing (MD §2.6.3), in the order of the vocabulary.
 * - `toolName` and `toolVersion` are the attributes of the item when they have at most 256 characters. The item has no
 *   vendor.
 *
 * The body of an item is walked as the model keeps it; an `xi:include` that is still in the item is not followed.
 *
 * @param item - An item from `readAsi`.
 * @throws `DataError` when the argument is not an item model.
 */
export function deriveQtiMetadata(item: AssessmentItem): QtiMetadata {
  checkRecord(item, "The item must be an object");
  checkArray(item.responseDeclarations, "The responseDeclarations of the item must be an array");
  checkArray(item.outcomeDeclarations, "The outcomeDeclarations of the item must be an array");
  checkArray(item.modalFeedback, "The modalFeedback of the item must be an array");
  const body: BodyFacts = { interactions: [], customTypeIdentifier: undefined, feedback: false };
  inspectBody(item.body?.children ?? [], body);
  const feedback = body.feedback || item.modalFeedback.length > 0;
  const context: PciContext | undefined =
    body.customTypeIdentifier === undefined ? undefined : { customTypeIdentifier: body.customTypeIdentifier };
  return {
    itemTemplate: item.templateProcessing !== undefined,
    timeDependent: item.timeDependent,
    composite: body.interactions.length > 1,
    interactionTypes: [...new Set(body.interactions)],
    portableCustomInteractionContext: context,
    feedbackType: feedback ? (item.adaptive === true ? "adaptive" : "nonadaptive") : "none",
    solutionAvailable: solutionAvailable(item),
    scoringModes: scoringModesOf(item),
    toolName: toolString(item.toolName),
    toolVersion: toolString(item.toolVersion),
  };
}
