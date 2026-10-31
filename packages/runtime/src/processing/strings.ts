import { DataError, ProcessingError } from "../errors.js";
import { compileXsdRegex, type Value, type XsdPattern } from "../values/index.js";
import { asString, booleanResult, primitiveOf } from "./operands.js";

/** Returns the strings of two single operands, case-folded unless `caseSensitive`; `undefined` when either is NULL. */
function stringsOf(a: Value | null, b: Value | null, caseSensitive: boolean): readonly [string, string] | undefined {
  if (a === null || b === null) return undefined;
  const [first, second] = [asString(primitiveOf(a)), asString(primitiveOf(b))];
  return caseSensitive ? [first, second] : [foldCase(first), foldCase(second)];
}

/**
 * Folds the case of a string for a comparison that ignores case: Unicode default case conversion.
 *
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function foldCase(text: string): string {
  return text.toLowerCase();
}

/**
 * `qti-string-match`: whether two strings are equal, or with the deprecated `substring` whether the first contains the
 * second; case-insensitively unless `caseSensitive`.
 *
 * @remarks
 * NULL when either is NULL.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-string-match}
 */
export function stringMatch(
  a: Value | null,
  b: Value | null,
  caseSensitive: boolean,
  substring: boolean,
): Value | null {
  const pair = stringsOf(a, b, caseSensitive);
  if (pair === undefined) return null;
  const [first, second] = pair;
  return booleanResult(substring ? first.includes(second) : first === second);
}

/**
 * `qti-substring`: whether the first string occurs in the second, case-insensitively unless `caseSensitive`.
 *
 * @remarks
 * NULL when either is NULL.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-substring}
 */
export function substring(a: Value | null, b: Value | null, caseSensitive: boolean): Value | null {
  const pair = stringsOf(a, b, caseSensitive);
  if (pair === undefined) return null;
  const [part, whole] = pair;
  return booleanResult(whole.includes(part));
}

/**
 * `qti-pattern-match`: whether the whole string matches a regular expression of XML Schema, run on the linear-time
 * automaton of `values`.
 *
 * @remarks
 * NULL when the string or the pattern is NULL.
 *
 * @throws `ProcessingError` when the pattern is not a regular expression of XML Schema or is above its limits.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, qti-pattern-match}
 */
export function patternMatch(operand: Value | null, pattern: string | null): Value | null {
  if (operand === null || pattern === null) return null;
  return booleanResult(compiled(pattern).matches(asString(primitiveOf(operand))));
}

function compiled(pattern: string): XsdPattern {
  try {
    return compileXsdRegex(pattern);
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    throw new ProcessingError(`The operator qti-pattern-match cannot use its pattern: ${error.message}`);
  }
}
