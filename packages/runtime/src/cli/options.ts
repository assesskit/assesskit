import { checkFunction, checkOptions, checkString } from "../checks.js";
import { SCHEMA_FILES } from "../node/index.js";
import { defaultSchemaDirectory } from "./schema-directory.js";

/** Options of {@link runCli}: what the command line touches besides its arguments. */
export interface RunCliOptions {
  /** Writes text to the standard output, where the report of `validate` goes. Default: `process.stdout.write`. */
  readonly stdout?: (text: string) => void;
  /** Writes text to the standard error, where errors go. Default: `process.stderr.write`. */
  readonly stderr?: (text: string) => void;
  /**
   * The directory of the schemas when no option names one. Default: `assesskit/schemas/<version>` in the user cache directory of
   * the platform, where `<version>` is the start of the SHA-256 of `SCHEMA_FILES`.
   */
  readonly schemaDirectory?: string;
  /** Downloads an address for `schemas fetch`. Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Checks the options of {@link runCli} and returns them with their defaults.
 *
 * @throws `DataError` when they are not an object, or an option has the wrong type.
 */
export function resolveOptions(options: RunCliOptions): Required<RunCliOptions> {
  checkOptions(options);
  const {
    stdout = (text) => void process.stdout.write(text),
    stderr = (text) => void process.stderr.write(text),
    schemaDirectory = defaultSchemaDirectory(SCHEMA_FILES),
    fetch: fetchUrl = fetch,
  } = options;
  checkFunction(stdout, "The option stdout must be a function of a text");
  checkFunction(stderr, "The option stderr must be a function of a text");
  checkString(schemaDirectory, "The option schemaDirectory");
  checkFunction(fetchUrl, "The option fetch must be a function of an address");
  return { stdout, stderr, schemaDirectory, fetch: fetchUrl };
}
