import { type Stats, statSync } from "node:fs";
import { checkString } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { DataError, SecurityError } from "../errors.js";
import { openPackage, type QtiPackage, type ReadPackageOptions } from "../package/index.js";
import { openZip, resolveZipLimits } from "../package/internal.js";
import { openDirectory } from "./directory-files.js";
import { fileSource } from "./file-source.js";

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads a QTI content package from a ZIP file or from an unpacked package directory, detected by what the path is.
 *
 * A ZIP file is read as `readPackage` reads it, by ranges: the end of the file and its central directory when the package
 * opens, and the bytes of an entry when {@link QtiPackage.file} or {@link QtiPackage.document} asks for it, so that the memory
 * follows the directory and the largest entry opened, and not the size of the file. A directory is listed once; its files are read when asked for,
 * and the limits `maxEntries`, `maxEntryBytes` and `maxTotalBytes` apply to its files and directories. The directory is
 * rejected when it holds a symbolic link or a file that is not a regular file, and a file is checked again with `lstat`
 * and `realpath` when it is read, so that nothing outside the directory is ever read.
 *
 * @param path - The ZIP file or directory.
 * @param options - See {@link ReadPackageOptions}.
 * @returns The package.
 * @throws `DataError` when an argument has the wrong type, a limit is not a positive integer, or the path cannot be read.
 * @throws `ReadError` and `SecurityError` as `readPackage` does, and `SecurityError` for the directory rules above.
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
    throw new DataError(`The package ${path} cannot be read: ${reasonOf(error)}`, { cause: error });
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
  return openPackage(openZip(fileSource(path, stat.size), resolved), packageOptions);
}
