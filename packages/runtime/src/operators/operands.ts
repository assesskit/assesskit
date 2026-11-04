import { DataError } from "../errors.js";
import type { Point, SingleValue, Value } from "../values/index.js";

/** Unicode White_Space and the spacing commands of LaTeX: a string of nothing else is blank. */
const BLANK =
  /^(?:[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000~]|\\[,;:!]|\\q?quad(?![A-Za-z]))*$/u;

/** Whether a string holds only white space and spacing commands. */
export function isBlank(text: string): boolean {
  return BLANK.test(text);
}

/** How an operator takes its response: the cardinalities it reads, and whether a number reads as its decimal form. */
export interface OperandShape {
  readonly containers: boolean;
  readonly numbers: boolean;
}

/** Describes a value's type for a message. */
function typeOf(value: Value): string {
  return value.cardinality === "record" ? "a record" : `${value.cardinality} ${value.baseType}`;
}

/**
 * The strings of an operand: a single string, a container of strings when the operator takes one, and an integer or a float
 * through its shortest decimal form when it takes numbers. NULL is `null`.
 *
 * @throws `DataError` naming the operand when its type is not one the operator reads: a defect of the item, never of a
 *   candidate's input.
 */
export function stringsOf(
  operand: Value | null | undefined,
  index: number,
  shape: OperandShape,
): readonly string[] | null {
  if (operand === null) return null;
  if (operand === undefined) throw new DataError(`The operator has no operand ${index + 1}.`);
  if (operand.cardinality === "record")
    throw new DataError(`The operator does not read its operand ${index + 1}, a record.`);
  const numeric = shape.numbers && (operand.baseType === "integer" || operand.baseType === "float");
  const readable =
    (operand.baseType === "string" || numeric) &&
    (operand.cardinality === "single" || (shape.containers && operand.baseType === "string"));
  if (!readable) throw new DataError(`The operator does not read its operand ${index + 1}, ${typeOf(operand)}.`);
  if (operand.cardinality === "single") return [String(operand.value)];
  return operand.values.map(String);
}

/** The points of an operand: one point, or a container of them. NULL is `null`. */
export function pointsOf(operand: Value | null | undefined): readonly Point[] | null {
  if (operand === null) return null;
  if (operand === undefined || operand.cardinality === "record" || operand.baseType !== "point") {
    const found = operand === undefined ? "none" : typeOf(operand);
    throw new DataError(`hotspot-matching reads a point or a container of points, found ${found}.`);
  }
  const values = operand.cardinality === "single" ? [operand.value] : operand.values;
  return values.filter((value): value is Point => Array.isArray(value));
}

/**
 * Checks the count of operands: the response, and the earlier response when the call has a follow-through.
 *
 * @throws `DataError` for another count.
 */
export function checkOperandCount(operands: readonly unknown[], expected: number): void {
  if (operands.length !== expected)
    throw new DataError(
      `The operator takes ${expected} operand${expected === 1 ? "" : "s"}, found ${operands.length}.`,
    );
}

/** A share of the response's points, as a single float. */
export function share(value: number): SingleValue {
  return { cardinality: "single", baseType: "float", value };
}

/** A flag, as a single boolean. */
export function flag(value: boolean): SingleValue {
  return { cardinality: "single", baseType: "boolean", value };
}
