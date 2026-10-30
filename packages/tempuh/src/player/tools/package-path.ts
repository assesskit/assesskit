/** Whether a path is a URL with a scheme, which a package path never is. */
export function isAbsoluteUrl(path: string): boolean {
  try {
    new URL(path);
    return true;
  } catch {
    return false;
  }
}
