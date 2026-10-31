import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  closeBuffer,
  openBuffer,
  readBuffer,
  XmlDocument,
  type XmlInputProvider,
  XsdValidator,
  xmlCleanupInputProvider,
  xmlRegisterInputProvider,
} from "libxml2-wasm";
import { checkString } from "../checks.js";
import { AssesskitError, DataError } from "../errors.js";
import { SCHEMA_FILES, type SchemaFile } from "./schema-files.js";

/**
 * The schemas of {@link SCHEMA_FILES} in one directory, compiled when a document first needs them and reused for every
 * document after that. Close it to free the compiled schemas.
 */
export interface SchemaSet {
  /** The directory the schemas are read from. */
  readonly directory: string;
  /** Frees the compiled schemas. The set cannot validate afterwards; closing it again does nothing. */
  close(): void;
}

interface State {
  readonly validators: Map<string, XsdValidator>;
  closed: boolean;
}

const STATES = new WeakMap<SchemaSet, State>();

const SCHEMAS_BY_URL: ReadonlyMap<string, SchemaFile> = new Map(SCHEMA_FILES.map((schema) => [schema.url, schema]));

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads a schema and checks its hash, so that a changed file is never compiled. */
function readVerified(directory: string, schema: SchemaFile): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(join(directory, schema.file));
  } catch (error) {
    throw new DataError(`The schema ${schema.file} cannot be read from ${directory}: ${reasonOf(error)}.`);
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== schema.sha256) {
    throw new DataError(
      `The schema ${schema.file} in ${directory} has the SHA-256 ${hash}, not the pinned ${schema.sha256}.`,
    );
  }
  return bytes;
}

/** Serves the pinned schemas to libxml2 for the `import` and `include` of the schema it compiles. */
function schemaProvider(directory: string): XmlInputProvider {
  return {
    match: (url) => SCHEMAS_BY_URL.has(url),
    open: (url) => {
      const schema = SCHEMAS_BY_URL.get(url);
      return schema === undefined ? undefined : openBuffer(readVerified(directory, schema));
    },
    read: readBuffer,
    close: (descriptor) => {
      closeBuffer(descriptor);
      return true;
    },
  };
}

/**
 * Compiles a schema. libxml2-wasm keeps its input providers in one table for the process, so the provider is
 * registered for the compilation only and every provider is removed afterwards.
 */
function compile(directory: string, schema: SchemaFile): XsdValidator {
  if (!xmlRegisterInputProvider(schemaProvider(directory))) {
    throw new AssesskitError(
      "libxml2-wasm has no room for another input provider: remove the ones your program registered.",
    );
  }
  try {
    const document = XmlDocument.fromBuffer(readVerified(directory, schema), { url: schema.url });
    try {
      return XsdValidator.fromDoc(document);
    } finally {
      document.dispose();
    }
  } finally {
    xmlCleanupInputProvider();
  }
}

/**
 * Loads the schemas of {@link SCHEMA_FILES} from a directory, after checking that every file is there with its pinned
 * SHA-256. A schema is compiled the first time a document needs it, and the compiled schema is reused afterwards.
 *
 * @param directory - The directory that holds the files under their `file` names.
 * @throws `DataError` when the argument is not a string, or a file is missing, unreadable or changed.
 */
export async function loadSchemaSet(directory: string): Promise<SchemaSet> {
  checkString(directory, "The schema directory");
  const problems: string[] = [];
  for (const schema of SCHEMA_FILES) {
    try {
      readVerified(directory, schema);
    } catch (error) {
      problems.push(reasonOf(error));
    }
  }
  if (problems.length > 0) {
    const list = problems.map((problem) => `\n- ${problem}`).join("");
    throw new DataError(
      `The directory ${directory} does not hold the pinned schemas of SCHEMA_FILES:${list}\nDownload each url of SCHEMA_FILES to its file name.`,
    );
  }
  const state: State = { validators: new Map(), closed: false };
  const set: SchemaSet = {
    directory,
    close: () => {
      for (const validator of state.validators.values()) validator.dispose();
      state.validators.clear();
      state.closed = true;
    },
  };
  STATES.set(set, state);
  return set;
}

/**
 * Returns the state of a set that is open.
 *
 * @throws `DataError` when the argument is not a set that {@link loadSchemaSet} returned, or the set is closed.
 */
function openState(set: SchemaSet): State {
  const state = STATES.get(set);
  if (state === undefined) throw new DataError("The schemas must be a SchemaSet that loadSchemaSet returned.");
  if (state.closed) throw new DataError("The schema set is closed.");
  return state;
}

/**
 * Checks that a value is a set that is open.
 *
 * @throws `DataError` when it is not.
 */
export function checkSchemaSet(set: SchemaSet): void {
  openState(set);
}

/**
 * Returns the compiled validator of a schema, compiling it on first use.
 *
 * @throws `DataError` when the argument is not a set that {@link loadSchemaSet} returned, or the set is closed.
 */
export function validatorFor(set: SchemaSet, schema: SchemaFile): XsdValidator {
  const state = openState(set);
  let validator = state.validators.get(schema.file);
  if (validator === undefined) {
    validator = compile(set.directory, schema);
    state.validators.set(schema.file, validator);
  }
  return validator;
}
