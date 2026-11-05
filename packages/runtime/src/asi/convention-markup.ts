import * as v from "valibot";
import { guardSchema, strictRecord } from "../checks.js";
import { xmlTokens } from "../values/internal.js";
import type { XmlAttribute, XmlNode } from "../xml/index.js";
import type { ElementModel, TestRubricBlock } from "./model.js";
import { isModelNode } from "./nodes.js";
import { typeNamed } from "./type-index.js";
import { writeElement } from "./write.js";

/** The attribute that names the outcome a rubric block of a convention is for. */
export const OUTCOME_ATTRIBUTE = "data-outcome-identifier";

/** A list entry (`li`), as the model has it. */
export type ListEntry = ElementModel<"LI", "li">;

/**
 * Content that a rubric block accepts both in a test and in an item: the content of a test's rubric block, which an item's
 * also accepts.
 */
export type RubricContent = TestRubricBlock["contentBody"]["children"][number];

/** Content for the scorers: the notes of a rubric block. */
export type RubricNotes = readonly RubricContent[];

/** The schema of {@link RubricBlockOptions}: the notes are nodes, each checked for its `kind` alone. */
export const rubricBlockOptionsSchema = strictRecord({
  notes: v.optional(
    v.array(guardSchema((value): value is RubricContent => isModelNode(value), "a node of body content")),
    [],
  ),
});

/** The options of {@link buildScoreCoversBlock} and {@link buildScoringRubricBlock}. */
export interface RubricBlockOptions {
  /**
   * Content for the scorers before the list, such as instructions.
   *
   * @defaultValue `[]`
   */
  readonly notes?: RubricNotes;
}

/** Returns the value of an attribute without a namespace among the extensions of an element, or `undefined` when it has none. */
export function attributeOf(
  element: { readonly extensions: readonly XmlAttribute[] },
  name: string,
): string | undefined {
  return element.extensions.find((attribute) => attribute.namespace === "" && attribute.name === name)?.value;
}

/** Returns the text of a node and its descendants. */
function textOf(node: XmlNode): string {
  if (node.kind === "text" || node.kind === "cdata") return node.value;
  return node.kind === "element" ? node.children.map(textOf).join("") : "";
}

/** Returns the text of a list entry and everything inside it, with white space normalized. */
export function entryText(entry: ListEntry): string {
  return xmlTokens(textOf(writeElement(typeNamed("LI"), "li", entry))).join(" ");
}
