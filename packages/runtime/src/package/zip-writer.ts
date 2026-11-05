import { type Zippable, zipSync } from "fflate";
import { DataError } from "../errors.js";

/** A file to put in an archive. */
export interface ZipEntry {
  /** The path, already normalized. */
  readonly name: string;
  /** The uncompressed bytes. */
  readonly data: Uint8Array;
}

/** The largest value of a field of the classic format: the next value is the marker for ZIP64. */
const MAX_CLASSIC_COUNT = 0xfffe;
const MAX_CLASSIC_VALUE = 0xfffffffe;
/** The compression level of fflate that stores an entry. */
const STORED = 0;

/**
 * The extensions of the media types whose bytes are compressed already: images, audio, video, fonts and archives. Deflating
 * them again gains little or makes them larger, so they are stored.
 */
const COMPRESSED_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "heic",
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "opus",
  "flac",
  "mp4",
  "m4v",
  "webm",
  "ogv",
  "mov",
  "woff",
  "woff2",
  "zip",
  "gz",
  "7z",
]);

/** Whether a path names a file of a media type that is compressed already, by its extension in any case. */
function isCompressed(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > name.lastIndexOf("/") && COMPRESSED_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Writes entries as a ZIP archive of the classic format through `zipSync` of `fflate`, which deflates each entry once: a file
 * of a media type that is compressed already, by its extension, is stored, and every other file is deflated at the default
 * level. Every entry has one fixed time stamp, so that equal input gives equal bytes in every time zone. The classic format
 * holds at most 65,534 entries and values below 4 GiB.
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
  const tooLarge = () => new DataError("A package larger than 4 GiB needs ZIP64, which the runtime does not write.");
  const files: Zippable = {};
  for (const { name, data } of entries) {
    if (data.length > MAX_CLASSIC_VALUE) throw tooLarge();
    files[name] = isCompressed(name) ? [data, { level: STORED }] : data;
  }
  const zip = zipSync(files, { mtime: new Date(1980, 0, 1) });
  if (zip.length > MAX_CLASSIC_VALUE) throw tooLarge();
  return zip;
}
