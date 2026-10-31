/**
 * QTI content packages: the manifest, ZIP archives with the security checks of their limits, the documents of a package, the
 * resolvers that the delivery engine uses, LTI link documents and the dependency closure.
 *
 * @module @assesskit/runtime/package
 */
export { dependencyClosure } from "./closure.js";
export { type LtiExtensions, type LtiLink, type LtiVendor, ltiLaunchUrl, readLtiLink } from "./lti-link.js";
export {
  CPX_NAMESPACE,
  MANIFEST_SCHEMA_VERSION,
  MANIFEST_SCHEMAS,
  type Manifest,
  type ManifestMetadata,
  type ManifestSchema,
  RESOURCE_TYPES,
  type Resource,
  type ResourceFile,
  type ResourceType,
  type Variant,
} from "./manifest.js";
export {
  MANIFEST_PATH,
  type OpenPackageOptions,
  openPackage,
  type QtiPackage,
  type ReadPackageOptions,
  readPackage,
} from "./package.js";
export type { PackageFiles } from "./package-files.js";
export { resolveReference } from "./paths.js";
export { readManifest } from "./read-manifest.js";
export {
  type DeliverableItem,
  type LtiDeliverable,
  packageResolvers,
  type QtiDeliverable,
  type ResolvedItem,
  type ResolvedVariant,
  type Resolvers,
} from "./resolvers.js";
export { resourcePath } from "./resource-path.js";
export { writeManifest } from "./write-manifest.js";
export { writePackage } from "./write-package.js";
export { DEFAULT_ZIP_LIMITS, type ZipLimits } from "./zip-limits.js";
