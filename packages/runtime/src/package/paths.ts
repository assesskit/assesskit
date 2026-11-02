/** The characters a path segment must not contain: C0 and C1 control characters (NUL included) and the backslash. */
function isSafeSegment(segment: string): boolean {
  for (const char of segment) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || char === "\\") return false;
  }
  return true;
}

/** The start of a Windows drive path, such as `C:`. */
const DRIVE_LETTER = /^[A-Za-z]:/;

/**
 * Removes the `.` segments and resolves the `..` segments of a list of segments, and drops the empty ones.
 *
 * @returns `undefined` when a `..` leaves the root, or a segment is not safe.
 */
function normalizeSegments(segments: readonly string[]): string[] | undefined {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (normalized.pop() === undefined) return undefined;
    } else if (isSafeSegment(segment)) {
      normalized.push(segment);
    } else {
      return undefined;
    }
  }
  const [first] = normalized;
  return first !== undefined && DRIVE_LETTER.test(first) ? undefined : normalized;
}

/**
 * Normalizes the name of an entry of a package.
 *
 * @param name - The name of an archive entry or a path of a package.
 * @returns The path without `.` and empty segments and with the `..` segments resolved; `undefined` when the name is
 * absolute, has a `..` that leaves the root, a backslash, a drive letter, a control character, or no segment.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, packaging}
 */
export function normalizeEntryName(name: string): string | undefined {
  if (name.startsWith("/")) return undefined;
  const normalized = normalizeSegments(name.split("/"));
  return normalized === undefined || normalized.length === 0 ? undefined : normalized.join("/");
}

/** The start of an absolute reference: a scheme. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const HEX = /^[0-9A-Fa-f]{2}$/;

const ENCODER = new TextEncoder();

/** Appends the UTF-8 octets of a code point. */
function pushOctets(bytes: number[], codePoint: number): void {
  for (const byte of ENCODER.encode(String.fromCodePoint(codePoint))) bytes.push(byte);
}

/** Decodes the percent-encoded octets of a segment as UTF-8; `undefined` when an escape or the UTF-8 is invalid. */
function decodeSegment(segment: string): string | undefined {
  if (!segment.includes("%")) return segment;
  const bytes: number[] = [];
  for (let index = 0; index < segment.length; ) {
    const char = segment.codePointAt(index) ?? 0;
    if (segment[index] === "%") {
      const hex = segment.slice(index + 1, index + 3);
      if (!HEX.test(hex)) return undefined;
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
    } else {
      pushOctets(bytes, char);
      index += char > 0xffff ? 2 : 1;
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return undefined;
  }
}

/** Returns the path of a URI reference: what precedes the first `?` or `#`. */
function pathOf(reference: string): string {
  const ends = [reference.indexOf("?"), reference.indexOf("#")].filter((index) => index >= 0);
  return ends.length === 0
    ? reference
    : reference.slice(
        0,
        ends.reduce((first, index) => Math.min(first, index)),
      );
}

/**
 * Resolves a reference against a base inside a package. The query and the
 * fragment are dropped and percent-encoded octets are decoded, so that `my%20file.png` names the entry `my file.png`.
 *
 * @param base - The path of the referencing file, or of a directory when it ends with `/`; empty for the root.
 * @param reference - The reference as written in the document.
 * @returns The normalized path, with a trailing `/` when the reference names a directory; `undefined` when the
 * reference is outside the package: it has a scheme, starts with `/` or `//`, leaves the root with `..`, or has a
 * backslash, drive letter, control character or invalid percent-encoding in a segment.
 */
export function resolveReference(base: string, reference: string): string | undefined {
  if (reference.startsWith("/") || SCHEME.test(reference)) return undefined;
  const path = pathOf(reference);
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    const decoded = decodeSegment(segment);
    if (decoded === undefined || decoded.includes("/")) return undefined;
    segments.push(decoded);
  }
  const directory = base.slice(0, base.lastIndexOf("/") + 1);
  const merged = path === "" ? base.split("/") : [...directory.split("/"), ...segments];
  const normalized = normalizeSegments(merged);
  if (normalized === undefined) return undefined;
  const last = segments.at(-1);
  const names = path === "" ? base.endsWith("/") : last === "" || last === "." || last === "..";
  return normalized.length > 0 && names ? `${normalized.join("/")}/` : normalized.join("/");
}
