import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseXml } from "@assesskit/runtime/xml";
import { ParseOption, XmlDocument } from "libxml2-wasm";
import { expect, test } from "vitest";
import { compareRow, LIBXML2_BUDGET } from "./budgets.js";
import { EXAMPLES } from "./corpus-items.js";

// The XML parser of the runtime against libxml2, compiled to WebAssembly by libxml2-wasm, with the work that both do: a
// tree from the bytes of a document. libxml2 parses as `validateXmlFiles` makes it parse, with no network and no external
// entity; the runtime parses with the limits of `parseXml`.

/** The options of libxml2 that `validateXmlFiles` gives it. */
const OPTIONS = {
  option: ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE | ParseOption.XML_PARSE_BIG_LINES,
};

/** Whether libxml2 makes a tree of the bytes. */
function libxml2Reads(bytes: Uint8Array): boolean {
  try {
    XmlDocument.fromBuffer(bytes, OPTIONS).dispose();
    return true;
  } catch {
    return false;
  }
}

/** Whether the runtime makes a tree of the bytes. */
function runtimeReads(bytes: Uint8Array): boolean {
  try {
    parseXml(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The bytes of every XML file of the 1EdTech examples that both parsers read, in path order. */
const DOCUMENTS = readdirSync(EXAMPLES, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".xml"))
  .sort()
  .map((path) => new Uint8Array(readFileSync(join(EXAMPLES, path))))
  .filter((bytes) => runtimeReads(bytes) && libxml2Reads(bytes));

test("parses the example documents from their bytes within its budget against libxml2", async ({ annotate, bench }) => {
  expect(DOCUMENTS.length).toBeGreaterThan(250);
  await compareRow(
    { annotate, bench },
    {
      name: "parse a document",
      budget: LIBXML2_BUDGET,
      runtime: () => {
        for (const bytes of DOCUMENTS) parseXml(bytes);
      },
      reference: () => {
        for (const bytes of DOCUMENTS) XmlDocument.fromBuffer(bytes, OPTIONS).dispose();
      },
    },
  );
});
