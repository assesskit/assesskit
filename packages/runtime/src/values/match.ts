import { checkRecord } from "../checks.js";
import { primitiveKey } from "./primitive-key.js";
import type { ContainerValue, RecordValue, SingleValue, Value } from "./value.js";

function matchSingle(a: SingleValue, b: SingleValue): boolean {
  return a.baseType === b.baseType && primitiveKey(a.baseType, a.value) === primitiveKey(b.baseType, b.value);
}

function matchContainers(a: ContainerValue, b: ContainerValue): boolean {
  if (a.baseType !== b.baseType || a.values.length !== b.values.length) return false;
  const left = a.values.map((primitive) => primitiveKey(a.baseType, primitive));
  const right = b.values.map((primitive) => primitiveKey(b.baseType, primitive));
  if (a.cardinality === "ordered") return left.every((item, index) => item === right[index]);
  // A multiple container is a multiset: the same values the same number of times.
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of right) {
    const count = counts.get(item);
    if (count === undefined || count === 0) return false;
    counts.set(item, count - 1);
  }
  return true;
}

function matchRecords(a: RecordValue, b: RecordValue): boolean {
  if (a.fields.size !== b.fields.size) return false;
  for (const [name, field] of a.fields) {
    const other = b.fields.get(name);
    if (other === undefined || !matchSingle(field, other)) return false;
  }
  return true;
}

/**
 * Returns whether two values are the same value: the meaning of `qti-match` once neither is NULL.
 *
 * @remarks
 * Values of different cardinality or base type never match. A `multiple` container matches another with the same values
 * the same number of times in any order, an `ordered` one only in the same order, and a `record` one with the same
 * fields. Strings and identifiers compare case-sensitively, a `pair` ignores the order of its identifiers and a
 * `directedPair` does not, a `float` or `duration` compares as `SameValueZero`, and a `file` by its reference, content
 * type and name. The function does not check its arguments deeply, so build them with {@link buildSingle},
 * {@link buildContainer} and {@link buildRecord}.
 *
 * @param a - The first value.
 * @param b - The second value.
 * @returns `true` when they match.
 * @throws `DataError` when `a` or `b` is not an object.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, match}
 */
export function matchValues(a: Value, b: Value): boolean {
  checkRecord(a, "The first value must be an object");
  checkRecord(b, "The second value must be an object");
  if (a.cardinality === "single") return b.cardinality === "single" && matchSingle(a, b);
  if (a.cardinality === "record") return b.cardinality === "record" && matchRecords(a, b);
  return (
    (b.cardinality === "multiple" || b.cardinality === "ordered") &&
    a.cardinality === b.cardinality &&
    matchContainers(a, b)
  );
}
