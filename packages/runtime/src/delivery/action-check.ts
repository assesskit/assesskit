import * as v from "valibot";
import { type ItemStage, isSessionEnd } from "../cat/index.js";
import {
  checkChoice,
  checkRecord,
  guardSchema,
  isRecord,
  looseRecord,
  parseWith,
  positiveIntegerSchema,
  type Schema,
  transformWith,
} from "../checks.js";
import { normalizeValue, type Value } from "../values/index.js";
import { type Action, CANDIDATE_ACTION_TYPES, candidateActionSchemas, HOST_ACTION_TYPES } from "./action.js";
import { checkInstant } from "./datestamp.js";
import type { ItemKey } from "./item-key.js";

/** The schema of a value of an action in memory, or of NULL: {@link normalizeValue} checks it. */
const valueSchema = v.pipe(
  v.unknown(),
  transformWith((value) => (value === null ? null : normalizeValue(value as Value))),
);

/** The schema of a variable of a result that a CAT engine returned: the kinds this engine reads. */
const reportedVariableSchema = v.pipe(
  looseRecord({ identifier: v.string() }),
  transformWith((variable) => {
    if (variable.kind === "outcome" && variable.value !== null) normalizeValue(variable.value as Value);
    return variable;
  }),
);

/** The schema of the result report in the answer to Submit Results: the context, the test result and the item results. */
const reportSchema = looseRecord({
  context: v.optional(
    looseRecord({
      sessionIdentifiers: v.array(looseRecord({ sourceId: v.string(), identifier: v.string() })),
    }),
  ),
  testResult: v.optional(looseRecord({ variables: v.array(reportedVariableSchema) })),
  itemResults: v.array(looseRecord({ identifier: v.string(), variables: v.array(reportedVariableSchema) })),
});

/** The schema of an answer of a CAT engine as far as the engine reads it, which ends the session or has these fields. */
const catAnswerSchema = looseRecord({
  sessionIdentifier: v.optional(v.string()),
  sessionState: v.optional(v.string()),
  // isSessionEnd checks that the stage is an item stage.
  nextItems: v.nullish(
    v.pipe(
      v.unknown(),
      transformWith((stage) => isSessionEnd(stage as ItemStage)),
    ),
  ),
  assessmentResult: v.optional(reportSchema),
});

/**
 * The schema of the answer of a CAT engine. An End Session answer has `ended`, and nothing else of it is read; whether an
 * answer fits the request is decided when it is applied.
 */
const catResponseSchema = v.lazy((input) =>
  isRecord(input) && input.ended !== undefined ? looseRecord({ ended: v.literal(true) }) : catAnswerSchema,
);

/** An item instance in memory: any object with the two properties, such as an entry of the navigation of a view. */
const itemSchema: Schema<ItemKey> = v.looseObject({ ref: v.string(), instance: positiveIntegerSchema });

/** A map in memory, whose entries are read when the action is applied. */
const mapOf = <TValue>(expected: string): Schema<ReadonlyMap<string, TValue>> =>
  guardSchema((value): value is ReadonlyMap<string, TValue> => value instanceof Map, expected);

/** An action in memory: maps, and any other property, such as its time, which {@link checkAction} reads first. */
const actionSchema = v.variant("type", [
  ...candidateActionSchemas({
    object: v.looseObject as unknown as typeof v.strictObject,
    item: itemSchema,
    responses: mapOf("a Map from response identifier to value"),
    pciStates: mapOf("a Map from response identifier to state"),
  }),
  v.looseObject({ type: v.literal("time") }),
  v.looseObject({
    type: v.literal("supply-scores"),
    request: v.string(),
    scorer: v.picklist(["human", "externalMachine"]),
    value: valueSchema,
  }),
  v.looseObject({ type: v.literal("cat-response"), request: v.string(), response: catResponseSchema }),
]);

/** The types of the actions. */
const ACTION_TYPES = [...CANDIDATE_ACTION_TYPES, ...HOST_ACTION_TYPES];

/**
 * Checks an action in memory: its type, its time, and the fields that its type has.
 *
 * @throws `DataError` when it is not an action.
 */
export function checkAction(action: unknown): asserts action is Action {
  checkRecord(action, "The action must be an object with a type and a time");
  checkChoice(action.type, "The type of the action", ACTION_TYPES);
  checkInstant(action.at, "The time of the action");
  parseWith(actionSchema, action, "The action");
}
