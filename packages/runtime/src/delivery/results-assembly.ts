import type { AssessmentItem, OutcomeDeclaration } from "../asi/index.js";
import { setCorrectResponses } from "../asi/internal.js";
import { deriveAnsweredStatus } from "../interactions/index.js";
import type { SupportName } from "../pnp/index.js";
import { COMPLETION_STATUS, DURATION, NUM_ATTEMPTS } from "../processing/index.js";
import type {
  AssessmentResult,
  ContextVariable,
  ItemResult,
  OutcomeVariable,
  ResponseVariable,
  ResultVariable,
  ResultVariableType,
  SessionStatus,
  SupportUse,
  TemplateVariable,
  TestResult,
} from "../results/index.js";
import { buildSingle, type Value } from "../values/index.js";
import { endAttemptInteractions } from "./attempt.js";
import { type CatSession, endedAttempts } from "./cat-session.js";
import { type Course, candidateOf } from "./course.js";
import { datestampOf } from "./datestamp.js";
import { type DeliveredItem, type DeliveryState, deliveredLookup, findDelivered } from "./delivery-state.js";
import { deriveSessionStatus } from "./derive-session-status.js";
import { presentedInteractions } from "./item-display.js";
import { type ItemKey, sameKey } from "./plan.js";
import { planIndex } from "./plan-index.js";
import { isCoveredUnscored, outstandingScores } from "./scoring.js";
import { durationOf, SessionScope } from "./session-scope.js";

/**
 * The prefix of the name of a custom support in the PNP; a results report names the support without it.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
const EXTENSION_PREFIX = "ext:";

/**
 * The `SCORE` outcome that a report to a CAT engine leaves out for an item without a response.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
const SCORE = "SCORE";

/** Returns the type of a declaration as a result variable states it. */
function typeOf({ cardinality, baseType }: ResultVariableType): ResultVariableType {
  return { cardinality, ...(baseType === undefined ? {} : { baseType }) };
}

/**
 * Returns an outcome variable: the value with what its declaration says about it.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function outcomeVariable(declaration: OutcomeDeclaration, value: Value | null): OutcomeVariable {
  const {
    view,
    interpretation,
    longInterpretation,
    normalMaximum,
    normalMinimum,
    masteryValue,
    externalScored,
    variableIdentifierRef,
  } = declaration;
  return {
    kind: "outcome",
    identifier: declaration.identifier,
    cardinality: declaration.cardinality,
    ...(declaration.baseType === undefined ? {} : { baseType: declaration.baseType }),
    value,
    ...(view === undefined ? {} : { view }),
    ...(interpretation === undefined ? {} : { interpretation }),
    ...(longInterpretation === undefined ? {} : { longInterpretation }),
    ...(normalMaximum === undefined ? {} : { normalMaximum }),
    ...(normalMinimum === undefined ? {} : { normalMinimum }),
    ...(masteryValue === undefined ? {} : { masteryValue }),
    ...(externalScored === undefined ? {} : { externalScored }),
    ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
  };
}

/**
 * Returns an outcome that a CAT engine reported and no declaration takes.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function reportedOutcome(identifier: string, value: Value, variableIdentifierRef: string | undefined): OutcomeVariable {
  return {
    kind: "outcome",
    identifier,
    cardinality: value.cardinality,
    ...(value.cardinality === "record" ? {} : { baseType: value.baseType }),
    value,
    externalScored: "externalMachine",
    ...(variableIdentifierRef === undefined ? {} : { variableIdentifierRef }),
  };
}

/**
 * Returns the type that the built-in `completionStatus` has in a report.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
const COMPLETION: ResultVariableType = { cardinality: "single", baseType: "identifier" };

/**
 * Returns the supports as a report lists them: those that were on while an item or the test ran.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function supportUses(state: DeliveryState, names: readonly SupportName[]): SupportUse[] {
  return names.map((name) => {
    const support = state.supports.get(name);
    const assignment =
      support?.universal === true ? "universal" : support?.state === "prohibited" ? "prohibited" : "assigned";
    return { name: name.startsWith(EXTENSION_PREFIX) ? name.slice(EXTENSION_PREFIX.length) : name, assignment };
  });
}

/**
 * Whether an item instance was submitted with no response to any of its response variables.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function isSkipped(delivered: DeliveredItem, item: AssessmentItem): boolean {
  if (endedAttempts(delivered) === 0) return false;
  const endAttempts = endAttemptInteractions(item);
  const declared = item.responseDeclarations.filter(({ identifier }) => !endAttempts.has(identifier));
  return (
    declared.length > 0 &&
    declared.every(({ identifier }) => delivered.session.variables.responses.get(identifier) == null)
  );
}

/** Returns the status of an item session as its result reports it, with the external scores still outstanding. */
function sessionStatusOf(
  course: Course,
  state: DeliveryState,
  delivered: DeliveredItem,
  item: AssessmentItem,
): SessionStatus {
  const { key } = delivered.session;
  const status = deriveSessionStatus(delivered.session, item);
  if (status === "pendingExternalScoring") {
    return outstandingScores(state, key, item).length > 0 ? status : "final";
  }
  const covered = item.responseDeclarations.some(({ identifier }) => isCoveredUnscored(course, state, key, identifier));
  return status === "final" && covered ? "pendingExternalScoring" : status;
}

/** The options of {@link itemResultOf}. */
interface ItemResultOptions {
  /** The CAT session the result is for; absent for the report of the test. */
  readonly cat?: CatSession;
}

/**
 * Returns the identifier of an item instance in a report to a CAT engine: instanced when the plan has several.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function catIdentifier(state: DeliveryState, key: ItemKey): string {
  return planIndex(state.plan).instances(key.ref).length > 1 ? `${key.ref}.${key.instance}` : key.ref;
}

/**
 * Returns the built-in response variables of an item instance: `numAttempts` and `duration`.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function builtInResponses(numAttempts: Value | null, duration: Value | null): ResponseVariable[] {
  return [
    {
      kind: "response",
      identifier: NUM_ATTEMPTS,
      cardinality: "single",
      baseType: "integer",
      candidateResponse: numAttempts,
      extensions: [],
    },
    {
      kind: "response",
      identifier: DURATION,
      cardinality: "single",
      baseType: "duration",
      candidateResponse: duration,
      extensions: [],
    },
  ];
}

/**
 * Returns the response variables of an item instance: the built-ins, then the declared ones. The correct response is
 * written for a variable whose key template processing set, when `keys` is true: a declared key is in the item, and
 * the key of a variable that processing set is in no other place, so that a report can be scored again.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function responseVariables(
  course: Course,
  state: DeliveryState,
  delivered: DeliveredItem,
  status: SessionStatus,
  options: { readonly omitted: boolean; readonly keys: boolean },
): ResponseVariable[] {
  const { session } = delivered;
  const { variables } = session;
  const entry = course.items.get(session.key.ref);
  const item = entry === undefined ? undefined : candidateOf(entry, delivered.variant).item;
  const builtIns = builtInResponses(
    variables.responses.get(NUM_ATTEMPTS) ?? null,
    variables.responses.get(DURATION) ?? null,
  );
  if (entry === undefined || item === undefined || options.omitted) return builtIns;
  const interactions = presentedInteractions(session, item, entry.control);
  const answered = deriveAnsweredStatus(interactions, variables.responses);
  const keysSet = setCorrectResponses(item);
  const declared = item.responseDeclarations.map((declaration): ResponseVariable => {
    const sequence = interactions.find(
      (descriptor) =>
        descriptor.responseIdentifier === declaration.identifier && descriptor.shuffle && descriptor.choices.length > 0,
    );
    const scored = status === "final" && !isCoveredUnscored(course, state, session.key, declaration.identifier);
    const key =
      options.keys && keysSet.has(declaration.identifier)
        ? variables.correctResponses.get(declaration.identifier)
        : null;
    return {
      kind: "response",
      identifier: declaration.identifier,
      cardinality: declaration.cardinality,
      ...(declaration.baseType === undefined ? {} : { baseType: declaration.baseType }),
      ...(key === undefined || key === null ? {} : { correctResponse: { value: key } }),
      candidateResponse: variables.responses.get(declaration.identifier) ?? null,
      ...(sequence === undefined ? {} : { choiceSequence: sequence.choices.map(({ identifier }) => identifier) }),
      scoreStatus: scored ? "scored" : "notscored",
      answeredStatus: answered,
      extensions: [],
    };
  });
  return [...builtIns, ...declared];
}

/**
 * Returns the outcome variables of an item instance: `completionStatus`, then the declared outcomes and the CAT's.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function outcomeVariables(
  state: DeliveryState,
  delivered: DeliveredItem,
  item: AssessmentItem,
  options: ItemResultOptions,
): OutcomeVariable[] {
  const { session } = delivered;
  const { outcomes } = session.variables;
  const omitted = options.cat !== undefined && isSkipped(delivered, item) ? SCORE : undefined;
  const completion: OutcomeVariable = {
    kind: "outcome",
    identifier: COMPLETION_STATUS,
    ...COMPLETION,
    value: outcomes.get(COMPLETION_STATUS) ?? null,
  };
  const declared = item.outcomeDeclarations
    .filter(({ identifier }) => identifier !== omitted)
    .map((declaration) => outcomeVariable(declaration, outcomes.get(declaration.identifier) ?? null));
  const extra = state.cat.flatMap((cat) =>
    cat.outcomes
      .filter((outcome) => !outcome.declared && outcome.item !== undefined && sameKey(outcome.item, session.key))
      .map((outcome) => reportedOutcome(outcome.identifier, outcome.value, outcome.variableIdentifierRef)),
  );
  return [completion, ...declared, ...extra];
}

/**
 * Returns the template and context variables of an item instance.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function valuedVariables(delivered: DeliveredItem, item: AssessmentItem): (TemplateVariable | ContextVariable)[] {
  const { templates, contexts } = delivered.session.variables;
  return [
    ...item.templateDeclarations.map(
      (declaration): TemplateVariable => ({
        kind: "template",
        identifier: declaration.identifier,
        ...typeOf(declaration),
        value: templates.get(declaration.identifier) ?? null,
      }),
    ),
    ...item.contextDeclarations.map(
      (declaration): ContextVariable => ({
        kind: "context",
        identifier: declaration.identifier,
        ...typeOf(declaration),
        value: contexts.get(declaration.identifier) ?? null,
      }),
    ),
  ];
}

/**
 * Returns the result of an item instance: its sequence index in the presentation order, the datestamp of its last
 * event, the session status, the response, template, context and outcome variables, the comment and the supports used.
 * A report to a CAT engine names the item instanced when the plan holds several, and gives an item that the candidate
 * skipped no response variables and no `SCORE`, with the status `initial`.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
function itemResultOf(
  course: Course,
  state: DeliveryState,
  delivered: DeliveredItem,
  options: ItemResultOptions,
): ItemResult | undefined {
  const { session } = delivered;
  const entry = course.items.get(session.key.ref);
  if (entry === undefined) return undefined;
  const item = candidateOf(entry, delivered.variant).item;
  const skipped = options.cat !== undefined && isSkipped(delivered, item);
  const status = skipped ? "initial" : sessionStatusOf(course, state, delivered, item);
  const variables: ResultVariable[] = [
    ...responseVariables(course, state, delivered, status, { omitted: skipped, keys: options.cat === undefined }),
    ...valuedVariables(delivered, item),
    ...outcomeVariables(state, delivered, item, options),
  ];
  return {
    identifier: options.cat === undefined ? session.key.ref : catIdentifier(state, session.key),
    sequenceIndex: state.items.indexOf(delivered) + 1,
    datestamp: datestampOf(delivered.submittedAt ?? session.updatedAt),
    sessionStatus: status,
    variables,
    ...(session.comment === undefined ? {} : { candidateComment: session.comment }),
    supports: supportUses(state, delivered.supports),
  };
}

/**
 * Returns the duration variables of the test: the test's, then those of the parts and sections entered.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model}
 */
function durationVariables(course: Course, state: DeliveryState): ResponseVariable[] {
  const { identifier } = course.structure.test.model;
  const named = (name: string, scope: "test" | "part" | "section", owner: string): ResponseVariable => ({
    kind: "response",
    identifier: name,
    cardinality: "single",
    baseType: "duration",
    candidateResponse: durationOf(state.clocks, scope, owner),
    extensions: [],
  });
  return [
    named(DURATION, "test", identifier),
    ...state.clocks
      .filter(({ scope }) => scope !== "test")
      .map(({ scope, identifier: owner }) => named(`${owner}.${DURATION}`, scope as "part" | "section", owner)),
  ];
}

/**
 * Returns the result of the test: durations, context variables and outcomes, and with them the CAT's.
 *
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function testResultOf(course: Course, state: DeliveryState, cat: CatSession | undefined): TestResult {
  const { model } = course.structure.test;
  const scope = new SessionScope(course, state);
  const held = new Set(
    cat === undefined
      ? []
      : state.cat
          .filter((other) => other !== cat)
          .flatMap((other) => other.outcomes.filter((o) => o.item === undefined).map((o) => o.identifier)),
  );
  const contexts = model.contextDeclarations.map(
    (declaration): ContextVariable => ({
      kind: "context",
      identifier: declaration.identifier,
      ...typeOf(declaration),
      value: scope.variable(declaration.identifier) ?? null,
    }),
  );
  const outcomes = model.outcomeDeclarations
    .filter(({ identifier }) => !held.has(identifier))
    .map((declaration) => outcomeVariable(declaration, state.outcomes.get(declaration.identifier) ?? null));
  const extra = state.cat.flatMap((other) =>
    other.outcomes
      .filter((outcome) => outcome.item === undefined && !outcome.declared)
      .map((outcome) => reportedOutcome(outcome.identifier, outcome.value, outcome.variableIdentifierRef)),
  );
  const used = [...new Set(state.items.flatMap(({ supports }) => supports))];
  return {
    identifier: model.identifier,
    datestamp: datestampOf(state.at),
    variables: [...durationVariables(course, state), ...contexts, ...outcomes, ...extra],
    supports: supportUses(state, used),
  };
}

/**
 * Returns the result of an instance of the plan that was not presented: no attempt, no time, the status `initial`, the
 * datestamp of the test result, which the schema requires, and no other variable.
 *
 * @param sequenceIndex - The index after those of the instances presented, as the schema requires one.
 * @see {@link https://www.imsglobal.org/sites/default/files/spec/qti/v3/rr-bind/index.html | QTI 3.0 Results Reporting}
 */
function notPresented(state: DeliveryState, key: ItemKey, sequenceIndex: number): ItemResult {
  return {
    identifier: key.ref,
    sequenceIndex,
    datestamp: datestampOf(state.at),
    sessionStatus: "initial",
    variables: builtInResponses(buildSingle("integer", 0), buildSingle("duration", 0)),
    supports: [],
  };
}

/**
 * Assembles the results report of a session: the context, the result of the test unless an item is delivered alone, and
 * one result for each item instance of the plan, in plan order.
 *
 * @remarks
 * While scoring requests are pending the report is provisional. The sequence index of an instance presented is its place
 * in the order of presentation; an instance not presented has the status `initial` and an index after them. Plan order
 * keeps the nth result of an item reference its instance `n`, and the last of equal datestamps the last instance, as the
 * engine reads `ITEM.n.VAR` and `ITEM.VAR`, so that `readTestInputs` reads a report as the engine read the session. The
 * report writes the correct response of a response variable that template processing set.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function assembleResults(course: Course, state: DeliveryState): AssessmentResult {
  const delivered = deliveredLookup(state);
  let unpresented = state.items.length;
  const itemResults = planIndex(state.plan).placements.flatMap(({ key }): ItemResult[] => {
    const item = delivered(key);
    if (item !== undefined) {
      const result = itemResultOf(course, state, item, {});
      return result === undefined ? [] : [result];
    }
    unpresented += 1;
    return [notPresented(state, key, unpresented)];
  });
  return {
    context: state.report,
    ...(course.standalone ? {} : { testResult: testResultOf(course, state, undefined) }),
    itemResults,
  };
}

/**
 * Assembles the report that a Submit Results request carries: the test result without outcomes that other CAT engines
 * set, and the results of the item instances to report, with their sequence indexes in the whole presentation.
 *
 * @remarks
 * The context is empty: the CAT engine knows the candidate by its session.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/impl/ | 1EdTech Computer Adaptive Testing 1.0}
 */
export function catReport(
  course: Course,
  state: DeliveryState,
  session: CatSession,
  keys: readonly ItemKey[],
): AssessmentResult {
  return {
    context: { sessionIdentifiers: [] },
    testResult: testResultOf(course, state, session),
    itemResults: keys.flatMap((key) => {
      const delivered = findDelivered(state, key);
      return delivered === undefined ? [] : (itemResultOf(course, state, delivered, { cat: session }) ?? []);
    }),
  };
}
