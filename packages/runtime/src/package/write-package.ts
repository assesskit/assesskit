import { describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Manifest } from "./manifest.js";
import { MANIFEST_PATH } from "./package.js";
import { normalizeEntryName } from "./paths.js";
import { writeManifest } from "./write-manifest.js";
import { writeZip, type ZipEntry } from "./zip-writer.js";

/**
 * Writes a package as a ZIP archive: `imsmanifest.xml` first, written from the manifest, then the files in the order of
 * the map, each deflated when that makes it smaller. The archive has no ZIP64 records: it holds at most 65,534 files and is
 * below 4 GiB. Equal input gives equal bytes: every entry has the same time stamp.
 *
 * @param manifest - The manifest, written as in {@link writeManifest}.
 * @param files - The other files by path. A path must be normalized, which excludes absolute paths, `..` segments,
 * backslashes, drive letters and control characters, and must not be `imsmanifest.xml`.
 * @returns The archive.
 * @throws `DataError` when an argument has the wrong type, the manifest is not valid, a path is not allowed, or the
 * archive would need ZIP64.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding, content packages}
 * @see {@link https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT | ZIP File Format Specification (APPNOTE)}
 */
export function writePackage(manifest: Manifest, files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const manifestText = writeManifest(manifest);
  if (!(files instanceof Map))
    throw new DataError(`The files must be a Map of paths to bytes, found ${describe(files)}.`);
  const entries: ZipEntry[] = [{ name: MANIFEST_PATH, data: new TextEncoder().encode(manifestText) }];
  for (const [path, data] of files) {
    if (typeof path !== "string" || normalizeEntryName(path) !== path) {
      throw new DataError(`A path of a file must be normalized and inside the package, found ${describe(path)}.`);
    }
    if (path === MANIFEST_PATH)
      throw new DataError(`The files must not contain ${MANIFEST_PATH}: it is written from the manifest.`);
    if (!(data instanceof Uint8Array))
      throw new DataError(`The bytes of ${describe(path)} must be a Uint8Array, found ${describe(data)}.`);
    entries.push({ name: path, data });
  }
  return writeZip(entries);
}
