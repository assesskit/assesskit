import type { CandidateView } from "@luthfanwakan/olah/delivery";
import { resolveStructure, type TestStructure } from "@luthfanwakan/olah/delivery";
import {
  packageResolvers,
  type QtiPackage,
  type Resolvers,
  resolveReference,
  resourcePath,
} from "@luthfanwakan/olah/package";
import { type DocumentSource, type ViewDocuments, viewDocuments } from "../../protocol/index.js";

/** A test of a package with its structure resolved, which every session of the test shares. */
interface LocatedTest {
  /** The path of the test document. */
  readonly path: string;
  /** The test with its section references resolved. */
  readonly structure: TestStructure;
}

/** The tests of a package, by the identifier of the test; a package that has none for an identifier holds `undefined`. */
const TESTS = new WeakMap<QtiPackage, Map<string, LocatedTest | undefined>>();

/** The resolvers of a package, built once. */
const RESOLVERS = new WeakMap<QtiPackage, Resolvers>();

function resolversOf(pkg: QtiPackage): Resolvers {
  let resolvers = RESOLVERS.get(pkg);
  if (resolvers === undefined) {
    resolvers = packageResolvers(pkg);
    RESOLVERS.set(pkg, resolvers);
  }
  return resolvers;
}

/** Finds the test with the identifier among the test resources of the package, and resolves its structure. */
function findTest(pkg: QtiPackage, identifier: string): LocatedTest | undefined {
  for (const resource of pkg.manifest.resources) {
    if (resource.type !== "imsqti_test_xmlv3p0") continue;
    const path = resourcePath(pkg.manifest, resource);
    if (path === undefined) continue;
    const document = pkg.document(path);
    if (document.kind === "test" && document.test.identifier === identifier) {
      return { path, structure: resolveStructure(document.test, path, resolversOf(pkg)) };
    }
  }
  return undefined;
}

function testOf(pkg: QtiPackage, identifier: string): LocatedTest | undefined {
  let tests = TESTS.get(pkg);
  if (tests === undefined) {
    tests = new Map();
    TESTS.set(pkg, tests);
  }
  if (!tests.has(identifier)) tests.set(identifier, findTest(pkg, identifier));
  return tests.get(identifier);
}

/** Returns the path of the main file of the item resource whose item has the identifier: the item of a session that delivers one item alone (E12). */
function standaloneItemPath(pkg: QtiPackage, identifier: string): string | undefined {
  for (const resource of pkg.manifest.resources) {
    if (resource.type !== "imsqti_item_xmlv3p0") continue;
    const path = resourcePath(pkg.manifest, resource);
    if (path === undefined) continue;
    const document = pkg.document(path);
    if (document.kind === "item" && document.item.identifier === identifier) return path;
  }
  return undefined;
}

/** Tells whether the file at a path is the link of an LTI resource, a document of the LTI schema and not of QTI (BPIG 6.2.9). */
function isLtiLink(pkg: QtiPackage, path: string): boolean {
  return pkg.manifest.resources.some(
    (resource) => resource.type === "imsbasiclti_xmlv1p3" && resourcePath(pkg.manifest, resource) === path,
  );
}

/** Returns the paths of the stimuli an item names, resolved against its document. */
function stimulusPaths(pkg: QtiPackage, itemPath: string): readonly string[] {
  const document = pkg.document(itemPath);
  if (document.kind !== "item") return [];
  return document.item.stimulusRefs.map((ref) => resolveReference(itemPath, ref.href) ?? "");
}

/** Returns where the documents of the session of a view are: those of the test, else those of the item delivered alone. */
function sourceOf(pkg: QtiPackage, identifier: string): DocumentSource | undefined {
  const test = testOf(pkg, identifier);
  if (test !== undefined) {
    return {
      test: test.path,
      item: (reference) => {
        const node = test.structure.itemRef(reference);
        const path = node === undefined ? undefined : resolveReference(node.base, node.model.href);
        // A link to a tool has no document of QTI to read, and no content that the gate serves.
        return path === undefined || isLtiLink(pkg, path) ? undefined : { path, stimuli: stimulusPaths(pkg, path) };
      },
    };
  }
  const alone = standaloneItemPath(pkg, identifier);
  return alone === undefined
    ? undefined
    : { test: "", item: () => ({ path: alone, stimuli: stimulusPaths(pkg, alone) }) };
}

/**
 * Locates the documents that the content of a view comes from: the test, the item presented and its stimuli.
 *
 * @param view - The view of a session of a test of the package, or of an item of it that was delivered alone.
 * @param pkg - The package the session delivers.
 * @throws `ReadError` when a document of the package that the lookup needs cannot be read.
 */
export function locateDocuments(view: CandidateView, pkg: QtiPackage): ViewDocuments {
  return viewDocuments(view, sourceOf(pkg, view.test.identifier));
}
