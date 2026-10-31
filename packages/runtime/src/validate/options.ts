import type { ResponseProcessing } from "../asi/index.js";
import { checkFunction, checkOptions, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { CustomOperator } from "../processing/index.js";

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
}

/** The options as the checks use them. */
export interface CheckedOptions {
  /** The path of the document, or `undefined`. */
  readonly path: string | undefined;
  /** The registered custom operators, or `undefined` when they are not checked. */
  readonly customOperators: ReadonlyMap<string, CustomOperator> | undefined;
  /** Resolves a template URI, or `undefined` when the standard templates are the only ones. */
  readonly resolveTemplate: ((uri: string) => ResponseProcessing | undefined) | undefined;
}

/**
 * Checks the options of a validation function and returns them.
 *
 * @param options - The options of a validation function.
 * @returns The options as the checks use them.
 * @throws `DataError` when they are not an object, or `path` is not a string, `customOperators` not a `Map` or
 * `resolveTemplate` not a function.
 */
export function checkValidateOptions(options: ValidateOptions): CheckedOptions {
  checkOptions(options);
  const { path, customOperators, resolveTemplate } = options;
  if (path !== undefined) checkString(path, "The option path");
  if (customOperators !== undefined && !(customOperators instanceof Map)) {
    throw new DataError(
      `The option customOperators must be a Map from a definition or class to a function, found ${describe(customOperators)}.`,
    );
  }
  if (resolveTemplate !== undefined) checkFunction(resolveTemplate, "The option resolveTemplate must be a function");
  return { path, customOperators, resolveTemplate };
}
