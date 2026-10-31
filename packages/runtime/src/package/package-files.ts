/**
 * The files of a package by path: an archive, a directory or any store that can list its paths and return bytes. The
 * paths are normalized (see {@link QtiPackage.resolve}), unique and relative to the root of the package.
 */
export interface PackageFiles {
  /** The paths of the files in a stable order. */
  readonly paths: readonly string[];
  /** Returns the bytes of a file, or `undefined` when the package has no file at the path. */
  read(path: string): Uint8Array | undefined;
}
