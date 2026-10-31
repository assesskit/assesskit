import { documentName, readError } from "./read-error.js";

/** The XML declaration is ASCII and short; its encoding declaration is looked for in this many bytes (XML 1.0 App. F.1). */
const DECLARATION_LENGTH = 256;
const ENCODING_DECLARATION = /^<\?xml[ \t\r\n][^>]*?[ \t\r\n]encoding[ \t\r\n]*=[ \t\r\n]*(?:"([^"]*)"|'([^']*)')/;

interface ByteOrderMark {
  readonly bytes: readonly number[];
  /** The WHATWG Encoding Standard name of the encoding the mark announces. */
  readonly encoding: string;
}

/** The byte order marks of UTF-8 and UTF-16 (XML 1.0 App. F.1). */
const BYTE_ORDER_MARKS: readonly ByteOrderMark[] = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: "utf-8" },
  { bytes: [0xff, 0xfe], encoding: "utf-16le" },
  { bytes: [0xfe, 0xff], encoding: "utf-16be" },
];

/** Returns the WHATWG name of the encoding a label stands for, or `undefined` when the runtime does not support it. */
function encodingOf(label: string): string | undefined {
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return undefined;
  }
}

/** Returns the UTF-16 family as one encoding, because a declaration of `UTF-16` fits either byte order. */
function family(encoding: string | undefined): string | undefined {
  return encoding?.startsWith("utf-16") ? "utf-16" : encoding;
}

/** Returns the encoding that the XML declaration at the start of some text names, if it names one. */
function declaredLabel(head: string): string | undefined {
  const match = ENCODING_DECLARATION.exec(head);
  return match?.[1] ?? match?.[2];
}

/** Returns the bytes as a string, one character per byte, which is enough to read an ASCII declaration. */
function latin1(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function decode(bytes: Uint8Array, encoding: string, path: string | undefined): string {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw readError("assesskit/xml/encoding", `${documentName(path)} is not valid ${encoding}.`, { path });
  }
}

/** Decodes a document that starts with a byte order mark; its declaration, if any, must name the same family. */
function decodeMarked(bytes: Uint8Array, mark: ByteOrderMark, path: string | undefined): string {
  const text = decode(bytes.subarray(mark.bytes.length), mark.encoding, path);
  const label = declaredLabel(text.slice(0, DECLARATION_LENGTH));
  if (label !== undefined && family(encodingOf(label)) !== family(mark.encoding)) {
    const message = `${documentName(path)} starts with a ${mark.encoding} byte order mark but declares the encoding ${JSON.stringify(label)}.`;
    throw readError("assesskit/xml/encoding", message, { path });
  }
  return text;
}

/**
 * Decodes the bytes of a document into text by the rules of XML 1.0 §4.3.3 and App. F.1: a UTF-8 or UTF-16 byte order
 * mark decides, and a declaration that names another encoding is an error; without a mark, the declared encoding is
 * used when `TextDecoder` supports it, and UTF-8 when the document declares none. UTF-16 needs a mark.
 *
 * @throws `ReadError` when the bytes are not valid in their encoding, the encoding is not supported, or a declaration
 * contradicts the byte order mark.
 */
export function decodeXml(bytes: Uint8Array, path: string | undefined): string {
  const mark = BYTE_ORDER_MARKS.find(({ bytes: prefix }) => prefix.every((byte, index) => bytes[index] === byte));
  if (mark !== undefined) return decodeMarked(bytes, mark, path);
  const label = declaredLabel(latin1(bytes.subarray(0, DECLARATION_LENGTH))) ?? "utf-8";
  const encoding = encodingOf(label);
  if (encoding === undefined || encoding.startsWith("utf-16")) {
    const reason = encoding === undefined ? "this runtime does not support it" : "UTF-16 needs a byte order mark";
    const message = `${documentName(path)} declares the encoding ${JSON.stringify(label)}, but ${reason}.`;
    throw readError("assesskit/xml/encoding", message, { path });
  }
  return decode(bytes, encoding, path);
}
