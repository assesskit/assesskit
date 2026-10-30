import { decodePciValue, encodePciValue, type PciJson } from "@luthfanwakan/olah/pci";
import type { FileValue, Primitive, Value, ValueDeclaration } from "@luthfanwakan/olah/values";
import { checkRecord, checkString } from "../../checks.js";
import { DataError } from "../../errors.js";

/** The value of a variable with its declaration, which the JSON of BPIG App. C needs to be written and read. */
export interface PciVariable {
  /** The value, or `null` for NULL. */
  readonly value: Value | null;
  /** The cardinality and base type of the variable. */
  readonly declaration: ValueDeclaration;
}

/**
 * The host's storage of the files that a portable custom interaction reads and writes. A file value only refers to its
 * bytes (olah D7), and the codec of olah calls its callbacks synchronously, so the host's storage is asynchronous here:
 * the bytes of the files that go to the interaction are read before it starts, and the files it gives are stored before
 * the player gets its response.
 */
export interface PciFiles {
  /** Reads the bytes of a stored file. */
  read(file: FileValue): Promise<Uint8Array>;
  /** Stores the bytes of a file that an interaction gave, and resolves with the file value that refers to them. */
  upload(bytes: Blob, mimeType: string, fileName?: string): Promise<FileValue>;
}

/** The characters that `String.fromCharCode` takes at once; more would overflow the stack. */
const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  } catch {
    throw new DataError("The data of a file must be base64.");
  }
}

const isFile = (primitive: Primitive): primitive is FileValue =>
  typeof primitive === "object" && "reference" in primitive;

/** Returns the file values in a value, wherever its cardinality puts them. */
function filesOf(value: Value | null): readonly FileValue[] {
  if (value === null) return [];
  const primitives =
    value.cardinality === "record"
      ? [...value.fields.values()].map((field) => field.value)
      : value.cardinality === "single"
        ? [value.value]
        : value.values;
  return primitives.filter(isFile);
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
 * Checks that a variable is one: the value has the declared cardinality and base type. The files are not read.
 *
 * @throws `DataError` when it is not.
 */
export function checkVariable(variable: unknown): asserts variable is PciVariable {
  checkRecord(variable, "A variable must be an object with a value and a declaration");
  // The codec checks the value against the declaration, and the declaration itself.
  encodePciValue(variable.value as Value | null, variable.declaration as ValueDeclaration, { load: () => "" });
}

/**
 * Writes a variable as the JSON that an interaction reads (BPIG App. C). The bytes of each file value are read from the
 * host's storage first, and the codec puts them inline as base64.
 *
 * @param variable - The variable, checked with {@link checkVariable}.
 * @param files - The host's storage.
 * @throws `DataError` when the variable is not valid. The error of `files.read` passes through.
 */
export async function encodeVariable(variable: PciVariable, files: PciFiles): Promise<PciJson> {
  const loaded = new Map<string, string>();
  for (const file of filesOf(variable.value)) loaded.set(file.reference, toBase64(await files.read(file)));
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
 * Reads the JSON that an interaction gave for a variable, and stores its inline files.
 *
 * @param json - The parsed JSON, or `null` when the interaction has no response.
 * @param declaration - The cardinality and base type of the variable.
 * @returns the value, or `null` for NULL.
 * @throws `DataError` when the JSON is not the JSON of a value of the declaration or has a file that is not base64.
 */
export type ResponseDecoder = (json: unknown, declaration: ValueDeclaration) => Promise<Value | null>;

/**
 * Builds the decoder of the responses of one interaction. The codec of olah stores a file synchronously, so a decoder
 * reads the JSON twice: once to find and check the inline files, then, after the host has stored them, to build the value
 * with their references. A file that an earlier response of the decoder held is not stored again, since an interaction
 * that draws gives the same image with every change.
 *
 * @param files - The host's storage.
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
