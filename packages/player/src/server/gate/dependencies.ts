import { listDependencies, type QtiPackage, type Resource, resolveResourcePath } from "@assesskit/runtime/package";

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
  const resource = manifest.resources.find((each) =>
    variant === undefined
      ? document !== "" && resolveResourcePath(manifest, each) === document
      : each.identifier === variant,
  );
  return resource === undefined ? [] : listDependencies(manifest, resource.identifier);
}
