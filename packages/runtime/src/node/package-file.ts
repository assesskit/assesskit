import { readFileSync, type Stats, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { checkOptions, checkString } from "../checks.js";
import { DataError, SecurityError } from "../errors.js";
import {
  type Manifest,
  openPackage,
  type QtiPackage,
  type ReadPackageOptions,
  readPackage,
  writePackage,
} from "../package/index.js";
import { resolveZipLimits } from "../package/internal.js";
import { openDirectory } from "./directory-files.js";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads a QTI content package from a ZIP file or from an unpacked package directory, detected by what the path is.
 *
 * A ZIP file is read as {@link readPackage} reads it. A directory is listed once; its files are read when asked for,
 * and the limits `maxEntries`, `maxEntryBytes` and `maxTotalBytes` apply to its files and directories. The directory is
 * rejected when it holds a symbolic link or a file that is not a regular file, and a file is checked again with `lstat`
 * and `realpath` when it is read, so that nothing outside the directory is ever read.
 *
 * @param path - The ZIP file or directory.
 * @param options - See {@link ReadPackageOptions}.
 * @returns The package.
 * @throws `DataError` when an argument has the wrong type, a limit is not a positive integer, or the path cannot be read.
 * @throws `ReadError` and `SecurityError` as {@link readPackage} does, and `SecurityError` for the directory rules above.
 */
export async function readPackageFile(path: string, options: ReadPackageOptions = {}): Promise<QtiPackage> {
  checkString(path, "The path");
  checkOptions(options);
  const { limits = {}, xmlLimits } = options;
  const resolved = resolveZipLimits(limits);
  let stat: Stats;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new DataError(`The package ${path} cannot be read: ${reasonOf(error)}`);
  }
  const packageOptions = xmlLimits === undefined ? {} : { xmlLimits };
  if (stat.isDirectory()) return openPackage(await openDirectory(path, resolved), packageOptions);
  // A ZIP file is smaller than its contents unless they are stored, so a file above the total limit cannot pass it.
  if (stat.size > resolved.maxTotalBytes) {
    throw new SecurityError(
      `The file ${path} has ${stat.size} bytes, above the limit maxTotalBytes of ${resolved.maxTotalBytes}.`,
      "maxTotalBytes",
      resolved.maxTotalBytes,
    );
  }
  return readPackage(new Uint8Array(readFileSync(path)), { ...packageOptions, limits });
}

/**
 * Writes a package as a ZIP file, as {@link writePackage} builds it. An existing file at the path is replaced.
 *
 * @param path - The path of the ZIP file to write.
 * @param manifest - The manifest, written as in `writePackage`.
 * @param files - The other files by path.
 * @throws `DataError` as {@link writePackage} does, and when the file cannot be written.
 */
export async function writePackageFile(
  path: string,
  manifest: Manifest,
  files: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  checkString(path, "The path");
  const bytes = writePackage(manifest, files);
  try {
    await writeFile(path, bytes);
  } catch (error) {
    throw new DataError(`The package ${path} cannot be written: ${reasonOf(error)}`);
  }
}
