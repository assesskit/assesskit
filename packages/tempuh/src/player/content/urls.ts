import { resolveReference } from "@luthfanwakan/olah/package";
import { checkArray, checkString, describe } from "../../checks.js";
import { DataError } from "../../errors.js";

/** How the references of content become URLs that the page may load (tempuh design §3, "URL abuse"). */
export interface UrlPolicy {
  /** Turns the path of a file in the package into the URL to load it from. */
  readonly assets: (path: string) => string;
  /** The path in the package of the document the content comes from; relative references resolve against it. */
  readonly base: string;
  /** The origins besides the package's that content may reference, as `URL.origin` writes them. */
  readonly origins: ReadonlySet<string>;
}

/** What a reference is for: a link that the candidate follows, or a resource that the page loads by itself. */
export type UrlUse = "load" | "navigate";

/**
 * A host that never resolves (RFC 6761 §6.4), against which a reference is parsed so that the browser's own URL parser
 * decides what its scheme and host are, whatever the spelling: tabs, backslashes and leading spaces included.
 */
const PROBE = new URL("https://package.invalid/");

/** A `data:` URL of a raster image: SVG can carry script and is refused (tempuh design §3). */
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp)[;,]/iu;

/** Returns whether a URL is a `data:` URL of a raster image, the one kind of `data:` URL that the player loads. */
export function isRasterDataUrl(url: string): boolean {
  return RASTER_DATA_URL.test(url);
}

/** A descriptor of a candidate of `srcset`: a width in pixels or a density (HTML Standard §4.8.4.3.1). */
const SRCSET_DESCRIPTOR = /^(?:\d+w|(?:\d+|\d*\.\d+)x)$/u;

/** The code of the highest character that HTML counts as white space in a list of candidates. */
const LAST_SPACE = 0x20;

/**
 * Reads the origins that content may reference besides the package's.
 *
 * @throws `DataError` when `origins` is not an array of `http` or `https` URLs.
 */
export function readOrigins(origins: unknown): ReadonlySet<string> {
  checkArray(origins, "The option origins must be an array");
  return new Set(
    origins.map((origin) => {
      checkString(origin, "An origin of the option origins");
      try {
        const url = new URL(origin);
        if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
      } catch {
        // The error below says what to give.
      }
      throw new DataError(
        `An origin of the option origins must be an absolute http or https URL, found ${describe(origin)}.`,
      );
    }),
  );
}

/**
 * Resolves a reference of content to the URL the page may load, or `undefined` when the policy refuses it.
 *
 * - A reference without scheme or host is a path in the package: it resolves against the base and goes through `assets`.
 *   A path that leaves the package is refused.
 * - An `http` or `https` URL is kept when its origin is one of the policy's. Any other origin is refused.
 * - A raster `data:` URL is kept for a resource that loads. Every other scheme, `javascript:`, `vbscript:` and `blob:`
 *   among them, is refused.
 * - A fragment alone is kept for a link and refused for a resource.
 */
export function resolveUrl(reference: string, policy: UrlPolicy, use: UrlUse): string | undefined {
  const trimmed = reference.trim();
  if (trimmed === "") return undefined;
  if (trimmed.startsWith("#")) return use === "navigate" ? trimmed : undefined;
  let url: URL;
  try {
    url = new URL(reference, PROBE);
  } catch {
    return undefined;
  }
  if (url.origin === PROBE.origin) {
    const path = resolveReference(policy.base, reference);
    return path === undefined ? undefined : policy.assets(path);
  }
  if (url.protocol === "data:") return use === "load" && isRasterDataUrl(url.href) ? url.href : undefined;
  // The origin of a `blob:` URL is that of the page that made it, so the scheme is checked as well.
  const isWeb = url.protocol === "https:" || url.protocol === "http:";
  return isWeb && policy.origins.has(url.origin) ? url.href : undefined;
}

/** A candidate of a `srcset`: a URL and its descriptor, which is empty for the default density. */
interface Candidate {
  readonly url: string;
  readonly descriptor: string;
}

const isSpace = (character: string | undefined): boolean =>
  character !== undefined && character.charCodeAt(0) <= LAST_SPACE;

/** Returns the end of the descriptors of a candidate: the next comma that is not inside parentheses. */
function descriptorEnd(value: string, from: number): number {
  let depth = 0;
  for (let index = from; index < value.length; index++) {
    const character = value.charAt(index);
    if (character === "(") depth++;
    else if (character === ")" && depth > 0) depth--;
    else if (character === "," && depth === 0) return index;
  }
  return value.length;
}

/** Parses the candidates of a `srcset` (HTML Standard §4.8.4.3.1): URLs may contain commas, descriptors may not. */
function parseSrcset(value: string): Candidate[] {
  const candidates: Candidate[] = [];
  let index = 0;
  while (index < value.length) {
    while (isSpace(value[index]) || value[index] === ",") index++;
    const start = index;
    while (index < value.length && !isSpace(value[index])) index++;
    const url = value.slice(start, index);
    if (url.endsWith(",")) {
      candidates.push({ url: url.replace(/,+$/u, ""), descriptor: "" });
      continue;
    }
    const end = descriptorEnd(value, index);
    if (url !== "") candidates.push({ url, descriptor: value.slice(index, end).trim() });
    index = end;
  }
  return candidates;
}

/**
 * Resolves the candidates of a `srcset`. A candidate whose URL the policy refuses, or whose descriptor is none of a width
 * or a density, is left out.
 *
 * @returns The rewritten `srcset`, or `undefined` when no candidate remains.
 */
export function resolveSrcset(value: string, policy: UrlPolicy): string | undefined {
  const kept = parseSrcset(value).flatMap(({ url, descriptor }) => {
    const resolved = resolveUrl(url, policy, "load");
    return resolved === undefined || !(descriptor === "" || SRCSET_DESCRIPTOR.test(descriptor))
      ? []
      : [descriptor === "" ? resolved : `${resolved} ${descriptor}`];
  });
  return kept.length === 0 ? undefined : kept.join(", ");
}
