import type { AssessmentItem, AssessmentSection, AssessmentStimulus } from "../asi/index.js";
import { checkRecord, describe } from "../checks.js";
import { type AccessForAllResource, DRD_HAZARDS, type DrdHazard } from "../metadata/index.js";
import { readError } from "../xml/index.js";
import { type LtiLink, readLtiLink } from "./lti-link.js";
import type { Manifest, Resource } from "./manifest.js";
import type { QtiPackage } from "./package.js";
import { resolveReference } from "./paths.js";
import { indexResources } from "./resource-index.js";
import { resourcePath } from "./resource-path.js";

/** A QTI item that the engine can present. */
export interface QtiDeliverable {
  /** Tells a QTI item from an LTI link. */
  readonly kind: "qti";
  /** The item. */
  readonly item: AssessmentItem;
}

/** The link to an item that a tool provides over LTI. */
export interface LtiDeliverable {
  /** Tells an LTI link from a QTI item. */
  readonly kind: "lti";
  /** The identifier of the manifest resource of the link. */
  readonly identifier: string;
  /** The link. */
  readonly link: LtiLink;
}

/** An item the engine can present: a QTI item or the link to an item that a tool provides. */
export type DeliverableItem = QtiDeliverable | LtiDeliverable;

/** A variant of an item with the description of how it differs. */
export interface ResolvedVariant {
  /** The identifier of the manifest resource that is the variant. */
  readonly resource: string;
  /** What the variant presents. */
  readonly deliverable: DeliverableItem;
  /** The accessibility description on the link to the variant. */
  readonly drd: AccessForAllResource;
}

/** An item reference resolved: the item with the variants the engine may choose from. */
export interface ResolvedItem {
  /** The identifier of the manifest resource. */
  readonly resource: string;
  /** What the resource presents. */
  readonly deliverable: DeliverableItem;
  /** The hazards of the DRD of the variant links that point at this resource, without repeats, in document order. */
  readonly hazards: readonly DrdHazard[];
  /** The variants linked from this resource. */
  readonly variants: readonly ResolvedVariant[];
}

/**
 * The functions that resolve the references of a test to what they name. Each takes the `href` as written and the path of
 * the document that holds it, and returns its value, never a promise: the engine and the validators throw a `DataError`
 * for a promise.
 */
export interface Resolvers {
  /** Resolves the `href` of a `qti-assessment-item-ref`. */
  readonly items: (href: string, base: string) => ResolvedItem;
  /** Resolves the `href` of a `qti-assessment-section-ref`. */
  readonly sections: (href: string, base: string) => AssessmentSection;
  /** Resolves the `href` of a `qti-assessment-stimulus-ref`. */
  readonly stimuli: (href: string, base: string) => AssessmentStimulus;
}

/** The resource types an item reference may name: a QTI item or an LTI link. */
const ITEM_TYPES: readonly Resource["type"][] = ["imsqti_item_xmlv3p0", "imsbasiclti_xmlv1p3"];

/** Returns the path of the main file of a resource: its href, or its only file when it has no href. */
function mainPath(manifest: Manifest, resource: Resource): string | undefined {
  const [only, ...others] = resource.files;
  if (resource.href === undefined && only !== undefined && others.length === 0)
    return resourcePath(manifest, resource, only.href);
  return resourcePath(manifest, resource);
}

function isDrdHazard(term: string): term is DrdHazard {
  return DRD_HAZARDS.some((hazard) => hazard === term);
}

/** The DRD hazards of the variant links that point at each resource, in document order. */
function incomingHazards(resources: readonly Resource[]): Map<string, DrdHazard[]> {
  const hazards = new Map<string, DrdHazard[]>();
  for (const resource of resources) {
    for (const variant of resource.variants) {
      const known = hazards.get(variant.identifierref) ?? [];
      for (const term of variant.drd.hazard) if (isDrdHazard(term) && !known.includes(term)) known.push(term);
      hazards.set(variant.identifierref, known);
    }
  }
  return hazards;
}

/**
 * Builds the resolvers of the engine over a package. An item reference resolves to the manifest resource of type
 * `imsqti_item_xmlv3p0` or `imsbasiclti_xmlv1p3` whose main file, its `href` or its only file, is the file the reference names, so that the item comes with
 * its variants and their DRD; the engine chooses among them. Section and stimulus references resolve to the
 * document at their path. All resolvers are synchronous: the package holds the files.
 *
 * @param pkg - The opened package.
 * @returns The resolvers of the package.
 * @throws `DataError` when the argument is not a package.
 * @throws `ReadError` from the resolvers, when a reference is outside the package, names no resource of the right type,
 * names a file that is missing or is not a document of the expected kind.
 */
export function packageResolvers(pkg: QtiPackage): Resolvers {
  checkRecord(pkg, "The package must be an object");
  const { manifest } = pkg;
  const resources = indexResources(manifest.resources);
  const itemsByPath = new Map<string, Resource>();
  for (const resource of manifest.resources) {
    const path = ITEM_TYPES.includes(resource.type) ? mainPath(manifest, resource) : undefined;
    if (path !== undefined && !itemsByPath.has(path)) itemsByPath.set(path, resource);
  }
  const hazards = incomingHazards(manifest.resources);

  const pathOf = (href: string, base: string): string => {
    const path = resolveReference(base, href);
    if (path === undefined) {
      const message = `The reference ${describe(href)} in ${describe(base)} is outside the package.`;
      throw readError("assesskit/package/outside-package", message, { path: base });
    }
    return path;
  };

  const deliverable = (resource: Resource, base: string): DeliverableItem => {
    const path = mainPath(manifest, resource);
    if (path === undefined) {
      const message = `The resource ${describe(resource.identifier)} has no main file inside the package.`;
      throw readError("assesskit/package/resource-href", message, { path: base });
    }
    if (resource.type === "imsbasiclti_xmlv1p3") {
      const bytes = pkg.file(path);
      if (bytes === undefined)
        throw readError("assesskit/package/missing-file", `The package has no file ${describe(path)}.`, {
          path: base,
        });
      return { kind: "lti", identifier: resource.identifier, link: readLtiLink(bytes, { path }) };
    }
    const document = pkg.document(path);
    if (document.kind !== "item") {
      const message = `The resource ${describe(resource.identifier)} names ${describe(path)}, which is a ${document.kind}, not an item.`;
      throw readError("assesskit/package/document-kind", message, { path });
    }
    return { kind: "qti", item: document.item };
  };

  return {
    items: (href, base) => {
      const path = pathOf(href, base);
      const resource = itemsByPath.get(path);
      if (resource === undefined) {
        const message = `The manifest has no item resource for the reference ${describe(href)} in ${describe(base)}, which names ${describe(path)}.`;
        throw readError("assesskit/package/unknown-resource", message, { path: base });
      }
      return {
        resource: resource.identifier,
        deliverable: deliverable(resource, base),
        hazards: hazards.get(resource.identifier) ?? [],
        variants: resource.variants.map((variant) => {
          const target = resources.get(variant.identifierref);
          if (target === undefined) {
            const message = `The variant ${describe(variant.identifier)} links to ${describe(variant.identifierref)}, which is no resource of the manifest.`;
            throw readError("assesskit/package/dangling-reference", message, { path: base });
          }
          return { resource: target.identifier, deliverable: deliverable(target, base), drd: variant.drd };
        }),
      };
    },
    sections: (href, base) => {
      const path = pathOf(href, base);
      const document = pkg.document(path);
      if (document.kind !== "section") {
        const message = `The reference ${describe(href)} names ${describe(path)}, which is a ${document.kind}, not a section.`;
        throw readError("assesskit/package/document-kind", message, { path });
      }
      return document.section;
    },
    stimuli: (href, base) => {
      const path = pathOf(href, base);
      const document = pkg.document(path);
      if (document.kind !== "stimulus") {
        const message = `The reference ${describe(href)} names ${describe(path)}, which is a ${document.kind}, not a stimulus.`;
        throw readError("assesskit/package/document-kind", message, { path });
      }
      return document.stimulus;
    },
  };
}
