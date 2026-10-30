import { checkRecord, describe } from "../checks.js";
import { DataError } from "../errors.js";
import { type BaseType, checkBaseType, isBaseType } from "./base-type.js";
import { type Cardinality, checkCardinality } from "./cardinality.js";
import { formatIsoDuration, parseIsoDuration } from "./duration.js";
import { formatDouble } from "./lexical.js";
import { isFileValue, isTuple, type Primitive } from "./primitive.js";
import {
  buildContainer,
  buildRecord,
  buildSingle,
  type ContainerValue,
  normalizeValue,
  type RecordValue,
  type SingleValue,
  type Value,
} from "./value.js";

/**
 * The JSON of a value in the binding of BPIG Appendix C: `{ "base": ... }` for a single value, `{ "list": ... }` for a
 * `multiple` or `ordered` container and `{ "record": ... }` for a record. A NULL has `null` in place of the content.
 */
export type JsonValue =
  | {
      /** The content of a single value: `{ "<base type>": ... }`, or `null`. */
      readonly base: unknown;
    }
  | {
      /** The content of a container: `{ "<base type>": [...] }`, or `null`. */
      readonly list: unknown;
    }
  | {
      /** The fields of a record: `[{ "name": ..., "base": ... }, ...]`, or `null`. */
      readonly record: unknown;
    };

/** What a variable declaration says about its values: the cardinality and, except for a record, the base type. */
export interface ValueDeclaration {
  /** The cardinality. */
  readonly cardinality: Cardinality;
  /** The base type; a record has none, and one given for a record is checked and ignored. */
  readonly baseType?: BaseType;
}

/** A declaration read and checked: a record has no base type. */
type Declared =
  | { readonly cardinality: "record" }
  | { readonly cardinality: "single" | "multiple" | "ordered"; readonly baseType: BaseType };

/**
 * The numbers that JSON cannot carry, with the `xs:double` spelling that stands for them. JSON has no `NaN` or infinity,
 * and `JSON.stringify` writes them as `null` and `-0` as `0`.
 */
const NON_JSON_NUMBERS: ReadonlyMap<string, number> = new Map([
  ["NaN", Number.NaN],
  ["INF", Number.POSITIVE_INFINITY],
  ["-INF", Number.NEGATIVE_INFINITY],
  ["-0", -0],
]);

/** The name that App. C gives a base type that is an integer or an identifier, by the JSON type of the value (G38). */
const INT_OR_IDENTIFIER = "intOrIdentifier";

function readDeclaration(declaration: unknown): Declared {
  checkRecord(declaration, "The declaration must be an object");
  const { cardinality, baseType } = declaration;
  checkCardinality(cardinality);
  if (cardinality === "record") {
    if (baseType !== undefined) checkBaseType(baseType);
    return { cardinality };
  }
  checkBaseType(baseType);
  return { cardinality, baseType };
}

const isPlainNumber = (value: number): boolean => Number.isFinite(value) && !Object.is(value, -0);

function encodePrimitive(baseType: BaseType, primitive: Primitive): unknown {
  if (typeof primitive === "number") {
    if (isPlainNumber(primitive)) return baseType === "duration" ? formatIsoDuration(primitive) : primitive;
    return formatDouble(primitive);
  }
  if (isTuple(primitive)) return [...primitive];
  if (isFileValue(primitive)) {
    const { reference, mimeType, fileName } = primitive;
    return fileName === undefined ? { reference, mime: mimeType } : { reference, mime: mimeType, name: fileName };
  }
  return primitive;
}

function encodeSingle(value: SingleValue): unknown {
  return { [value.baseType]: encodePrimitive(value.baseType, value.value) };
}

function encodeContainer(value: ContainerValue): unknown {
  return { [value.baseType]: value.values.map((primitive) => encodePrimitive(value.baseType, primitive)) };
}

function encodeRecord(value: RecordValue): unknown {
  return [...value.fields].map(([name, field]) => ({ name, base: encodeSingle(field) }));
}

/** The JSON of NULL for a cardinality. */
function nullJson(cardinality: Cardinality): JsonValue {
  if (cardinality === "single") return { base: null };
  return cardinality === "record" ? { record: null } : { list: null };
}

/**
 * Writes a value in the JSON binding of BPIG Appendix C.1 to C.3, which PCIs use. Differences from the appendix:
 *
 * - A `file` is `{ "reference", "mime", "name" }`, a reference to the bytes, instead of `{ "data", "mime", "name" }`
 *   with the bytes inline. `name` is left out when the file has none.
 * - A `duration` is `PT<seconds>S` with the shortest decimal for the seconds, never with years or months (G14).
 * - A `float` or `duration` that JSON cannot carry, `NaN`, `INF`, `-INF` and `-0`, is the string with that spelling.
 * - NULL needs the declaration, as `{ "base": null }`, `{ "list": null }` and `{ "record": null }` differ by cardinality.
 *
 * @param value - The value, or `null` for NULL.
 * @param declaration - The cardinality and base type of the variable; the value must have them.
 * @throws `DataError` when `value` is not a value or `null`, `declaration` is not a declaration, or they differ.
 */
export function toJsonValue(value: Value | null, declaration: ValueDeclaration): JsonValue {
  const declared = readDeclaration(declaration);
  if (value === null) return nullJson(declared.cardinality);
  const checked = normalizeValue(value);
  const differs =
    checked.cardinality !== declared.cardinality ||
    (checked.cardinality !== "record" && declared.cardinality !== "record" && checked.baseType !== declared.baseType);
  if (differs) {
    throw new DataError(`The value is ${describeKind(checked)}, but the declaration says ${describeKind(declared)}.`);
  }
  if (checked.cardinality === "single") return { base: encodeSingle(checked) };
  return checked.cardinality === "record" ? { record: encodeRecord(checked) } : { list: encodeContainer(checked) };
}

function describeKind(value: Declared | Value): string {
  return value.cardinality === "record" ? "a record" : `${value.cardinality} ${value.baseType}`;
}

/** Names the properties of an object for a message. */
const propertiesOf = (keys: readonly string[]): string => keys.map(describe).join(", ") || "none";

/** Returns the only property of an object, if it is named `key`. */
function onlyMember(json: unknown, key: string, what: string): unknown {
  checkRecord(json, `${what} must be an object with the one property ${describe(key)}`);
  const keys = Object.keys(json);
  if (keys.length !== 1 || keys[0] !== key) {
    throw new DataError(
      `${what} must be an object with the one property ${describe(key)}, found the properties ${propertiesOf(keys)}.`,
    );
  }
  return json[key];
}

/** Returns the base type for the App. C name `intOrIdentifier`, which names no base type (G38). */
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

/** Reads the JSON of a file into the properties of a `FileValue`; `normalizePrimitive` checks their types. */
function decodeFile(json: unknown): unknown {
  const expected = 'an object with the properties "reference", "mime" and optionally "name"';
  checkRecord(json, `A file must be ${expected}`);
  if (Object.hasOwn(json, "data")) {
    throw new DataError(
      'A file must be a reference, not inline "data": the host stores the bytes, and the file is the reference to them.',
    );
  }
  const unexpected = Object.keys(json).find((key) => !["reference", "mime", "name"].includes(key));
  if (unexpected !== undefined)
    throw new DataError(`A file must be ${expected}, found the property ${describe(unexpected)}.`);
  return { reference: json.reference, mimeType: json.mime, fileName: json.name };
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
  if (!Array.isArray(content)) {
    throw new DataError(`The list of base type ${baseType} must be an array, found ${describe(content)}.`);
  }
  return buildContainer(
    cardinality,
    baseType,
    content.map((item) => decodeItem(baseType, item)),
  );
}

function decodeRecord(json: unknown): RecordValue | null {
  if (!Array.isArray(json)) throw new DataError(`The fields of a record must be an array, found ${describe(json)}.`);
  const fields: [unknown, SingleValue][] = [];
  for (const entry of json) {
    checkRecord(entry, 'A field of a record must be an object with the properties "name" and "base"');
    if (!(Object.keys(entry).length === 2 && Object.hasOwn(entry, "name") && Object.hasOwn(entry, "base"))) {
      throw new DataError(
        `A field of a record must have exactly the properties "name" and "base", found ${propertiesOf(Object.keys(entry))}.`,
      );
    }
    // A field without a value is NULL, and a record holds no NULL, so it is left out (G37).
    const field =
      entry.base === null ? null : decodeSingle(entry.base, `The base of the field ${describe(entry.name)}`, undefined);
    if (field !== null) fields.push([entry.name, field]);
  }
  return buildRecord(fields);
}

/**
 * Reads a value from the JSON binding of BPIG Appendix C that `toJsonValue` writes. `{ "base": null }`, `{ "list": null }`
 * and `{ "record": null }` are NULL, and so are an empty list, an empty record and the empty string. A field of a record
 * that is NULL is left out (G37). The App. C name `intOrIdentifier` is read as the declared base type when that is
 * `integer` or `identifier`, and in a record as `integer` for a number and `identifier` for a string (G38).
 *
 * @param json - The parsed JSON.
 * @param declaration - The cardinality and base type of the variable; the JSON must have them.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when `json` is not the JSON of a value of the declaration, has years or months in a duration, or has
 * inline file data, or when `declaration` is not a declaration.
 */
export function fromJsonValue(json: unknown, declaration: ValueDeclaration): Value | null {
  const declared = readDeclaration(declaration);
  if (declared.cardinality === "single") {
    const body = onlyMember(json, "base", "The JSON of a single value");
    return body === null ? null : decodeSingle(body, "The base of a single value", declared.baseType);
  }
  if (declared.cardinality === "record") {
    const body = onlyMember(json, "record", "The JSON of a record");
    return body === null ? null : decodeRecord(body);
  }
  const body = onlyMember(json, "list", `The JSON of a ${declared.cardinality} container`);
  return body === null ? null : decodeList(body, declared.cardinality, declared.baseType);
}
