import { checkArray, checkBoolean, checkChoice, checkRecord, checkString } from "../checks.js";
import { DataError } from "../errors.js";
import { ElementReader, type ReaderRules, termOf, type XmlElement } from "../xml/index.js";
import { QTI_METADATA_NAMESPACE } from "./namespaces.js";
import {
  boundedStringOf,
  checkReadArguments,
  expectRoot,
  MAX_TOOL_STRING_LENGTH,
  parseBoolean,
  parseString,
  takeLeaf,
  takeLeaves,
} from "./text.js";
import { appendLeaf, branch, leaf, QMD } from "./write-support.js";

/** The terms of the vocabulary InteractionType (MD §2.6.2): the interactions an item contains. */
export const INTERACTION_TYPES = [
  "associateInteraction",
  "choiceInteraction",
  "customInteraction",
  "drawingInteraction",
  "endAttemptInteraction",
  "extendedTextInteraction",
  "gapMatchInteraction",
  "graphicAssociateInteraction",
  "graphicGapMatchInteraction",
  "graphicOrderInteraction",
  "hotspotInteraction",
  "hottextInteraction",
  "inlineChoiceInteraction",
  "matchInteraction",
  "mediaInteraction",
  "orderInteraction",
  "portableCustomInteraction",
  "positionObjectInteraction",
  "selectPointInteraction",
  "sliderInteraction",
  "textEntryInteraction",
  "uploadInteraction",
] as const;

/** A term of the vocabulary InteractionType. */
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/** The terms of the vocabulary FeedbackType (MD §2.6.1). */
export const FEEDBACK_TYPES = ["adaptive", "nonadaptive", "none"] as const;

/** A term of the vocabulary FeedbackType. */
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** The terms of the vocabulary ScoringMode (MD §2.6.3). */
export const SCORING_MODES = ["human", "externalmachine", "responseprocessing"] as const;

/** A term of the vocabulary ScoringMode. */
export type ScoringMode = (typeof SCORING_MODES)[number];

/** The context of a portable custom interaction (MD §2.4.1). */
export interface PciContext {
  /** The type identifier of the custom interaction. */
  readonly customTypeIdentifier?: string;
  /** The kind of the interaction. */
  readonly interactionKind?: string;
}

/** What QTI metadata says about an item (MD §2.3.1). A field the document omits is `undefined`. */
export interface QtiMetadata {
  /** Whether the item is an item template: it has template declarations and template processing. */
  readonly itemTemplate?: boolean;
  /** Whether the item is time dependent. */
  readonly timeDependent?: boolean;
  /** Whether the item is composite: it has more than one interaction. */
  readonly composite?: boolean;
  /** The interactions of the item. */
  readonly interactionTypes: readonly InteractionType[];
  /** The context of a portable custom interaction. */
  readonly portableCustomInteractionContext?: PciContext;
  /** How the item gives feedback. */
  readonly feedbackType?: FeedbackType;
  /** Whether the item declares a correct response. */
  readonly solutionAvailable?: boolean;
  /** How the item is scored. */
  readonly scoringModes: readonly ScoringMode[];
  /** The name of the tool that authored the item, at most 256 characters. */
  readonly toolName?: string;
  /** The version of that tool, at most 256 characters. */
  readonly toolVersion?: string;
  /** The vendor of that tool, at most 256 characters. */
  readonly toolVendor?: string;
}

/** The rules of the QTI metadata schema for a reader. */
function rulesOf(path: string | undefined): ReaderRules {
  return { module: "metadata", source: "MD §2.3.1", namespaces: [QTI_METADATA_NAMESPACE], path };
}

function readPciContext(reader: ElementReader): PciContext {
  const context = {
    customTypeIdentifier: takeLeaf(reader, "customTypeIdentifier", parseString),
    interactionKind: takeLeaf(reader, "interactionKind", parseString),
  };
  reader.done();
  return context;
}

/**
 * Reads a `qtiMetadata` element. The children come in the order of the schema.
 *
 * @param element - The element.
 * @param path - The path of the document, which the issues name. Default: no path.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ReadError` when the element is not a `qtiMetadata` of the QTI metadata namespace, has an element, attribute or
 * text that MD §2.3.1 does not allow at that place, a boolean that is not `true`, `false`, `1` or `0`, a term outside its
 * vocabulary, or a tool string above 256 characters.
 */
export function readQtiMetadata(element: XmlElement, path?: string): QtiMetadata {
  checkReadArguments(element, path);
  const reader = new ElementReader(element, rulesOf(path));
  expectRoot(reader, QTI_METADATA_NAMESPACE, "qtiMetadata");
  const toolString = boundedStringOf(MAX_TOOL_STRING_LENGTH);
  const itemTemplate = takeLeaf(reader, "itemTemplate", parseBoolean);
  const timeDependent = takeLeaf(reader, "timeDependent", parseBoolean);
  const composite = takeLeaf(reader, "composite", parseBoolean);
  const interactionTypes = takeLeaves(reader, "interactionType", termOf(INTERACTION_TYPES));
  const pci = reader.take("portableCustomInteractionContext");
  const portableCustomInteractionContext = pci && readPciContext(pci);
  const metadata: QtiMetadata = {
    itemTemplate,
    timeDependent,
    composite,
    interactionTypes,
    portableCustomInteractionContext,
    feedbackType: takeLeaf(reader, "feedbackType", termOf(FEEDBACK_TYPES)),
    solutionAvailable: takeLeaf(reader, "solutionAvailable", parseBoolean),
    scoringModes: takeLeaves(reader, "scoringMode", termOf(SCORING_MODES)),
    toolName: takeLeaf(reader, "toolName", toolString),
    toolVersion: takeLeaf(reader, "toolVersion", toolString),
    toolVendor: takeLeaf(reader, "toolVendor", toolString),
  };
  reader.done();
  return metadata;
}

function checkToolString(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if ([...value].length > MAX_TOOL_STRING_LENGTH) {
    throw new DataError(`${label} must have at most ${MAX_TOOL_STRING_LENGTH} characters, found ${[...value].length}.`);
  }
}

function checkOptionalBoolean(value: unknown, label: string): void {
  if (value !== undefined) checkBoolean(value, label);
}

/**
 * Checks that a value is QTI metadata: an object whose fields have the types of `QtiMetadata`, whose terms are in their
 * vocabularies and whose tool strings have at most 256 characters.
 *
 * @throws `DataError` when it is not.
 */
export function checkQtiMetadata(metadata: unknown): asserts metadata is QtiMetadata {
  checkRecord(metadata, "The QTI metadata must be an object");
  const { itemTemplate, timeDependent, composite, interactionTypes, portableCustomInteractionContext } = metadata;
  const { feedbackType, solutionAvailable, scoringModes, toolName, toolVersion, toolVendor } = metadata;
  checkOptionalBoolean(itemTemplate, "The field itemTemplate");
  checkOptionalBoolean(timeDependent, "The field timeDependent");
  checkOptionalBoolean(composite, "The field composite");
  checkArray(interactionTypes, "The field interactionTypes must be an array");
  for (const type of interactionTypes) checkChoice(type, "An interaction type", INTERACTION_TYPES);
  if (feedbackType !== undefined) checkChoice(feedbackType, "The field feedbackType", FEEDBACK_TYPES);
  checkOptionalBoolean(solutionAvailable, "The field solutionAvailable");
  checkArray(scoringModes, "The field scoringModes must be an array");
  for (const mode of scoringModes) checkChoice(mode, "A scoring mode", SCORING_MODES);
  for (const [label, value] of [
    ["toolName", toolName],
    ["toolVersion", toolVersion],
    ["toolVendor", toolVendor],
  ] as const) {
    if (value !== undefined) checkToolString(value, `The field ${label}`);
  }
  if (portableCustomInteractionContext !== undefined) {
    checkRecord(portableCustomInteractionContext, "The field portableCustomInteractionContext must be an object");
    const { customTypeIdentifier, interactionKind } = portableCustomInteractionContext;
    for (const [label, value] of [
      ["customTypeIdentifier", customTypeIdentifier],
      ["interactionKind", interactionKind],
    ] as const) {
      if (value !== undefined) checkString(value, `The field ${label}`);
    }
  }
}

/**
 * Writes the metadata as a `qtiMetadata` element, with its children in the order of the schema (MD §2.3.1).
 *
 * @throws `DataError` when a field has the wrong type, a term is outside its vocabulary, or a tool string is above 256 characters.
 */
export function writeQtiMetadata(metadata: QtiMetadata): XmlElement {
  checkQtiMetadata(metadata);
  const { itemTemplate, timeDependent, composite, interactionTypes, portableCustomInteractionContext } = metadata;
  const { feedbackType, solutionAvailable, scoringModes, toolName, toolVersion, toolVendor } = metadata;
  const children: XmlElement[] = [];
  const flag = (name: string, value: boolean | undefined): void => appendLeaf(children, QMD, name, value?.toString());
  flag("itemTemplate", itemTemplate);
  flag("timeDependent", timeDependent);
  flag("composite", composite);
  for (const type of interactionTypes) children.push(leaf(QMD, "interactionType", type));
  if (portableCustomInteractionContext !== undefined) {
    const { customTypeIdentifier, interactionKind } = portableCustomInteractionContext;
    const context: XmlElement[] = [];
    appendLeaf(context, QMD, "customTypeIdentifier", customTypeIdentifier);
    appendLeaf(context, QMD, "interactionKind", interactionKind);
    children.push(branch(QMD, "portableCustomInteractionContext", context));
  }
  appendLeaf(children, QMD, "feedbackType", feedbackType);
  flag("solutionAvailable", solutionAvailable);
  for (const mode of scoringModes) children.push(leaf(QMD, "scoringMode", mode));
  appendLeaf(children, QMD, "toolName", toolName);
  appendLeaf(children, QMD, "toolVersion", toolVersion);
  appendLeaf(children, QMD, "toolVendor", toolVendor);
  return branch(QMD, "qtiMetadata", children);
}
