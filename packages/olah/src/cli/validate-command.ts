import { DataError } from "../errors.js";
import { loadSchemaSet, type SchemaSet } from "../node/index.js";
import { pathIssues } from "./check-path.js";
import type { RunCliOptions } from "./options.js";
import { packageVersion } from "./package-version.js";
import { buildReport, exitCodeOf, formatJson, formatText } from "./report.js";
import { parseCommand, UsageError } from "./usage.js";

/** Loads the schemas, and tells how to get them when they are missing or changed. */
async function openSchemas(directory: string | undefined, fallback: string): Promise<SchemaSet> {
  const schemaDirectory = directory ?? fallback;
  try {
    return await loadSchemaSet(schemaDirectory);
  } catch (error) {
    if (!(error instanceof DataError)) throw error;
    const command =
      directory === undefined ? "olah schemas fetch" : `olah schemas fetch --dir ${JSON.stringify(directory)}`;
    throw new DataError(
      `The directory ${schemaDirectory} does not hold the pinned schemas. Run ${command} to download them.`,
    );
  }
}

/**
 * Runs `olah validate <path> [--schemas <dir>] [--format text|json]` (L12, L13): validates the path against the schemas
 * and with the semantic checks, writes the report to the standard output and returns the exit code of the report.
 *
 * @throws `UsageError` when the arguments do not follow the command.
 * @throws `DataError` when the schemas or the path cannot be read, and `SecurityError` when the input is refused.
 */
export async function validateCommand(args: readonly string[], options: Required<RunCliOptions>): Promise<number> {
  const { values, positionals } = parseCommand(args, { schemas: { type: "string" }, format: { type: "string" } });
  const [target, ...extra] = positionals;
  if (target === undefined || extra.length > 0) throw new UsageError("The command validate takes one path.");
  const { format = "text" } = values;
  if (format !== "text" && format !== "json") {
    throw new UsageError(`The option --format must be "text" or "json", found ${JSON.stringify(format)}.`);
  }
  const schemas = await openSchemas(values.schemas, options.schemaDirectory);
  try {
    const report = buildReport(target, packageVersion(), await pathIssues(target, schemas));
    options.stdout(format === "json" ? formatJson(report) : formatText(report));
    return exitCodeOf(report);
  } finally {
    schemas.close();
  }
}
