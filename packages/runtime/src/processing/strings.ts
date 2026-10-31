import { DataError, ProcessingError } from "../errors.js";
import { compileXsdRegex, type Value, type XsdPattern } from "../values/index.js";
import { asString, booleanResult, primitiveOf } from "./operands.js";

/** Returns the strings of two single operands, case-folded unless `caseSensitive`; `undefined` when either is NULL. */
function stringsOf(a: Value | null, b: Value | null, caseSensitive: boolean): readonly [string, string] | undefined {
  if (a === null || b === null) return undefined;
  const [first, second] = [asString(primitiveOf(a)), asString(primitiveOf(b))];
  return caseSensitive ? [first, second] : [foldCase(first), foldCase(second)];
}

/** Folds the case of a string for a comparison that ignores case: Unicode default case conversion (G6). */
export function foldCase(text: string): string {
  return text.toLowerCase();
}

/**
 * `qti-string-match`: whether two strings are equal, or with the deprecated `substring` whether the first contains the
 * second; case-insensitively unless `caseSensitive` (INFO §5.138). NULL when either is NULL.
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
 * `qti-substring`: whether the first string occurs in the second, case-insensitively unless `caseSensitive` (INFO
 * §5.139). NULL when either is NULL.
 */
export function substring(a: Value | null, b: Value | null, caseSensitive: boolean): Value | null {
  const pair = stringsOf(a, b, caseSensitive);
  if (pair === undefined) return null;
  const [part, whole] = pair;
  return booleanResult(whole.includes(part));
}

/**
 * `qti-pattern-match`: whether the whole string matches a regular expression of XML Schema (INFO §5.104.1), run on the
 * linear-time automaton of `values`. NULL when the string or the pattern is NULL.
 *
 * @throws `ProcessingError` when the pattern is not a regular expression of XML Schema or is above its limits.
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
