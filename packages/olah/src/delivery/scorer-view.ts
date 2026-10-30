import { type AssessmentItem, type BodyNode, descendantNodes, type ModelNode, scoreCoverBlocks } from "../asi/index.js";
import { resolveContent, testRubricBlocks } from "../content/index.js";
import { DataError } from "../errors.js";
import type { Value } from "../values/index.js";
import { type Course, candidateOf } from "./course.js";
import { type DeliveredItem, type DeliveryState, findDelivered } from "./delivery-state.js";
import { itemFeedback } from "./item-display.js";
import { type ItemKey, sameKey } from "./plan.js";
import { planIndex } from "./plan-index.js";
import type { ScoringRequest } from "./scoring.js";

/** An item instance as a scorer sees it (E27). */
export interface ScorerItem {
  /** The item instance. */
  readonly key: ItemKey;
  /** The title of the item. */
  readonly title: string;
  /** Whether the candidate was presented the item; if not, the body and the maps are empty. */
  readonly presented: boolean;
  /** The body as the candidate saw it after template processing, followed by the item's rubric for the scorer view. */
  readonly body: readonly BodyNode[];
  /** The template variables of the instance. */
  readonly templateValues: ReadonlyMap<string, Value | null>;
  /** The submitted responses, by response identifier; exact strings (B96). */
  readonly responses: ReadonlyMap<string, Value | null>;
  /** The correct responses, by response identifier. */
  readonly correctResponses: ReadonlyMap<string, Value | null>;
}

/**
 * What a scorer needs to rate the outcome of a scoring request (R6, E27): the request, the rubric for the scorer view, and
 * each item instance it covers. It holds the correct responses, so it belongs on the server and never in a candidate's
 * view.
 */
export interface ScorerView {
  /** The request. */
  readonly request: ScoringRequest;
  /**
   * The rubric blocks of the test, and for an item outcome those of its test part and sections, whose `view` lists
   * `scorer`, in that order (INFO §2.8.6). The covers blocks of other outcomes (§4.16) are left out.
   */
  readonly rubric: readonly BodyNode[];
  /** The item instances the request covers, in the order of its covers, each once. */
  readonly items: readonly ScorerItem[];
}

/** A rubric block of an item body. */
type ItemRubricBlock = Extract<BodyNode, { readonly kind: "rubric-block" }>;

const isRubricBlock = (node: ModelNode): node is ItemRubricBlock => node.kind === "rubric-block";

/** Returns the rubric blocks of the item body that only the scorer sees: the candidate's are already in the body. */
function scorerRubric(item: AssessmentItem): ItemRubricBlock[] {
  return (item.body?.children ?? [])
    .flatMap((node) => [node, ...descendantNodes(node)])
    .filter(isRubricBlock)
    .filter((node) => node.view.includes("scorer") && !node.view.includes("candidate"));
}

function scorerItem(course: Course, key: ItemKey, delivered: DeliveredItem | undefined): ScorerItem {
  const entry = course.items.get(key.ref);
  if (entry === undefined) throw new DataError(`The state names ${key.ref}, which the test does not have.`);
  const item = candidateOf(entry, delivered?.variant).item;
  if (delivered === undefined) {
    return {
      key,
      title: item.title,
      presented: false,
      body: [],
      templateValues: new Map(),
      responses: new Map(),
      correctResponses: new Map(),
    };
  }
  const { variables } = delivered.session;
  const { outcomes } = itemFeedback(delivered.session, item, entry.control);
  const shown = { outcomes, templates: variables.templates };
  const identifiers = item.responseDeclarations.map(({ identifier }) => identifier);
  const pick = (values: ReadonlyMap<string, Value | null>): Map<string, Value | null> =>
    new Map(identifiers.map((identifier) => [identifier, values.get(identifier) ?? null]));
  return {
    key,
    title: item.title,
    presented: true,
    body: [
      ...resolveContent(item.body?.children ?? [], shown, item, { view: "candidate" }),
      ...resolveContent(scorerRubric(item), shown, item, { view: "scorer" }),
    ],
    templateValues: variables.templates,
    responses: pick(variables.responses),
    correctResponses: pick(variables.correctResponses),
  };
}

/** Returns the rubric blocks of the scorer view for a request, as body nodes. */
function rubricFor(course: Course, state: DeliveryState, request: ScoringRequest): BodyNode[] {
  const { structure } = course;
  const test = structure.test.model;
  const others = scoreCoverBlocks(test)
    .filter(({ outcomeIdentifier }) => outcomeIdentifier !== request.outcome)
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

/**
 * Builds the scorer view of a scoring request (E27): the rubric for the scorer, and for each covered item instance, and the
 * item of an item outcome, its body as the candidate saw it with the scorer's rubric, its template values, submitted
 * responses and correct responses.
 *
 * @throws `DataError` when the state has no such request.
 */
export function scorerViewOf(course: Course, state: DeliveryState, requestId: string): ScorerView {
  const request = state.scoring.find(({ id }) => id === requestId);
  if (request === undefined) throw new DataError(`The state has no scoring request ${JSON.stringify(requestId)}.`);
  // An item outcome is about its item even when the item has no response, such as a link to a tool.
  const keys: ItemKey[] = request.item === undefined ? [] : [request.item];
  for (const { item } of request.covers) if (!keys.some((key) => sameKey(key, item))) keys.push(item);
  return {
    request,
    rubric: rubricFor(course, state, request),
    items: keys.map((key) => scorerItem(course, key, findDelivered(state, key))),
  };
}
