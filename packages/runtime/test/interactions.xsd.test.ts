import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { ASI_NAMESPACE, readAsi, writeAsi } from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(resolve(import.meta.dirname, "../../..")));
});

afterAll(() => {
  schemas.close();
});

/** The item whose body is the markup. */
const itemOf = (body: string): string =>
  `<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="item" title="Item" time-dependent="false"><qti-response-declaration identifier="R" cardinality="single" base-type="identifier"/><qti-item-body>${body}</qti-item-body></qti-assessment-item>`;

const issuesOf = (xml: string) => validateXmlFiles(schemas, [{ path: "item.xml", content: xml }]);

/** Writes the item that `readAsi` reads from the markup, reads the written text back, and returns the schema's issues. */
async function writtenIssues(xml: string) {
  const written = writeAsi(readAsi(xml));
  expect(writeAsi(readAsi(written))).toBe(written);
  return issuesOf(written);
}

describe("the vocabularies of the interactions", () => {
  it("OrientationEnum: writes horizontal and vertical on a choice interaction that the schema accepts, and the schema refuses another term", async () => {
    const choice = (term: string): string =>
      itemOf(
        `<qti-choice-interaction response-identifier="R" orientation="${term}"><qti-simple-choice identifier="A">A</qti-simple-choice></qti-choice-interaction>`,
      );
    for (const term of ["horizontal", "vertical"]) expect(await writtenIssues(choice(term))).toEqual([]);
    expect(await issuesOf(choice("diagonal"))).not.toEqual([]);
  });

  it("TextFormatEnum: writes plain, preformatted and xhtml on an extended text interaction that the schema accepts, and the schema refuses another term", async () => {
    const extended = (term: string): string =>
      itemOf(`<qti-extended-text-interaction response-identifier="R" format="${term}"/>`);
    for (const term of ["plain", "preformatted", "xhtml"]) expect(await writtenIssues(extended(term))).toEqual([]);
    expect(await issuesOf(extended("html"))).not.toEqual([]);
  });

  it("MimeTypeList: writes the types of an upload interaction that the schema accepts, and the schema refuses a list with a token that is no type", async () => {
    const upload = (types: string): string =>
      itemOf(`<qti-upload-interaction response-identifier="R" type="${types}"/>`);
    for (const types of ["image/png", "image/png text/plain application/pdf", "application/vnd.ms-excel"]) {
      expect(await writtenIssues(upload(types))).toEqual([]);
    }
    expect(await issuesOf(upload("image/png banana"))).not.toEqual([]);
  });

  it("the data-ak-record attributes of an upload interaction: the schema accepts them, and they read and write back as they are", async () => {
    const recording = itemOf(
      `<qti-upload-interaction response-identifier="R" type="audio/webm audio/mp4 audio/ogg" data-ak-record-start="15" data-ak-record-limit="45" data-ak-record-once="true"/>`,
    );
    expect(await issuesOf(recording)).toEqual([]);
    expect(await writtenIssues(recording)).toEqual([]);
    const written = writeAsi(readAsi(recording));
    for (const attribute of ['data-ak-record-start="15"', 'data-ak-record-limit="45"', 'data-ak-record-once="true"']) {
      expect(written).toContain(attribute);
    }
  });
});
