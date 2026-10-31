import { ProcessingError } from "../errors.js";
import type { Value } from "../values/index.js";
import { describeType } from "./assign.js";
import { baseTypeOf } from "./operands.js";
import { MANY, OPERATOR_SIGNATURES, type OperandSignature, type OperatorSignature } from "./signatures.js";

/** The signatures by any string, so that a kind from untrusted data can be looked up. */
const BY_KIND: ReadonlyMap<string, OperatorSignature> = OPERATOR_SIGNATURES;

/**
 * Describes how many operands an operator takes, such as `2` or `1 or more`.
 *
 * @param signature - The signature of an operator.
 * @returns The description.
 */
export function describeCount(signature: OperatorSignature): string {
  const { minOperands, maxOperands } = signature;
  if (maxOperands === MANY) return `${minOperands} or more`;
  return minOperands === maxOperands ? String(minOperands) : `${minOperands} to ${maxOperands}`;
}

function mismatch(kind: string, problem: string): ProcessingError {
  return new ProcessingError(`The operator qti-${kind} ${problem}.`);
}

/**
 * Describes what an operand takes, such as `single or multiple integer`.
 *
 * @param expected - What the operand takes.
 * @returns The description.
 */
export function describeOperand(expected: OperandSignature): string {
  const cardinalities = expected.cardinalities.join(" or ");
  return expected.baseTypes === undefined ? cardinalities : `${cardinalities} ${expected.baseTypes.join(" or ")}`;
}

/** Checks one operand that is not NULL against what its position takes. */
function checkOperand(kind: string, signature: OperatorSignature, value: Value, index: number): void {
  const expected = signature.operands[Math.min(index, signature.operands.length - 1)];
  if (expected === undefined) return;
  const baseType = baseTypeOf(value);
  const fits =
    expected.cardinalities.includes(value.cardinality) &&
    (expected.baseTypes === undefined || baseType === undefined || expected.baseTypes.includes(baseType));
  if (!fits) {
    throw mismatch(kind, `takes ${describeOperand(expected)} operands, found ${describeType(value)}`);
  }
}

/**
 * Returns the signature of an expression's kind.
 *
 * @throws `ProcessingError` when the kind is not an expression of QTI 3.0.
 */
function signatureOf(kind: string): OperatorSignature {
  const found = BY_KIND.get(kind);
  if (found !== undefined) return found;
  throw new ProcessingError(
    `The model has the expression kind ${JSON.stringify(kind)}, which QTI 3.0 does not define.`,
  );
}

/**
 * Checks the operands of an operator against its signature: their number, and the cardinality and base type of each
 * that is not NULL.
 *
 * @throws `ProcessingError` when they do not fit.
 */
export function checkOperands(kind: string, operands: readonly (Value | null)[]): void {
  const signature = signatureOf(kind);
  if (operands.length < signature.minOperands || operands.length > signature.maxOperands) {
    throw mismatch(kind, `takes ${describeCount(signature)} operands, found ${operands.length}`);
  }
  const present = operands.filter((value) => value !== null);
  operands.forEach((value, index) => {
    if (value !== null) checkOperand(kind, signature, value, index);
  });
  if (signature.sameBaseType && new Set(present.map(baseTypeOf).filter((type) => type !== undefined)).size > 1) {
    throw mismatch(kind, `takes operands of one base type, found ${present.map(describeType).join(" and ")}`);
  }
  if (signature.sameCardinality && new Set(present.map((value) => value.cardinality)).size > 1) {
    throw mismatch(kind, `takes operands of one cardinality, found ${present.map(describeType).join(" and ")}`);
  }
}
