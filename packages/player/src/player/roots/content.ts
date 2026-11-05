import type { BodyNode, Catalog, TestFeedback } from "@assesskit/runtime/asi";
import { looseRecord, objectSchema, parseWith, strictRecord } from "@assesskit/runtime/checks";
import type { ContentVariables, HazardExposure } from "@assesskit/runtime/content";
import { PNP_HAZARDS } from "@assesskit/runtime/pnp";
import * as v from "valibot";

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

const part = v.optional(objectSchema<object>());

const rootContentSchema = strictRecord({
  rubric: part,
  stimuli: v.optional(v.array(objectSchema<object>())),
  body: part,
  testFeedback: v.optional(v.array(v.unknown())),
  stylesheets: v.optional(v.array(v.string())),
  catalogs: v.optional(v.array(v.unknown())),
  hazards: v.optional(v.array(looseRecord({ hazard: v.picklist(PNP_HAZARDS), avoided: v.boolean() }))),
  language: v.optional(v.string()),
  variables: v.optional(v.unknown()),
});

/**
 * Checks the content of a root.
 *
 * @param content - The value to check.
 * @throws `DataError` when it, a part, or a list of it is not of its type.
 */
export function checkContent(content: unknown): asserts content is RootContent {
  parseWith(rootContentSchema, content, "The content");
}
