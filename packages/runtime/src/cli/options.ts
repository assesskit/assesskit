import * as v from "valibot";
import { functionSchema, parseWith, strictRecord } from "../checks.js";
import { defaultSchemaDirectory } from "../node/index.js";

const writeFunctionSchema = functionSchema<(text: string) => void>();

const runCliOptionsSchema = strictRecord({
  stdout: v.optional(writeFunctionSchema, (): ((text: string) => void) => (text) => void process.stdout.write(text)),
  stderr: v.optional(writeFunctionSchema, (): ((text: string) => void) => (text) => void process.stderr.write(text)),
  schemaDirectory: v.optional(v.string(), defaultSchemaDirectory),
  fetch: v.optional(functionSchema<typeof fetch>(), () => fetch),
});

/** Options of {@link runCli}: what the command line touches besides its arguments. */
export interface RunCliOptions {
  /**
   * Writes text to the standard output, where the report of `validate` goes.
   *
   * @defaultValue `process.stdout.write`
   */
  readonly stdout?: (text: string) => void;
  /**
   * Writes text to the standard error, where errors go.
   *
   * @defaultValue `process.stderr.write`
   */
  readonly stderr?: (text: string) => void;
  /**
   * The directory of the schemas when no option names one.
   *
   * @defaultValue `assesskit/schemas/<version>` in the user cache directory of the platform, where `<version>` is the
   * start of the SHA-256 of `SCHEMA_FILES`
   */
  readonly schemaDirectory?: string;
  /**
   * Downloads an address for `schemas fetch`.
   *
   * @defaultValue the global `fetch`
   */
  readonly fetch?: typeof fetch;
}

/**
 * Checks the options of {@link runCli} and returns them with their defaults.
 *
 * @param options - The options of `runCli`.
 * @returns The options with every default set.
 * @throws `DataError` when they are not an object, or an option has the wrong type.
 */
export function resolveOptions(options: RunCliOptions): Required<RunCliOptions> {
  return parseWith(runCliOptionsSchema, options, "The options object");
}
