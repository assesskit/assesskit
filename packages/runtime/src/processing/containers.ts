import { drawIndex } from "../random.js";
import type { BaseType, ContainerValue, Primitive, Value } from "../values/index.js";
import { primitiveKey } from "../values/primitive-key.js";
import { checkContainerSize, type Environment } from "./context.js";
import { baseTypeOf, booleanResult, integerResult, primitiveOf, primitivesOf } from "./operands.js";

/**
 * Builds a container of the values an operator collected, NULL when there are none (INFO §2.2.2).
 *
 * @throws `SecurityError` when there are more than `maxContainerSize`.
 */
function containerOf(
  cardinality: "multiple" | "ordered",
  baseType: BaseType | undefined,
  values: readonly Primitive[],
  environment: Environment,
  operator: string,
): ContainerValue | null {
  if (baseType === undefined || values.length === 0) return null;
  checkContainerSize(environment, values.length, operator);
  return { cardinality, baseType, values };
}

/** Returns the base type of the first operand that is not NULL. */
function sharedBaseType(operands: readonly (Value | null)[]): BaseType | undefined {
  for (const operand of operands) if (operand !== null) return baseTypeOf(operand);
  return undefined;
}

/**
 * `qti-multiple` and `qti-ordered`: a container of the values of the operands, a container operand adding its values,
 * NULL operands left out; NULL when no value is left (INFO §2.11.3.8–9).
 *
 * @throws `SecurityError` when the container would hold more than `maxContainerSize` values.
 */
export function collect(
  cardinality: "multiple" | "ordered",
  operands: readonly (Value | null)[],
  environment: Environment,
): Value | null {
  const values = operands.flatMap((operand) => (operand === null ? [] : primitivesOf(operand)));
  return containerOf(cardinality, sharedBaseType(operands), values, environment, `qti-${cardinality}`);
}

/**
 * `qti-repeat`: the values of the operands, in order, `times` times over, in an ordered container; NULL operands left out
 * (INFO §2.11.3.42). NULL when no value is left, or when `times` is NULL or less than 1.
 *
 * @throws `SecurityError` when the container would hold more than `maxContainerSize` values.
 */
export function repeat(
  operands: readonly (Value | null)[],
  times: number | null,
  environment: Environment,
): Value | null {
  if (times === null || times < 1) return null;
  const once = operands.flatMap((operand) => (operand === null ? [] : primitivesOf(operand)));
  // Without a value, any number of repeats is NULL, and must not be built.
  if (once.length === 0) return null;
  checkContainerSize(environment, once.length * times, "qti-repeat");
  const values = Array.from({ length: times }, () => once).flat();
  return containerOf("ordered", sharedBaseType(operands), values, environment, "qti-repeat");
}

/** `qti-container-size`: the number of values of a container, 0 for NULL (INFO §2.11.3.32). */
export function containerSize(operand: Value | null): Value | null {
  return integerResult(operand === null ? 0 : primitivesOf(operand).length);
}

/** `qti-is-null`: whether the operand is NULL (INFO §2.11.3.34). */
export function isNull(operand: Value | null): Value | null {
  return booleanResult(operand === null);
}

/** Returns the keys of the values of a container, which equal values share. */
function keysOf(container: Value): string[] {
  const baseType = baseTypeOf(container);
  return baseType === undefined ? [] : primitivesOf(container).map((primitive) => primitiveKey(baseType, primitive));
}

/** Returns the key of a single value. */
function keyOf(value: Value): string {
  const baseType = baseTypeOf(value);
  return baseType === undefined ? "" : primitiveKey(baseType, primitiveOf(value));
}

/** `qti-member`: whether the container holds the value; NULL when either is NULL (INFO §2.11.3.29). */
export function member(value: Value | null, container: Value | null): Value | null {
  if (value === null || container === null) return null;
  return booleanResult(keysOf(container).includes(keyOf(value)));
}

/**
 * `qti-delete`: the container without every value equal to the first operand; NULL when either is NULL or no value is
 * left (INFO §2.11.3.18).
 */
export function deleteValue(value: Value | null, container: Value | null): Value | null {
  if (
    value === null ||
    container === null ||
    container.cardinality === "record" ||
    container.cardinality === "single"
  ) {
    return null;
  }
  const key = keyOf(value);
  const values = container.values.filter((primitive) => primitiveKey(container.baseType, primitive) !== key);
  return values.length === 0 ? null : { cardinality: container.cardinality, baseType: container.baseType, values };
}

/** Returns whether the keys hold the part as a multiset: each value at least as often. */
function holdsMultiset(whole: readonly string[], part: readonly string[]): boolean {
  const counts = new Map<string, number>();
  for (const key of whole) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const key of part) {
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    counts.set(key, count - 1);
  }
  return true;
}

/** Returns whether the keys hold the part as a run of consecutive values (G30). */
function holdsRun(whole: readonly string[], part: readonly string[]): boolean {
  for (let start = 0; start + part.length <= whole.length; start++) {
    if (part.every((key, offset) => whole[start + offset] === key)) return true;
  }
  return false;
}

/**
 * `qti-contains`: whether the first container holds the second: each value as often for multiple containers, and as a
 * contiguous run for ordered ones (INFO §2.11.3.17, G30). NULL when either is NULL.
 */
export function contains(whole: Value | null, part: Value | null): Value | null {
  if (whole === null || part === null) return null;
  const [all, sought] = [keysOf(whole), keysOf(part)];
  return booleanResult(whole.cardinality === "ordered" ? holdsRun(all, sought) : holdsMultiset(all, sought));
}

/**
 * `qti-index`: the nth value of an ordered container, from 1 (INFO §2.11.3.6). NULL when the container or n is NULL, n
 * is beyond the container, or n is less than 1 (G31).
 */
export function index(container: Value | null, n: number | null): Value | null {
  if (container === null || n === null || n < 1 || container.cardinality !== "ordered") return null;
  const value = container.values[n - 1];
  return value === undefined ? null : { cardinality: "single", baseType: container.baseType, value };
}

/** `qti-random`: a value of the container, each position equally likely; NULL for NULL (INFO §2.11.3.36). */
export function random(container: Value | null, environment: Environment): Value | null {
  if (container === null || container.cardinality === "record" || container.cardinality === "single") return null;
  const value = container.values[drawIndex(environment.random, container.values.length)];
  return value === undefined ? null : { cardinality: "single", baseType: container.baseType, value };
}

/** `qti-field-value`: the field of a record, NULL when the record is NULL or has no such field (INFO §2.11.3.5). */
export function fieldValue(operand: Value | null, field: string): Value | null {
  return operand?.cardinality === "record" ? (operand.fields.get(field) ?? null) : null;
}
