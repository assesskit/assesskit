import {
  type AssessmentTest,
  type BodyNode,
  type ModelNode,
  type ScoringRubric,
  scoreCoverBlocks,
} from "../asi/index.js";
import { scoringRubricBlocks, scoringRubricOf, withDescendants } from "../asi/internal.js";
import { resolveContent, testRubricBlocks } from "../content/index.js";
import { DataError } from "../errors.js";
import type { Value } from "../values/index.js";
import { type Course, candidateOf } from "./course.js";
import { type DeliveredItem, type DeliveryState, findDelivered } from "./delivery-state.js";
import { itemFeedback } from "./item-display.js";
import { type ItemKey, sameKey } from "./plan.js";
import { planIndex } from "./plan-index.js";
import type { ScoringRequest } from "./scoring.js";

/** An item instance as a scorer sees it. */
export interface ScorerItem {
  /** The item instance. */
  readonly key: ItemKey;
  /** The title of the item. */
  readonly title: string;
  /** Whether the candidate was presented the item; if not, the body and the maps are empty. */
  readonly presented: boolean;
  /**
   * The body as the candidate saw it after template processing, followed by the item's rubric for the scorer view. For an
   * item outcome the scoring rubrics of the item's other outcomes are left out; for a test outcome, all of them.
   */
  readonly body: readonly BodyNode[];
  /** The template variables of the instance. */
  readonly templateValues: ReadonlyMap<string, Value | null>;
  /** The submitted responses, by response identifier; exact strings. */
  readonly responses: ReadonlyMap<string, Value | null>;
  /** The correct responses, by response identifier. */
  readonly correctResponses: ReadonlyMap<string, Value | null>;
}

/**
 * What a scorer needs to rate the outcome of a scoring request: the request, the rubric for the scorer view, and each
 * item instance it covers.
 *
 * @remarks
 * It holds the correct responses, so it belongs on the server and never in a candidate's view.
 */
export interface ScorerView {
  /** The request. */
  readonly request: ScoringRequest;
  /**
   * The children of the rubric blocks of the test, and for an item outcome those of its test part and sections, whose
   * `view` lists `scorer`, in that order. The covers and scoring-rubric blocks of the test that name other outcomes are
   * left out; for an item outcome they are all left out, because they name outcomes of the test.
   *
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
   */
  readonly rubric: readonly BodyNode[];
  /**
   * The scoring rubric of the request's outcome, from the item or from the test; absent when the outcome has none or its
   * block breaks a rule of the convention. For an item its texts are those after template processing.
   *
   * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/conventions.md | Conventions of the runtime, scoring rubrics}
   */
  readonly scoringRubric?: ScoringRubric;
  /** The item instances the request covers, in the order of its covers, each once. */
  readonly items: readonly ScorerItem[];
}

/** A rubric block of an item body. */
type ItemRubricBlock = Extract<BodyNode, { readonly kind: "rubric-block" }>;

const isRubricBlock = (node: ModelNode): node is ItemRubricBlock => node.kind === "rubric-block";

/**
 * Returns the rubric blocks of the item body that only the scorer sees: the candidate's are already in the body. A block
 * of the scoring rubric convention stays only when its outcome is `outcome`.
 */
function scorerRubric(
  blocks: readonly ItemRubricBlock[],
  scoring: ReadonlyMap<ModelNode, string | undefined>,
  outcome: string | undefined,
): ItemRubricBlock[] {
  return blocks
    .filter((node) => node.view.includes("scorer") && !node.view.includes("candidate"))
    .filter((node) => !scoring.has(node) || (outcome !== undefined && scoring.get(node) === outcome));
}

/** An item instance for the scorer, and the scoring rubric of the outcome it is requested for, if it is. */
interface ItemRead {
  readonly item: ScorerItem;
  readonly scoringRubric?: ScoringRubric;
}

/**
 * Reads an item instance for a request. The scoring rubric is that of the first marked block of the outcome, read after
 * template processing: only texts vary, so its criteria, levels and numbers are those of the document.
 */
function scorerItem(
  course: Course,
  key: ItemKey,
  delivered: DeliveredItem | undefined,
  request: ScoringRequest,
): ItemRead {
  const entry = course.items.get(key.ref);
  if (entry === undefined) throw new DataError(`The state names ${key.ref}, which the test does not have.`);
  const item = candidateOf(entry, delivered?.variant).item;
  if (delivered === undefined) {
    return {
      item: {
        key,
        title: item.title,
        presented: false,
        body: [],
        templateValues: new Map(),
        responses: new Map(),
        correctResponses: new Map(),
      },
    };
  }
  const { variables } = delivered.session;
  const { outcomes } = itemFeedback(delivered.session, item, entry.control);
  const shown = { outcomes, templates: variables.templates };
  const identifiers = item.responseDeclarations.map(({ identifier }) => identifier);
  const pick = (values: ReadonlyMap<string, Value | null>): Map<string, Value | null> =>
    new Map(identifiers.map((identifier) => [identifier, values.get(identifier) ?? null]));
  const blocks = withDescendants(item.body?.children ?? []).filter(isRubricBlock);
  const scoring = new Map<ModelNode, string | undefined>(
    scoringRubricBlocks(item).map(({ block, outcomeIdentifier }) => [block, outcomeIdentifier]),
  );
  const own = request.item !== undefined && sameKey(request.item, key);
  const first = own ? blocks.find((block) => scoring.get(block) === request.outcome) : undefined;
  const [scoringRubric] = (first === undefined ? [] : resolveContent([first], shown, item, { view: "scorer" }))
    .filter(isRubricBlock)
    .map((block) => scoringRubricOf(block, item.language).rubric);
  return {
    item: {
      key,
      title: item.title,
      presented: true,
      body: [
        ...resolveContent(item.body?.children ?? [], shown, item, { view: "candidate" }),
        ...resolveContent(scorerRubric(blocks, scoring, own ? request.outcome : undefined), shown, item, {
          view: "scorer",
        }),
      ],
      templateValues: variables.templates,
      responses: pick(variables.responses),
      correctResponses: pick(variables.correctResponses),
    },
    ...(scoringRubric === undefined ? {} : { scoringRubric }),
  };
}

/**
 * Returns the rubric blocks of the scorer view for a request, as body nodes. The covers and scoring-rubric blocks of the
 * test are conventions for the outcomes of the test: an item outcome sees none of them, and a test outcome sees its own.
 */
function rubricFor(course: Course, state: DeliveryState, request: ScoringRequest): BodyNode[] {
  const { structure } = course;
  const test = structure.test.model;
  const named = request.scope === "test" ? request.outcome : undefined;
  const others = [...scoreCoverBlocks(test), ...scoringRubricBlocks(test)]
    .filter(({ outcomeIdentifier }) => named === undefined || outcomeIdentifier !== named)
    .map(({ block }) => block);
  const placement = request.item === undefined ? undefined : planIndex(state.plan).placement(request.item);
  const blocks = testRubricBlocks(
    {
      test,
      ...(placement === undefined ? {} : { part: structure.part(placement.part)?.model }),
      sections: placement?.sections.flatMap(({ identifier }) => structure.section(identifier)?.model ?? []) ?? [],
    },
    "scorer",
  ).filter((block) => !others.includes(block));
  return blocks.flatMap(({ contentBody }) => contentBody.children);
}

/** Returns the scoring rubric of an outcome of the test: that of its first marked block. */
function testScoringRubric(test: AssessmentTest, outcome: string): ScoringRubric | undefined {
  const first = scoringRubricBlocks(test).find(({ outcomeIdentifier }) => outcomeIdentifier === outcome);
  return first === undefined ? undefined : scoringRubricOf(first.block, first.language).rubric;
}

/**
 * Builds the scorer view of a scoring request: the rubric for the scorer, the scoring rubric of the outcome, and for each
 * covered item instance, and the item of an item outcome, its body as the candidate saw it with the scorer's rubric, its
 * template values, submitted responses and correct responses.
 *
 * @throws `DataError` when the state has no such request.
 */
export function scorerViewOf(course: Course, state: DeliveryState, requestId: string): ScorerView {
  const request = state.scoring.find(({ id }) => id === requestId);
  if (request === undefined) throw new DataError(`The state has no scoring request ${JSON.stringify(requestId)}.`);
  // An item outcome is about its item even when the item has no response, such as a link to a tool.
  const keys: ItemKey[] = request.item === undefined ? [] : [request.item];
  for (const { item } of request.covers) if (!keys.some((key) => sameKey(key, item))) keys.push(item);
  const reads = keys.map((key) => scorerItem(course, key, findDelivered(state, key), request));
  const own = request.item;
  const scoringRubric =
    own === undefined
      ? testScoringRubric(course.structure.test.model, request.outcome)
      : reads.find(({ item }) => sameKey(item.key, own))?.scoringRubric;
  return {
    request,
    rubric: rubricFor(course, state, request),
    ...(scoringRubric === undefined ? {} : { scoringRubric }),
    items: reads.map(({ item }) => item),
  };
}
