import type { Resource } from "./manifest.js";

/** Indexes resources by identifier; if two resources share one, the first is kept. */
export function indexResources(resources: readonly Resource[]): Map<string, Resource> {
  const index = new Map<string, Resource>();
  for (const resource of resources) if (!index.has(resource.identifier)) index.set(resource.identifier, resource);
  return index;
}
