import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "../values/index.js";
import { xmlTokens } from "../values/whitespace.js";
import type { XmlAttribute, XmlElement, XmlNode } from "../xml/index.js";
import { isNode } from "./guards.js";
import type { AssessmentTest, BodyNode, RubricBlock } from "./model.js";
import { ASI_NAMESPACE } from "./namespace.js";

/** The class token that marks a test-level rubric block as the covers of an outcome (olah convention, §4.16). */
const COVERS_CLASS = "external-score-covers";
/** The attributes of the convention: the outcome on the block, and the item reference and response on an `li`. */
const OUTCOME_ATTRIBUTE = "data-outcome-identifier";
const ITEM_ATTRIBUTE = "data-item-ref";
const RESPONSE_ATTRIBUTE = "data-response-identifier";

/** A response that an externally scored outcome of a test covers. */
export interface ScoreCover {
  /** The identifier of the `qti-assessment-item-ref` of the item. */
  readonly itemRef: string;
  /** The identifier of the response variable of the item. */
  readonly responseIdentifier: string;
  /** The text of the list entry, with white space normalized; absent when the entry has no text. */
  readonly label?: string;
}

function isNamed(node: XmlNode, name: string): node is XmlElement {
  return node.kind === "element" && node.namespace === ASI_NAMESPACE && node.name === name;
}

function attributeOf(element: { readonly attributes: readonly XmlAttribute[] }, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.namespace === "" && attribute.name === name)?.value;
}

/** Returns the text of a node and its descendants. */
function textOf(node: XmlNode): string {
  if (node.kind === "text" || node.kind === "cdata") return node.value;
  return node.kind === "element" ? node.children.map(textOf).join("") : "";
}

function coverOf(entry: XmlElement): ScoreCover | undefined {
  const itemRef = attributeOf(entry, ITEM_ATTRIBUTE);
  const responseIdentifier = attributeOf(entry, RESPONSE_ATTRIBUTE);
  if (itemRef === undefined || responseIdentifier === undefined) return undefined;
  const label = xmlTokens(textOf(entry)).join(" ");
  return { itemRef, responseIdentifier, ...(label === "" ? {} : { label }) };
}

/** Returns the outcome that a rubric block covers, or `undefined` when it is not a covers block. */
function outcomeOf(block: RubricBlock): string | undefined {
  if (!block.class?.includes(COVERS_CLASS)) return undefined;
  return attributeOf({ attributes: block.extensions }, OUTCOME_ATTRIBUTE);
}

function coversOf(block: RubricBlock): ScoreCover[] {
  return block.contentBody.children
    .filter((node) => isNamed(node, "ul"))
    .flatMap((list) => (list.kind === "element" ? list.children : []))
    .filter((node) => isNamed(node, "li"))
    .flatMap((entry) => {
      const cover = entry.kind === "element" ? coverOf(entry) : undefined;
      return cover === undefined ? [] : [cover];
    });
}

/**
 * Reads the covers of the externally scored outcomes of a test: the responses that each outcome rates. The covers are in
 * the test-level rubric blocks whose class has the token `external-score-covers` and that name an outcome in
 * `data-outcome-identifier`; they are not copied into the model (olah convention, §4.16). Rubric blocks of test parts
 * and sections are not recognized, and a list entry without `data-item-ref` or `data-response-identifier` is left out.
 *
 * @param test - The test.
 * @returns The covers by outcome identifier, in document order; a test without covers blocks gives an empty map.
 * @throws `DataError` when the test, its rubric blocks or their content are not objects and arrays of the model.
 */
export function readScoreCovers(test: AssessmentTest): ReadonlyMap<string, readonly ScoreCover[]> {
  checkRecord(test, "The test must be an object");
  checkArray(test.rubricBlocks, "The rubric blocks of the test must be an array");
  const covers = new Map<string, ScoreCover[]>();
  for (const block of test.rubricBlocks) {
    checkRecord(block, "A rubric block must be an object");
    checkRecord(block.contentBody, "The content body of a rubric block must be an object");
    checkArray(block.contentBody.children, "The children of the content body must be an array");
    checkArray(block.extensions, "The extensions of a rubric block must be an array");
    const outcome = outcomeOf(block);
    if (outcome !== undefined) covers.set(outcome, [...(covers.get(outcome) ?? []), ...coversOf(block)]);
  }
  return covers;
}

function checkIdentifier(value: unknown, label: string): string {
  if (!isIdentifier(value)) throw new DataError(`${label} must be an identifier, found ${describe(value)}.`);
  return value;
}

function entryOf(cover: unknown): XmlElement {
  checkRecord(cover, "A cover must be an object");
  const { itemRef, responseIdentifier, label } = cover;
  if (label !== undefined) checkString(label, "The label of a cover");
  const text = label === undefined ? "" : xmlTokens(label).join(" ");
  return {
    kind: "element",
    namespace: ASI_NAMESPACE,
    name: "li",
    attributes: [
      { namespace: "", name: ITEM_ATTRIBUTE, value: checkIdentifier(itemRef, "The item reference of a cover") },
      {
        namespace: "",
        name: RESPONSE_ATTRIBUTE,
        value: checkIdentifier(responseIdentifier, "The response identifier of a cover"),
      },
    ],
    children: text === "" ? [] : [{ kind: "text", value: text }],
  };
}

/**
 * Builds the rubric block that names the responses an externally scored outcome of a test covers (olah convention,
 * §4.16): `view="scorer"`, `use="scoring"`, the class token `external-score-covers` and `data-outcome-identifier`, with
 * the notes and then a list of the covers as content. Put it in `rubricBlocks` of the test, where
 * {@link readScoreCovers} finds it again. A label is written with its white space normalized.
 *
 * @param outcomeIdentifier - The identifier of the outcome.
 * @param covers - The responses the outcome covers.
 * @param notes - Content for the scorers before the list, such as instructions. Default: none.
 * @throws `DataError` when an identifier is not an identifier, a label is not a string, or an argument has the wrong type.
 */
export function scoreCoversBlock(
  outcomeIdentifier: string,
  covers: readonly ScoreCover[],
  notes: readonly BodyNode[] = [],
): RubricBlock {
  checkIdentifier(outcomeIdentifier, "The outcome identifier");
  checkArray(covers, "The covers must be an array");
  checkArray(notes, "The notes must be an array");
  if (!notes.every(isNode)) throw new DataError(`The notes must be nodes of body content, found ${describe(notes)}.`);
  const list: XmlElement = {
    kind: "element",
    namespace: ASI_NAMESPACE,
    name: "ul",
    attributes: [],
    children: covers.map(entryOf),
  };
  return {
    kind: "rubric-block",
    view: ["scorer"],
    use: "scoring",
    class: [COVERS_CLASS],
    stylesheets: [],
    contentBody: { kind: "content-body", children: [...notes, list] },
    extensions: [{ namespace: "", name: OUTCOME_ATTRIBUTE, value: outcomeIdentifier }],
  };
}
