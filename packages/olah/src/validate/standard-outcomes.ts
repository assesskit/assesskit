import type { BaseType } from "../values/index.js";
import type { Findings } from "./findings.js";

/** The base types of the standard outcomes (INFO §2.2.2.3, BPIG §3.5). */
const STANDARD_OUTCOMES: ReadonlyMap<string, BaseType> = new Map([
  ["SCORE", "float"],
  ["MAXSCORE", "float"],
  ["PASSED", "boolean"],
]);

/**
 * Warns when `SCORE`, `MAXSCORE` or `PASSED` has another base type than the specification asks (T23, G40): the
 * specification says "must", yet content in the field varies, so such content still runs.
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
  findings.warning("olah/validate/standard-outcome", message, "INFO §2.2.2.3, BPIG §3.5", element);
}
