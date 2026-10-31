import { dependencyClosure, type QtiPackage, type Resource, resourcePath } from "@assesskit/runtime/package";

/**
 * Returns the resource whose main file is the document, or the variant resource with that identifier, followed by the
 * resources it depends on, directly or through others; none when the manifest has no such resource.
 */
export function dependenciesOf(pkg: QtiPackage, document: string, variant: string | undefined): readonly Resource[] {
  const { manifest } = pkg;
  const resource = manifest.resources.find((each) =>
    variant === undefined ? document !== "" && resourcePath(manifest, each) === document : each.identifier === variant,
  );
  return resource === undefined ? [] : dependencyClosure(manifest, resource.identifier);
}
