import { descendantNodes, type ModelNode, type PortableCustomInteraction } from "@assesskit/runtime/asi";
import type { CandidateView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import { type QtiPackage, resourcePath } from "@assesskit/runtime/package";
import {
  isPackageRelative,
  moduleConfigurationPaths,
  type PciModuleConfiguration,
  parseModuleResolution,
  resolvePciModules,
} from "@assesskit/runtime/pci";
import type { ViewDocuments } from "../../protocol/index.js";
import { dependenciesOf } from "./dependencies.js";
import { locateDocuments } from "./documents.js";

/** The properties of content nodes that name a file: `qti-file-href` keeps its reference in `value`. */
const REFERENCE_PROPERTIES = ["src", "srcset", "href", "data", "poster", "longdesc", "cite"] as const;

/** The paths of a package, as a set, per package. */
const PATH_SETS = new WeakMap<QtiPackage, ReadonlySet<string>>();

function pathsOf(pkg: QtiPackage): ReadonlySet<string> {
  let paths = PATH_SETS.get(pkg);
  if (paths === undefined) {
    paths = new Set(pkg.paths);
    PATH_SETS.set(pkg, paths);
  }
  return paths;
}

/** Returns the URLs of the candidates of a `srcset` (HTML Standard, the `srcset` attribute). */
function srcsetUrls(srcset: string): string[] {
  return srcset.split(",").flatMap((candidate) => candidate.trim().split(/\s+/u).slice(0, 1));
}

/** Returns the references that a node of content makes to files, as written. */
function referencesOf(node: ModelNode): string[] {
  const references: string[] = [];
  for (const property of REFERENCE_PROPERTIES) {
    const value: unknown = Reflect.get(node, property);
    if (typeof value !== "string") continue;
    if (property === "srcset") for (const url of srcsetUrls(value)) references.push(url);
    else references.push(value);
  }
  const value: unknown = Reflect.get(node, "value");
  if (node.kind === "file-href" && typeof value === "string") references.push(value);
  return references;
}

/** Returns the paths in the package of the files that nodes reference, resolved against the document that holds them. */
function referencedPaths(pkg: QtiPackage, base: string, nodes: readonly ModelNode[]): string[] {
  const present = pathsOf(pkg);
  return [...nodes, ...nodes.flatMap(descendantNodes)]
    .flatMap(referencesOf)
    .flatMap((reference) => pkg.resolve(base, reference) ?? [])
    .filter((path) => present.has(path));
}

/** Returns the files that the manifest lists for the resource whose main file is the document, and for its dependencies. */
function manifestFiles(pkg: QtiPackage, document: string, variant: string | undefined): string[] {
  const { manifest } = pkg;
  return dependenciesOf(pkg, document, variant).flatMap((each) => [
    ...(resourcePath(manifest, each) ?? []),
    ...each.files.flatMap((file) => resourcePath(manifest, each, file.href) ?? []),
  ]);
}

/**
 * Returns the deepest directory that holds all the paths, ending in `/`; `""`, the root of the package, when they share no
 * directory.
 */
function commonDirectory(paths: readonly string[]): string {
  const [first, ...others] = paths.map((path) => path.split("/").slice(0, -1));
  if (first === undefined) return "";
  let length = first.length;
  for (const directories of others) {
    let shared = 0;
    while (shared < length && directories[shared] === first[shared]) shared += 1;
    length = shared;
  }
  return length === 0 ? "" : `${first.slice(0, length).join("/")}/`;
}

/** Reads a module resolution file of the package; a file that is missing or is not one is left out. */
function configurationOf(pkg: QtiPackage, path: string): PciModuleConfiguration["primary"] {
  const bytes = pkg.file(path);
  if (bytes === undefined) return undefined;
  try {
    return parseModuleResolution(new TextDecoder().decode(bytes));
  } catch (error) {
    // The frame reports the failure of the modules; the gate only has no files to name for it.
    if (error instanceof DataError) return undefined;
    throw error;
  }
}

/** Returns the files of a PCI that the gate must serve: its module resolution files and its modules, with or without `.js`. */
function pciFiles(pkg: QtiPackage, interaction: PortableCustomInteraction): string[] {
  const present = pathsOf(pkg);
  const { primary, fallback } = moduleConfigurationPaths(interaction);
  const first = configurationOf(pkg, primary);
  const second = configurationOf(pkg, fallback);
  const configuration: PciModuleConfiguration = {
    ...(first === undefined ? {} : { primary: first }),
    ...(second === undefined ? {} : { fallback: second }),
  };
  const locations = resolvePciModules(interaction, configuration).flatMap((module) =>
    [module.primary, module.fallback].flatMap((location) =>
      location !== undefined && isPackageRelative(location) ? [location] : [],
    ),
  );
  return [primary, fallback, ...locations.flatMap((location) => [location, `${location}.js`])].filter((path) =>
    present.has(path),
  );
}

const isPortableInteraction = (node: ModelNode): node is PortableCustomInteraction =>
  node.kind === "portable-custom-interaction";

/** Returns the files that the content root of a view needs: the documents of the item, what its content references and what the manifest lists. */
function rootFiles(view: CandidateView, pkg: QtiPackage, documents: ViewDocuments): string[] {
  const { current } = view;
  const present = pathsOf(pkg);
  const files = [
    ...referencedPaths(pkg, documents.test, [...view.rubric, ...view.testFeedback]),
    ...view.test.stylesheets,
  ];
  if (current === undefined) return files.filter((path) => present.has(path));
  const more = [
    [documents.item],
    documents.stimuli,
    referencedPaths(pkg, documents.item, [
      ...current.body,
      ...current.modalFeedback,
      ...current.catalogs,
      ...(current.companionMaterials === undefined ? [] : [current.companionMaterials]),
    ]),
    ...current.stimuli.map((stimulus, index) => referencedPaths(pkg, documents.stimuli[index] ?? "", stimulus.body)),
    current.stylesheets,
    manifestFiles(pkg, documents.item, current.variant?.resource),
  ];
  for (const paths of more) for (const path of paths) files.push(path);
  return files.filter((path) => present.has(path));
}

/** Returns the portable custom interactions in the content of the item presented. */
function interactionsOf(view: CandidateView): PortableCustomInteraction[] {
  const { current } = view;
  if (current === undefined) return [];
  const nodes: readonly ModelNode[] = [...current.body, ...current.stimuli.flatMap((stimulus) => stimulus.body)];
  return [...nodes, ...nodes.flatMap(descendantNodes)].filter(isPortableInteraction);
}

/**
 * Collects the asset prefixes that a view needs: one for the content root and one for each portable custom interaction in
 * it.
 *
 * @remarks
 * The prefix of the root is the deepest directory that holds the documents of the root, the files its content references,
 * its stylesheets and those of the test, and the files the manifest lists for the item's resource and its dependencies. The prefix of an
 * interaction is the deepest directory that holds its modules and its module resolution files, since it may keep them
 * apart from the item. A relative URL under a prefix, such as a `define` of RequireJS or a `url()` of a stylesheet, then
 * resolves under the same token.
 *
 * A file under a prefix that no view references is served too: that is the price of relative resolution, and the
 * packaging guide recommends one folder per item. Keys stay safe because the gate denies by type and by content.
 *
 * @param view - The view that an envelope carries.
 * @param pkg - The package the session delivers.
 * @returns The prefixes, each a directory that ends in `/` or the empty root.
 * @throws `ReadError` when a document of the package that the lookup needs cannot be read.
 */
export function collectAssetPrefixes(view: CandidateView, pkg: QtiPackage): ReadonlySet<string> {
  const documents = locateDocuments(view, pkg);
  const prefixes = new Set<string>();
  const root = rootFiles(view, pkg, documents);
  if (root.length > 0) prefixes.add(commonDirectory(root));
  for (const interaction of interactionsOf(view)) {
    const files = pciFiles(pkg, interaction);
    if (files.length > 0) prefixes.add(commonDirectory(files));
  }
  return prefixes;
}
