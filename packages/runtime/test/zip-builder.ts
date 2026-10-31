import { crc32 as nodeCrc32 } from "node:zlib";
import { deflateSync } from "fflate";

/** An entry of an archive built by hand, with every field of its headers open to change, so that a test can write what a hostile tool writes. */
export interface RawEntry {
  readonly name: string;
  /** The uncompressed bytes. Default: none. */
  readonly data?: Uint8Array;
  /** The compression method. Default: 8, deflated. */
  readonly method?: number;
  /** The general purpose flags. Default: 0. */
  readonly flags?: number;
  /** The host system in the "version made by" field. Default: 0, MS-DOS. */
  readonly host?: number;
  /** The external attributes. Default: 0. */
  readonly externalAttributes?: number;
  /** The uncompressed size the headers declare. Default: the size of the data. */
  readonly declaredSize?: number;
  /** The compressed size the headers declare. Default: the size of the compressed bytes. */
  readonly declaredCompressedSize?: number;
  /** The CRC-32 the headers declare. Default: the CRC-32 of the data. */
  readonly crc?: number;
  /** The name in the local header. Default: the name. */
  readonly localName?: string;
  /** The bytes stored as the compressed data. Default: the data deflated, or as it is when stored. */
  readonly stored?: Uint8Array;
}

export interface RawOptions {
  /** The disk number in the end record. Default: 0. */
  readonly disk?: number;
  /** The entry count the end record declares. Default: the number of entries. */
  readonly declaredCount?: number;
}

const encoder = new TextEncoder();

/** Builds an archive of the classic format from entries whose headers say what the test needs them to. */
export function buildZip(entries: readonly RawEntry[], options: RawOptions = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = entry.data ?? new Uint8Array();
    const method = entry.method ?? 8;
    const body = entry.stored ?? (method === 8 ? deflateSync(data) : data);
    const name = encoder.encode(entry.name);
    const localName = encoder.encode(entry.localName ?? entry.name);
    const crc = entry.crc ?? nodeCrc32(data);
    const size = entry.declaredSize ?? data.length;
    const compressedSize = entry.declaredCompressedSize ?? body.length;
    const local = new Uint8Array(30 + localName.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, entry.flags ?? 0, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, compressedSize, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, localName.length, true);
    local.set(localName, 30);
    const header = new Uint8Array(46 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, ((entry.host ?? 0) << 8) | 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, entry.flags ?? 0, true);
    view.setUint16(10, method, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, compressedSize, true);
    view.setUint32(24, size, true);
    view.setUint16(28, name.length, true);
    view.setUint32(38, entry.externalAttributes ?? 0, true);
    view.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);
    parts.push(local, body);
    offset += local.length + body.length;
  }
  const directorySize = central.reduce((sum, header) => sum + header.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, options.disk ?? 0, true);
  endView.setUint16(8, options.declaredCount ?? entries.length, true);
  endView.setUint16(10, options.declaredCount ?? entries.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  return concat([...parts, ...central, end]);
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

/** The bytes of a text. */
export function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}
