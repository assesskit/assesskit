import type { BaseType } from "../values/index.js";
import type { Findings } from "./findings.js";

/** The base types of the standard outcomes. */
const STANDARD_OUTCOMES: ReadonlyMap<string, BaseType> = new Map([
  ["SCORE", "float"],
  ["MAXSCORE", "float"],
  ["PASSED", "boolean"],
]);

/**
 * Warns when `SCORE`, `MAXSCORE` or `PASSED` has another base type than the specification asks: the
 * specification says "must", yet content in the field varies, so such content still runs.
 *
 * @param findings - The findings of the document, which receive the issues.
 * @param identifier - The identifier of the outcome.
 * @param baseType - The base type it is declared with.
 * @param element - The element path of the declaration.
 */
export function checkStandardOutcome(
  findings: Findings,
  identifier: string,
  baseType: BaseType | undefined,
  element: string,
): void {
  const expected = STANDARD_OUTCOMES.get(identifier);
  if (expected === undefined || baseType === expected) return;
  const message = `The outcome ${identifier} should have the base type ${expected}, found ${baseType ?? "none"}; content that deviates still runs.`;
  findings.warning("assesskit/validate/standard-outcome", message, element);
}
