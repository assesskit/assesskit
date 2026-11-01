import type { ElementModel, ResponseProcessing } from "../asi/index.js";
import { checkFunction, checkPositiveInteger, checkRecord, checkString, describe } from "../checks.js";
import { DataError, SecurityError } from "../errors.js";
import type { Random } from "../random.js";
import type { Value } from "../values/index.js";
import { DEFAULT_PROCESSING_LIMITS, type ProcessingLimits } from "./limits.js";

/** A `qti-custom-operator` of the model. */
export type CustomOperatorExpression = ElementModel<"CustomOperator", "qti-custom-operator">;

/**
 * A custom operator: a function that computes the value of a `qti-custom-operator` from the values of its operands,
 * NULL as `null`.
 *
 * @remarks
 * It receives the expression, so that it can read the attributes and elements of other namespaces that the operator
 * carries. A function that throws makes the processing fail with a `ProcessingError`, as an operator that returns a value
 * that is not one does with a `DataError`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-custom-operator}
 */
export type CustomOperator = (
  operands: readonly (Value | null)[],
  expression: CustomOperatorExpression,
) => Value | null;

/** What processing needs besides the variables: the source of random draws, the extensions and the limits. */
export interface ProcessingContext {
  /** The source of the draws of `qti-random`, `qti-random-integer` and `qti-random-float`. */
  readonly random: Random;
  /**
   * The custom operators, by the `definition` of a `qti-custom-operator`, else by its `class`.
   *
   * @defaultValue none
   */
  readonly customOperators?: ReadonlyMap<string, CustomOperator>;
  /**
   * Returns the response processing that a template URI names, for templates other than the six standard ones; it
   * receives the `template-location` of the item when it has one, else its `template`.
   *
   * @defaultValue none
   */
  readonly resolveTemplate?: (uri: string) => ResponseProcessing | undefined;
  /** Limits that replace those of {@link DEFAULT_PROCESSING_LIMITS}; a limit left out keeps its default. */
  readonly limits?: Partial<ProcessingLimits>;
}

/** A context that has been checked, with its defaults applied. */
export interface Environment {
  readonly random: Random;
  readonly customOperators: ReadonlyMap<string, CustomOperator>;
  readonly resolveTemplate: ((uri: string) => ResponseProcessing | undefined) | undefined;
  readonly limits: ProcessingLimits;
}

const NO_OPERATORS: ReadonlyMap<string, CustomOperator> = new Map();

/**
 * Checks the options of processing that a caller passes in a context or to an engine: the custom operators, the resolver of
 * templates and the limits of processing. It applies their defaults.
 *
 * @throws `DataError` when an option has the wrong type or a limit is not a positive integer.
 */
export function checkProcessingOptions(
  options: Pick<ProcessingContext, "customOperators" | "resolveTemplate" | "limits">,
): Omit<Environment, "random"> {
  const { customOperators = NO_OPERATORS, resolveTemplate, limits = {} } = options;
  if (!(customOperators instanceof Map)) {
    throw new DataError(
      `The option customOperators must be a Map from a definition or class to a function, found ${describe(customOperators)}.`,
    );
  }
  for (const [name, operator] of customOperators) {
    checkString(name, "The name of a custom operator");
    checkFunction(operator, `The custom operator ${describe(name)} must be a function`);
  }
  if (resolveTemplate !== undefined) checkFunction(resolveTemplate, "The option resolveTemplate must be a function");
  checkRecord(limits, "The option limits must be an object");
  const { maxContainerSize = DEFAULT_PROCESSING_LIMITS.maxContainerSize } = limits;
  checkPositiveInteger(maxContainerSize, "The limit maxContainerSize");
  return { customOperators, resolveTemplate, limits: { maxContainerSize } };
}

/**
 * Checks a processing context and applies its defaults.
 *
 * @throws `DataError` when it is not a context.
 */
export function checkContext(context: ProcessingContext): Environment {
  checkRecord(context, "The processing context must be an object");
  const { random } = context;
  checkRecord(random, "The option random must be an object with a function uniform");
  checkFunction(random.uniform, "The option random must be an object with a function uniform");
  return { random, ...checkProcessingOptions(context) };
}

/**
 * Checks the size of a container that an expression builds.
 *
 * @throws `SecurityError` when it is above `maxContainerSize`.
 */
export function checkContainerSize(environment: Environment, size: number, operator: string): void {
  const limit = environment.limits.maxContainerSize;
  if (size > limit) {
    throw new SecurityError(
      `The operator ${operator} builds a container of ${size} values, more than the limit maxContainerSize of ${limit}.`,
      "maxContainerSize",
      limit,
    );
  }
}
