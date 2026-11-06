import { type Stats, statSync } from "node:fs";
import { checkString, parseWith } from "../checks.js";
import { messageOf } from "../checks-internal.js";
import { DataError, SecurityError } from "../errors.js";
import { openPackage, type QtiPackage, type ReadPackageOptions } from "../package/index.js";
import { openZip, readPackageOptionsSchema } from "../package/internal.js";
import { openDirectory } from "./directory-files.js";
import { fileSource } from "./file-source.js";

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
 * @example
 * ```ts
 * import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
 * import { tmpdir } from "node:os";
 * import { join } from "node:path";
 * import { readPackageFile } from "@assesskit/runtime/node";
 *
 * const directory = mkdtempSync(join(tmpdir(), "package-"));
 * writeFileSync(
 *   join(directory, "imsmanifest.xml"),
 *   `<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="demo">
 *   <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
 *   <organizations/>
 *   <resources>
 *     <resource identifier="capital" type="imsqti_item_xmlv3p0" href="capital.xml"><file href="capital.xml"/></resource>
 *   </resources>
 * </manifest>`,
 * );
 * writeFileSync(join(directory, "capital.xml"), "<qti-assessment-item/>");
 * const pkg = await readPackageFile(directory);
 * pkg.paths; // => ["capital.xml", "imsmanifest.xml"]
 * rmSync(directory, { recursive: true });
 * ```
 */
export async function readPackageFile(path: string, options: ReadPackageOptions = {}): Promise<QtiPackage> {
  checkString(path, "The path");
  const { limits: resolved, xmlLimits } = parseWith(readPackageOptionsSchema, options, "The options object");
  let stat: Stats;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new DataError(`The package ${path} cannot be read: ${messageOf(error)}`, { cause: error });
  }
  const packageOptions = { xmlLimits };
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
