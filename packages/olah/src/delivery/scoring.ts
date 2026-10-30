import type { AssessmentItem, OutcomeDeclaration } from "../asi/index.js";
import { describeInteractions, type InteractionKind } from "../interactions/index.js";
import { fitValue } from "../processing/assign.js";
import type { BaseType, Cardinality, Value } from "../values/index.js";
import { endAttemptInteractions } from "./attempt.js";
import { type Course, candidateOf } from "./course.js";
import { type DeliveredItem, type DeliveryState, findDelivered } from "./delivery-state.js";
import type { ItemKey } from "./plan.js";
import { planIndex } from "./plan-index.js";

/** Who supplies the value of an outcome that processing does not set: a person or a machine (INFO §4.5.10, W18). */
export type Scorer = "human" | "externalMachine";

/** The declaration of the outcome that a scoring request asks for, as the scorer needs to know it (INFO §4.5). */
export interface ScoringDeclaration {
  /** The cardinality of the outcome. */
  readonly cardinality: Cardinality;
  /** The base type of the outcome; absent for a record. */
  readonly baseType?: BaseType;
  /** The least value in normal use. */
  readonly normalMinimum?: number;
  /** The greatest value in normal use. */
  readonly normalMaximum?: number;
  /** The value from which the aspect counts as mastered. */
  readonly masteryValue?: number;
  /** What the outcome means. */
  readonly interpretation?: string;
  /** A URI of a longer description of the outcome. */
  readonly longInterpretation?: string;
}

/** A response that an externally scored outcome rates, with what the candidate submitted (O12, E14). */
export interface ScoringCover {
  /** The item instance. */
  readonly item: ItemKey;
  /** The response variable. */
  readonly responseIdentifier: string;
  /** The label of the cover in the test, the text of its list entry; absent when it has none. */
  readonly label?: string;
  /** Whether the instance was presented; if not, `response` is NULL (G26). */
  readonly presented: boolean;
  /** The kind of the interaction that binds the response; absent when no interaction does. */
  readonly interaction?: InteractionKind;
  /** The last submitted response, exact (B96, G36). */
  readonly response: Value | null;
}

/** What a scorer supplied for a request (E15). */
export interface SuppliedScore {
  /** The value of the outcome, or NULL. */
  readonly value: Value | null;
  /** When it was supplied, in epoch milliseconds. */
  readonly at: number;
  /** Who supplied it. */
  readonly scorer: Scorer;
}

/**
 * A request for the value of one externally scored outcome (E13, E14): of an item outcome when its item session has
 * closed, of a test outcome when every response it covers has closed or the test has ended (G26). The host answers with
 * a `supply-scores` action; a request stays in the state after that, so that a second supply can replace the value.
 */
export interface ScoringRequest {
  /** The identifier of the request: `item:<ref>:<instance>:<outcome>` or `test:<outcome>`. */
  readonly id: string;
  /** Whether the outcome belongs to an item or to the test. */
  readonly scope: "item" | "test";
  /** The item instance, for an item outcome. */
  readonly item?: ItemKey;
  /** The identifier of the outcome. */
  readonly outcome: string;
  /** Who is to score it: `external-scored` of the declaration. */
  readonly mode: Scorer;
  /** The `variable-identifier-ref` of the declaration; absent when it has none. */
  readonly variableIdentifierRef?: string;
  /** Whether the item is a link to a tool (E25); absent otherwise. */
  readonly lti?: true;
  /** The declaration of the outcome. */
  readonly declaration: ScoringDeclaration;
  /** The responses the outcome rates; those of the item for an item outcome, the covers of the test for a test outcome. */
  readonly covers: readonly ScoringCover[];
  /** When the request was made, in epoch milliseconds. */
  readonly requestedAt: number;
  /** The value the host supplied; absent while the request is pending. */
  readonly supplied?: SuppliedScore;
}

/** Returns the id of the request for an outcome of an item instance. */
function itemRequestId(key: ItemKey, outcome: string): string {
  return `item:${key.ref}:${key.instance}:${outcome}`;
}

/** Returns the id of the request for an outcome of the test. */
function testRequestId(outcome: string): string {
  return `test:${outcome}`;
}

/** Returns the declaration of an outcome as a request carries it. */
function declarationOf(declaration: OutcomeDeclaration): ScoringDeclaration {
  const { cardinality, baseType, normalMinimum, normalMaximum, masteryValue, interpretation, longInterpretation } =
    declaration;
  return {
    cardinality,
    ...(baseType === undefined ? {} : { baseType }),
    ...(normalMinimum === undefined ? {} : { normalMinimum }),
    ...(normalMaximum === undefined ? {} : { normalMaximum }),
    ...(masteryValue === undefined ? {} : { masteryValue }),
    ...(interpretation === undefined ? {} : { interpretation }),
    ...(longInterpretation === undefined ? {} : { longInterpretation }),
  };
}

/** Returns the externally scored outcomes an item or a test declares, in document order. */
function externalOutcomes(declarations: readonly OutcomeDeclaration[]): OutcomeDeclaration[] {
  return declarations.filter((declaration) => declaration.externalScored !== undefined);
}

/** The fields of a request that its outcome gives. */
function requestHead(
  declaration: OutcomeDeclaration,
): Pick<ScoringRequest, "mode" | "declaration"> & Partial<Pick<ScoringRequest, "variableIdentifierRef">> {
  const { externalScored, variableIdentifierRef } = declaration;
  return {
    mode: externalScored ?? "human",
    declaration: declarationOf(declaration),
    ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
  };
}

/** The kind of the interaction that binds a response of an item. */
function interactionOf(item: AssessmentItem, responseIdentifier: string): InteractionKind | undefined {
  return describeInteractions(item).find((descriptor) => descriptor.responseIdentifier === responseIdentifier)?.kind;
}

/** Returns the covers of a closed item: each response variable it declares, except those of end attempt interactions. */
function itemCovers(key: ItemKey, delivered: DeliveredItem, item: AssessmentItem): ScoringCover[] {
  const endAttempts = endAttemptInteractions(item);
  return item.responseDeclarations
    .filter(({ identifier }) => !endAttempts.has(identifier))
    .map(({ identifier }) => {
      const interaction = interactionOf(item, identifier);
      return {
        item: key,
        responseIdentifier: identifier,
        presented: true,
        ...(interaction === undefined ? {} : { interaction }),
        response: delivered.session.variables.responses.get(identifier) ?? null,
      };
    });
}

/** Whether an item session is over: closed, or shown again for review or the solution. */
function isOver(delivered: DeliveredItem): boolean {
  const { status } = delivered.session;
  return status === "closed" || status === "review" || status === "solution";
}

/** Returns the requests for the outcomes of items whose sessions are over and that have no request yet (E13). */
function itemRequests(course: Course, state: DeliveryState, at: number): ScoringRequest[] {
  const made = new Set(state.scoring.map(({ id }) => id));
  const requests: ScoringRequest[] = [];
  for (const delivered of state.items) {
    if (!isOver(delivered)) continue;
    const { key } = delivered.session;
    const entry = course.items.get(key.ref);
    if (entry === undefined) continue;
    const candidate = candidateOf(entry, delivered.variant);
    for (const declaration of externalOutcomes(candidate.item.outcomeDeclarations)) {
      const id = itemRequestId(key, declaration.identifier);
      if (made.has(id)) continue;
      requests.push({
        id,
        scope: "item",
        item: key,
        outcome: declaration.identifier,
        ...requestHead(declaration),
        ...(candidate.link === undefined ? {} : { lti: true as const }),
        covers: itemCovers(key, delivered, candidate.item),
        requestedAt: at,
      });
    }
  }
  return requests;
}

/**
 * Returns the covers of a test outcome resolved to the instances of the plan, presented or not (O12, O4): each cover of
 * the test's blocks names an item reference, and every instance of it that the plan holds is a cover.
 */
function testCovers(course: Course, state: DeliveryState, outcome: string): ScoringCover[] {
  const index = planIndex(state.plan);
  return (course.covers.get(outcome) ?? []).flatMap(({ itemRef, responseIdentifier, label }) => {
    const entry = course.items.get(itemRef);
    if (entry === undefined) return [];
    return index.instances(itemRef).map(({ key }): ScoringCover => {
      const delivered = findDelivered(state, key);
      const { item } = candidateOf(entry, delivered?.variant);
      const interaction = interactionOf(item, responseIdentifier);
      return {
        item: key,
        responseIdentifier,
        ...(label === undefined ? {} : { label }),
        presented: delivered !== undefined,
        ...(interaction === undefined ? {} : { interaction }),
        response: delivered?.session.variables.responses.get(responseIdentifier) ?? null,
      };
    });
  });
}

/**
 * Whether the request of a test outcome is due: the test has ended, or the outcome covers responses and every instance
 * it covers has been presented and is over (G26). A test without covers waits for its end (O5).
 */
function isTestRequestDue(state: DeliveryState, covers: readonly ScoringCover[]): boolean {
  if (state.status === "ended") return true;
  return (
    covers.length > 0 &&
    covers.every(({ item }) => {
      const delivered = findDelivered(state, item);
      return delivered !== undefined && isOver(delivered);
    })
  );
}

/** Returns the requests for the external-scored outcomes of the test that are due and have no request yet (E13). */
function testRequests(course: Course, state: DeliveryState, at: number): ScoringRequest[] {
  const made = new Set(state.scoring.map(({ id }) => id));
  const requests: ScoringRequest[] = [];
  for (const declaration of externalOutcomes(course.structure.test.model.outcomeDeclarations)) {
    const id = testRequestId(declaration.identifier);
    if (made.has(id)) continue;
    const covers = testCovers(course, state, declaration.identifier);
    if (!isTestRequestDue(state, covers)) continue;
    requests.push({
      id,
      scope: "test",
      outcome: declaration.identifier,
      ...requestHead(declaration),
      covers,
      requestedAt: at,
    });
  }
  return requests;
}

/**
 * Returns the scoring requests that the state makes due and has not made (E13): for each externally scored outcome of an
 * item whose session is over, and of the test when its covers are over or the test has ended. A request is made once.
 */
export function dueRequests(course: Course, state: DeliveryState, at: number): ScoringRequest[] {
  return [...itemRequests(course, state, at), ...testRequests(course, state, at)];
}

/**
 * Returns a score as the declaration of its request holds it, `undefined` when it does not fit: NULL fits, and an integer
 * fits a float or duration outcome (D5).
 */
export function fitScore(request: ScoringRequest, value: Value | null): Value | null | undefined {
  return value === null ? null : fitValue(value, request.declaration);
}

/** Returns the values that supplied scores give the external-scored outcomes of the test: their reset values (G24, E16). */
export function suppliedTestOutcomes(state: DeliveryState): Map<string, Value | null> {
  const values = new Map<string, Value | null>();
  for (const { scope, outcome, supplied } of state.scoring) {
    if (scope === "test" && supplied !== undefined) values.set(outcome, supplied.value);
  }
  return values;
}

/**
 * Returns the external-scored outcomes of an item instance that are not yet supplied: the item declares them and no
 * request for them has a supplied value (E17).
 */
export function outstandingScores(state: DeliveryState, key: ItemKey, item: AssessmentItem): string[] {
  return externalOutcomes(item.outcomeDeclarations)
    .map(({ identifier }) => identifier)
    .filter((identifier) => {
      const request = state.scoring.find(({ id }) => id === itemRequestId(key, identifier));
      return request?.supplied === undefined;
    });
}

/**
 * Whether a response of an item instance is rated by an externally scored outcome of the test whose value has not been
 * supplied, so that the response is not scored yet (E17): the outcome has a cover for it, and no supplied request.
 */
export function isCoveredUnscored(
  course: Course,
  state: DeliveryState,
  key: ItemKey,
  responseIdentifier: string,
): boolean {
  return externalOutcomes(course.structure.test.model.outcomeDeclarations).some(({ identifier }) => {
    const covered = (course.covers.get(identifier) ?? []).some(
      (cover) => cover.itemRef === key.ref && cover.responseIdentifier === responseIdentifier,
    );
    return covered && state.scoring.find(({ id }) => id === testRequestId(identifier))?.supplied === undefined;
  });
}
