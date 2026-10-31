import { AssesskitError } from "../errors.js";
import { MANIFEST_PATH, type Manifest, type QtiPackage, type Resource, resourcePath } from "../package/index.js";
import { PNP_ALTERNATE_NAMESPACES, PNP_NAMESPACE } from "../pnp/index.js";
import { RESULTS_NAMESPACE } from "../results/index.js";
import { parseXml, type XmlElement } from "../xml/index.js";
import type { Findings } from "./findings.js";

/** What a package holds and what its manifest lists, for the checks of the files that documents name. */
export class Contents {
  /** The package. */
  readonly pkg: QtiPackage;
  private readonly present: ReadonlySet<string>;
  private readonly listed: ReadonlySet<string>;

  constructor(pkg: QtiPackage) {
    this.pkg = pkg;
    this.present = new Set(pkg.paths);
    this.listed = listedPaths(pkg.manifest);
  }

  /** Returns whether the package holds a file. */
  has(path: string): boolean {
    return this.present.has(path);
  }

  /**
   * Reports a file that a document names and the package lacks or the manifest does not list.
   *
   * @param what - Says what names the file, such as `The settings file of the adaptive section`.
   */
  check(path: string | undefined, what: string, findings: Findings, element: string): void {
    if (path === undefined) return;
    if (!this.present.has(path)) {
      const message = `${what} is ${JSON.stringify(path)}, which the package does not contain.`;
      findings.error("assesskit/validate/missing-file", message, element);
    } else if (!this.listed.has(path)) {
      const message = `${what} is ${JSON.stringify(path)}, which the manifest does not list.`;
      findings.error("assesskit/validate/unlisted-file", message, element);
    }
  }
}

/** A file that a resource lists, as written and as a path in the package. */
interface Listing {
  readonly resource: Resource;
  /** The `href` as written. */
  readonly href: string;
  /** The path in the package; `undefined` when the `href` leaves the package. */
  readonly path: string | undefined;
}

/** Lists the main file and the files of every resource of a manifest. */
function listings(manifest: Manifest): readonly Listing[] {
  return manifest.resources.flatMap((resource) => {
    const hrefs = [...(resource.href === undefined ? [] : [resource.href]), ...resource.files.map(({ href }) => href)];
    return hrefs.map((href) => ({ resource, href, path: resourcePath(manifest, resource, href) }));
  });
}

/** The paths of the files a manifest lists: the `href` of each resource and of each of its files, inside the package. */
function listedPaths(manifest: Manifest): ReadonlySet<string> {
  return new Set(listings(manifest).flatMap(({ path }) => (path === undefined ? [] : [path])));
}

/**
 * Checks that the files the manifest lists are in the package and that the package holds no other file (BIND §8.1,
 * CAT §2.6): all files of a conformant package are listed, and a listed file must exist. The manifest itself is not listed.
 *
 * @param findings - The findings of the manifest.
 */
export function checkListedFiles(pkg: QtiPackage, findings: Findings): void {
  const present = new Set(pkg.paths);
  const element = "manifest/resources/resource/file";
  for (const { resource, href, path } of listings(pkg.manifest)) {
    if (path === undefined) {
      const message = `The resource ${JSON.stringify(resource.identifier)} lists ${JSON.stringify(href)}, which is outside the package.`;
      findings.error("assesskit/validate/outside-package", message, element);
    } else if (!present.has(path)) {
      const message = `The resource ${JSON.stringify(resource.identifier)} lists the file ${JSON.stringify(path)}, which the package does not contain.`;
      findings.error("assesskit/validate/missing-file", message, element);
    }
  }
  const listed = listedPaths(pkg.manifest);
  for (const path of pkg.paths) {
    if (listed.has(path) || path === MANIFEST_PATH) continue;
    const message = `The package contains the file ${JSON.stringify(path)}, which the manifest does not list; all files of a package must be listed.`;
    findings.error("assesskit/validate/unlisted-file", message, "manifest/resources");
  }
}

/** Returns what a document at a path is that a package must not hold, `undefined` for any other document. */
function foreignKind(root: XmlElement): "pnp" | "results" | undefined {
  if (PROFILE_NAMESPACES.has(root.namespace) && root.name.startsWith("access-for-all-pnp")) return "pnp";
  return root.namespace === RESULTS_NAMESPACE && root.name === "assessmentResult" ? "results" : undefined;
}

/** The namespaces of the personal needs profiles that the runtime reads (D6). */
const PROFILE_NAMESPACES: ReadonlySet<string> = new Set([PNP_NAMESPACE, ...PNP_ALTERNATE_NAMESPACES]);

/** Reads the root element of a file, `undefined` when the file is absent or not a well-formed document. */
function rootOf(pkg: QtiPackage, path: string): XmlElement | undefined {
  const bytes = pkg.file(path);
  if (bytes === undefined) return undefined;
  try {
    return parseXml(bytes, { path });
  } catch (error) {
    // A file that is not well-formed is not this check's to report.
    if (!(error instanceof AssesskitError)) throw error;
    return undefined;
  }
}

/**
 * Checks that no file of the package is a personal needs profile or a results report, which BIND §7 keeps out of a
 * package. Every XML file that is not a QTI document of a resource is read for its root element.
 *
 * @param documents - The paths of the files that the manifest gives as QTI documents, which are not read again.
 * @param findings - The findings of the manifest.
 */
export function checkForeignDocuments(pkg: QtiPackage, documents: ReadonlySet<string>, findings: Findings): void {
  for (const path of pkg.paths) {
    if (documents.has(path) || path === MANIFEST_PATH || !path.toLowerCase().endsWith(".xml")) continue;
    const root = rootOf(pkg, path);
    const kind = root === undefined ? undefined : foreignKind(root);
    if (kind === undefined) continue;
    const what = kind === "pnp" ? "a personal needs profile" : "a results report";
    const message = `The file ${JSON.stringify(path)} is ${what}, which does not belong in a content package.`;
    findings.error(`assesskit/validate/${kind}-in-package`, message, "manifest/resources");
  }
}
