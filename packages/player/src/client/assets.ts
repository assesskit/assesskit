/**
 * The URL of a path that no asset prefix holds. It loads nothing, so that a file the host did not sign is a broken
 * reference and not a request to the page's own origin.
 */
export const UNSIGNED_URL = "about:blank";

/**
 * Builds the function that turns a package path into a URL.
 *
 * @remarks
 * The URL is the base URL of the longest asset prefix that holds the path, followed by the path. The base ends in `/` and
 * already holds the token, and the gate reads the path after it as the whole package path. A path that no prefix holds
 * gives {@link UNSIGNED_URL}.
 *
 * @param assets - The prefixes of an envelope, each mapped to its base URL.
 * @returns The function.
 */
export function assetResolver(assets: Readonly<Record<string, string>>): (path: string) => string {
  const prefixes = Object.keys(assets).sort((a, b) => b.length - a.length);
  return (path) => {
    const prefix = prefixes.find((candidate) => path.startsWith(candidate));
    const base = prefix === undefined ? undefined : assets[prefix];
    return base === undefined ? UNSIGNED_URL : `${base}${path}`;
  };
}
