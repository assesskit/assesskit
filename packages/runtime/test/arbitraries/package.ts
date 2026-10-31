import fc from "fast-check";
import { MANIFEST_SCHEMAS, type Manifest, RESOURCE_TYPES, type Resource, type ZipLimits } from "../../src/index.js";
import { buildZip, type RawEntry, type RawOptions } from "../zip-builder.js";
import { accessForAllResource, curriculumStandardsSet, lom, qtiMetadata, uri } from "./metadata.js";
import { defined, optional } from "./values.js";

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

/**
 * Names that archive tools write and attackers choose: absolute, parent segments, backslashes, drive letters, control
 * characters.
 */
const ENTRY_NAMES = [
  "imsmanifest.xml",
  "items/a.xml",
  "dir/",
  "../x",
  "/x",
  "a/../../b",
  "a/../b",
  "./a",
  "a//b",
  "a\\b",
  "C:/x",
  "C:",
  "a\u0000b",
  "a\u001fb",
  "a\u0085b",
  "",
  ".",
  "..",
  "./",
  "../",
  "é/ünï.txt",
  "\u202e.xml",
];

/** A value in the field of a header that is zero, a boundary of 16, 31 or 32 bits, or off by one from the truth. */
const headerValue = (truth: number): fc.Arbitrary<number | undefined> =>
  fc.constantFrom(undefined, 0, 1, Math.max(0, truth - 1), truth + 1, 0xffff, 0x7fffffff, 0xffffffff);

/**
 * A file of an archive whose headers say whatever a hostile tool writes. Its data is small, or zeros that compress to
 * almost nothing.
 */
const rawEntry: fc.Arbitrary<RawEntry> = fc
  .record({
    name: fc.oneof(fc.constantFrom(...ENTRY_NAMES), fc.stringMatching(/^[a-z]{1,3}(\/[a-z.]{1,3}){0,2}$/)),
    data: fc.oneof(
      fc.uint8Array({ maxLength: 64 }),
      fc.integer({ min: 0, max: 4000 }).map((length) => new Uint8Array(length)),
    ),
    method: fc.constantFrom(undefined, 0, 8, 1, 9, 12, 93),
    flags: fc.constantFrom(undefined, 0, 0x1, 0x8, 0x40, 0x800, 0x2000),
    host: fc.constantFrom(undefined, 0, 3, 19),
    externalAttributes: fc.constantFrom(undefined, 0, 0xa1ff0000, 0x81a40000),
    declaredSize: headerValue(0),
    declaredCompressedSize: headerValue(0),
    crc: fc.constantFrom(undefined, 0, 0xffffffff),
    localName: fc.constantFrom(undefined, "other.xml"),
    stored: fc.constantFrom(undefined, new Uint8Array([0x78, 0x9c]), new Uint8Array(40).fill(0xff)),
  })
  .map((fields) => defined(fields));

/** What the end record of a hostile archive declares: a disk number and an entry count. */
const rawOptions: fc.Arbitrary<RawOptions> = fc
  .record({
    disk: fc.constantFrom(undefined, 0, 1, 0xffff),
    declaredCount: fc.constantFrom(undefined, 0, 1, 0xffff, 100_000),
  })
  .map((fields) => defined(fields));

/** Archives built from entries with hostile headers: the manifest comes first about half of the time. */
export const hostileArchives: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.boolean(), fc.array(rawEntry, { maxLength: 4 }), rawOptions)
  .map(([withManifest, entries, options]) =>
    buildZip(withManifest ? [{ name: "imsmanifest.xml", data: new Uint8Array(8) }, ...entries] : entries, options),
  );

/** Limits small enough for the archives above to reach them; a limit left out keeps its default. */
export const smallZipLimits: fc.Arbitrary<Partial<ZipLimits>> = fc.record(
  {
    maxEntries: fc.integer({ min: 1, max: 6 }),
    maxEntryBytes: fc.integer({ min: 1, max: 4096 }),
    maxTotalBytes: fc.integer({ min: 1, max: 8192 }),
    maxRatio: fc.integer({ min: 1, max: 50 }),
  },
  { requiredKeys: [] },
);
