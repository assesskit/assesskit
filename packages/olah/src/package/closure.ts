import { checkArray, checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";
import type { Manifest, Resource } from "./manifest.js";
import { indexResources } from "./resource-index.js";

/**
 * Returns a resource with the resources it depends on, directly or through other dependencies (BIND §8.1 to §8.5): the
 * resource first, then each dependency once in depth-first order, following the order of the `dependency` elements. A
 * cycle ends where it closes. Variants are not part of the closure: `packageResolvers` returns them.
 *
 * @param manifest - The manifest.
 * @param resourceIdentifier - The identifier of the resource to start from.
 * @throws `DataError` when an argument has the wrong type, the manifest has no such resource, or a dependency names no resource.
 */
export function dependencyClosure(manifest: Manifest, resourceIdentifier: string): readonly Resource[] {
  checkRecord(manifest, "The manifest must be an object");
  checkArray(manifest.resources, "The resources of the manifest must be an array");
  checkString(resourceIdentifier, "The resource identifier");
  const byIdentifier = indexResources(manifest.resources);
  const closure = new Map<string, Resource>();
  const visit = (identifier: string, dependent: string | undefined): void => {
    if (closure.has(identifier)) return;
    const resource = byIdentifier.get(identifier);
    if (resource === undefined) {
      throw new DataError(
        dependent === undefined
          ? `The manifest has no resource ${describe(identifier)}.`
          : `The resource ${describe(dependent)} depends on ${describe(identifier)}, which is no resource of the manifest.`,
      );
    }
    closure.set(identifier, resource);
    for (const dependency of resource.dependencies) visit(dependency, identifier);
  };
  visit(resourceIdentifier, undefined);
  return [...closure.values()];
}
