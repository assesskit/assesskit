import { Inflate } from "fflate";
import { AssesskitError, type ReadError, SecurityError } from "../errors.js";
import { readError } from "../xml/index.js";
import { crc32 } from "./crc32.js";
import type { PackageFiles } from "./package-files.js";
import { normalizeEntryName } from "./paths.js";
import { RATIO_GRACE_BYTES, type ZipLimits } from "./zip-limits.js";

// The record signatures and sizes of the ZIP format.
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_RECORD_BYTES = 56;
const CENTRAL_HEADER = 0x02014b50;
const CENTRAL_HEADER_BYTES = 46;
const LOCAL_HEADER = 0x04034b50;
const LOCAL_HEADER_BYTES = 30;
const ZIP64_EXTRA_FIELD = 0x0001;
/** A 16-bit field holds this when the value is in the ZIP64 record. */
const MARKER_16 = 0xffff;
/** A 32-bit field holds this when the value is in the ZIP64 record or extra field. */
const MARKER_32 = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;
/** General purpose bit flags: encrypted (bit 0), strong encryption (bit 6) and encrypted central directory (bit 13) */
const ENCRYPTION_FLAGS = 0x1 | 0x40 | 0x2000;
/** The "version made by" host systems that store a Unix mode in the external attributes: Unix and OS X. */
const UNIX_HOSTS: readonly number[] = [3, 19];
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMLINK = 0o120000;
/** The compressed bytes fed to the inflater at once, so that a burst of output stays small even at the ratio 1032:1 of DEFLATE. */
const INFLATE_CHUNK_BYTES = 8192;

const NAME_DECODER = new TextDecoder("utf-8", { fatal: true });

/** The central directory entry of a file. */
interface Entry {
  readonly name: string;
  readonly rawName: Uint8Array;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc: number;
  readonly offset: number;
}

function corrupt(message: string): ReadError {
  return readError("assesskit/package/zip", message, undefined);
}

function exceeded(limit: keyof ZipLimits, limits: ZipLimits, what: string): SecurityError {
  return new SecurityError(`The archive ${what} the limit ${limit} of ${limits[limit]}.`, limit, limits[limit]);
}

function rule(limit: string, message: string): SecurityError {
  return new SecurityError(message, limit, 0);
}

/** Reads the little-endian fields of a record, and the 64-bit ones as safe integers. */
class Reader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(offset: number): number {
    return this.view.getUint8(offset);
  }

  u16(offset: number): number {
    return this.view.getUint16(offset, true);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  u64(offset: number): number {
    const value = this.view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw corrupt("A size or offset of the archive is above 2^53 - 1.");
    return Number(value);
  }
}

/** Finds the end of central directory record: the last one whose comment ends the archive. */
function findEnd(reader: Reader): number {
  const { length } = reader.bytes;
  for (
    let offset = length - END_RECORD_BYTES;
    offset >= Math.max(0, length - END_RECORD_BYTES - MAX_COMMENT_BYTES);
    offset--
  ) {
    if (
      reader.u32(offset) === END_OF_CENTRAL_DIRECTORY &&
      offset + END_RECORD_BYTES + reader.u16(offset + 20) === length
    ) {
      return offset;
    }
  }
  throw corrupt("The data is not a ZIP archive: it has no end of central directory record.");
}

/** Where the central directory is and how many entries it has. */
interface Directory {
  readonly count: number;
  readonly size: number;
  readonly offset: number;
}

function locateDirectory(reader: Reader, end: number): Directory {
  for (const disk of [reader.u16(end + 4), reader.u16(end + 6)]) {
    if (disk !== 0 && disk !== MARKER_16) throw corrupt("An archive in several parts is not supported.");
  }
  const count = reader.u16(end + 10);
  const size = reader.u32(end + 12);
  const offset = reader.u32(end + 16);
  if (count !== MARKER_16 && size !== MARKER_32 && offset !== MARKER_32) return { count, size, offset };
  const locator = end - ZIP64_LOCATOR_BYTES;
  if (locator < 0 || reader.u32(locator) !== ZIP64_LOCATOR) {
    throw corrupt("The archive needs ZIP64 values but has no ZIP64 end of central directory locator.");
  }
  const record = reader.u64(locator + 8);
  if (record + ZIP64_END_RECORD_BYTES > locator || reader.u32(record) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
    throw corrupt(
      "The ZIP64 end of central directory locator does not point to a ZIP64 end of central directory record.",
    );
  }
  if (reader.u32(record + 16) !== 0 || reader.u32(record + 20) !== 0) {
    throw corrupt("An archive in several parts is not supported.");
  }
  return {
    count: reader.u64(record + 32),
    size: reader.u64(record + 40),
    offset: reader.u64(record + 48),
  };
}

/** The values a ZIP64 extra field replaces: those whose 32-bit field holds the marker. */
interface Zip64Values {
  size: number;
  compressedSize: number;
  offset: number;
}

/** Finds the data of the ZIP64 extra field in the extra data of an entry. */
function findZip64Field(
  reader: Reader,
  extra: { start: number; end: number },
): { start: number; end: number } | undefined {
  for (let position = extra.start; position + 4 <= extra.end; ) {
    const length = reader.u16(position + 2);
    const dataEnd = position + 4 + length;
    if (dataEnd > extra.end) {
      throw corrupt("An extra field of an entry is longer than the entry's extra data.");
    }
    if (reader.u16(position) === ZIP64_EXTRA_FIELD) return { start: position + 4, end: dataEnd };
    position = dataEnd;
  }
  return undefined;
}

function applyZip64Extra(reader: Reader, extra: { start: number; end: number }, values: Zip64Values): void {
  const field = findZip64Field(reader, extra);
  let cursor = field?.start ?? 0;
  for (const key of ["size", "compressedSize", "offset"] as const) {
    if (values[key] !== MARKER_32) continue;
    if (field === undefined || cursor + 8 > field.end) {
      throw corrupt(
        "An entry needs a ZIP64 extra field with the values its header leaves out, and has none or a short one.",
      );
    }
    values[key] = reader.u64(cursor);
    cursor += 8;
  }
}

/** Checks the name of a directory entry. A relative name made of `.` and empty segments names the root and is accepted. */
function checkDirectoryName(name: string): void {
  if (!name.startsWith("/") && name.split("/").every((segment) => segment === "" || segment === ".")) return;
  if (normalizeEntryName(name) === undefined) {
    throw rule(
      "path",
      `The archive has the directory entry ${JSON.stringify(name)}, which is absolute or leaves the package, or has a backslash, a drive letter or a control character.`,
    );
  }
}

function readEntry(
  reader: Reader,
  position: number,
  end: number,
): { entry: Entry | undefined; next: number; name: string } {
  if (position + CENTRAL_HEADER_BYTES > end || reader.u32(position) !== CENTRAL_HEADER) {
    throw corrupt("The central directory of the archive has a record that is not a file header.");
  }
  const nameLength = reader.u16(position + 28);
  const extraLength = reader.u16(position + 30);
  const commentLength = reader.u16(position + 32);
  const nameStart = position + CENTRAL_HEADER_BYTES;
  const extraStart = nameStart + nameLength;
  const next = extraStart + extraLength + commentLength;
  if (next > end) throw corrupt("A file header of the central directory is longer than the directory.");
  const rawName = reader.bytes.subarray(nameStart, extraStart);
  let name: string;
  try {
    name = NAME_DECODER.decode(rawName);
  } catch {
    throw corrupt("The archive has an entry whose name is not valid UTF-8.");
  }
  const flags = reader.u16(position + 8);
  if ((flags & ENCRYPTION_FLAGS) !== 0)
    throw rule("encrypted", `The entry ${JSON.stringify(name)} is encrypted; the runtime reads no encrypted archive.`);
  const unixMode = reader.u32(position + 38) >>> 16;
  if (UNIX_HOSTS.includes(reader.u8(position + 5)) && (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK) {
    throw rule(
      "symlink",
      `The entry ${JSON.stringify(name)} is a symbolic link; the runtime reads no archive that contains one.`,
    );
  }
  if (name.endsWith("/")) return { entry: undefined, next, name };
  const values: Zip64Values = {
    size: reader.u32(position + 24),
    compressedSize: reader.u32(position + 20),
    offset: reader.u32(position + 42),
  };
  applyZip64Extra(reader, { start: extraStart, end: extraStart + extraLength }, values);
  const method = reader.u16(position + 10);
  return {
    entry: {
      name,
      rawName,
      method,
      compressedSize: values.compressedSize,
      size: values.size,
      crc: reader.u32(position + 16),
      offset: values.offset,
    },
    next,
    name,
  };
}

function checkEntry(entry: Entry, reader: Reader, limits: ZipLimits, total: number): void {
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    throw corrupt(
      `The entry ${JSON.stringify(entry.name)} uses the compression method ${entry.method}; the runtime reads stored and deflated entries.`,
    );
  }
  if (entry.method === STORED && entry.compressedSize !== entry.size) {
    throw corrupt(`The stored entry ${JSON.stringify(entry.name)} has a compressed size that differs from its size.`);
  }
  if (entry.size > limits.maxEntryBytes)
    throw exceeded(
      "maxEntryBytes",
      limits,
      `has the entry ${JSON.stringify(entry.name)} of ${entry.size} bytes, above`,
    );
  if (total > limits.maxTotalBytes) throw exceeded("maxTotalBytes", limits, "holds more bytes uncompressed than");
  if (entry.size > RATIO_GRACE_BYTES && entry.size > entry.compressedSize * limits.maxRatio) {
    throw exceeded(
      "maxRatio",
      limits,
      `has the entry ${JSON.stringify(entry.name)}, which is more than ${limits.maxRatio} times larger uncompressed than compressed, above`,
    );
  }
  if (entry.offset + LOCAL_HEADER_BYTES > reader.bytes.length) {
    throw corrupt(`The entry ${JSON.stringify(entry.name)} starts after the end of the archive.`);
  }
}

/** Reads the central directory: checks every name, the entry count and the declared sizes against the limits. */
function readDirectory(reader: Reader, limits: ZipLimits): Map<string, Entry> {
  const end = findEnd(reader);
  const directory = locateDirectory(reader, end);
  if (directory.count > limits.maxEntries)
    throw exceeded("maxEntries", limits, `has ${directory.count} entries, above`);
  if (directory.offset + directory.size > end)
    throw corrupt("The central directory of the archive extends past its end record.");
  if (directory.count * CENTRAL_HEADER_BYTES > directory.size)
    throw corrupt("The central directory is too small for the entries the archive declares.");
  const entries = new Map<string, Entry>();
  let position = directory.offset;
  let total = 0;
  for (let index = 0; index < directory.count; index++) {
    const { entry, next, name } = readEntry(reader, position, directory.offset + directory.size);
    position = next;
    if (entry === undefined) {
      checkDirectoryName(name);
      continue;
    }
    const path = normalizeEntryName(name);
    if (path === undefined) {
      throw rule(
        "path",
        `The entry ${JSON.stringify(name)} is absolute or leaves the package, or has a backslash, a drive letter or a control character (zip-slip).`,
      );
    }
    if (entries.has(path))
      throw rule("duplicate-path", `The archive has two entries named ${JSON.stringify(path)} after normalization.`);
    total += entry.size;
    checkEntry(entry, reader, limits, total);
    entries.set(path, entry);
  }
  return entries;
}

function concatenate(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** Inflates the data of an entry, counting the bytes as they come, so that a header that understates the size cannot make the output larger. */
function inflate(data: Uint8Array, entry: Entry): Uint8Array {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  const inflater = new Inflate((chunk) => {
    produced += chunk.length;
    if (produced > entry.size) {
      throw new SecurityError(
        `The entry ${JSON.stringify(entry.name)} inflates to more than the ${entry.size} bytes its header declares.`,
        "declaredBytes",
        entry.size,
      );
    }
    chunks.push(chunk);
  });
  try {
    let offset = 0;
    do {
      const next = offset + INFLATE_CHUNK_BYTES;
      inflater.push(data.subarray(offset, next), next >= data.length);
      offset = next;
    } while (offset < data.length);
  } catch (error) {
    if (error instanceof AssesskitError) throw error;
    throw corrupt(`The entry ${JSON.stringify(entry.name)} has compressed data that cannot be inflated.`);
  }
  return concatenate(chunks, produced);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Returns the bytes of an entry, after checking its local header against the central directory, its size and its CRC-32. */
function extract(reader: Reader, entry: Entry): Uint8Array {
  const { offset } = entry;
  if (reader.u32(offset) !== LOCAL_HEADER)
    throw corrupt(`The entry ${JSON.stringify(entry.name)} does not start with a local file header.`);
  const nameStart = offset + LOCAL_HEADER_BYTES;
  const dataStart = nameStart + reader.u16(offset + 26) + reader.u16(offset + 28);
  if (!sameBytes(reader.bytes.subarray(nameStart, nameStart + reader.u16(offset + 26)), entry.rawName)) {
    throw corrupt(
      `The local file header of the entry ${JSON.stringify(entry.name)} names another file than the central directory.`,
    );
  }
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > reader.bytes.length) throw corrupt(`The data of the entry ${JSON.stringify(entry.name)} is cut off.`);
  const data = reader.bytes.subarray(dataStart, dataEnd);
  const bytes = entry.method === STORED ? data.slice() : inflate(data, entry);
  if (bytes.length !== entry.size)
    throw corrupt(
      `The entry ${JSON.stringify(entry.name)} has ${bytes.length} bytes, not the ${entry.size} its header declares.`,
    );
  if (crc32(bytes) !== entry.crc) throw corrupt(`The entry ${JSON.stringify(entry.name)} fails its CRC-32 check.`);
  return bytes;
}

/**
 * Reads the central directory of a ZIP archive and returns its files, inflated one at a time when they are read.
 *
 * @remarks
 * The security checks run here: names (zip-slip), duplicate names, symbolic links, encryption, the entry count, and the
 * declared sizes and ratios against the limits; each read counts the inflated bytes again.
 *
 * @param zip - The archive.
 * @param limits - The limits, with every field set.
 * @returns The paths of the files, and a function that reads one.
 * @throws `ReadError` when the data is not a ZIP archive, is cut off, or uses a feature the runtime does not read.
 * @throws `SecurityError` when an entry breaks a rule or a limit.
 */
export function openZip(zip: Uint8Array, limits: ZipLimits): PackageFiles {
  const reader = new Reader(zip);
  const entries = readDirectory(reader, limits);
  return {
    paths: [...entries.keys()],
    read: (path) => {
      const entry = entries.get(path);
      return entry === undefined ? undefined : extract(reader, entry);
    },
  };
}
