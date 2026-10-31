import type { FileValue, Primitive } from "@assesskit/runtime/values";

/**
 * Returns whether a primitive is a value of the base type `file`: a reference to bytes that the host stores.
 *
 * @param primitive - The primitive.
 * @returns `true` for a file value, and `false` for a number, a string, a point or a pair.
 */
export function isFileValue(primitive: Primitive): primitive is FileValue {
  return typeof primitive === "object" && "reference" in primitive;
}
