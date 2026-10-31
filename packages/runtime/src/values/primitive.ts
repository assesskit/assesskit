/**
 * A point of the base type `point`: the horizontal and vertical position, as integers.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding, base types}
 */
export type Point = readonly [x: number, y: number];

/**
 * A pair of the base types `pair` and `directedPair`: two identifiers. A directed pair is source and destination; a pair
 * has no order when two are compared.
 */
export type Pair = readonly [first: string, second: string];

/**
 * A value of the base type `file`: a reference to bytes that the host stores, with their content type and an optional
 * name. The bytes are never part of a value.
 */
export interface FileValue {
  /** The host's reference to the stored bytes. */
  readonly reference: string;
  /** The content type, one of the MIME types of RFC 2045. */
  readonly mimeType: string;
  /** The name given to the file, such as the name of the uploaded file. */
  readonly fileName?: string;
}

/** The value of one base type: what a single value holds and a container holds many of. */
export type Primitive = boolean | number | string | Point | Pair | FileValue;

/**
 * Returns whether a primitive is a {@link Point} or a {@link Pair}.
 *
 * @param primitive - The primitive.
 * @returns `true` for the two array forms.
 */
export function isTuple(primitive: Primitive): primitive is Point | Pair {
  return Array.isArray(primitive);
}

/**
 * Returns whether a primitive is a {@link FileValue}.
 *
 * @param primitive - The primitive.
 * @returns `true` for the object form.
 */
export function isFileValue(primitive: Primitive): primitive is FileValue {
  return typeof primitive === "object" && !Array.isArray(primitive);
}
