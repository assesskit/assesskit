import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError } from "../errors.js";
import { isIdentifier } from "../values/index.js";
import { xmlTokens } from "../values/internal.js";
import {
  attributeOf,
  entryText,
  type ListEntry,
  OUTCOME_ATTRIBUTE,
  type RubricBlockOptions,
} from "./convention-markup.js";
import type { AssessmentTest, ElementModel, TestRubricBlock } from "./model.js";
import { isModelNode } from "./nodes.js";

/** The class token that marks a test-level rubric block as the covers of an outcome (a convention of the runtime). */
export const SCORE_COVERS_CLASS = "external-score-covers";
/** The attributes of the convention besides the outcome: the item reference and response on an `li`. */
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

/** A list entry of a covers block as written: an attribute that the entry lacks is absent. */
interface ScoreCoverEntry {
  /** The `data-item-ref` attribute: the identifier of the `qti-assessment-item-ref` of the item. */
  readonly itemRef?: string;
  /** The `data-response-identifier` attribute: the identifier of the response variable of the item. */
  readonly responseIdentifier?: string;
  /** The text of the list entry, with white space normalized; absent when the entry has no text. */
  readonly label?: string;
}

/** A test-level rubric block that carries the class token of the convention, read without judging it. */
export interface ScoreCoverBlock {
  /** The rubric block. */
  readonly block: TestRubricBlock;
  /** The `data-outcome-identifier` attribute; absent when the block lacks it. */
  readonly outcomeIdentifier?: string;
  /** The list entries of the block's lists, in document order. */
  readonly entries: readonly ScoreCoverEntry[];
}

/** A list of the convention, as the model has it. */
type List = ElementModel<"OUL", "ul">;

function entryOf(entry: ListEntry): ScoreCoverEntry {
  const itemRef = attributeOf(entry, ITEM_ATTRIBUTE);
  const responseIdentifier = attributeOf(entry, RESPONSE_ATTRIBUTE);
  const label = entryText(entry);
  return {
    ...(itemRef === undefined ? {} : { itemRef }),
    ...(responseIdentifier === undefined ? {} : { responseIdentifier }),
    ...(label === "" ? {} : { label }),
  };
}

function entriesOf(block: TestRubricBlock): ScoreCoverEntry[] {
  const entries: ScoreCoverEntry[] = [];
  for (const node of block.contentBody.children) {
    if (node.kind !== "ul") continue;
    for (const item of node.items) if (item.kind === "li") entries.push(entryOf(item));
  }
  return entries;
}

/**
 * Reads the rubric blocks of a test that carry the class token `external-score-covers` (a convention of the runtime),
 * as they are written: a block without `data-outcome-identifier` and a list entry without `data-item-ref` or
 * `data-response-identifier` are kept, with the attribute absent, so that a check can report them. Rubric blocks of test
 * parts and sections are not recognized.
 *
 * @param test - The test.
 * @returns The blocks in document order.
 * @throws `DataError` when the test, its rubric blocks or their content are not objects and arrays of the model.
 */
export function selectScoreCoverBlocks(test: AssessmentTest): readonly ScoreCoverBlock[] {
  checkRecord(test, "The test must be an object");
  checkArray(test.rubricBlocks, "The rubric blocks of the test must be an array");
  const blocks: ScoreCoverBlock[] = [];
  for (const block of test.rubricBlocks) {
    checkRecord(block, "A rubric block must be an object");
    checkRecord(block.contentBody, "The content body of a rubric block must be an object");
    checkArray(block.contentBody.children, "The children of the content body must be an array");
    checkArray(block.extensions, "The extensions of a rubric block must be an array");
    if (!block.class?.includes(SCORE_COVERS_CLASS)) continue;
    const outcomeIdentifier = attributeOf(block, OUTCOME_ATTRIBUTE);
    blocks.push({
      block,
      ...(outcomeIdentifier === undefined ? {} : { outcomeIdentifier }),
      entries: entriesOf(block),
    });
  }
  return blocks;
}

/**
 * Reads the covers of the externally scored outcomes of a test: the responses that each outcome rates. The covers are in
 * the test-level rubric blocks whose class has the token `external-score-covers` and that name an outcome in
 * `data-outcome-identifier`; they are not copied into the model (a convention of the runtime). Rubric blocks of test
 * parts and sections are not recognized, and a list entry without `data-item-ref` or `data-response-identifier` is left out.
 *
 * @param test - The test.
 * @returns The covers by outcome identifier, in document order; a test without covers blocks gives an empty map.
 * @throws `DataError` when the test, its rubric blocks or their content are not objects and arrays of the model.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/conventions.md | Conventions of the runtime, covers}
 */
export function readScoreCovers(test: AssessmentTest): ReadonlyMap<string, readonly ScoreCover[]> {
  const covers = new Map<string, ScoreCover[]>();
  for (const { outcomeIdentifier, entries } of selectScoreCoverBlocks(test)) {
    if (outcomeIdentifier === undefined) continue;
    const complete = entries.flatMap(({ itemRef, responseIdentifier, label }) =>
      itemRef === undefined || responseIdentifier === undefined
        ? []
        : [{ itemRef, responseIdentifier, ...(label === undefined ? {} : { label }) }],
    );
    covers.set(outcomeIdentifier, [...(covers.get(outcomeIdentifier) ?? []), ...complete]);
  }
  return covers;
}

function checkIdentifier(value: unknown, label: string): string {
  if (!isIdentifier(value)) throw new DataError(`${label} must be an identifier, found ${describe(value)}.`);
  return value;
}

function coverEntry(cover: unknown): ListEntry {
  checkRecord(cover, "A cover must be an object");
  const { itemRef, responseIdentifier, label } = cover;
  if (label !== undefined) checkString(label, "The label of a cover");
  const text = label === undefined ? "" : xmlTokens(label).join(" ");
  return {
    kind: "li",
    children: text === "" ? [] : [{ kind: "text", value: text }],
    extensions: [
      { namespace: "", name: ITEM_ATTRIBUTE, value: checkIdentifier(itemRef, "The item reference of a cover") },
      {
        namespace: "",
        name: RESPONSE_ATTRIBUTE,
        value: checkIdentifier(responseIdentifier, "The response identifier of a cover"),
      },
    ],
  };
}

/**
 * Builds the rubric block that names the responses an externally scored outcome of a test covers (a convention of the
 * runtime): `view="scorer"`, `use="scoring"`, the class token `external-score-covers` and `data-outcome-identifier`, with
 * the notes and then a list of the covers as content. Put it in `rubricBlocks` of the test, where
 * {@link readScoreCovers} finds it again. A label is written with its white space normalized.
 *
 * @param outcomeIdentifier - The identifier of the outcome.
 * @param covers - The responses the outcome covers.
 * @param options - See {@link RubricBlockOptions}.
 * @returns The rubric block.
 * @throws `DataError` when an identifier is not an identifier, a label is not a string, or an argument has the wrong type.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/conventions.md | Conventions of the runtime, covers}
 */
export function buildScoreCoversBlock(
  outcomeIdentifier: string,
  covers: readonly ScoreCover[],
  options: RubricBlockOptions = {},
): TestRubricBlock {
  checkIdentifier(outcomeIdentifier, "The outcome identifier");
  checkArray(covers, "The covers must be an array");
  checkOptions(options);
  const { notes = [] } = options;
  checkArray(notes, "The notes must be an array");
  if (!notes.every(isModelNode)) {
    throw new DataError(`The notes must be nodes of body content, found ${describe(notes)}.`);
  }
  const list: List = { kind: "ul", items: covers.map(coverEntry), extensions: [] };
  return {
    kind: "rubric-block",
    view: ["scorer"],
    use: "scoring",
    class: [SCORE_COVERS_CLASS],
    stylesheets: [],
    contentBody: { kind: "content-body", children: [...notes, list] },
    extensions: [{ namespace: "", name: OUTCOME_ATTRIBUTE, value: outcomeIdentifier }],
  };
}
