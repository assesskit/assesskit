import { checkArray, checkString } from "../checks.js";
import { type RunCliOptions, resolveOptions } from "./options.js";
import { EXIT_CODES } from "./report.js";
import { schemasCommand } from "./schemas-command.js";
import { USAGE, UsageError } from "./usage.js";
import { validateCommand } from "./validate-command.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the command line of `assesskit` and returns its exit code; the caller sets it as the exit code of the process. The
 * commands are `validate`, which validates a package, a directory or an XML document, and `schemas fetch`, which
 * downloads the schemas. `docs/runtime/cli.md` lists their arguments.
 *
 * | Exit code | Meaning                                                                              |
 * | --------- | ------------------------------------------------------------------------------------ |
 * | 0         | The command succeeded, and `validate` found no issue with severity error.           |
 * | 1         | `validate` found an issue with severity error.                                       |
 * | 2         | The arguments are wrong, the input is unreadable or refused, or schemas are missing. |
 *
 * @param args - The arguments after the program name, such as `process.argv.slice(2)`.
 * @param options - See {@link RunCliOptions}.
 * @throws `DataError` when an argument or an option has the wrong type.
 */
export async function runCli(args: readonly string[], options: RunCliOptions = {}): Promise<number> {
  checkArray(args, "The arguments must be an array");
  for (const argument of args) checkString(argument, "An argument");
  const resolved = resolveOptions(options);
  const [command, ...rest] = args;
  try {
    if (command === "--help" || command === "-h") {
      resolved.stdout(USAGE);
      return EXIT_CODES.valid;
    }
    if (command === "validate") return await validateCommand(rest, resolved);
    if (command === "schemas") return await schemasCommand(rest, resolved);
    throw new UsageError(
      command === undefined ? "A command is required." : `The command ${JSON.stringify(command)} is unknown.`,
    );
  } catch (error) {
    // A command line that fails does not exit with 1, which means that the content has errors.
    resolved.stderr(`assesskit: ${messageOf(error)}\n${error instanceof UsageError ? `\n${USAGE}` : ""}`);
    return EXIT_CODES.failed;
  }
}
