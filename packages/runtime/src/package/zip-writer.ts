import { deflateSync, type Zippable, zipSync } from "fflate";
import { DataError } from "../errors.js";

/** A file to put in an archive. */
export interface ZipEntry {
  /** The path, already normalized. */
  readonly name: string;
  /** The uncompressed bytes. */
  readonly data: Uint8Array;
}

/** The bytes of a local header and of a central header without the name, and of the end record. */
const FIXED_BYTES_PER_ENTRY = 30 + 46;
const END_RECORD_BYTES = 22;
/** The largest value of a field of the classic format: the next value is the marker for ZIP64. */
const MAX_CLASSIC_COUNT = 0xfffe;
const MAX_CLASSIC_VALUE = 0xfffffffe;
/** The compression level of fflate that stores an entry. */
const STORED = 0;

const ENCODER = new TextEncoder();

/**
 * Writes entries as a ZIP archive of the classic format through `fflate`: deflated when that makes an entry smaller, stored
 * otherwise, with one fixed time stamp, so that equal input gives equal bytes in every time zone. The classic format holds at
 * most 65,534 entries and values below 4 GiB.
 *
 * @remarks
 * The entries come in the order given, except that `fflate` keeps them in a plain object: a name that is a whole number, which
 * only a file at the root can be, comes first in ascending order, and a name `__proto__` it cannot hold.
 *
 * @param entries - The entries, in the order they are written.
 * @returns The archive.
 * @throws `DataError` when the archive would need ZIP64.
 * @see {@link https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT | ZIP File Format Specification (APPNOTE)}
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_CLASSIC_COUNT) {
    throw new DataError(
      `A package of ${entries.length} files needs ZIP64, which the runtime does not write; the classic format holds ${MAX_CLASSIC_COUNT}.`,
    );
  }
  const files: Zippable = {};
  let total = END_RECORD_BYTES;
  for (const { name, data } of entries) {
    const deflated = deflateSync(data).length;
    files[name] = deflated < data.length ? data : [data, { level: STORED }];
    total += FIXED_BYTES_PER_ENTRY + 2 * ENCODER.encode(name).length + Math.min(deflated, data.length);
    if (total > MAX_CLASSIC_VALUE || data.length > MAX_CLASSIC_VALUE) {
      throw new DataError("A package larger than 4 GiB needs ZIP64, which the runtime does not write.");
    }
  }
  return zipSync(files, { mtime: new Date(1980, 0, 1) });
}
