import { parseArgs } from "node:util";
import { AssesskitError } from "../errors.js";

/** The commands, as `assesskit --help` and every usage error print them. */
export const USAGE = `Usage:
  assesskit validate <path> [--schemas <dir>] [--format text|json]
  assesskit schemas fetch [--dir <dir>]
  assesskit --help
`;

/** The error for a command line that does not follow {@link USAGE}. */
export class UsageError extends AssesskitError {
  /** Error class name. */
  override name = "UsageError";
}

/** The options of a command: the strings that follow `--name`. */
type StringOptions = Readonly<Record<string, { readonly type: "string" }>>;

/**
 * Parses the arguments of a command that has the given options, each taking a string.
 *
 * @throws `UsageError` when an option is unknown or lacks its value.
 */
export function parseCommand<TOptions extends StringOptions>(
  args: readonly string[],
  options: TOptions,
): { readonly values: { [TName in keyof TOptions]?: string }; readonly positionals: readonly string[] } {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true });
  } catch (error) {
    // `parseArgs` reports a bad command line with a TypeError.
    if (error instanceof TypeError) throw new UsageError(error.message);
    throw error;
  }
}
