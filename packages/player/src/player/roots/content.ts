import type { BodyNode, Catalog, TestFeedback } from "@assesskit/runtime/asi";
import {
  checkArray,
  checkBoolean,
  checkChoice,
  checkProperties,
  checkRecord,
  checkString,
} from "@assesskit/runtime/checks";
import type { ContentVariables, HazardExposure } from "@assesskit/runtime/content";
import { PNP_HAZARDS } from "@assesskit/runtime/pnp";

/** Content from one document of the package, and where its references start. */
export interface ContentPart {
  /** The nodes of the content, such as the children of an item body. */
  readonly nodes: readonly BodyNode[];
  /**
   * The path in the package of the document the nodes come from.
   *
   * @defaultValue `""`, the root of the package
   */
  readonly base?: string;
}

/** What a content root shows: an item with the stimuli it shares, the rubric and feedback around them, and what they need. */
export interface RootContent {
  /**
   * The rubric of the test, its part and its sections for the view, which comes before the stimuli.
   *
   * @defaultValue None
   */
  readonly rubric?: ContentPart;
  /**
   * The stimuli that the item shares, beside the item and in order.
   *
   * @defaultValue `[]`
   */
  readonly stimuli?: readonly ContentPart[];
  /**
   * The body of the item.
   *
   * @defaultValue None
   */
  readonly body?: ContentPart;
  /**
   * The test feedback that is shown, after the item.
   *
   * @defaultValue `[]`
   */
  readonly testFeedback?: readonly TestFeedback[];
  /**
   * The paths in the package of the stylesheets of the content, adopted in this order after the player's: those of the
   * test, then those of the item.
   *
   * @defaultValue `[]`
   */
  readonly stylesheets?: readonly string[];
  /**
   * The catalogs of the item, whose cards {@link ContentRoot.card} renders.
   *
   * @defaultValue `[]`
   */
  readonly catalogs?: readonly Catalog[];
  /**
   * The hazards of the delivered content with whether the candidate avoids them.
   *
   * @remarks
   * Those avoided make the root withhold media and animation, and say so.
   *
   * @defaultValue `[]`
   */
  readonly hazards?: readonly HazardExposure[];
  /**
   * The language of the content, a BCP 47 tag, such as the language of the delivered variant.
   *
   * @defaultValue That of the host
   */
  readonly language?: string;
  /**
   * The variables that printed variables still in the content read.
   *
   * @defaultValue None
   */
  readonly variables?: ContentVariables;
}

const CONTENT_NAMES = [
  "rubric",
  "stimuli",
  "body",
  "testFeedback",
  "stylesheets",
  "catalogs",
  "hazards",
  "language",
  "variables",
];

/**
 * Checks the content of a root.
 *
 * @param content - The value to check.
 * @throws `DataError` when it, a part, or a list of it is not of its type.
 */
export function checkContent(content: unknown): asserts content is RootContent {
  checkRecord(content, "The content must be an object");
  checkProperties(content, "The content", CONTENT_NAMES);
  const {
    rubric,
    body,
    language,
    stimuli = [],
    testFeedback = [],
    stylesheets = [],
    catalogs = [],
    hazards = [],
  } = content;
  checkArray(stimuli, "The stimuli of the content must be an array");
  checkArray(testFeedback, "The test feedback of the content must be an array");
  checkArray(stylesheets, "The stylesheets of the content must be an array");
  checkArray(catalogs, "The catalogs of the content must be an array");
  checkArray(hazards, "The hazards of the content must be an array");
  for (const part of [rubric, body, ...stimuli]) {
    if (part !== undefined) checkRecord(part, "A part of the content must be an object");
  }
  for (const path of stylesheets) checkString(path, "A stylesheet of the content");
  for (const exposure of hazards) {
    checkRecord(exposure, "A hazard of the content must be an object");
    checkChoice(exposure.hazard, "The hazard of a hazard of the content", PNP_HAZARDS);
    checkBoolean(exposure.avoided, "The property avoided of a hazard of the content");
  }
  if (language !== undefined) checkString(language, "The language of the content");
}
