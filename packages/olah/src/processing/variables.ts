import type { AssessmentItem, OutcomeDeclaration, ValueElement } from "../asi/index.js";
import { checkOptions, checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Value } from "../values/index.js";
import { normalizeValue } from "../values/value.js";
import { describeType, fitValue, type VariableType } from "./assign.js";
import {
  BUILT_IN_CONTEXTS,
  COMPLETION_STATUS,
  DURATION,
  NOT_ATTEMPTED,
  NUM_ATTEMPTS,
  QTI_CONTEXT,
  QTI_CONTEXT_FIELDS,
} from "./built-ins.js";
import { declaredValue } from "./declared-value.js";
import { floatResult, integerResult } from "./operands.js";

/**
 * The variables of one item session, NULL as `null` (INFO §2.2.2). Each built-in variable is in the map of its kind:
 * `numAttempts` and `duration` with the responses, `completionStatus` with the outcomes and `QTI_CONTEXT` with the
 * contexts.
 */
export interface ItemVariables {
  /** The context variables, `QTI_CONTEXT` included. */
  readonly contexts: ReadonlyMap<string, Value | null>;
  /** The response variables, `numAttempts` and `duration` included: the last submitted values. */
  readonly responses: ReadonlyMap<string, Value | null>;
  /** The outcomes, `completionStatus` included. */
  readonly outcomes: ReadonlyMap<string, Value | null>;
  /** The template variables. */
  readonly templates: ReadonlyMap<string, Value | null>;
  /** The correct response of each response variable, as declared or as `qti-set-correct-response` set it (INFO §6.50.5). */
  readonly correctResponses: ReadonlyMap<string, Value | null>;
  /**
   * The default value of each declared variable, as declared or as `qti-set-default-value` set it (INFO §6.50.4).
   * Template processing restarts its variables from these values.
   */
  readonly defaults: ReadonlyMap<string, Value | null>;
}

/** The options of {@link createItemVariables}. */
export interface CreateItemVariablesOptions {
  /**
   * The values of context variables, `QTI_CONTEXT` included, which the delivery engine sets before any processing (INFO
   * §2.2.2.1). A context variable left out has its default value, else NULL. Default: none.
   */
  readonly context?: ReadonlyMap<string, Value | null>;
}

/** The value outcomes of a numeric base type start with when they have no default (INFO §2.2.2.3). */
const NUMERIC_START = 0;

/**
 * Returns the value an outcome starts with: its default value, else 0 for a single integer or float, else NULL
 * (INFO §2.2.2.3).
 */
export function initialOutcome(declaration: OutcomeDeclaration, defaultValue: Value | null): Value | null {
  if (defaultValue !== null || declaration.cardinality !== "single") return defaultValue;
  if (declaration.baseType === "integer") return integerResult(NUMERIC_START);
  return declaration.baseType === "float" ? floatResult(NUMERIC_START) : null;
}

/** The kind of the model of `qti-assessment-item`. */
const ITEM_KIND = "assessment-item";

/**
 * Checks an item shallowly: an object of the model of `qti-assessment-item`.
 *
 * @throws `DataError` when it is not.
 */
export function checkItem(item: AssessmentItem): void {
  checkRecord(item, "The item must be an object of the model of qti-assessment-item");
  if (item.kind !== ITEM_KIND) {
    throw new DataError(`The item must be the model of a qti-assessment-item, found the kind ${describe(item.kind)}.`);
  }
}

/**
 * Checks item variables shallowly: an object with the six maps.
 *
 * @throws `DataError` when they are not.
 */
export function checkVariables(variables: ItemVariables): void {
  checkRecord(variables, "The item variables must be an object");
  for (const kind of ["contexts", "responses", "outcomes", "templates", "correctResponses", "defaults"] as const) {
    if (!(variables[kind] instanceof Map)) {
      throw new DataError(`The ${kind} of the item variables must be a Map, found ${describe(variables[kind])}.`);
    }
  }
}

/** Checks a value that the caller gives a context variable and returns it as the variable holds it. */
function givenContext(identifier: string, value: unknown, type: VariableType): Value | null {
  if (value === null) return null;
  const checked = normalizeValue(value);
  const fitted = fitValue(checked, type);
  if (fitted === undefined) {
    throw new DataError(`The context variable ${identifier} is ${describeType(type)}, found ${describeType(checked)}.`);
  }
  if (identifier === QTI_CONTEXT && fitted.cardinality === "record") {
    for (const field of QTI_CONTEXT_FIELDS) {
      const found = fitted.fields.get(field);
      if (found !== undefined && found.baseType !== "string") {
        throw new DataError(`The field ${field} of QTI_CONTEXT must be a single string, found ${describeType(found)}.`);
      }
    }
  }
  return fitted;
}

/** Checks the values that the caller gives context variables. */
function givenContexts(item: AssessmentItem, given: unknown): Map<string, Value | null> {
  if (!(given instanceof Map)) {
    throw new DataError(`The option context must be a Map from identifier to value, found ${describe(given)}.`);
  }
  const types = new Map<string, VariableType>(BUILT_IN_CONTEXTS);
  for (const declaration of item.contextDeclarations) types.set(declaration.identifier, declaration);
  const values = new Map<string, Value | null>();
  for (const [identifier, value] of given) {
    const type = types.get(identifier);
    if (type === undefined) {
      throw new DataError(
        `The option context gives ${describe(identifier)}, which the item declares no context variable for.`,
      );
    }
    values.set(identifier, givenContext(identifier, value, type));
  }
  return values;
}

/**
 * Creates the variables of a new item session, before template processing (INFO §2.2.2): response variables are NULL
 * (the delivery engine applies their default values at the start of the first attempt), outcomes have their default
 * values, else 0 for a single integer or float and NULL otherwise (B7), template and context variables have their
 * default values, else NULL, and the correct responses and default values are the declared ones. `numAttempts` is 0,
 * `duration` 0 seconds, `completionStatus` is `not_attempted`, and `QTI_CONTEXT` is NULL unless the option `context`
 * gives it.
 *
 * @param item - The item, as `readAsi` reads it.
 * @param options - See {@link CreateItemVariablesOptions}.
 * @throws `DataError` when an argument has the wrong type, or the option `context` names a variable the item does not
 * declare or gives a value of another type than its declaration.
 * @throws `ProcessingError` when a declared value is not in the lexical form of its base type or does not fit its
 * variable.
 */
export function createItemVariables(item: AssessmentItem, options: CreateItemVariablesOptions = {}): ItemVariables {
  checkItem(item);
  checkOptions(options);
  const { context = new Map<string, Value | null>() } = options;
  const given = givenContexts(item, context);
  const defaults = new Map<string, Value | null>();
  const declare = (
    identifier: string,
    type: VariableType,
    values: readonly ValueElement[] | undefined,
  ): Value | null => {
    const value = declaredValue(values, type, `The default value of ${identifier}`);
    defaults.set(identifier, value);
    return value;
  };
  const contexts = new Map<string, Value | null>([[QTI_CONTEXT, null]]);
  for (const declaration of item.contextDeclarations) {
    contexts.set(
      declaration.identifier,
      declare(declaration.identifier, declaration, declaration.defaultValue?.values),
    );
  }
  for (const [identifier, value] of given) contexts.set(identifier, value);
  const responses = new Map<string, Value | null>([
    [NUM_ATTEMPTS, integerResult(0)],
    [DURATION, { cardinality: "single", baseType: "duration", value: 0 }],
  ]);
  const correctResponses = new Map<string, Value | null>();
  for (const declaration of item.responseDeclarations) {
    const { identifier } = declaration;
    declare(identifier, declaration, declaration.defaultValue?.values);
    responses.set(identifier, null);
    correctResponses.set(
      identifier,
      declaredValue(declaration.correctResponse?.values, declaration, `The correct response of ${identifier}`),
    );
  }
  const outcomes = new Map<string, Value | null>([
    [COMPLETION_STATUS, { cardinality: "single", baseType: "identifier", value: NOT_ATTEMPTED }],
  ]);
  for (const declaration of item.outcomeDeclarations) {
    const value = declare(declaration.identifier, declaration, declaration.defaultValue?.values);
    outcomes.set(declaration.identifier, initialOutcome(declaration, value));
  }
  const templates = new Map<string, Value | null>();
  for (const declaration of item.templateDeclarations) {
    templates.set(
      declaration.identifier,
      declare(declaration.identifier, declaration, declaration.defaultValue?.values),
    );
  }
  return { contexts, responses, outcomes, templates, correctResponses, defaults };
}
