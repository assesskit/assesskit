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
/** Version 2.0, which deflate needs (APPNOTE §4.4.3). */
const VERSION = 20;
const UTF8_NAME_FLAG = 0x800;
const STORED = 0;
const DEFLATED = 8;
/** 1980-01-01 in the MS-DOS date format (year since 1980 in bits 9 to 15, month in 5 to 8, day in 0 to 4), which every entry gets so that equal input gives equal bytes. */
const DOS_DATE = 0x21;
const DOS_TIME = 0;
/** The largest value of a field of the classic format: the next value is the marker for ZIP64 (APPNOTE §4.4.1.4). */
const MAX_CLASSIC_COUNT = 0xfffe;
const MAX_CLASSIC_VALUE = 0xfffffffe;

const ENCODER = new TextEncoder();

interface Packed {
  readonly name: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly size: number;
  readonly data: Uint8Array;
}

function pack({ name, data }: ZipEntry): Packed {
  const bytes = ENCODER.encode(name);
  const deflated = deflateSync(data);
  const useDeflate = deflated.length < data.length;
  return {
    name: bytes,
    flags: bytes.length === name.length ? 0 : UTF8_NAME_FLAG,
    method: useDeflate ? DEFLATED : STORED,
    crc: crc32(data),
    size: data.length,
    data: useDeflate ? deflated : data,
  };
}

/**
 * Writes entries as a ZIP archive of the classic format: deflated when that makes an entry smaller, stored otherwise,
 * in the order given, with one fixed time stamp. The classic format holds at most 65,534 entries and values below 4 GiB.
 *
 * @throws `DataError` when the archive would need ZIP64.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  if (entries.length > MAX_CLASSIC_COUNT) {
    throw new DataError(
      `A package of ${entries.length} files needs ZIP64, which the runtime does not write; the classic format holds ${MAX_CLASSIC_COUNT}.`,
    );
  }
  const packed = entries.map(pack);
  const localBytes = packed.reduce((sum, entry) => sum + LOCAL_HEADER_BYTES + entry.name.length + entry.data.length, 0);
  const centralBytes = packed.reduce((sum, entry) => sum + CENTRAL_HEADER_BYTES + entry.name.length, 0);
  const total = localBytes + centralBytes + END_RECORD_BYTES;
  if (total > MAX_CLASSIC_VALUE || packed.some((entry) => entry.size > MAX_CLASSIC_VALUE)) {
    throw new DataError("A package larger than 4 GiB needs ZIP64, which the runtime does not write.");
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let position = 0;
  const offsets: number[] = [];
  for (const entry of packed) {
    offsets.push(position);
    view.setUint32(position, LOCAL_HEADER, true);
    view.setUint16(position + 4, VERSION, true);
    view.setUint16(position + 6, entry.flags, true);
    view.setUint16(position + 8, entry.method, true);
    view.setUint16(position + 10, DOS_TIME, true);
    view.setUint16(position + 12, DOS_DATE, true);
    view.setUint32(position + 14, entry.crc, true);
    view.setUint32(position + 18, entry.data.length, true);
    view.setUint32(position + 22, entry.size, true);
    view.setUint16(position + 26, entry.name.length, true);
    out.set(entry.name, position + LOCAL_HEADER_BYTES);
    out.set(entry.data, position + LOCAL_HEADER_BYTES + entry.name.length);
    position += LOCAL_HEADER_BYTES + entry.name.length + entry.data.length;
  }
  packed.forEach((entry, index) => {
    view.setUint32(position, CENTRAL_HEADER, true);
    view.setUint16(position + 4, VERSION, true);
    view.setUint16(position + 6, VERSION, true);
    view.setUint16(position + 8, entry.flags, true);
    view.setUint16(position + 10, entry.method, true);
    view.setUint16(position + 12, DOS_TIME, true);
    view.setUint16(position + 14, DOS_DATE, true);
    view.setUint32(position + 16, entry.crc, true);
    view.setUint32(position + 20, entry.data.length, true);
    view.setUint32(position + 24, entry.size, true);
    view.setUint16(position + 28, entry.name.length, true);
    view.setUint32(position + 42, offsets[index] ?? 0, true);
    out.set(entry.name, position + CENTRAL_HEADER_BYTES);
    position += CENTRAL_HEADER_BYTES + entry.name.length;
  });
  view.setUint32(position, END_OF_CENTRAL_DIRECTORY, true);
  view.setUint16(position + 8, packed.length, true);
  view.setUint16(position + 10, packed.length, true);
  view.setUint32(position + 12, centralBytes, true);
  view.setUint32(position + 16, localBytes, true);
  return out;
}
