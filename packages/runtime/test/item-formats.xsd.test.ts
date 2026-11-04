import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { writeAsi } from "../src/asi/index.js";
import { readGift, readMoodleXml, writeGift } from "../src/item-formats/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { readFixture } from "./fixtures.js";
import { buildWrittenItems, HTML_EDGES, WRITE_OPTIONS } from "./item-formats-cases.js";

const root = resolve(import.meta.dirname, "../../..");

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(root));
});

afterAll(() => {
  schemas.close();
});

/** The files of `item-formats-moodle.json`: each case's file and Moodle's export of each question. */
interface MoodleFiles {
  readonly cases: readonly {
    readonly format: string;
    readonly file: string;
    readonly moodle: { readonly questions: readonly { readonly gift: string; readonly xml: string }[] };
  }[];
}

describe("readGift", () => {
  it("reads items that the official schema accepts, from each file of the fixture and each export of Moodle", async () => {
    const { cases } = readFixture<MoodleFiles>("item-formats-moodle.json");
    const read = cases.flatMap(({ format, file, moodle }) => [
      ...(format === "gift" ? readGift(file).items : readMoodleXml(file).items),
      ...moodle.questions.flatMap(({ gift, xml }) => [
        ...readGift(gift).items,
        ...readMoodleXml(`<quiz>${xml}</quiz>`).items,
      ]),
    ]);
    read.push(...Object.values(HTML_EDGES).flatMap((gift) => readGift(gift).items));
    const files = read.map(({ item }, at) => ({
      path: `${at}-${item.identifier}.xml`,
      content: writeAsi({ kind: "item", item }),
    }));
    expect(files.length).toBeGreaterThan(40);
    expect(await validateXmlFiles(schemas, files)).toStrictEqual([]);
  });

  it("reads back the items that writeGift writes as items that the official schema accepts", async () => {
    const { items } = readGift(writeGift(buildWrittenItems(), WRITE_OPTIONS).text);
    const files = items.map(({ item }) => ({
      path: `${item.identifier}.xml`,
      content: writeAsi({ kind: "item", item }),
    }));
    expect(await validateXmlFiles(schemas, files)).toStrictEqual([]);
  });
});
