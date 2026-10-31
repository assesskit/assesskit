import { type AssessmentItem, type ResponseDeclaration, readAsi } from "../../src/asi/index.js";
import {
  applyItemAction,
  type ItemAction,
  type ItemSession,
  type ItemSessionContext,
  type ItemStep,
  presentItem,
  standaloneSessionControl,
  startItemSession,
} from "../../src/delivery/index.js";
import { AssesskitError, createRandom } from "../../src/index.js";
import {
  createItemVariables,
  type ItemVariables,
  runResponseProcessing,
  runTemplateProcessing,
} from "../../src/processing/index.js";
import {
  type BaseType,
  container,
  type Primitive,
  parsePrimitive,
  single,
  type Value,
} from "../../src/values/index.js";
import { longsightRandom } from "./longsight.js";
import type { Implementation, ItemCase, Observed, Play, Scalar, SessionCase, Turn, TurnObservation } from "./model.js";

/** Returns a primitive in the neutral form: points, pairs and files as the text that the oracle reports. */
function scalarOf(primitive: Primitive): Scalar {
  if (typeof primitive !== "object") return primitive;
  return "reference" in primitive ? primitive.reference : primitive.join(" ");
}

/** Returns a value in the neutral form. */
function observe(value: Value | null): Observed {
  if (value === null) return null;
  if (value.cardinality === "single") return scalarOf(value.value);
  if (value.cardinality === "record") {
    return Object.fromEntries([...value.fields].map(([name, field]) => [name, scalarOf(field.value)]));
  }
  return value.values.map(scalarOf);
}

/** Returns the values of a map in the neutral form, by identifier. */
function observeAll(values: ReadonlyMap<string, Value | null>): Record<string, Observed> {
  return Object.fromEntries([...values].map(([identifier, value]) => [identifier, observe(value)]));
}

/** Reads a scalar of the neutral form as a primitive of a base type. */
function primitiveOf(scalar: Observed, baseType: BaseType): Primitive {
  if (typeof scalar === "number" || typeof scalar === "boolean") return scalar;
  if (typeof scalar === "string") return baseType === "string" ? scalar : parsePrimitive(scalar, baseType);
  throw new Error(`A response holds ${JSON.stringify(scalar)} where a ${baseType} belongs.`);
}

/** Reads a response in the neutral form as a value of its declaration; the cases give no record responses. */
function responseOf(observed: Observed, declaration: ResponseDeclaration): Value | null {
  const { identifier, cardinality, baseType = "string" } = declaration;
  if (observed === null) return null;
  if (cardinality === "record") throw new Error(`The case gives the record response ${identifier}.`);
  if (cardinality === "single") return single(baseType, primitiveOf(observed, baseType));
  const items = Array.isArray(observed) ? observed : [observed];
  return container(
    cardinality,
    baseType,
    items.map((item) => primitiveOf(item, baseType)),
  );
}

/**
 * Gives an item the responses of a case as the delivery engine does in the first attempt (INFO §2.2.2.2–3):
 * `numAttempts` becomes 1, `completionStatus` becomes `unknown`, and a response the case leaves out has its default
 * value. A case without responses makes no attempt unless the item is adaptive, as in the oracle.
 */
function attempt(item: AssessmentItem, variables: ItemVariables, responses: ItemCase["responses"]): ItemVariables {
  if (Object.keys(responses).length === 0 && item.adaptive !== true) return variables;
  const given = new Map(variables.responses);
  given.set("numAttempts", single("integer", 1));
  for (const declaration of item.responseDeclarations) {
    const { identifier } = declaration;
    given.set(
      identifier,
      Object.hasOwn(responses, identifier)
        ? responseOf(responses[identifier] ?? null, declaration)
        : (variables.defaults.get(identifier) ?? null),
    );
  }
  const outcomes = new Map(variables.outcomes);
  outcomes.set("completionStatus", single("identifier", "unknown"));
  return { ...variables, responses: given, outcomes };
}

/** The milliseconds between the steps of a played session. */
const STEP = 1000;

/** What a session reports after a turn. */
function observeTurn(session: ItemSession, accepted: boolean): TurnObservation {
  const attempts = session.variables.responses.get("numAttempts");
  return {
    accepted,
    outcomes: observeAll(session.variables.outcomes),
    numAttempts: attempts?.cardinality === "single" ? Number(attempts.value) : 0,
    closed: session.status === "closed",
  };
}

/** The message of a processing failure that a step reports, `undefined` when there is none. */
function failureOf(step: ItemStep): string | undefined {
  return step.ok ? step.events.find(({ type }) => type === "processing-failed")?.detail : undefined;
}

/** Reads the responses of a turn as values of their declarations; a response the item does not declare is left out. */
function turnValues(item: AssessmentItem, responses: Turn["responses"]): Map<string, Value | null> {
  const values = new Map<string, Value | null>();
  for (const declaration of item.responseDeclarations) {
    const { identifier } = declaration;
    if (Object.hasOwn(responses, identifier))
      values.set(identifier, responseOf(responses[identifier] ?? null, declaration));
  }
  return values;
}

/** Plays a turn: sets its responses, then submits them or ends the attempt with its end attempt interaction. */
function playTurn(session: ItemSession, { responses, endAttempt }: Turn, context: ItemSessionContext): ItemStep {
  const item = session.key;
  const at = session.updatedAt + STEP;
  const answered = applyItemAction(
    session,
    { type: "set-responses", item, responses: turnValues(context.item, responses), at },
    context,
  );
  const ending: ItemAction =
    endAttempt === undefined ? { type: "submit", item } : { type: "end-attempt", item, interaction: endAttempt };
  return answered.ok ? applyItemAction(answered.session, { ...ending, at: at + 1 }, context) : answered;
}

/**
 * Plays a session of an item delivered alone, without a limit on attempts, as the oracle has none. Template and
 * response processing draw from the oracle's generator with the case's seed, and the choices shuffle from another, as
 * the oracle's presentation does. A processing failure, which the runtime reports as data, makes the item one that the runtime does
 * not accept.
 */
function play({ xml, turns, seed }: SessionCase): Play {
  const document = readAsi(xml);
  if (document.kind !== "item") return { accepted: false, reason: `The document is a ${document.kind}.` };
  const { item } = document;
  const context: ItemSessionContext = {
    item,
    control: { ...standaloneSessionControl(), maxAttempts: 0 },
    random: longsightRandom(seed),
  };
  const started = startItemSession({ ref: item.identifier, instance: 1 }, 0, context);
  const failure = failureOf(started);
  if (!started.ok || failure !== undefined) return { accepted: false, reason: failure ?? "The session did not start." };
  const presented = presentItem(started.session, 0, { ...context, random: createRandom(seed) });
  if (!presented.ok) return { accepted: false, reason: presented.refusal.message };
  let session = presented.session;
  const observations: TurnObservation[] = [];
  for (const turn of turns) {
    const step = playTurn(session, turn, context);
    const failed = failureOf(step);
    if (failed !== undefined) return { accepted: false, reason: failed };
    if (step.ok) session = step.session;
    observations.push(observeTurn(session, step.ok));
  }
  return { accepted: true, turns: observations };
}

/**
 * The runtime: template processing, then the responses, then response processing. It draws from the oracle's generator with
 * the case's seed, and both draw by the same procedures, so that they draw the same template values.
 */
export const runtime: Implementation = {
  name: "runtime",
  run: ({ xml, responses, seed }: ItemCase) => {
    try {
      const document = readAsi(xml);
      if (document.kind !== "item") return { accepted: false, reason: `The document is a ${document.kind}.` };
      const { item } = document;
      const random = longsightRandom(seed);
      const instance = runTemplateProcessing(item, createItemVariables(item), { random });
      const scored = runResponseProcessing(item, attempt(item, instance, responses), { random });
      return {
        accepted: true,
        observation: { outcomes: observeAll(scored.outcomes), templateValues: observeAll(scored.templates) },
      };
    } catch (error) {
      if (error instanceof AssesskitError) return { accepted: false, reason: error.message };
      throw error;
    }
  },
  play: (testCase: SessionCase) => {
    try {
      return play(testCase);
    } catch (error) {
      if (error instanceof AssesskitError) return { accepted: false, reason: error.message };
      throw error;
    }
  },
};
