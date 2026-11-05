import { listDependencies, type QtiPackage, type Resource, resolveResourcePath } from "@assesskit/runtime/package";

/**
 * The resource of each main file of a package, the first in the manifest for a path, built once: every view of a session
 * looks up the resource of its item, and a search of the manifest costs as many resolutions of a path as it has resources.
 */
const RESOURCES_BY_PATH = new WeakMap<QtiPackage, ReadonlyMap<string, Resource>>();

/** Returns the resource whose main file is at a path, the first in the manifest. */
function resourceAt(pkg: QtiPackage, path: string): Resource | undefined {
  let byPath = RESOURCES_BY_PATH.get(pkg);
  if (byPath === undefined) {
    const built = new Map<string, Resource>();
    for (const resource of pkg.manifest.resources) {
      const main = resolveResourcePath(pkg.manifest, resource);
      if (main !== undefined && !built.has(main)) built.set(main, resource);
    }
    byPath = built;
    RESOURCES_BY_PATH.set(pkg, byPath);
  }
  return byPath.get(path);
}

/**
 * Returns the resource whose main file is the document, or the variant resource with that identifier, followed by the
 * resources it depends on, directly or through others.
 *
 * @param pkg - The package.
 * @param document - The path of the document.
 * @param variant - The identifier of a variant resource; `undefined` to find the resource by the path of the document.
 * @returns The resources; none when the manifest has no such resource.
 */
export function dependenciesOf(pkg: QtiPackage, document: string, variant: string | undefined): readonly Resource[] {
  const { manifest } = pkg;
  const resource =
    variant === undefined
      ? document === ""
        ? undefined
        : resourceAt(pkg, document)
      : manifest.resources.find((each) => each.identifier === variant);
  return resource === undefined ? [] : listDependencies(manifest, resource.identifier);
}
