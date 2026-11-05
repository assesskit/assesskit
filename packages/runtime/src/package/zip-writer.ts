import { deflateSync } from "fflate";
import { DataError } from "../errors.js";
import { crc32 } from "./crc32.js";

/** A file to put in an archive. */
export interface ZipEntry {
  /** The path, already normalized. */
  readonly name: string;
  /** The uncompressed bytes. */
  readonly data: Uint8Array;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
/** Version 2.0, which deflate needs, made on MS-DOS, as `zipSync` of `fflate` writes it. */
const VERSION = 20;
const UTF8_NAME_FLAG = 0x800;
const STORED = 0;
const DEFLATED = 8;
/** 1980-01-01 at midnight in the MS-DOS date format, which every entry gets so that equal input gives equal bytes. */
const DOS_DATE = 0x21;
/** The largest value of a field of the classic format: the next value is the marker for ZIP64. */
const MAX_CLASSIC_COUNT = 0xfffe;
const MAX_CLASSIC_VALUE = 0xfffffffe;

const ENCODER = new TextEncoder();

/** An entry as the archive holds it: its name in UTF-8, and its bytes deflated when that makes them smaller. */
interface Packed {
  readonly name: Uint8Array;
  readonly ascii: boolean;
  readonly method: number;
  readonly crc: number;
  readonly size: number;
  readonly data: Uint8Array;
}

/** Deflates the bytes of an entry once, and keeps the smaller of them and the bytes as they are. */
function pack({ name, data }: ZipEntry): Packed {
  const deflated = deflateSync(data);
  const smaller = deflated.length < data.length;
  const encoded = ENCODER.encode(name);
  return {
    name: encoded,
    ascii: encoded.length === name.length,
    method: smaller ? DEFLATED : STORED,
    crc: crc32(data),
    size: data.length,
    data: smaller ? deflated : data,
  };
}

/** Writes the fields that a local header and a central header share, from the version needed to the length of the name. */
function writeFields(view: DataView, at: number, entry: Packed): void {
  view.setUint16(at, VERSION, true);
  view.setUint16(at + 2, entry.ascii ? 0 : UTF8_NAME_FLAG, true);
  view.setUint16(at + 4, entry.method, true);
  view.setUint16(at + 8, DOS_DATE, true);
  view.setUint32(at + 10, entry.crc, true);
  view.setUint32(at + 14, entry.data.length, true);
  view.setUint32(at + 18, entry.size, true);
  view.setUint16(at + 22, entry.name.length, true);
}

/**
 * Writes entries as a ZIP archive of the classic format, in the order given: each deflated once, and stored when deflating
 * does not make it smaller, with one fixed time stamp, so that equal input gives equal bytes in every time zone. The bytes
 * are those that `zipSync` of `fflate` writes for the same entries; `zipSync` would deflate each entry a second time to
 * write it, and holds its entries in a plain object, which puts a name that is a whole number first and has no place for
 * `__proto__`. The classic format holds at most 65,534 entries and values below 4 GiB.
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
  const packed = entries.map(pack);
  let localBytes = 0;
  let centralBytes = 0;
  for (const entry of packed) {
    localBytes += LOCAL_HEADER_BYTES + entry.name.length + entry.data.length;
    centralBytes += CENTRAL_HEADER_BYTES + entry.name.length;
  }
  if (
    localBytes + centralBytes + END_RECORD_BYTES > MAX_CLASSIC_VALUE ||
    packed.some(({ size }) => size > MAX_CLASSIC_VALUE)
  ) {
    throw new DataError("A package larger than 4 GiB needs ZIP64, which the runtime does not write.");
  }
  const out = new Uint8Array(localBytes + centralBytes + END_RECORD_BYTES);
  const view = new DataView(out.buffer);
  let local = 0;
  let central = localBytes;
  for (const entry of packed) {
    view.setUint32(local, LOCAL_HEADER, true);
    writeFields(view, local + 4, entry);
    out.set(entry.name, local + LOCAL_HEADER_BYTES);
    out.set(entry.data, local + LOCAL_HEADER_BYTES + entry.name.length);
    view.setUint32(central, CENTRAL_HEADER, true);
    view.setUint16(central + 4, VERSION, true);
    writeFields(view, central + 6, entry);
    view.setUint32(central + 42, local, true);
    out.set(entry.name, central + CENTRAL_HEADER_BYTES);
    local += LOCAL_HEADER_BYTES + entry.name.length + entry.data.length;
    central += CENTRAL_HEADER_BYTES + entry.name.length;
  }
  view.setUint32(central, END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(central + 8, packed.length, true);
  view.setUint16(central + 10, packed.length, true);
  view.setUint32(central + 12, centralBytes, true);
  view.setUint32(central + 16, localBytes, true);
  return out;
}
