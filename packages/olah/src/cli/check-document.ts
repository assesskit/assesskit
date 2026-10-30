import { ASI_NAMESPACE, readAsi } from "../asi/index.js";
import { type Issue, ReadError, SecurityError } from "../errors.js";
import { readManifest } from "../package/index.js";
import { PNP_ALTERNATE_NAMESPACES, PNP_NAMESPACE, readPnp } from "../pnp/index.js";
import { RESULTS_NAMESPACE, readResults } from "../results/index.js";
import { readUsageData, USAGE_NAMESPACE } from "../usage/index.js";
import { validateAsi, validatePnp, validatePnpNamespace, validateResults } from "../validate/index.js";
import { parseXml, type XmlElement } from "../xml/index.js";

/** The local name of the root of a manifest; the reader checks its namespace. */
const MANIFEST_ROOT = "manifest";

/** Returns the issues of a PNP document: those of its profiles, and its elements in a namespace of the examples (L15). */
function pnpIssues(root: XmlElement): readonly Issue[] {
  const read = readPnp(root);
  const profiles = Array.isArray(read) ? read.map(({ profile }) => profile) : [read];
  return [...profiles.flatMap((profile) => validatePnp(profile)), ...validatePnpNamespace(root)];
}

/** Reads a document as the kind its root names and returns the issues of the checks of that kind. */
function readIssues(root: XmlElement, path: string): readonly Issue[] {
  const { namespace, name } = root;
  if (namespace === ASI_NAMESPACE) return validateAsi(readAsi(root, { path }), { path });
  if (namespace === RESULTS_NAMESPACE) return validateResults(readResults(root));
  if (namespace === PNP_NAMESPACE || PNP_ALTERNATE_NAMESPACES.includes(namespace)) return pnpIssues(root);
  // The readers of usage data and of a manifest have the only checks of these kinds: a manifest alone has no files.
  if (namespace === USAGE_NAMESPACE) readUsageData(root);
  else if (name === MANIFEST_ROOT) readManifest(root, { path });
  return [];
}

/** Names the file in the location of the issues that do not. */
function located(issues: readonly Issue[], path: string): readonly Issue[] {
  return issues.map((issue) =>
    issue.location?.path === undefined ? { ...issue, location: { ...issue.location, path } } : issue,
  );
}

/**
 * Returns the semantic issues of a document: it is read as the kind its root element names (an assessment document,
 * results report, PNP document, usage data or manifest), and the kinds that `validate` has checks for get them (L12). A
 * document that cannot be parsed, or whose root is of another kind, has no issues here: the schema check reports it.
 *
 * @param content - The document.
 * @param path - The path that issues name.
 */
export function documentIssues(content: Uint8Array, path: string): readonly Issue[] {
  let root: XmlElement;
  try {
    root = parseXml(content, { path });
  } catch (error) {
    if (error instanceof ReadError || error instanceof SecurityError) return [];
    throw error;
  }
  try {
    return located(readIssues(root, path), path);
  } catch (error) {
    if (error instanceof ReadError) return located(error.issues, path);
    throw error;
  }
}
