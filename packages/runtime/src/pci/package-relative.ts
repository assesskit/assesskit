/** Matches the start of a URL with a scheme, such as `https:`. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Returns whether a module location is a path in the content package.
 *
 * @remarks
 * A location that starts with a protocol, such as `https://`, is fetched from there; any other is relative to the
 * package. A location that starts with `//` names a host and so is not in the package either.
 *
 * @param location - The location of a module, as a configuration file gives it.
 * @returns `true` for a path in the package.
 * @see
 * {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 * @see {@link https://www.rfc-editor.org/rfc/rfc3986#section-3.1 | RFC 3986, scheme}
 */
export function isPackageRelative(location: string): boolean {
  return !(SCHEME.test(location) || location.startsWith("//"));
}
