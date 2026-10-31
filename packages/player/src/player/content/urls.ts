import { checkArray, checkString, describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { resolveReference } from "@assesskit/runtime/package";

/** How the references of content become URLs that the page may load. */
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
 * A host that never resolves, against which a reference is parsed so that the browser's own URL parser decides what its
 * scheme and host are, whatever the spelling: tabs, backslashes and leading spaces included.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc6761#section-6.4 | RFC 6761, the invalid domain}
 */
const PROBE = new URL("https://package.invalid/");

/** A `data:` URL of a raster image: SVG can carry script and is refused. */
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp)[;,]/iu;

/**
 * Returns whether a URL is a `data:` URL of a raster image, the one kind of `data:` URL that the player loads.
 *
 * @param url - The URL.
 * @returns `true` for a raster image.
 */
export function isRasterDataUrl(url: string): boolean {
  return RASTER_DATA_URL.test(url);
}

/**
 * Reads the origins that content may reference besides the package's.
 *
 * @param origins - An array of `http` or `https` URLs.
 * @returns The origins, as `URL.origin` writes them.
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
 * Resolves a reference of content to the URL the page may load.
 *
 * @remarks
 * - A reference without scheme or host is a path in the package: it resolves against the base and goes through `assets`.
 *   A path that leaves the package is refused.
 * - An `http` or `https` URL is kept when its origin is one of the policy's. Any other origin is refused.
 * - A raster `data:` URL is kept for a resource that loads. Every other scheme, `javascript:`, `vbscript:` and `blob:`
 *   among them, is refused.
 * - A fragment alone is kept for a link and refused for a resource.
 *
 * @param reference - The reference as the content writes it.
 * @param policy - The URL policy.
 * @param use - Whether the reference is a link or a resource.
 * @returns The URL, or `undefined` when the policy refuses the reference.
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
