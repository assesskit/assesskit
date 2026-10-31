import * as v from "valibot";
import { checkFunction, checkRecord, checkString, parseWith } from "../checks.js";
import { fromJsonValue, type Value, type ValueDeclaration } from "../values/index.js";
import { convertFiles } from "./convert-files.js";
import type { PciFileStore } from "./file-callbacks.js";
import { isPciJson } from "./pci-json.js";

const inlineFileSchema = v.strictObject({ data: v.string(), mime: v.string(), name: v.optional(v.string()) });

/** Turns the inline file of a PCI into the reference of a file in the host's storage. */
function storedFile(file: unknown, files: PciFileStore): unknown {
  const { data, mime, name } = parseWith(inlineFileSchema, file, "A file");
  const reference: unknown = name === undefined ? files.store(data, mime) : files.store(data, mime, name);
  checkString(reference, "The reference that the function store returns");
  return { reference, mime, ...(name === undefined ? {} : { name }) };
}

/**
 * Reads the JSON that a portable custom interaction gives for a variable.
 *
 * @remarks
 * It is `fromJsonValue` with each file `{ "data", "mime", "name" }` stored through the host and replaced by its
 * reference. NULL, an empty list, an empty record and the empty string are NULL, a NULL field of a record is left out,
 * and `intOrIdentifier` is read as an integer for a number and an identifier for a string. A duration with years or
 * months is refused.
 *
 * @param json - The parsed JSON, which is untrusted.
 * @param declaration - The cardinality and base type of the variable; the JSON must have them.
 * @param files - Stores the bytes of a file and returns its reference. It is called once for each file in the JSON.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when `json` is not the JSON of a value of the declaration, has a duration with years or months,
 * or has a file that is not `{ "data", "mime", "name" }` with strings; when `declaration` is not a declaration; when
 * `files` has no function `store`; or when `store` returns anything but a string.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, JSON binding of values}
 * @see {@link https://github.com/assesskit/assesskit/blob/main/docs/runtime/spec-gaps.md | Spec gaps}
 */
export function decodePciValue(json: unknown, declaration: ValueDeclaration, files: PciFileStore): Value | null {
  checkRecord(files, "The files must be an object with a function store");
  checkFunction(files.store, "The files must be an object with a function store");
  return fromJsonValue(isPciJson(json) ? convertFiles(json, (file) => storedFile(file, files)) : json, declaration);
}
