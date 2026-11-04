import { checkRecord, checkString } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { decodePciValue, encodePciValue } from "@assesskit/runtime/pci";
import {
  decodeBase64,
  encodeBase64,
  type FileValue,
  type JsonValue,
  type Value,
  type ValueDeclaration,
} from "@assesskit/runtime/values";
import { isFileValue } from "../internal.js";

/**
 * The value of a variable with its declaration, which the JSON of the portable custom interaction binding needs to be
 * written and read.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export interface PciVariable {
  /** The value, or `null` for NULL. */
  readonly value: Value | null;
  /** The cardinality and base type of the variable. */
  readonly declaration: ValueDeclaration;
}

/**
 * The host's storage of the files that a portable custom interaction reads and writes.
 *
 * @remarks
 * A file value only refers to its bytes, and the codec of the runtime calls its callbacks synchronously, so the host's
 * storage is asynchronous here: the bytes of the files that go to the interaction are read before it starts, and the files
 * it gives are stored before the player gets its response.
 */
export interface PciFiles {
  /**
   * Reads the bytes of a stored file.
   *
   * @param file - The file value.
   * @returns The bytes.
   */
  read(file: FileValue): Promise<Uint8Array>;
  /**
   * Stores the bytes of a file that an interaction gave, and resolves with the file value that refers to them.
   *
   * @param bytes - The bytes.
   * @param mimeType - Their media type.
   * @param fileName - The name of the file, if it has one.
   * @returns The file value.
   */
  upload(bytes: Blob, mimeType: string, fileName?: string): Promise<FileValue>;
}

/** Decodes the base64 of an inline file; text that is not base64 is a `DataError`. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bytes = decodeBase64(text);
  if (bytes === undefined) throw new DataError("The data of a file must be base64.");
  return bytes;
}

/** Returns the file values in a value, wherever its cardinality puts them. */
function filesOf(value: Value | null): readonly FileValue[] {
  if (value === null) return [];
  const primitives =
    value.cardinality === "record"
      ? [...value.fields.values()].map((field) => field.value)
      : value.cardinality === "single"
        ? [value.value]
        : value.values;
  return primitives.filter(isFileValue);
}

/** Returns the bytes of the files as base64, by reference, for the `load` callback of the codec. */
function loader(loaded: ReadonlyMap<string, string>): (reference: string) => string {
  return (reference) => {
    const data = loaded.get(reference);
    if (data === undefined) throw new DataError(`The file ${JSON.stringify(reference)} was not read.`);
    return data;
  };
}

/**
 * Checks that a variable is one: the value has the declared cardinality and base type.
 *
 * @remarks
 * The files are not read.
 *
 * @param variable - The value to check.
 * @throws `DataError` when it is not.
 */
export function checkVariable(variable: unknown): asserts variable is PciVariable {
  checkRecord(variable, "A variable must be an object with a value and a declaration");
  // The codec checks the value against the declaration, and the declaration itself.
  encodePciValue(variable.value as Value | null, variable.declaration as ValueDeclaration, { load: () => "" });
}

/**
 * Writes a variable as the JSON that an interaction reads.
 *
 * @remarks
 * The bytes of each file value are read from the host's storage first, and the codec puts them inline as base64.
 *
 * @param variable - The variable, checked with {@link checkVariable}.
 * @param files - The host's storage.
 * @returns The JSON.
 * @throws `DataError` when the variable is not valid. The error of `files.read` passes through.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export async function encodeVariable(variable: PciVariable, files: PciFiles): Promise<JsonValue> {
  const loaded = new Map<string, string>();
  for (const file of filesOf(variable.value)) loaded.set(file.reference, encodeBase64(await files.read(file)));
  return encodePciValue(variable.value, variable.declaration, { load: loader(loaded) });
}

/** The reference of a file that is not stored yet: the value read with it is only checked, and then discarded. */
const PENDING_REFERENCE = "pending";

/** A file of the JSON of an interaction, inline: the arguments of the `store` callback of the codec. */
interface InlineFile {
  readonly data: string;
  readonly mimeType: string;
  readonly fileName: string | undefined;
}

const keyOf = ({ data, mimeType, fileName }: InlineFile): string => JSON.stringify([mimeType, fileName ?? null, data]);

async function upload({ data, mimeType, fileName }: InlineFile, files: PciFiles): Promise<string> {
  const blob = new Blob([fromBase64(data)], { type: mimeType });
  const stored = await (fileName === undefined ? files.upload(blob, mimeType) : files.upload(blob, mimeType, fileName));
  checkRecord(stored, "The file that upload resolves with must be an object");
  checkString(stored.reference, "The reference of an uploaded file");
  return stored.reference;
}

/** Takes the reference of the next file in the order that the codec stores them. */
function next(references: string[]): string {
  const reference = references.shift();
  if (reference === undefined) throw new DataError("The response holds more files than it did when it was read.");
  return reference;
}

/**
 * Writes the JSON of a response as text that compares as the value it holds, without storing its files.
 *
 * @remarks
 * Either form of NULL gives the same text, and a file counts by its type, its name and its bytes.
 *
 * @param json - The parsed JSON, or `null` when the interaction has no response.
 * @param declaration - The cardinality and base type of the variable.
 * @returns The text, or `undefined` for JSON that is not a value of the declaration.
 */
export function responseKey(json: unknown, declaration: ValueDeclaration): string | undefined {
  try {
    const value =
      json === null
        ? null
        : decodePciValue(json, declaration, {
            store: (data, mimeType, fileName) => JSON.stringify([mimeType, fileName ?? null, data]),
          });
    return JSON.stringify(value, (_key, member: unknown) => (member instanceof Map ? [...member] : member));
  } catch (error) {
    if (error instanceof DataError) return undefined;
    throw error;
  }
}

/**
 * Reads the JSON that an interaction gave for a variable, and stores its inline files.
 *
 * @param json - The parsed JSON, or `null` when the interaction has no response.
 * @param declaration - The cardinality and base type of the variable.
 * @returns The value, or `null` for NULL.
 * @throws `DataError` when the JSON is not the JSON of a value of the declaration or has a file that is not base64.
 */
export type ResponseDecoder = (json: unknown, declaration: ValueDeclaration) => Promise<Value | null>;

/**
 * Builds the decoder of the responses of one interaction.
 *
 * @remarks
 * The codec of the runtime stores a file synchronously, so a decoder reads the JSON twice: once to find and check the
 * inline files, then, after the host has stored them, to build the value with their references. A file that an earlier
 * response of the decoder held is not stored again, since an interaction that draws gives the same image with every
 * change.
 *
 * @param files - The host's storage.
 * @returns The decoder.
 */
export function createResponseDecoder(files: PciFiles): ResponseDecoder {
  let known = new Map<string, string>();
  return async (json, declaration) => {
    if (json === null) return null;
    const found: InlineFile[] = [];
    decodePciValue(json, declaration, {
      store: (data, mimeType, fileName) => {
        found.push({ data, mimeType, fileName });
        return PENDING_REFERENCE;
      },
    });
    const used = new Map<string, string>();
    const references: string[] = [];
    for (const file of found) {
      const key = keyOf(file);
      const reference = used.get(key) ?? known.get(key) ?? (await upload(file, files));
      used.set(key, reference);
      references.push(reference);
    }
    known = used;
    return decodePciValue(json, declaration, { store: () => next(references) });
  };
}
