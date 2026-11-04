import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "@assesskit/runtime/node";
import { parseXml, type XmlElement } from "@assesskit/runtime/xml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { HTML_ELEMENT_NAMES } from "../src/player/content/internal.js";

/** The names of the elements that a schema declares, anywhere in it. */
function declaredElements(schema: XmlElement): string[] {
  const names: string[] = [];
  const visit = (node: XmlElement): void => {
    const name = node.attributes.find((attribute) => attribute.namespace === "" && attribute.name === "name");
    if (node.name === "element" && name !== undefined) names.push(name.value);
    for (const child of node.children) if (child.kind === "element") visit(child);
  };
  visit(schema);
  return names;
}

describe("html-elements", () => {
  it("names every HTML element that the ASI schema declares, and no other: the elements without the prefix qti-", () => {
    // The schema has 18.8 MB of text, most of it documentation, above the limit of a document; its hash is pinned.
    const schema = parseXml(
      readFileSync(join(requireSchemas(resolve(import.meta.dirname, "../../..")), "imsqti_asiv3p0p1_v1p0.xsd"), "utf8"),
      { limits: { maxBytes: 32 * 1024 * 1024 } },
    );
    const declared = new Set(declaredElements(schema).filter((name) => !name.startsWith("qti-")));
    expect([...HTML_ELEMENT_NAMES].sort()).toEqual([...declared].sort());
  });
});

describe("the markup of tabs and sortable tables", () => {
  let set: SchemaSet;
  beforeAll(async () => {
    set = await loadSchemaSet(requireSchemas(resolve(import.meta.dirname, "../../..")));
  });
  afterAll(() => set.close());

  const item = (body: string): string =>
    `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="item" title="Item" time-dependent="false"><qti-item-body>${body}</qti-item-body></qti-assessment-item>`;
  const issues = (body: string) => validateXmlFiles(set, [{ path: "item.xml", content: item(body) }]);

  const Tabs = `<div role="tablist" aria-label="Sources">
    <span role="tab" id="tab-email" aria-controls="panel-email" aria-selected="true">Email</span>
    <span role="tab" id="tab-memo" aria-controls="panel-memo">Memo</span>
  </div>
  <div role="tabpanel" id="panel-email" aria-labelledby="tab-email"><p>Email text.</p></div>
  <div role="tabpanel" id="panel-memo" aria-labelledby="tab-memo"><p>Memo text.</p></div>`;

  const Table = `<table>
    <thead><tr><th aria-sort="none">Region</th><th aria-sort="none">Revenue</th></tr></thead>
    <tbody><tr><td>North</td><td data-ak-sort-value="1200">$1,200</td></tr></tbody>
  </table>`;

  it("is valid against the ASI schema", async () => {
    expect(await issues(Tabs)).toEqual([]);
    expect(await issues(Table)).toEqual([]);
  });

  it("accepts the attributes of a timed recording and of a count of words, which QTI leaves to the player", async () => {
    const upload =
      '<qti-upload-interaction response-identifier="R" type="audio/webm" data-ak-record-start="15" data-ak-record-limit="45" data-ak-record-once="true"/>';
    expect(await issues(upload)).toEqual([]);
    expect(await issues('<qti-extended-text-interaction response-identifier="R" data-ak-count="words"/>')).toEqual([]);
  });

  it("makes a tab a span, because the schema has no button", async () => {
    expect(await issues('<div role="tablist"><button role="tab" aria-controls="p">One</button></div>')).not.toEqual([]);
  });
});
