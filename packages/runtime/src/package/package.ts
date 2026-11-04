import { type AsiDocument, readAsi } from "../asi/index.js";
import { checkArray, checkFunction, checkRecord, checkString, describe } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import { AssesskitError, DataError, SecurityError } from "../errors.js";
import { parseXml, resolveIncludes, type XmlElement, type XmlLimits } from "../xml/index.js";
import { createReadError } from "../xml/internal.js";
import type { Manifest } from "./manifest.js";
import type { PackageFiles } from "./package-files.js";
import { normalizeEntryName, resolveReference } from "./paths.js";
import { readManifest } from "./read-manifest.js";
import { resolveZipLimits, type ZipLimits } from "./zip-limits.js";
import { memorySource, openZip } from "./zip-reader.js";

/** The path of the manifest in a package. */
export const MANIFEST_PATH = "imsmanifest.xml";

/** A QTI content package: its manifest and files, with the documents parsed on first use. */
export interface QtiPackage {
  /** The manifest. */
  readonly manifest: Manifest;
  /** The paths of the files of the package, the manifest included, in a stable order. */
  readonly paths: readonly string[];
  /**
   * Returns the bytes of a file, or `undefined` when the package has no file at the path. Each call returns bytes the
   * caller may change.
   *
   * @throws `DataError` when the path is not a string.
   * @throws `ReadError` when a file of an archive is corrupt.
   * @throws `SecurityError` when a file inflates to more bytes than its header declares.
   */
  file(path: string): Uint8Array | undefined;
  /**
   * Returns the ASI document at a path, with its `xi:include` elements resolved inside the package. The document is parsed
   * on the first call and kept. A file that several includes name is read and parsed once for the document.
   *
   * @throws `DataError` when the path is not a string.
   * @throws `ReadError` when the package has no file at the path, or the file cannot be read as an ASI document.
   * @throws `SecurityError` when an include names a file outside the package, or a limit is exceeded.
   */
  document(path: string): AsiDocument;
  /**
   * Resolves a reference against the path of the file that holds it: the base `items/a.xml` and the href
   * `../media/x.png` give `media/x.png`. The query and fragment are dropped and percent-encoded octets decoded.
   *
   * @param base - The path of the referencing file; a path ending in `/` stands for a directory, as an `xml:base` does.
   * @param href - The reference as written.
   * @returns The normalized path; `undefined` when the reference is outside the package: it has a scheme, starts with
   * `/` or `//`, leaves the package with `..`, or has a backslash, a drive letter, a control character or an invalid
   * percent-encoding. The file need not exist.
   * @throws `DataError` when an argument is not a string.
   */
  resolve(base: string, href: string): string | undefined;
}

/** Options of {@link openPackage}. */
export interface OpenPackageOptions {
  /**
   * XML limits for the manifest and every document, replacing the defaults field by field.
   *
   * @defaultValue `{}`, which keeps `DEFAULT_XML_LIMITS` of `xml`
   */
  readonly xmlLimits?: Partial<XmlLimits>;
}

/** Options of {@link readPackage}. */
export interface ReadPackageOptions extends OpenPackageOptions {
  /**
   * Limits on the archive, replacing the defaults field by field.
   *
   * @defaultValue `{}`, which keeps {@link DEFAULT_ZIP_LIMITS}
   */
  readonly limits?: Partial<ZipLimits>;
}

class OpenedPackage implements QtiPackage {
  readonly manifest: Manifest;
  readonly paths: readonly string[];
  private readonly files: PackageFiles;
  private readonly listed: ReadonlySet<string>;
  private readonly xmlLimits: Partial<XmlLimits>;
  private readonly documents = new Map<string, AsiDocument>();

  constructor(files: PackageFiles, xmlLimits: Partial<XmlLimits>) {
    this.files = files;
    this.paths = [...files.paths];
    this.listed = new Set(files.paths);
    this.xmlLimits = xmlLimits;
    const manifest = this.file(MANIFEST_PATH);
    if (manifest === undefined) {
      throw createReadError("assesskit/package/no-manifest", `The package has no ${MANIFEST_PATH} at its root.`, {
        location: {
          path: MANIFEST_PATH,
        },
      });
    }
    this.manifest = readManifest(manifest, { path: MANIFEST_PATH, limits: xmlLimits });
  }

  file(path: string): Uint8Array | undefined {
    checkString(path, "The path");
    return this.listed.has(path) ? this.files.read(path) : undefined;
  }

  /**
   * Reads and parses a file that an `xi:include` names. A file that cannot be read gives its error back instead of
   * throwing it, so that the failure is kept like a tree.
   */
  private parseIncluded(target: string, base: string): XmlElement | AssesskitError {
    try {
      const bytes = this.file(target);
      if (bytes === undefined) {
        const message = `The package has no file ${describe(target)}.`;
        return createReadError("assesskit/package/missing-file", message, { location: { path: base } });
      }
      return parseXml(bytes, { path: target, limits: this.xmlLimits });
    } catch (error) {
      if (error instanceof AssesskitError) return error;
      throw error;
    }
  }

  /**
   * Reads the target of an `xi:include`; a target outside the package is a security error, so that no fallback hides it.
   * A file is read and parsed once for a document, whatever the number of includes of it, so that a document cannot make
   * the reader repeat the work of a large file.
   */
  private include(href: string, base: string, outcomes: Map<string, XmlElement | AssesskitError>): XmlElement {
    const target = resolveReference(base, href);
    if (target === undefined) {
      throw new SecurityError(
        `The xi:include of ${describe(href)} in ${describe(base)} names a file outside the package.`,
        "path",
        0,
      );
    }
    let outcome = outcomes.get(target);
    if (outcome === undefined) {
      outcome = this.parseIncluded(target, base);
      outcomes.set(target, outcome);
    }
    if (outcome instanceof AssesskitError) throw outcome;
    return outcome;
  }

  document(path: string): AsiDocument {
    checkString(path, "The path");
    const cached = this.documents.get(path);
    if (cached !== undefined) return cached;
    const bytes = this.file(path);
    if (bytes === undefined) {
      throw createReadError("assesskit/package/missing-file", `The package has no file ${describe(path)}.`, {
        location: {
          path,
        },
      });
    }
    const root = parseXml(bytes, { path, limits: this.xmlLimits });
    const outcomes = new Map<string, XmlElement | AssesskitError>();
    const resolved = resolveIncludes(root, path, (href, base) => this.include(href, base, outcomes), {
      limits: this.xmlLimits,
    });
    const document = readAsi(resolved, { path, limits: this.xmlLimits });
    this.documents.set(path, document);
    return document;
  }

  resolve(base: string, href: string): string | undefined {
    checkString(base, "The base");
    checkString(href, "The href");
    return resolveReference(base, href);
  }
}

/**
 * Opens the files of a package: reads the manifest and returns the package. Documents are parsed when first asked for,
 * so opening costs the manifest only.
 *
 * @param files - The files. The paths must be normalized and unique.
 * @param options - See {@link OpenPackageOptions}.
 * @returns The opened package.
 * @throws `DataError` when an argument has the wrong type or the paths are not normalized and unique.
 * @throws `ReadError` when the package has no `imsmanifest.xml` at its root, or the manifest cannot be read (see {@link readManifest}).
 * @throws `SecurityError` as {@link parseXml} does for the manifest.
 */
export function openPackage(files: PackageFiles, options: OpenPackageOptions = {}): QtiPackage {
  checkOptions(options);
  const { xmlLimits = {} } = options;
  checkRecord(xmlLimits, "The option xmlLimits must be an object");
  checkRecord(files, "The files must be an object");
  checkArray(files.paths, "The paths of the files must be an array");
  checkFunction(files.read, "The files must have a function read of a path");
  const seen = new Set<string>();
  for (const path of files.paths) {
    if (typeof path !== "string" || normalizeEntryName(path) !== path || seen.has(path)) {
      throw new DataError(`The paths of the files must be normalized and unique, found ${describe(path)}.`);
    }
    seen.add(path);
  }
  return new OpenedPackage(files, xmlLimits);
}

/**
 * Reads a QTI content package from a ZIP archive. Only the central directory and the manifest are read; a file is
 * inflated when it is asked for. The security checks of {@link ZipLimits} run first.
 *
 * @param zip - The archive.
 * @param options - See {@link ReadPackageOptions}.
 * @returns The package.
 * @throws `DataError` when an argument has the wrong type or a limit is not a positive integer.
 * @throws `ReadError` when the data is not a ZIP archive, is cut off, or uses a feature the runtime does not read (several
 * parts, a compression method other than stored and deflated), or the package has no readable manifest.
 * @throws `SecurityError` when an entry breaks a rule or limit: a name that is absolute, leaves the package or has a
 * backslash, a drive letter or a control character; two entries with one normalized name; a symbolic link; encryption;
 * or an entry count, size, or compression ratio above its limit.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/bind/ | QTI 3.0 ASI XML Binding, content packages}
 * @see {@link https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT | ZIP File Format Specification (APPNOTE)}
 */
export function readPackage(zip: Uint8Array, options: ReadPackageOptions = {}): QtiPackage {
  checkOptions(options);
  const { limits = {}, xmlLimits } = options;
  if (!(zip instanceof Uint8Array)) throw new DataError(`The archive must be a Uint8Array, found ${describe(zip)}.`);
  return openPackage(
    openZip(memorySource(zip), resolveZipLimits(limits)),
    xmlLimits === undefined ? {} : { xmlLimits },
  );
}
