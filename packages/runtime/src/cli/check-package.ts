import { type Issue, ReadError } from "../errors.js";
import { readPackageFile, type SchemaSet, validateXmlFiles } from "../node/index.js";
import type { QtiPackage } from "../package/index.js";
import { validatePackage } from "../validate/index.js";

/** The code of the issue for a document whose root is in a namespace that no pinned schema describes. */
const NO_SCHEMA = "assesskit/node/no-schema";

/** Returns the schema issues of a file of a package: a package may hold XML that is not QTI, such as an LTI link. */
async function schemaIssues(pkg: QtiPackage, path: string, schemas: SchemaSet): Promise<readonly Issue[]> {
  let content: Uint8Array | undefined;
  try {
    content = pkg.file(path);
  } catch (error) {
    if (error instanceof ReadError) return error.issues;
    throw error;
  }
  if (content === undefined) return [];
  const issues = await validateXmlFiles(schemas, [{ path, content }]);
  return issues.filter(({ code }) => code !== NO_SCHEMA);
}

/**
 * Returns the issues of a package given as a ZIP file or a directory: the schema issues of every XML file of the
 * package, one file at a time, then those of `validatePackage`. A package whose manifest cannot be read has the issues
 * of its reader only.
 *
 * @param path - The ZIP file or the directory of the package.
 * @param schemas - The loaded schemas.
 * @returns The schema issues of each XML file, then the issues of `validatePackage`.
 * @throws `DataError` when the path cannot be read.
 * @throws `SecurityError` when the package breaks a limit or a security rule of `readPackageFile`, such as a symbolic
 * link or a path that leaves the package.
 */
export async function packageIssues(path: string, schemas: SchemaSet): Promise<readonly Issue[]> {
  let pkg: QtiPackage;
  try {
    pkg = await readPackageFile(path);
  } catch (error) {
    if (error instanceof ReadError) return error.issues;
    throw error;
  }
  const issues: Issue[] = [];
  for (const file of pkg.paths.filter((each) => each.toLowerCase().endsWith(".xml"))) {
    issues.push(...(await schemaIssues(pkg, file, schemas)));
  }
  return [...issues, ...validatePackage(pkg)];
}
