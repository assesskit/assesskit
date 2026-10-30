import * as v from "valibot";
import { checkFunction, checkRecord, checkString, isRecord, parseWith } from "../checks.js";
import { fromJsonValue, type JsonValue, toJsonValue, type Value, type ValueDeclaration } from "../values/index.js";

/**
 * The JSON that a portable custom interaction exchanges for a variable (BPIG App. C): `{ "base": ... }` for a single
 * value, `{ "list": ... }` for a container and `{ "record": ... }` for a record. A file is `{ "data", "mime", "name" }`
 * with the bytes in `data` as base64.
 */
export type PciJson = JsonValue;

/** Reads the files of values for {@link encodePciValue}. The host stores the bytes; a value only refers to them (D7). */
export interface PciFileLoader {
  /** Returns the bytes of the stored file that `reference` names, as base64. */
  readonly load: (reference: string) => string;
}

/** Stores the files of values for {@link decodePciValue}. The host keeps the bytes; a value only refers to them (D7). */
export interface PciFileStore {
  /** Stores a file given as base64, with its MIME type and optional name, and returns its reference. */
  readonly store: (data: string, mimeType: string, fileName?: string) => string;
}

type Convert = (file: unknown) => unknown;

/** Applies `convert` to the content of a typed object `{ "<base type>": ... }` when it holds a file. */
function convertTyped(typed: unknown, convert: Convert): unknown {
  return isRecord(typed) && Object.hasOwn(typed, "file") ? { ...typed, file: convert(typed.file) } : typed;
}

/** Applies `convert` to every file of a list `{ "file": [...] }`. */
function convertList(typed: unknown, convert: Convert): unknown {
  return isRecord(typed) && Array.isArray(typed.file) ? { ...typed, file: typed.file.map(convert) } : typed;
}

/** Applies `convert` to the file of every field of a record `[{ "name", "base" }, ...]` that has one. */
function convertFields(fields: unknown, convert: Convert): unknown {
  if (!Array.isArray(fields)) return fields;
  return fields.map((field) => (isRecord(field) ? { ...field, base: convertTyped(field.base, convert) } : field));
}

/** Applies `convert` to every file in the JSON of a value, wherever App. C puts one. Other properties are kept. */
function convertFiles(json: PciJson, convert: Convert): PciJson {
  if ("base" in json) return { ...json, base: convertTyped(json.base, convert) };
  if ("list" in json) return { ...json, list: convertList(json.list, convert) };
  return { ...json, record: convertFields(json.record, convert) };
}

/** Returns whether the JSON is an object with the property that names the cardinality: `base`, `list` or `record`. */
function isPciJson(json: unknown): json is PciJson {
  return isRecord(json) && ["base", "list", "record"].some((key) => Object.hasOwn(json, key));
}

const inlineFileSchema = v.strictObject({ data: v.string(), mime: v.string(), name: v.optional(v.string()) });

/** Turns the file of the JSON of a value, a reference as `toJsonValue` writes it, into App. C's inline file. */
function inlineFile(file: unknown, files: PciFileLoader): unknown {
  checkRecord(file, "A file must be an object");
  const { reference, mime, name } = file;
  checkString(reference, "The reference of a file");
  const data: unknown = files.load(reference);
  checkString(data, `The base64 data that the function load returns for the file ${JSON.stringify(reference)}`);
  return { data, mime, ...(name === undefined ? {} : { name }) };
}

/** Turns the inline file of a PCI into the reference of a file in the host's storage. */
function storedFile(file: unknown, files: PciFileStore): unknown {
  const { data, mime, name } = parseWith(inlineFileSchema, file, "A file");
  const reference: unknown = name === undefined ? files.store(data, mime) : files.store(data, mime, name);
  checkString(reference, "The reference that the function store returns");
  return { reference, mime, ...(name === undefined ? {} : { name }) };
}

/**
 * Writes the value of a variable as the JSON that a portable custom interaction reads (BPIG App. C.1 to C.3):
 * `toJsonValue`, with each file as `{ "data", "mime", "name" }`, its bytes read through the host. A duration is
 * `PT<seconds>S` and a float that JSON cannot carry is a string (see `toJsonValue`). NULL is `{ "base": null }`,
 * `{ "list": null }` or `{ "record": null }`, by the cardinality of the declaration.
 *
 * @param value - The value, or `null` for NULL.
 * @param declaration - The cardinality and base type of the variable; the value must have them.
 * @param files - Reads the stored bytes of a file value. It is called once for each file in the value.
 * @throws `DataError` when `value` is not a value or `null`, `declaration` is not a declaration, the value does not have
 * the declared type, `files` has no function `load`, or `load` returns anything but a string.
 */
export function encodePciValue(value: Value | null, declaration: ValueDeclaration, files: PciFileLoader): PciJson {
  checkRecord(files, "The files must be an object with a function load");
  checkFunction(files.load, "The files must be an object with a function load");
  return convertFiles(toJsonValue(value, declaration), (file) => inlineFile(file, files));
}

/**
 * Reads the JSON that a portable custom interaction gives for a variable (BPIG App. C.1 to C.3): `fromJsonValue`, with
 * each file `{ "data", "mime", "name" }` stored through the host and replaced by its reference. NULL, an empty list, an
 * empty record and the empty string are NULL, a NULL field of a record is left out (G37), and `intOrIdentifier` is read
 * as an integer for a number and an identifier for a string (G38).
 *
 * @param json - The parsed JSON, which is untrusted.
 * @param declaration - The cardinality and base type of the variable; the JSON must have them.
 * @param files - Stores the bytes of a file and returns its reference. It is called once for each file in the JSON.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when `json` is not the JSON of a value of the declaration, has a duration with years or months
 * (G14), or has a file that is not `{ "data", "mime", "name" }` with strings; when `declaration` is not a declaration;
 * when `files` has no function `store`; or when `store` returns anything but a string.
 */
export function decodePciValue(json: unknown, declaration: ValueDeclaration, files: PciFileStore): Value | null {
  checkRecord(files, "The files must be an object with a function store");
  checkFunction(files.store, "The files must be an object with a function store");
  return fromJsonValue(isPciJson(json) ? convertFiles(json, (file) => storedFile(file, files)) : json, declaration);
}
