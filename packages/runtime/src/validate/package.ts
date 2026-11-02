import type { AsiDocument, ResponseProcessing } from "../asi/index.js";
import { checkRecord } from "../checks.js";
import type { Issue } from "../errors.js";
import { lomGeneral } from "../metadata/index.js";
import {
  MANIFEST_PATH,
  packageResolvers,
  type QtiPackage,
  type Resource,
  type ResourceType,
  resourcePath,
} from "../package/index.js";
import { checkDocument } from "./asi.js";
import { failureIssues } from "./failures.js";
import type { Findings } from "./findings.js";
import { checkItem } from "./item.js";
import { type CheckedOptions, checkValidateOptions, type ValidateOptions } from "./options.js";
import { Contents, checkForeignDocuments, checkListedFiles } from "./package-files.js";
import { checkAdaptiveFiles, checkPciFiles } from "./package-references.js";
import { Reports } from "./reports.js";
import { checkTest } from "./test.js";

/** The kind of document that a resource of each type holds. */
const DOCUMENT_KINDS: ReadonlyMap<ResourceType, AsiDocument["kind"]> = new Map([
  ["imsqti_item_xmlv3p0", "item"],
  ["imsqti_test_xmlv3p0", "test"],
  ["imsqti_section_xmlv3p0", "section"],
  ["imsqti_stimulus_xmlv3p0", "stimulus"],
  ["imsqti_resprocessing_xmlv3p0", "response-processing"],
  ["imsqti_rptemplate_xmlv3p0", "response-processing"],
  ["imsqti_outcomes_xmlv3p0", "outcome-declaration"],
]);

/** Returns the path of the main file of a resource: its `href`, or its only file when it has no `href`. */
function mainPath(pkg: QtiPackage, resource: Resource): string | undefined {
  const [only, ...others] = resource.files;
  const href = resource.href ?? (only !== undefined && others.length === 0 ? only.href : undefined);
  return href === undefined ? undefined : resourcePath(pkg.manifest, resource, href);
}

/** Returns the response processing at a path of the package, as a resolver of templates gives it. */
function packageTemplate(pkg: QtiPackage, itemPath: string, uri: string): ResponseProcessing | undefined {
  const path = pkg.resolve(itemPath, uri);
  if (path === undefined || !pkg.paths.includes(path)) return undefined;
  try {
    const document = pkg.document(path);
    return document.kind === "response-processing" ? document.processing : undefined;
  } catch {
    // A template that cannot be read is reported with its own resource.
    return undefined;
  }
}

/** Checks that the identifier of an item is the identifier its resource's LOM metadata gives. */
function checkMetadataIdentifier(resource: Resource, identifier: string, findings: Findings): void {
  const identifiers =
    resource.metadata?.lom === undefined
      ? []
      : lomGeneral(resource.metadata.lom).identifiers.map((each) => each.trim());
  if (identifiers.length === 0 || identifiers.includes(identifier)) return;
  const message = `The item has the identifier ${JSON.stringify(identifier)}, but the LOM metadata of its resource ${JSON.stringify(resource.identifier)} gives ${identifiers.map((each) => JSON.stringify(each)).join(", ")}; the two must be the same.`;
  findings.error("assesskit/validate/metadata-identifier", message, `manifest/resources/resource`);
}

/** Checks the document of a resource with the package around it. */
function checkResource(
  contents: Contents,
  resource: Resource,
  path: string,
  document: AsiDocument,
  reports: Reports,
  options: CheckedOptions,
): void {
  const { pkg } = contents;
  const scoped: CheckedOptions = { ...options, path };
  if (document.kind === "item") {
    const resolveTemplate = (uri: string): ResponseProcessing | undefined =>
      options.resolveTemplate?.(uri) ?? packageTemplate(pkg, path, uri);
    checkItem(document.item, reports.of(path), { ...scoped, resolveTemplate });
    checkPciFiles(contents, document.item, reports.of(path));
    checkMetadataIdentifier(resource, document.item.identifier, reports.of(MANIFEST_PATH));
  } else if (document.kind === "test") {
    checkTest(document.test, reports, scoped, { base: path, resolvers: packageResolvers(pkg) }, false);
    checkAdaptiveFiles(contents, document, path, reports.of(path));
  } else {
    checkDocument(document, reports, scoped);
    if (document.kind === "section") checkAdaptiveFiles(contents, document, path, reports.of(path));
  }
}

/**
 * Validates a content package: the manifest, the files it lists, and every document of its resources.
 *
 * - The files: a listed file must be in the package and every file of the package must be listed,
 *   and no file may be a personal needs profile or a results report.
 * - The resources: the file of a resource must hold the kind of document its type says, and the
 *   identifier of an item must be the one its LOM metadata gives.
 * - The documents: each item is checked as `validateAsi` checks it, with the response processing templates the package
 *   holds, and each test as `validateTest` checks it with the package's resolvers; the items of a test are those of the
 *   resources and are checked once. A document that cannot be read is an issue.
 * - What documents name: the settings, usage data and metadata files of an adaptive section, and the resolution
 *   and module files of a portable custom interaction, when their addresses are relative, must be in
 *   the package and listed.
 *
 * The manifest itself was checked when the package was read.
 *
 * @param pkg - The package, as `readPackage` or `openPackage` returns it.
 * @param options - See {@link ValidateOptions}; its `path` is not used: issues name the file each document is at.
 * @returns The issues: those of the manifest, then of each document in the order of the manifest.
 * @throws `DataError` when an argument has the wrong type.
 */
export function validatePackage(pkg: QtiPackage, options: ValidateOptions = {}): readonly Issue[] {
  const checked = checkValidateOptions(options);
  checkRecord(pkg, "The package must be an object");
  const reports = new Reports(checked.maxFindings);
  const manifestFindings = reports.of(MANIFEST_PATH);
  const contents = new Contents(pkg);
  checkListedFiles(pkg, manifestFindings);
  const documents = new Set<string>();
  const seen = new Set<string>();
  for (const resource of pkg.manifest.resources) {
    const kind = DOCUMENT_KINDS.get(resource.type);
    const path = kind === undefined ? undefined : mainPath(pkg, resource);
    if (kind === undefined || path === undefined || seen.has(path) || !pkg.paths.includes(path)) continue;
    seen.add(path);
    documents.add(path);
    let document: AsiDocument;
    try {
      document = pkg.document(path);
    } catch (error) {
      reports.of(path).adopt(failureIssues(error, path));
      continue;
    }
    if (document.kind !== kind) {
      const message = `The resource ${JSON.stringify(resource.identifier)} of the type ${resource.type} names ${JSON.stringify(path)}, which holds a ${document.kind}.`;
      manifestFindings.error("assesskit/validate/resource-type", message, "manifest/resources/resource");
      continue;
    }
    checkResource(contents, resource, path, document, reports, checked);
  }
  checkForeignDocuments(pkg, documents, manifestFindings);
  return reports.issues;
}
