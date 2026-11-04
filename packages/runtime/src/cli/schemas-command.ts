import { AssesskitError } from "../errors.js";
import { SCHEMA_FILES } from "../node/index.js";
import { fetchSchemas } from "./fetch-schemas.js";
import type { RunCliOptions } from "./options.js";
import { EXIT_CODES } from "./report.js";
import { parseCommand, UsageError } from "./usage.js";

function countSchemas(count: number): string {
  return `${count} ${count === 1 ? "schema" : "schemas"}`;
}

/**
 * Runs `assesskit schemas fetch [--dir <dir>]`: downloads the files of `SCHEMA_FILES` that the directory lacks, checks
 * their SHA-256 and writes the result to the standard output. This is the only network access in the runtime.
 *
 * @param args - The arguments after `schemas`.
 * @param options - The options of the command line, with every default set.
 * @returns The exit code.
 * @throws `UsageError` when the arguments do not follow the command.
 * @throws `AssesskitError` when a schema cannot be downloaded or has another hash than the pinned one.
 */
export async function schemasCommand(args: readonly string[], options: Required<RunCliOptions>): Promise<number> {
  const [subcommand, ...rest] = args;
  if (subcommand !== "fetch") throw new UsageError('The command schemas takes the subcommand "fetch".');
  const { values, positionals } = parseCommand(rest, { dir: { type: "string" } });
  if (positionals.length > 0) throw new UsageError("The command schemas fetch takes no path.");
  const { dir = options.schemaDirectory } = values;
  const { downloaded, failures } = await fetchSchemas(dir, SCHEMA_FILES, {
    fetch: options.fetch,
    onRetry: (message) => options.stderr(`assesskit: ${message}\n`),
  });
  if (failures.length > 0) {
    const list = failures.map(({ reason }) => `\n- ${reason}`).join("");
    throw new AssesskitError(
      `${failures.length} of ${countSchemas(SCHEMA_FILES.length)} could not be downloaded to ${dir}:${list}\nRun the command again to download the rest.`,
    );
  }
  options.stdout(
    downloaded.length === 0
      ? `The schemas in ${dir} are current.\n`
      : `Downloaded ${countSchemas(downloaded.length)} to ${dir}.\n`,
  );
  return EXIT_CODES.valid;
}
