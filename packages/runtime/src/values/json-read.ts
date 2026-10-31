import * as v from "valibot";
import { checkRecord, describe, parseWith } from "../checks.js";
import { DataError } from "../errors.js";
import { type BaseType, isBaseType } from "./base-type.js";
import type { Cardinality } from "./cardinality.js";
import { readDeclaration, type ValueDeclaration } from "./declaration.js";
import { parseIsoDuration } from "./duration.js";
import {
  buildContainer,
  buildRecord,
  buildSingle,
  type ContainerValue,
  type RecordValue,
  type SingleValue,
  type Value,
} from "./value.js";

/**
 * The numbers that JSON cannot carry, with the `xs:double` spelling that stands for them. A `float` or `duration` that is
 * one of these is a string in the JSON.
 */
const NON_JSON_NUMBERS: ReadonlyMap<string, number> = new Map([
  ["NaN", Number.NaN],
  ["INF", Number.POSITIVE_INFINITY],
  ["-INF", Number.NEGATIVE_INFINITY],
  ["-0", -0],
]);

/** The name that the binding gives a base type that is an integer or an identifier, chosen by the JSON type of the value. */
const INT_OR_IDENTIFIER = "intOrIdentifier";

/** Names the properties of an object for a message. */
const propertiesOf = (keys: readonly string[]): string => keys.map(describe).join(", ") || "none";

const singleSchema = v.strictObject({ base: v.unknown() });
const recordSchema = v.strictObject({ record: v.unknown() });
const listSchema = v.strictObject({ list: v.unknown() });

/** Returns the base type for `intOrIdentifier`, which names no base type. */
function resolveIntOrIdentifier(declared: BaseType | undefined, content: unknown): BaseType | undefined {
  if (declared === undefined) return typeof content === "number" ? "integer" : "identifier";
  return declared === "integer" || declared === "identifier" ? declared : undefined;
}

/** Returns the base type that the property of a typed object names, and its content. */
function typedContent(json: unknown, declared: BaseType | undefined, what: string): [BaseType, unknown] {
  checkRecord(json, `${what} must be an object with one property, the base type`);
  const keys = Object.keys(json);
  const key = keys[0];
  if (keys.length !== 1 || key === undefined) {
    throw new DataError(
      `${what} must be an object with one property, the base type, found the properties ${propertiesOf(keys)}.`,
    );
  }
  const content = json[key];
  const baseType =
    key === INT_OR_IDENTIFIER ? resolveIntOrIdentifier(declared, content) : isBaseType(key) ? key : undefined;
  if (baseType === undefined || (declared !== undefined && baseType !== declared)) {
    const expected = declared === undefined ? "the name of a base type" : describe(declared);
    throw new DataError(`${what} must have the property ${expected}, found ${describe(key)}.`);
  }
  return [baseType, content];
}

function decodeFloat(json: unknown): number {
  if (typeof json === "number") return json;
  const special = typeof json === "string" ? NON_JSON_NUMBERS.get(json) : undefined;
  if (special === undefined) {
    throw new DataError(`A float must be a number or one of "NaN", "INF", "-INF" and "-0", found ${describe(json)}.`);
  }
  return special;
}

function decodeDuration(json: unknown): number {
  if (typeof json !== "string") {
    throw new DataError(`A duration must be an ISO 8601 duration such as "PT1.5S", found ${describe(json)}.`);
  }
  return NON_JSON_NUMBERS.get(json) ?? parseIsoDuration(json);
}

const fileSchema = v.strictObject({
  // A file is a reference to bytes that the host stores, so the inline "data" of the binding is refused.
  data: v.optional(
    v.never(
      'A file must be a reference, not inline "data": the host stores the bytes, and the file is the reference to them.',
    ),
  ),
  reference: v.string(),
  mime: v.string(),
  name: v.optional(v.string()),
});

/** Reads the JSON of a file into the properties of a `FileValue`. */
function decodeFile(json: unknown): unknown {
  const { reference, mime, name } = parseWith(fileSchema, json, "A file");
  return { reference, mimeType: mime, fileName: name };
}

function decodeItem(baseType: BaseType, json: unknown): unknown {
  switch (baseType) {
    case "float":
      return decodeFloat(json);
    case "duration":
      return decodeDuration(json);
    case "file":
      return decodeFile(json);
    default:
      return json;
  }
}

function decodeSingle(json: unknown, what: string, declared: BaseType | undefined): SingleValue | null {
  const [baseType, content] = typedContent(json, declared, what);
  return buildSingle(baseType, decodeItem(baseType, content));
}

function decodeList(json: unknown, cardinality: Cardinality, declared: BaseType): ContainerValue | null {
  const [baseType, content] = typedContent(json, declared, "The list of a container");
  const items = parseWith(v.array(v.unknown()), content, `The list of base type ${baseType}`);
  return buildContainer(
    cardinality,
    baseType,
    items.map((item) => decodeItem(baseType, item)),
  );
}

const fieldsSchema = v.array(v.strictObject({ name: v.string(), base: v.unknown() }));

function decodeRecord(json: unknown): RecordValue | null {
  const fields: [string, SingleValue][] = [];
  for (const { name, base } of parseWith(fieldsSchema, json, "A record")) {
    // A field without a value is NULL, and a record holds no NULL, so it is left out.
    const field = base === null ? null : decodeSingle(base, `The base of the field ${describe(name)}`, undefined);
    if (field !== null) fields.push([name, field]);
  }
  return buildRecord(fields);
}

/**
 * Reads a value from the JSON binding that {@link toJsonValue} writes.
 *
 * @remarks
 * `{ "base": null }`, `{ "list": null }` and `{ "record": null }` are NULL, and so are an empty list, an empty record
 * and the empty string. A field of a record that is NULL is left out. The name `intOrIdentifier` is read as the declared
 * base type when that is `integer` or `identifier`, and in a record as `integer` for a number and `identifier` for a
 * string.
 *
 * @param json - The parsed JSON.
 * @param declaration - The cardinality and base type of the variable; the JSON must have them.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when `json` is not the JSON of a value of the declaration, has years or months in a duration, or
 * has inline file data, or when `declaration` is not a declaration.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, JSON binding}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function fromJsonValue(json: unknown, declaration: ValueDeclaration): Value | null {
  const declared = readDeclaration(declaration);
  if (declared.cardinality === "single") {
    const { base } = parseWith(singleSchema, json, "The JSON of a single value");
    return base === null ? null : decodeSingle(base, "The base of a single value", declared.baseType);
  }
  if (declared.cardinality === "record") {
    const { record } = parseWith(recordSchema, json, "The JSON of a record");
    return record === null ? null : decodeRecord(record);
  }
  const { list } = parseWith(listSchema, json, `The JSON of a ${declared.cardinality} container`);
  return list === null ? null : decodeList(list, declared.cardinality, declared.baseType);
}
