// The row against Longsight times the build, as Longsight loads from node_modules; the other benchmarks time the sources.
import * as built from "@assesskit/runtime";
import { parseQtiPackage } from "@longsightgroup/qti3-core";
import fc from "fast-check";
import { inflateSync } from "fflate";
import { expect, test } from "vitest";
import {
  type AsiDocument,
  createPackageResolvers,
  type Manifest,
  type Resource,
  readPackage,
  writeAsi,
  writePackage,
} from "../src/index.js";
import { modelArbitrary } from "./arbitraries/asi.js";
import { lom, qtiMetadata } from "./arbitraries/metadata.js";
import { BENCH_OPTIONS, BUDGETS, compareRow, expectWithin, LONGSIGHT_BUDGETS } from "./budgets.js";

/** The items of the package, and the depth of the generated items: about 7 KB each, like items with a prompt and choices. */
const ITEMS = 1000;
/** The items of the package that both the runtime and Longsight read in full, which takes about a millisecond an item. */
const COMPARED_ITEMS = 200;
const ITEM_DEPTH = 2;
const SEED = 42;
/** The directory that the hrefs of the resolvers resolve against: the root of the package. */
const BASE = "";

const path = (index: number): string => `items/item-${String(index).padStart(4, "0")}.xml`;

/**
 * An item bank of generated items with generated metadata, written as an archive, with the bytes of its items. The items
 * that include a fragment are left out: the bank has no fragment file for them.
 */
function itemBank(count = ITEMS): { readonly zip: Uint8Array; readonly bytes: number } {
  const items = fc.sample(
    modelArbitrary("AssessmentItem", "qti-assessment-item", ITEM_DEPTH)
      // A generated model is valid against the schema, which its type does not say.
      .map((item): AsiDocument => ({ kind: "item", item }) as AsiDocument)
      .map(writeAsi)
      .filter((text) => !text.includes("xi:include")),
    { numRuns: count, seed: SEED },
  );
  const metadata = fc.sample(fc.record({ qti: qtiMetadata, lom }), { numRuns: count, seed: SEED });
  const text = new TextEncoder();
  const resources = items.map(
    (_, index): Resource => ({
      identifier: `item-${index}`,
      type: "imsqti_item_xmlv3p0",
      href: path(index),
      metadata: metadata[index],
      files: [{ href: path(index) }],
      dependencies: [],
      variants: [],
    }),
  );
  const manifest: Manifest = { identifier: "bank", metadata: { schema: "QTI Item Bank" }, resources };
  const files = new Map(items.map((item, index) => [path(index), text.encode(item)]));
  const bytes = [...files.values()].reduce((sum, file) => sum + file.length, 0);
  return { zip: writePackage(manifest, files), bytes };
}

test("reads the manifest of a package of 1,000 items, and an item when it is first used", async ({
  annotate,
  bench,
}) => {
  const { zip, bytes } = itemBank();
  await annotate(`The package has ${ITEMS} items of ${bytes} bytes and an archive of ${zip.length} bytes.`);
  const used = [0, ITEMS / 2, ITEMS - 1];
  const pkg = readPackage(zip);
  expect(pkg.manifest.resources).toHaveLength(ITEMS);
  expect(pkg.paths).toHaveLength(ITEMS + 1);
  for (const index of used) expect(createPackageResolvers(pkg).items(path(index), BASE).deliverable.kind).toBe("qti");

  const read = await bench("read the package", () => readPackage(zip)).run(BENCH_OPTIONS);
  await expectWithin(annotate, "read the package", read, BUDGETS.packageRead);

  // Each run uses a package that has parsed nothing; the hook that reads it is outside the time.
  let resolvers = createPackageResolvers(readPackage(zip));
  const firstUse = await bench(
    "first use of 3 items",
    {
      beforeEach: () => {
        resolvers = createPackageResolvers(readPackage(zip));
      },
    },
    () => {
      for (const index of used) resolvers.items(path(index), BASE);
    },
  ).run({ ...BENCH_OPTIONS, time: 0 });
  await expectWithin(annotate, "first use of 3 items", firstUse, BUDGETS.packageFirstUse);
});

test("reads a package and every item in it within its budget against Longsight", async ({ annotate, bench }) => {
  const { zip } = itemBank(COMPARED_ITEMS);
  // Longsight takes the inflation of the archive from its host: the runtime's, fflate, so that both inflate alike.
  const options = { inflateRaw: (bytes: Uint8Array) => inflateSync(bytes) };
  const read = parseQtiPackage(zip, options);
  expect(read.items.filter(({ document }) => document !== undefined)).toHaveLength(COMPARED_ITEMS);
  const readAll = () => {
    const resolvers = built.createPackageResolvers(built.readPackage(zip));
    for (let index = 0; index < COMPARED_ITEMS; index++) resolvers.items(path(index), BASE);
  };
  await compareRow(
    { annotate, bench },
    {
      name: "read a package and its items",
      budget: LONGSIGHT_BUDGETS.package,
      runtime: readAll,
      reference: () => parseQtiPackage(zip, options),
    },
  );
});
