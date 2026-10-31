import { readFileSync } from "node:fs";
import { isRecord } from "../checks.js";
import { AssesskitError } from "../errors.js";

/** Returns the version of the runtime package that runs, which `package.json` two folders above this one records. */
export function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  if (!(isRecord(manifest) && typeof manifest.version === "string")) {
    throw new AssesskitError("The package.json of the runtime has no version.");
  }
  return manifest.version;
}
