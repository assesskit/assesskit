import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
import { SCHEMA_FILES, type SchemaFile } from "./schema-files.js";

/** The characters of the hash of the pinned list that name its directory: 48 bits, far from a collision between releases. */
const VERSION_LENGTH = 12;

/**
 * Returns the user cache directory of a platform: `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows, and
 * `$XDG_CACHE_HOME` or `~/.cache` elsewhere. A variable that is not an absolute path is ignored, as the XDG Base
 * Directory Specification says.
 *
 * @param platform - The platform, as `process.platform` names it.
 * @param environment - The environment variables.
 * @param home - The home directory of the user.
 * @returns The user cache directory.
 * @see {@link https://specifications.freedesktop.org/basedir-spec/latest/ | XDG Base Directory Specification}
 */
export function userCacheDirectory(
  platform: NodeJS.Platform,
  environment: Readonly<Record<string, string | undefined>>,
  home: string,
): string {
  if (platform === "darwin") return posix.join(home, "Library", "Caches");
  if (platform === "win32") {
    const local = environment.LOCALAPPDATA;
    return local !== undefined && win32.isAbsolute(local) ? local : win32.join(home, "AppData", "Local");
  }
  const cache = environment.XDG_CACHE_HOME;
  return cache !== undefined && posix.isAbsolute(cache) ? cache : posix.join(home, ".cache");
}

/**
 * Returns the directory in the user cache directory that holds a list of pinned schemas: `assesskit/schemas/<version>`. The
 * version is the start of the SHA-256 of the list, so that a release that pins other schemas uses another directory and a
 * release that pins the same schemas shares it.
 *
 * @param schemas - The pinned schemas.
 * @returns The directory.
 */
export function pinnedSchemaDirectory(schemas: readonly SchemaFile[]): string {
  const list = schemas.map(({ file, sha256 }) => `${file} ${sha256}\n`).join("");
  const version = createHash("sha256").update(list).digest("hex").slice(0, VERSION_LENGTH);
  return join(userCacheDirectory(process.platform, process.env, homedir()), "assesskit", "schemas", version);
}

/**
 * Returns the directory that `assesskit validate` reads the schemas from and `assesskit schemas fetch` writes them to when no option
 * names one, which is the directory to give {@link loadSchemaSet} after that command ran: `assesskit/schemas/<version>` in the
 * user cache directory, where the version is the start of the SHA-256 of {@link SCHEMA_FILES}.
 *
 * @returns The directory.
 */
export function defaultSchemaDirectory(): string {
  return pinnedSchemaDirectory(SCHEMA_FILES);
}
