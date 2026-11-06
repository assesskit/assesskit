import { checkFunction, checkRecord, checkString } from "../checks.js";
import type { JsonValue, Value, ValueDeclaration } from "../values/index.js";
import { writeJsonValue } from "../values/internal.js";
import { convertFiles } from "./convert-files.js";
import type { PciFileLoader } from "./file-callbacks.js";

/** Turns the file of the JSON of a value, a reference as `writeJsonValue` writes it, into the inline file of a PCI. */
function inlineFile(file: unknown, files: PciFileLoader): unknown {
  checkRecord(file, "A file must be an object");
  const { reference, mime, name } = file;
  checkString(reference, "The reference of a file");
  const data: unknown = files.load(reference);
  checkString(data, `The base64 data that the function load returns for the file ${JSON.stringify(reference)}`);
  return { data, mime, ...(name === undefined ? {} : { name }) };
}

/**
 * Writes the value of a variable as the JSON that a portable custom interaction reads.
 *
 * @remarks
 * It is the JSON form of a `JsonValue` with each file as `{ "data", "mime", "name" }`, its bytes read through the host. A duration is
 * `PT<seconds>S` and a float that JSON cannot carry is a string. NULL is `{ "base": null }`, `{ "list": null }` or
 * `{ "record": null }`, by the cardinality of the declaration.
 *
 * @param value - The value, or `null` for NULL.
 * @param declaration - The cardinality and base type of the variable; the value must have them.
 * @param files - Reads the stored bytes of a file value. It is called once for each file in the value.
 * @returns The JSON of the value.
 * @throws `DataError` when `value` is not a value or `null`, `declaration` is not a declaration, the value does not
 * have the declared type, `files` has no function `load`, or `load` returns anything but a string.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, JSON binding of values}
 * @example
 * ```ts
 * import { decodePciValue, encodePciValue } from "@assesskit/runtime/pci";
 * import { buildContainer } from "@assesskit/runtime/values";
 *
 * const numbers = buildContainer("multiple", "integer", [3, 4]);
 * encodePciValue(numbers, { cardinality: "multiple", baseType: "integer" }, { load: () => "" }); // => { list: { integer: [3, 4] } }
 * decodePciValue({ base: { integer: 3 } }, { cardinality: "single", baseType: "integer" }, { store: () => "" });
 * // => { cardinality: "single", baseType: "integer", value: 3 }
 * ```
 */
export function encodePciValue(value: Value | null, declaration: ValueDeclaration, files: PciFileLoader): JsonValue {
  checkRecord(files, "The files must be an object with a function load");
  checkFunction(files.load, "The files must be an object with a function load");
  return convertFiles(writeJsonValue(value, declaration), (file) => inlineFile(file, files));
}
