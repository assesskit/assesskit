import { Inflate } from "fflate";
import { AssesskitError, type ReadError, SecurityError } from "../errors.js";
import { createReadError } from "../xml/internal.js";
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
/** The values of the 16-bit count of the classic end record, and of the 64-bit count of the ZIP64 record. */
const COUNT_RANGE_16 = 2 ** 16;
const COUNT_RANGE_64 = 2 ** 64;
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

/**
 * The bytes of the central directory that each entry the limit `maxEntries` allows may take: 512, room for a path of 400 bytes
 * and the fields of the record, where the longest path of the examples is under 100. The directory is read whole, so its size
 * bounds the memory of opening an archive whatever the archive holds.
 */
export const DIRECTORY_BYTES_PER_ENTRY = 512;
/** The compressed bytes that are read from the source at once while an entry inflates. */
const INFLATE_BLOCK_BYTES = 1_048_576;

const NAME_DECODER = new TextDecoder("utf-8", { fatal: true });
const ASCII = /^\p{ASCII}*$/u;

/** Returns the bytes of a name as characters of one byte each. A name has at most 65,535 bytes. */
const bytesAsText = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

/**
 * Where the bytes of an archive are: in memory, or in a file that is read by ranges. The reader asks for the end of the archive, its
 * central directory and the bytes of an entry when the entry is opened, so a file is never read whole.
 */
export interface ByteSource {
  /** The size of the archive in bytes. */
  readonly length: number;
  /**
   * Returns the bytes at an offset, which the caller reads and neither changes nor keeps.
   *
   * @throws `ReadError` when the archive has fewer bytes there.
   */
  read(offset: number, length: number): Uint8Array;
  /**
   * Returns the bytes at an offset as an array of their own, which the caller may change and keep.
   *
   * @throws `ReadError` when the archive has fewer bytes there.
   */
  copy(offset: number, length: number): Uint8Array;
}

/** The central directory entry of a file. */
interface Entry {
  readonly name: string;
  /** The bytes of the name as characters of one byte each, which the local header must repeat; the same string as `name` when it is ASCII. */
  readonly rawName: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly crc: number;
  readonly offset: number;
}

function corrupt(message: string, options: ErrorOptions = {}): ReadError {
  return createReadError("assesskit/package/zip", message, options);
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

/** Returns a reader of the bytes at an offset. */
function window(source: ByteSource, offset: number, length: number): Reader {
  return new Reader(source.read(offset, length));
}

/**
 * Finds the end of central directory record: the last one whose comment ends the archive. It reads the last bytes of the archive,
 * where a record with the longest comment starts.
 *
 * @returns The offset of the record in the archive.
 */
function findEnd(source: ByteSource): number {
  const { length } = source;
  const tailLength = Math.min(length, END_RECORD_BYTES + MAX_COMMENT_BYTES);
  const tailStart = length - tailLength;
  const tail = window(source, tailStart, tailLength);
  for (let offset = tailLength - END_RECORD_BYTES; offset >= 0; offset--) {
    if (
      tail.u32(offset) === END_OF_CENTRAL_DIRECTORY &&
      offset + END_RECORD_BYTES + tail.u16(offset + 20) === tailLength
    ) {
      return tailStart + offset;
    }
  }
  throw corrupt("The data is not a ZIP archive: it has no end of central directory record.");
}

/** Where the central directory is and how many entries its end record declares. */
interface Directory {
  readonly count: number;
  /** The number of values of the field that holds the count: writers that predate ZIP64 let a 16-bit count wrap. */
  readonly countRange: number;
  readonly size: number;
  readonly offset: number;
}

function locateDirectory(source: ByteSource, end: number): Directory {
  const record = window(source, end, END_RECORD_BYTES);
  for (const disk of [record.u16(4), record.u16(6)]) {
    if (disk !== 0 && disk !== MARKER_16) throw corrupt("An archive in several parts is not supported.");
  }
  const count = record.u16(10);
  const size = record.u32(12);
  const offset = record.u32(16);
  if (count !== MARKER_16 && size !== MARKER_32 && offset !== MARKER_32) {
    return { count, countRange: COUNT_RANGE_16, size, offset };
  }
  const locatorAt = end - ZIP64_LOCATOR_BYTES;
  if (locatorAt < 0) {
    throw corrupt("The archive needs ZIP64 values but has no ZIP64 end of central directory locator.");
  }
  const locator = window(source, locatorAt, ZIP64_LOCATOR_BYTES);
  if (locator.u32(0) !== ZIP64_LOCATOR) {
    throw corrupt("The archive needs ZIP64 values but has no ZIP64 end of central directory locator.");
  }
  const recordAt = locator.u64(8);
  if (recordAt + ZIP64_END_RECORD_BYTES > locatorAt) {
    throw corrupt(
      "The ZIP64 end of central directory locator does not point to a ZIP64 end of central directory record.",
    );
  }
  const zip64 = window(source, recordAt, ZIP64_END_RECORD_BYTES);
  if (zip64.u32(0) !== ZIP64_END_OF_CENTRAL_DIRECTORY) {
    throw corrupt(
      "The ZIP64 end of central directory locator does not point to a ZIP64 end of central directory record.",
    );
  }
  if (zip64.u32(16) !== 0 || zip64.u32(20) !== 0) {
    throw corrupt("An archive in several parts is not supported.");
  }
  return {
    count: zip64.u64(32),
    countRange: COUNT_RANGE_64,
    size: zip64.u64(40),
    offset: zip64.u64(48),
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
  const nameBytes = reader.bytes.subarray(nameStart, extraStart);
  let name: string;
  try {
    name = NAME_DECODER.decode(nameBytes);
  } catch (error) {
    throw corrupt("The archive has an entry whose name is not valid UTF-8.", { cause: error });
  }
  // An entry keeps a string and not the bytes of the directory, and one string when the name is ASCII.
  const rawName = ASCII.test(name) ? name : bytesAsText(nameBytes);
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

function checkEntry(entry: Entry, length: number, limits: ZipLimits, total: number): void {
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
  if (entry.offset + LOCAL_HEADER_BYTES > length) {
    throw corrupt(`The entry ${JSON.stringify(entry.name)} starts after the end of the archive.`);
  }
}

/**
 * Reads the central directory: checks every name, the entry count and the declared sizes against the limits.
 *
 * The size of the directory ends the reading, as it does in Python's `zipfile` and in `unzip`, and not the count of the end
 * record: a 16-bit count wraps in an archive of more than 65,535 entries and is too small in a crafted one, and a reader
 * that trusts it sees fewer files than another extractor unpacks. The count must agree with the records found.
 *
 * The directory is read whole, and its size is checked against {@link DIRECTORY_BYTES_PER_ENTRY} for each entry that `maxEntries`
 * allows before it is read, so that the memory of opening an archive follows the limit and not the archive.
 */
function readDirectory(source: ByteSource, limits: ZipLimits): Map<string, Entry> {
  const end = findEnd(source);
  const directory = locateDirectory(source, end);
  if (directory.count > limits.maxEntries)
    throw exceeded("maxEntries", limits, `has ${directory.count} entries, above`);
  if (directory.offset + directory.size > end)
    throw corrupt("The central directory of the archive extends past its end record.");
  if (directory.count * CENTRAL_HEADER_BYTES > directory.size)
    throw corrupt("The central directory is too small for the entries the archive declares.");
  const maxDirectoryBytes = limits.maxEntries * DIRECTORY_BYTES_PER_ENTRY;
  if (directory.size > maxDirectoryBytes) {
    throw new SecurityError(
      `The central directory of the archive has ${directory.size} bytes, above the ${maxDirectoryBytes} that the limit maxEntries of ${limits.maxEntries} allows at ${DIRECTORY_BYTES_PER_ENTRY} bytes for each entry.`,
      "maxDirectoryBytes",
      maxDirectoryBytes,
    );
  }
  const reader = window(source, directory.offset, directory.size);
  const entries = new Map<string, Entry>();
  let position = 0;
  let total = 0;
  let records = 0;
  while (position < directory.size) {
    if (records === limits.maxEntries) throw exceeded("maxEntries", limits, "holds more entries than");
    const { entry, next, name } = readEntry(reader, position, directory.size);
    position = next;
    records++;
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
    checkEntry(entry, source.length, limits, total);
    entries.set(path, entry);
  }
  if (records % directory.countRange !== directory.count) {
    throw corrupt(
      `The end record of the archive declares ${directory.count} entries, but its central directory holds ${records}.`,
    );
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

/**
 * Inflates the data of an entry, read from the source in blocks, counting the bytes as they come, so that a header that understates
 * the size cannot make the output larger.
 */
function inflate(source: ByteSource, start: number, length: number, entry: Entry): Uint8Array {
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
      const block = source.read(start + offset, Math.min(INFLATE_BLOCK_BYTES, length - offset));
      const last = offset + block.length >= length;
      let at = 0;
      do {
        const next = at + INFLATE_CHUNK_BYTES;
        inflater.push(block.subarray(at, next), last && next >= block.length);
        at = next;
      } while (at < block.length);
      offset += block.length;
    } while (offset < length);
  } catch (error) {
    if (error instanceof AssesskitError) throw error;
    throw corrupt(`The entry ${JSON.stringify(entry.name)} has compressed data that cannot be inflated.`, {
      cause: error,
    });
  }
  return concatenate(chunks, produced);
}

/** Returns the bytes of an entry, after checking its local header against the central directory, its size and its CRC-32. */
function extract(source: ByteSource, entry: Entry): Uint8Array {
  const { offset } = entry;
  const header = window(source, offset, LOCAL_HEADER_BYTES);
  if (header.u32(0) !== LOCAL_HEADER)
    throw corrupt(`The entry ${JSON.stringify(entry.name)} does not start with a local file header.`);
  const nameLength = header.u16(26);
  const nameStart = offset + LOCAL_HEADER_BYTES;
  const dataStart = nameStart + nameLength + header.u16(28);
  const name = source.read(nameStart, Math.max(0, Math.min(nameLength, source.length - nameStart)));
  if (bytesAsText(name) !== entry.rawName) {
    throw corrupt(
      `The local file header of the entry ${JSON.stringify(entry.name)} names another file than the central directory.`,
    );
  }
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > source.length) throw corrupt(`The data of the entry ${JSON.stringify(entry.name)} is cut off.`);
  const bytes =
    entry.method === STORED
      ? source.copy(dataStart, entry.compressedSize)
      : inflate(source, dataStart, entry.compressedSize, entry);
  if (bytes.length !== entry.size)
    throw corrupt(
      `The entry ${JSON.stringify(entry.name)} has ${bytes.length} bytes, not the ${entry.size} its header declares.`,
    );
  if (crc32(bytes) !== entry.crc) throw corrupt(`The entry ${JSON.stringify(entry.name)} fails its CRC-32 check.`);
  return bytes;
}

/** The source of an archive that is in memory: it returns views of the bytes, and copies where the caller keeps them. */
export function memorySource(zip: Uint8Array): ByteSource {
  const check = (offset: number, length: number): void => {
    if (offset < 0 || length < 0 || offset + length > zip.length) throw corrupt("The data of the archive is cut off.");
  };
  return {
    length: zip.length,
    read: (offset, length) => {
      check(offset, length);
      return zip.subarray(offset, offset + length);
    },
    copy: (offset, length) => {
      check(offset, length);
      return zip.slice(offset, offset + length);
    },
  };
}

/**
 * Reads the central directory of a ZIP archive and returns its files, inflated one at a time when they are read.
 *
 * @remarks
 * The security checks run here: names (zip-slip), duplicate names, symbolic links, encryption, the entry count, the size of the
 * directory, and the declared sizes and ratios against the limits; each read counts the inflated bytes again. Opening reads the
 * end of the archive and its central directory, and a read the bytes of one entry, so that a source that reads by ranges is
 * never read whole.
 *
 * @param source - The archive.
 * @param limits - The limits, with every field set.
 * @returns The paths of the files, and a function that reads one.
 * @throws `ReadError` when the data is not a ZIP archive, is cut off, or uses a feature the runtime does not read.
 * @throws `SecurityError` when an entry breaks a rule or a limit.
 */
export function openZip(source: ByteSource, limits: ZipLimits): PackageFiles {
  const entries = readDirectory(source, limits);
  return {
    paths: [...entries.keys()],
    read: (path) => {
      const entry = entries.get(path);
      return entry === undefined ? undefined : extract(source, entry);
    },
  };
}
