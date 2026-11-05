import { checkArray, checkRecord, checkString } from "../checks.js";
import { checkOptions } from "../checks-internal.js";
import type { Manifest, Resource } from "./manifest.js";
import type { QtiPackage } from "./package.js";
import { resolveReference } from "./paths.js";

/** The options of {@link resolveResourcePath}. */
export interface ResolveResourcePathOptions {
  /**
   * The reference to resolve, such as the `href` of one of the files of the resource.
   *
   * @defaultValue the `href` of the resource, or the `href` of its only file when it has no `href`
   */
  readonly href?: string;
}

/** Returns the href of the main file of a resource: its `href`, or the href of its only file. */
function mainHref(resource: Resource): string | undefined {
  if (resource.href !== undefined) return resource.href;
  checkArray(resource.files, "The files of a resource must be an array");
  const [only, ...others] = resource.files;
  return others.length === 0 ? only?.href : undefined;
}

/**
 * Returns the path in the package that an href of a resource names. The href is resolved against the `xml:base` of the
 * manifest, of its `resources` element and of the resource, each against the one before.
 *
 * @param manifest - The manifest the resource is in.
 * @param resource - The resource.
 * @param options - See {@link ResolveResourcePathOptions}.
 * @returns The normalized path; `undefined` when the resource has no main file to resolve, or the reference is outside the
 * package (see {@link QtiPackage.resolve}).
 * @throws `DataError` when an argument has the wrong type.
 */
export function resolveResourcePath(
  manifest: Manifest,
  resource: Resource,
  options: ResolveResourcePathOptions = {},
): string | undefined {
  checkRecord(manifest, "The manifest must be an object");
  checkRecord(resource, "The resource must be an object");
  checkOptions(options);
  const target = options.href ?? mainHref(resource);
  if (target === undefined) return undefined;
  checkString(target, "The href");
  let base = "";
  for (const value of [manifest.base, manifest.resourcesBase, resource.base]) {
    if (value === undefined) continue;
    const next = resolveReference(base, value);
    if (next === undefined) return undefined;
    base = next;
  }
  return resolveReference(base, target);
}
