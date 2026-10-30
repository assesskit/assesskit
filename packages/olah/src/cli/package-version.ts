import { readFileSync } from "node:fs";
import { isRecord } from "../checks.js";
import { OlahError } from "../errors.js";

/** Returns the version of the olah package that runs, which `package.json` two folders above this one records. */
export function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  if (!(isRecord(manifest) && typeof manifest.version === "string")) {
    throw new OlahError("The package.json of olah has no version.");
  }
  return manifest.version;
}
