import type { BaseType } from "./base-type.js";
import { isFileValue, isTuple, type Primitive } from "./primitive.js";

/**
 * Returns a string that two primitives of one base type share exactly when they are the same value.
 *
 * @remarks
 * Numbers compare as `SameValueZero`: `NaN` equals `NaN`, and `0` equals `-0`. A pair is unordered and a directed pair is
 * ordered, so the key of a pair sorts its two identifiers. The keys serve as the identity of a value in sets, counts and
 * lookups.
 *
 * @param baseType - The base type of the primitive.
 * @param primitive - The primitive.
 * @returns The key.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, base types}
 */
export function primitiveKey(baseType: BaseType, primitive: Primitive): string {
  if (isFileValue(primitive))
    return JSON.stringify([primitive.reference, primitive.mimeType, primitive.fileName ?? null]);
  if (baseType === "pair" && isTuple(primitive)) return primitive.map(String).toSorted().join("\0");
  return isTuple(primitive) ? primitive.join("\0") : String(primitive);
}
