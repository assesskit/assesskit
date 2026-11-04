import { checkArray, checkRecord, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError } from "../errors.js";
import { formatPrimitive, parsePrimitive } from "../values/index.js";
import { xmlTokens } from "../values/internal.js";
import type { XmlAttribute } from "../xml/index.js";
import type { RubricBlock } from "./body.js";
import {
  attributeOf,
  entryText,
  type ListEntry,
  OUTCOME_ATTRIBUTE,
  type RubricBlockOptions,
} from "./convention-markup.js";
import { SCORE_COVERS_CLASS } from "./covers.js";
import type { AssessmentItem, AssessmentTest, ElementModel, TestRubricBlock } from "./model.js";
import { isModelNode, type ModelNode, withDescendants } from "./nodes.js";
import {
  checkScoringRubric,
  DEFAULT_WEIGHT,
  RUBRIC_KINDS,
  type RubricCriterion,
  type RubricIssue,
  type RubricKind,
  type RubricLevel,
  rubricIssues,
  SCORING_RUBRIC_CLASS,
  type ScoringRubric,
} from "./scoring-rubric.js";

/** The attributes of the convention besides the outcome: the kind on the block, the criterion and level data on an `li`. */
const KIND_ATTRIBUTE = "data-rubric-kind";
const CRITERION_ATTRIBUTE = "data-criterion-identifier";
const WEIGHT_ATTRIBUTE = "data-weight";
const SCORE_ATTRIBUTE = "data-score";
const QUALITY_ATTRIBUTE = "data-quality";

/** The kind of a rubric that names none. */
const DEFAULT_KIND: RubricKind = "analytic";

/** A rubric block that fits both an item body and the rubric blocks of a test. */
export type ScoringRubricBlock = ElementModel<"RubricBlock", "qti-rubric-block"> & TestRubricBlock;

/** A list, as the model has it. */
type OrderedList = ElementModel<"OUL", "ol">;

/** A marked rubric block of a document, with the language that the document gives it. */
export interface MarkedRubricBlock {
  /** The rubric block that carries the class token. */
  readonly block: RubricBlock;
  /** The language of the item, which the block inherits; absent for a test and for an item without `xml:lang`. */
  readonly language: string | undefined;
  /** The `data-outcome-identifier` attribute; absent when the block lacks it. */
  readonly outcomeIdentifier: string | undefined;
}

/** What {@link scoringRubricOf} found in a block. */
export interface ScoringRubricRead {
  /** The rubric; absent when the block breaks a rule. */
  readonly rubric?: ScoringRubric;
  /** Each rule that the block breaks. */
  readonly issues: readonly RubricIssue[];
}

const isRubricBlock = (node: ModelNode): node is RubricBlock => node.kind === "rubric-block";

const isOrderedList = (node: ModelNode): node is OrderedList => node.kind === "ol";

/** Returns whether a rubric block of the document carries the class token of the convention. */
function isMarked(block: RubricBlock): boolean {
  return Array.isArray(block.class) && block.class.includes(SCORING_RUBRIC_CLASS);
}

/** Checks the parts of a marked block that the reader reads, as a document from JSON may lack them. */
function checkBlock(block: RubricBlock): void {
  checkRecord(block.contentBody, "The content body of a rubric block must be an object");
  checkArray(block.contentBody.children, "The children of the content body must be an array");
  checkArray(block.extensions, "The extensions of a rubric block must be an array");
  checkArray(block.view, "The view of a rubric block must be an array");
}

function markedBlocks(blocks: readonly ModelNode[], language: string | undefined): MarkedRubricBlock[] {
  return blocks
    .filter(isRubricBlock)
    .filter(isMarked)
    .map((block) => {
      checkBlock(block);
      return { block, language, outcomeIdentifier: attributeOf(block, OUTCOME_ATTRIBUTE) };
    });
}

/**
 * Returns the rubric blocks of an item or a test that carry the class token of the convention, in document order: in an
 * item, those anywhere in its body; in a test, its own rubric blocks.
 */
export function scoringRubricBlocks(document: AssessmentItem | AssessmentTest): readonly MarkedRubricBlock[] {
  checkRecord(document, "The document must be an object");
  const named: unknown = document.kind;
  if (document.kind === "assessment-item") {
    const children = document.body?.children ?? [];
    checkArray(children, "The children of the item body must be an array");
    return markedBlocks(withDescendants(children), document.language);
  }
  if (document.kind === "assessment-test") {
    checkArray(document.rubricBlocks, "The rubric blocks of the test must be an array");
    return markedBlocks(document.rubricBlocks, undefined);
  }
  throw new DataError(`The document must be an item or a test of the model, found ${describe(named)}.`);
}

/** Reads a number of the lexical space of `xs:double`, or returns `undefined` when the text is not one. */
function readDouble(text: string): number | undefined {
  try {
    return parsePrimitive(text, "float");
  } catch (error) {
    if (error instanceof DataError) return undefined;
    throw error;
  }
}

/** Returns the lists that are children of a node's content, in document order. */
function listsOf(children: readonly ModelNode[]): OrderedList[] {
  return children.filter(isOrderedList);
}

/** Returns the `li` entries of lists, in document order. */
function entriesOf(lists: readonly OrderedList[]): ListEntry[] {
  return lists.flatMap((list) => {
    checkArray(list.items, "The items of a list must be an array");
    return list.items;
  });
}

/** Checks the parts of an entry that the reader reads. */
function checkEntry(entry: ListEntry): void {
  checkRecord(entry, "A list entry must be an object");
  checkArray(entry.children, "The children of a list entry must be an array");
  checkArray(entry.extensions, "The extensions of a list entry must be an array");
}

function normalized(text: string): string | undefined {
  const tokens = xmlTokens(text).join(" ");
  return tokens === "" ? undefined : tokens;
}

/** The criteria and levels of the lists of a block as written, with each rule they break. */
interface Draft {
  readonly criteria: RubricCriterion[];
  readonly issues: RubricIssue[];
}

function readLevel(entry: ListEntry, at: string, draft: Draft): RubricLevel | undefined {
  const text = attributeOf(entry, SCORE_ATTRIBUTE);
  const score = text === undefined ? undefined : readDouble(text);
  if (score === undefined || !Number.isFinite(score) || score < 0) {
    const found = text === undefined ? "none" : describe(text);
    const message = `a level needs ${SCORE_ATTRIBUTE}, a finite number of 0 or more, found ${found}`;
    draft.issues.push({ rule: "malformed", path: `${at}.score`, message });
    return undefined;
  }
  const quality = normalized(attributeOf(entry, QUALITY_ATTRIBUTE) ?? "");
  const description = normalized(entryText(entry));
  return {
    score: score === 0 ? 0 : score,
    ...(quality === undefined ? {} : { quality }),
    ...(description === undefined ? {} : { description }),
  };
}

function readCriterion(entry: ListEntry, at: string, draft: Draft): RubricCriterion | undefined {
  const issuesBefore = draft.issues.length;
  const identifier = attributeOf(entry, CRITERION_ATTRIBUTE);
  if (identifier === undefined) {
    draft.issues.push({
      rule: "malformed",
      path: `${at}.identifier`,
      message: `a criterion needs ${CRITERION_ATTRIBUTE}`,
    });
  }
  const weightText = attributeOf(entry, WEIGHT_ATTRIBUTE);
  const weight = weightText === undefined ? DEFAULT_WEIGHT : readDouble(weightText);
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) {
    const message = `${WEIGHT_ATTRIBUTE} must be a finite number greater than 0, found ${describe(weightText)}`;
    draft.issues.push({ rule: "malformed", path: `${at}.weight`, message });
  }
  const lists = listsOf(entry.children);
  if (lists.length === 0) {
    const message = "a criterion needs an ol with a li for each level";
    draft.issues.push({ rule: "malformed", path: `${at}.levels`, message });
  }
  const levels = entriesOf(lists).map((level, index) => {
    checkEntry(level);
    return readLevel(level, `${at}.levels[${index}]`, draft);
  });
  const description = normalized(
    entryText({ ...entry, children: entry.children.filter((child) => !isOrderedList(child)) }),
  );
  if (draft.issues.length > issuesBefore || identifier === undefined || weight === undefined) return undefined;
  return {
    identifier,
    weight,
    ...(description === undefined ? {} : { description }),
    levels: levels.filter((level) => level !== undefined),
  };
}

/**
 * Reads one marked block, as written or after template resolution: the rubric when the block keeps every rule, and each
 * rule it breaks, for `validate`. The criteria and levels are the `li` entries of the lists that are children of the
 * content body and of each criterion.
 *
 * @param block - The rubric block.
 * @param language - The inherited language, used when the block has no `xml:lang`.
 */
export function scoringRubricOf(block: RubricBlock, language?: string): ScoringRubricRead {
  const draft: Draft = { criteria: [], issues: [] };
  const malformed = (path: string, message: string): void => {
    draft.issues.push({ rule: "malformed", path, message });
  };
  if (!block.view.includes("scorer") || block.view.includes("candidate")) {
    malformed("", `the view must contain scorer and not candidate, found ${block.view.join(" ")}`);
  }
  if (block.class?.includes(SCORE_COVERS_CLASS)) {
    malformed("", `a block cannot have both the class ${SCORING_RUBRIC_CLASS} and the class ${SCORE_COVERS_CLASS}`);
  }
  const outcomeIdentifier = attributeOf(block, OUTCOME_ATTRIBUTE);
  if (outcomeIdentifier === undefined)
    malformed("", `the block must name the outcome it rates in ${OUTCOME_ATTRIBUTE}`);
  const kindText = attributeOf(block, KIND_ATTRIBUTE) ?? DEFAULT_KIND;
  const kind = RUBRIC_KINDS.find((candidate) => candidate === kindText);
  if (kind === undefined) {
    const kinds = RUBRIC_KINDS.map((candidate) => JSON.stringify(candidate)).join(", ");
    malformed("", `${KIND_ATTRIBUTE} must be one of ${kinds}, found ${describe(kindText)}`);
  }
  const lists = listsOf(block.contentBody.children);
  entriesOf(lists).forEach((entry, index) => {
    checkEntry(entry);
    const criterion = readCriterion(entry, `criteria[${index}]`, draft);
    if (criterion !== undefined) draft.criteria.push(criterion);
  });
  if (draft.issues.length > 0 || outcomeIdentifier === undefined || kind === undefined) {
    return { issues: draft.issues };
  }
  const inherited = block.language ?? language;
  const rubric: ScoringRubric = {
    outcomeIdentifier,
    kind,
    ...(inherited === undefined ? {} : { language: inherited }),
    criteria: draft.criteria,
  };
  const issues = rubricIssues(rubric);
  return issues.length === 0 ? { rubric, issues } : { issues };
}

/**
 * Reads the scoring rubrics of an item, from its body, or of a test, from its own rubric blocks (a convention of the
 * runtime). The first marked block of an outcome decides; if it breaks a rule of the convention, the outcome has no rubric,
 * and `validate` reports it.
 *
 * @param document - The item or the test.
 * @returns The rubrics by outcome identifier, in document order; a document without marked blocks gives an empty map.
 * @throws `DataError` when the document is not an item or a test of the model.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/conventions.md | Conventions of the runtime, scoring rubrics}
 */
export function readScoringRubrics(document: AssessmentItem | AssessmentTest): ReadonlyMap<string, ScoringRubric> {
  const rubrics = new Map<string, ScoringRubric>();
  const decided = new Set<string>();
  for (const { block, language, outcomeIdentifier } of scoringRubricBlocks(document)) {
    if (outcomeIdentifier === undefined || decided.has(outcomeIdentifier)) continue;
    decided.add(outcomeIdentifier);
    const { rubric } = scoringRubricOf(block, language);
    if (rubric !== undefined) rubrics.set(outcomeIdentifier, rubric);
  }
  return rubrics;
}

function attribute(name: string, value: string): XmlAttribute {
  return { namespace: "", name, value };
}

function levelEntry({ score, quality, description }: RubricLevel): ListEntry {
  const text = normalized(description ?? "");
  const name = normalized(quality ?? "");
  return {
    kind: "li",
    children: text === undefined ? [] : [{ kind: "text", value: text }],
    extensions: [
      attribute(SCORE_ATTRIBUTE, formatPrimitive(score, "float")),
      ...(name === undefined ? [] : [attribute(QUALITY_ATTRIBUTE, name)]),
    ],
  };
}

function criterionEntry({ identifier, weight, description, levels }: RubricCriterion): ListEntry {
  const text = normalized(description ?? "");
  const list: OrderedList = { kind: "ol", items: levels.map(levelEntry), extensions: [] };
  return {
    kind: "li",
    children:
      text === undefined ? [list] : [{ kind: "p", children: [{ kind: "text", value: text }], extensions: [] }, list],
    extensions: [
      attribute(CRITERION_ATTRIBUTE, identifier),
      ...(weight === DEFAULT_WEIGHT ? [] : [attribute(WEIGHT_ATTRIBUTE, formatPrimitive(weight, "float"))]),
    ],
  };
}

/**
 * Builds the rubric block of a scoring rubric: `view="scorer"`, `use="scoring"`, the class token, the outcome, the kind
 * and `xml:lang`, then the notes and the criteria list. Put it in the body of an item or in `rubricBlocks` of a test, where
 * {@link readScoringRubrics} finds it again. Texts are written with their white space normalized, and a weight of 1 is
 * left to the default.
 *
 * @param rubric - The scoring rubric.
 * @param options - See {@link RubricBlockOptions}.
 * @returns The rubric block, which fits an item body and the rubric blocks of a test.
 * @throws `DataError` when the rubric fails {@link checkScoringRubric}, or a note is an `ol` or not a node.
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/conventions.md | Conventions of the runtime, scoring rubrics}
 */
export function buildScoringRubricBlock(rubric: ScoringRubric, options: RubricBlockOptions = {}): ScoringRubricBlock {
  checkScoringRubric(rubric);
  checkOptions(options);
  const { notes = [] } = options;
  checkArray(notes, "The notes must be an array");
  if (!notes.every(isModelNode)) {
    throw new DataError(`The notes must be nodes of body content, found ${describe(notes)}.`);
  }
  if (notes.some(isOrderedList)) {
    throw new DataError("The notes must not contain an ol, which a reader would take for the criteria.");
  }
  const list: OrderedList = { kind: "ol", items: rubric.criteria.map(criterionEntry), extensions: [] };
  return {
    kind: "rubric-block",
    view: ["scorer"],
    use: "scoring",
    class: [SCORING_RUBRIC_CLASS],
    ...(rubric.language === undefined ? {} : { language: rubric.language }),
    stylesheets: [],
    contentBody: { kind: "content-body", children: [...notes, list] },
    extensions: [attribute(OUTCOME_ATTRIBUTE, rubric.outcomeIdentifier), attribute(KIND_ATTRIBUTE, rubric.kind)],
  };
}
