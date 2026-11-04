import type { ResponseProcessing } from "../asi/index.js";
import { checkFunction, checkPositiveInteger, checkString, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError } from "../errors.js";
import type { CustomOperator } from "../processing/index.js";
import { DEFAULT_MAX_FINDINGS } from "./findings.js";

/** Options of the validation functions that run the static checks of processing. */
export interface ValidateOptions {
  /**
   * The path of the document, named in the location of its issues.
   *
   * @defaultValue `undefined`, which names no path
   */
  readonly path?: string;
  /**
   * The custom operators the host registers, by the `definition` or `class` of a `qti-custom-operator`.
   * When it is given, a `qti-custom-operator` that none of them serves is an error, as it fails when it runs.
   *
   * @defaultValue `undefined`, so custom operators are not checked
   */
  readonly customOperators?: ReadonlyMap<string, CustomOperator>;
  /**
   * Returns the response processing that a template URI names, for templates other than the six standard ones; it is
   * called with the `template-location` of the item, else its `template`.
   *
   * @defaultValue `undefined`, so only the standard templates are known
   */
  readonly resolveTemplate?: (uri: string) => ResponseProcessing | undefined;
  /**
   * The most issues to list. When the checks find more, the list ends with the error
   * `assesskit/validate/findings-stopped`, so that content that is wrong in a million places costs the memory of the limit.
   *
   * @defaultValue `1000`
   */
  readonly maxFindings?: number;
}

/** The options as the checks use them. */
export interface CheckedOptions {
  /** The path of the document, or `undefined`. */
  readonly path: string | undefined;
  /** The registered custom operators, or `undefined` when they are not checked. */
  readonly customOperators: ReadonlyMap<string, CustomOperator> | undefined;
  /** Resolves a template URI, or `undefined` when the standard templates are the only ones. */
  readonly resolveTemplate: ((uri: string) => ResponseProcessing | undefined) | undefined;
  /** The most issues to list. */
  readonly maxFindings: number;
}

/**
 * Checks the option `maxFindings` of a validation and returns it, or its default.
 *
 * @throws `DataError` when it is not a positive integer.
 */
export function checkMaxFindings(options: Pick<ValidateOptions, "maxFindings">): number {
  checkOptions(options);
  const { maxFindings = DEFAULT_MAX_FINDINGS } = options;
  checkPositiveInteger(maxFindings, "The option maxFindings");
  return maxFindings;
}

/**
 * Checks the options of a validation function and returns them.
 *
 * @param options - The options of a validation function.
 * @returns The options as the checks use them.
 * @throws `DataError` when they are not an object, or `path` is not a string, `customOperators` not a `Map`,
 * `resolveTemplate` not a function or `maxFindings` not a positive integer.
 */
export function checkValidateOptions(options: ValidateOptions): CheckedOptions {
  const maxFindings = checkMaxFindings(options);
  const { path, customOperators, resolveTemplate } = options;
  if (path !== undefined) checkString(path, "The option path");
  if (customOperators !== undefined && !(customOperators instanceof Map)) {
    throw new DataError(
      `The option customOperators must be a Map from a definition or class to a function, found ${describe(customOperators)}.`,
    );
  }
  if (resolveTemplate !== undefined) checkFunction(resolveTemplate, "The option resolveTemplate must be a function");
  return { path, customOperators, resolveTemplate, maxFindings };
}
