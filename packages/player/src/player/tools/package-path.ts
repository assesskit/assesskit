/**
 * Returns whether a path is a URL with a scheme, which a package path never is.
 *
 * @param path - The path.
 * @returns `true` for a URL with a scheme.
 */
export function isAbsoluteUrl(path: string): boolean {
  try {
    new URL(path);
    return true;
  } catch {
    return false;
  }
}
