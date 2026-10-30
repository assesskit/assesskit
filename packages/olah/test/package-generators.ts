import fc from "fast-check";
import { MANIFEST_SCHEMAS, type Manifest, RESOURCE_TYPES, type Resource } from "../src/index.js";
import { accessForAllResource, curriculumStandardsSet, lom, qtiMetadata, uri } from "./metadata-generators.js";

const optional = <T>(value: fc.Arbitrary<T>): fc.Arbitrary<T | undefined> => fc.option(value, { nil: undefined });

/**
 * Manifests with up to four resources named `r0`, `r1` and so on, whose dependencies and variants name resources of the
 * manifest, as a manifest must, and with metadata, files, bases and hrefs of URI references.
 */
export const manifests: fc.Arbitrary<Manifest> = fc
  .record({
    base: optional(uri),
    resourcesBase: optional(uri),
    schema: fc.constantFrom(...MANIFEST_SCHEMAS),
    curriculumStandards: optional(curriculumStandardsSet),
    lom: optional(lom),
    resources: fc.array(
      fc.record({
        type: fc.constantFrom(...RESOURCE_TYPES),
        href: optional(uri),
        base: optional(uri),
        metadata: optional(
          fc.record({
            qti: optional(qtiMetadata),
            curriculumStandards: optional(curriculumStandardsSet),
            lom: optional(lom),
          }),
        ),
        files: fc.array(fc.record({ href: uri }), { minLength: 1, maxLength: 2 }),
        dependencies: fc.array(fc.nat(), { maxLength: 3 }),
        variants: fc.array(fc.record({ target: fc.nat(), drd: accessForAllResource }), { maxLength: 2 }),
      }),
      { maxLength: 4 },
    ),
  })
  .map(({ base, resourcesBase, schema, curriculumStandards, lom: manifestLom, resources }) => ({
    identifier: "m",
    base,
    resourcesBase,
    metadata: { schema, curriculumStandards, lom: manifestLom },
    resources: resources.map(
      ({ dependencies, variants, ...rest }, index): Resource => ({
        ...rest,
        identifier: `r${index}`,
        dependencies: dependencies.map((number) => `r${number % resources.length}`),
        variants: variants.map(({ target, drd }, position) => ({
          identifier: `v${index}_${position}`,
          identifierref: `r${target % resources.length}`,
          drd,
        })),
      }),
    ),
  }));
