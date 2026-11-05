import { readFileSync } from "node:fs";
import * as v from "valibot";
import { looseRecord, parseWith } from "../checks.js";

const manifestSchema = looseRecord({ version: v.string() });

/**
 * Returns the version of the runtime package that runs, which `package.json` two folders above this one records.
 *
 * @returns The version.
 * @throws `DataError` when the `package.json` has no version.
 */
export function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  return parseWith(manifestSchema, manifest, "The package.json of the runtime").version;
}
