import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { XsdValidator } from "libxml2-wasm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import { DataError } from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles, type XmlFile } from "../src/node/index.js";
import { PRIMARY_SCHEMAS } from "../src/node/internal.js";
import { parseXml } from "../src/xml/index.js";
import { runGuideSamples } from "./guide-samples.js";

const root = resolve(import.meta.dirname, "../../..");
const schemaDirectory = requireSchemas(root);
const examples = join(requireCorpus(root), "qti-examples/qtiv3-examples");

const ASI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
const ASI_301 = "https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd";
const ASI_300 = "https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0_v1p0.xsd";

function example(path: string): XmlFile {
  return { path, content: new Uint8Array(readFileSync(join(examples, path))) };
}

/** An item that is valid under the ASI schema, with its body replaced by the given markup. */
function item(body: string, location = ASI_301): XmlFile {
  const content = `<qti-assessment-item xmlns="${ASI}" xmlns:xi="http://www.w3.org/2001/XInclude" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${ASI} ${location}" identifier="i" title="t" adaptive="false" time-dependent="false"><qti-item-body>${body}</qti-item-body></qti-assessment-item>`;
  return { path: "item.xml", content };
}

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(schemaDirectory);
});

afterAll(() => {
  schemas.close();
});

describe("loading schemas", () => {
  it("loads the pinned schemas from the directory that pnpm schemas fills", () => {
    expect(schemas.directory).toBe(schemaDirectory);
  });

  it("closes a set once, after which it validates nothing", async () => {
    const own = await loadSchemaSet(schemaDirectory);
    own.close();
    own.close();
    await expect(validateXmlFiles(own, [])).rejects.toThrow(new DataError("The schema set is closed."));
  });
});

describe("validating documents", () => {
  it("accepts the 1EdTech example items and test under the ASI schema", async () => {
    const files = [
      "packaging/items/choice.xml",
      "packaging/items/adaptive_template.xml",
      "packaging/items/Example03-feedbackBlock-solution-random.xml",
      "packaging/items/associate.xml",
      "tests/rtest01.xml",
    ].map(example);
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });

  it("accepts the same examples against the 3.0.1 schema when they name it", async () => {
    const files = ["packaging/items/choice.xml", "tests/rtest01.xml"].map((path) => {
      const text = readFileSync(join(examples, path), "utf8").replaceAll(ASI_300, ASI_301);
      return { path, content: text };
    });
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });

  it("rejects choice.xml without time-dependent, naming the schema, the attribute and the line", async () => {
    const text = readFileSync(join(examples, "packaging/items/choice.xml"), "utf8").replace(
      ' time-dependent="false"',
      "",
    );
    expect(await validateXmlFiles(schemas, [{ path: "choice.xml", content: text }])).toEqual([
      {
        severity: "error",
        code: "assesskit/node/xsd-invalid",
        message: `Element '{${ASI}}qti-assessment-item': The attribute 'time-dependent' is required but missing.`,
        location: { path: "choice.xml", line: 3 },
      },
    ]);
  });

  it("accepts results and usage data, and reports the example that is not well-formed", async () => {
    const valid = ["results/report.xml", "results/conformance-use-case-1.xml", "usageData/example.xml"].map(example);
    expect(await validateXmlFiles(schemas, valid)).toEqual([]);
    const issues = await validateXmlFiles(schemas, [example("results/full-example.xml")]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "assesskit/xml/not-well-formed",
      location: { path: "results/full-example.xml" },
    });
  });

  it("accepts a content package manifest", async () => {
    expect(await validateXmlFiles(schemas, [example("packaging/simple/imsmanifest.xml")])).toEqual([]);
  });

  it("accepts xi:include with an xi:fallback where the schema allows it, and rejects a bad include", async () => {
    const include = '<xi:include href="fragments/choice.xml"><xi:fallback><p>Missing.</p></xi:fallback></xi:include>';
    expect(await validateXmlFiles(schemas, [item(`<p>Before.</p>${include}`)])).toEqual([]);
    const issues = await validateXmlFiles(schemas, [item('<xi:include href="a.xml" parse="binary"/>')]);
    expect(issues.map(({ code }) => code)).toContain("assesskit/node/xsd-invalid");
  });

  it("rejects an element the schema does not know, with the position of the document", async () => {
    const issues = await validateXmlFiles(schemas, [item("<qti-nothing/>")]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: "error",
      code: "assesskit/node/xsd-invalid",
    });
    expect(issues[0]?.message).toContain("qti-nothing");
  });

  it("takes the schema that the document's xsi:schemaLocation names", async () => {
    const single = "https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_itemv3p0p1_v1p0.xsd";
    for (const hint of [ASI_300, single]) {
      const issues = await validateXmlFiles(schemas, [item("<qti-nothing/>", hint)]);
      expect(issues.map(({ code }) => code)).toEqual(["assesskit/node/xsd-invalid"]);
    }
  });

  it("validates a single-document schema's document type: an item schema accepts an item and not a test", async () => {
    const itemSchema = "https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_itemv3p0p1_v1p0.xsd";
    expect(await validateXmlFiles(schemas, [item("<p>Hello</p>", itemSchema)])).toEqual([]);
    const test = `<qti-assessment-test xmlns="${ASI}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${ASI} ${itemSchema}" identifier="t" title="t"/>`;
    const issues = await validateXmlFiles(schemas, [{ path: "test.xml", content: test }]);
    expect(issues[0]?.message).toContain("No matching global declaration");
  });

  it("reports a root in a namespace without a schema", async () => {
    const issues = await validateXmlFiles(schemas, [
      { path: "x.xml", content: '<a xmlns="urn:other"/>' },
      { path: "y.xml", content: "<b/>" },
    ]);
    expect(issues).toEqual([
      {
        severity: "error",
        code: "assesskit/node/no-schema",
        message: "The root element {urn:other}a is not in a namespace that the runtime has a schema for.",
        location: { path: "x.xml" },
      },
      {
        severity: "error",
        code: "assesskit/node/no-schema",
        message: "The root element b is not in a namespace that the runtime has a schema for.",
        location: { path: "y.xml" },
      },
    ]);
  });

  it("parses with the runtime first: a DOCTYPE, an oversize document or one that is not well-formed never reaches libxml2", async () => {
    const xxe = '<!DOCTYPE a [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a>&xxe;</a>';
    const deep = "<a>".repeat(300);
    const issues = await validateXmlFiles(schemas, [
      { path: "xxe.xml", content: xxe },
      { path: "deep.xml", content: deep },
      { path: "broken.xml", content: "<a><b></a>" },
    ]);
    expect(issues.map(({ code, location }) => [code, location?.path])).toEqual([
      ["assesskit/xml/security", "xxe.xml"],
      ["assesskit/xml/security", "deep.xml"],
      ["assesskit/xml/not-well-formed", "broken.xml"],
    ]);
    expect(issues[0]?.message).toContain("DOCTYPE");
  });

  it("returns the issues of all files in the order of the files", async () => {
    const issues = await validateXmlFiles(schemas, [
      item("<p>ok</p>"),
      { ...item("<qti-nothing/>"), path: "second.xml" },
      { path: "third.xml", content: "<a" },
    ]);
    expect(issues.map(({ location }) => location?.path)).toEqual(["second.xml", "third.xml"]);
  });

  it("reads bytes in the encodings the runtime decodes, and text as it is", async () => {
    const utf16 = new Uint8Array(
      Buffer.from(`﻿<?xml version="1.0" encoding="UTF-16"?>${item("<p>é€</p>").content}`, "utf16le"),
    );
    const latin1 = new Uint8Array(
      Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>${item("<p>é</p>").content}`, "latin1"),
    );
    const declared = `<?xml version="1.0" encoding="ISO-8859-1"?>${item("<p>é€</p>").content}`;
    const files = [
      { path: "utf16.xml", content: utf16 },
      { path: "latin1.xml", content: latin1 },
      { path: "string.xml", content: declared },
    ];
    expect(await validateXmlFiles(schemas, files)).toEqual([]);
  });

  it("compiles each schema once per set, however many calls and documents it validates", async () => {
    const own = await loadSchemaSet(schemaDirectory);
    const compile = vi.spyOn(XsdValidator, "fromDoc");
    try {
      await validateXmlFiles(own, [item("<p>1</p>")]);
      await validateXmlFiles(own, [item("<p>2</p>"), item("<p>3</p>")]);
      await Promise.all([
        validateXmlFiles(own, [item("<p>4</p>")]),
        validateXmlFiles(own, [example("usageData/example.xml")]),
      ]);
      await validateXmlFiles(own, [example("usageData/example.xml")]);
      expect(compile).toHaveBeenCalledTimes(2);
    } finally {
      compile.mockRestore();
      own.close();
    }
  });

  it("compiles each primary schema with the schemas it imports", async () => {
    for (const [namespace, file] of PRIMARY_SCHEMAS) {
      const issues = await validateXmlFiles(schemas, [{ path: "root.xml", content: `<root xmlns="${namespace}"/>` }]);
      expect(
        issues.every(({ code }) => code === "assesskit/node/xsd-invalid"),
        file,
      ).toBe(true);
    }
  });

  it("has a primary schema for each namespace of the table, which declares that namespace as its target", () => {
    for (const [namespace, file] of PRIMARY_SCHEMAS) {
      const bytes = readFileSync(join(schemaDirectory, file));
      const text = bytes[0] === 0xff ? bytes.toString("utf16le") : bytes.toString("utf8");
      const schema = parseXml(text);
      expect(schema.attributes.find(({ name }) => name === "targetNamespace")?.value, file).toBe(namespace);
    }
  });

  it("throws DataError for input of other types, as JavaScript or JSON pass it", async () => {
    await expect(validateXmlFiles(schemas, JSON.parse("{}"))).rejects.toThrow(
      "The files must be an array, found an object.",
    );
    await expect(validateXmlFiles(schemas, JSON.parse("[1]"))).rejects.toThrow("Each file must be an object, found 1.");
    await expect(validateXmlFiles(schemas, JSON.parse('[{"path":5,"content":""}]'))).rejects.toThrow(
      "The path of a file must be a string, found 5.",
    );
    await expect(validateXmlFiles(schemas, JSON.parse('[{"path":"a.xml","content":5}]'))).rejects.toThrow(
      'The content of the file "a.xml" must be a string or a Uint8Array, found 5.',
    );
    await expect(validateXmlFiles(schemas, JSON.parse('[{"path":"a.xml"}]'))).rejects.toThrow(DataError);
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/node.md", import.meta.url);
    const node = await import("../src/node/index.js");
    // The sample reads ./schemas and items/capital.xml; the test serves the schema directory and an item without time-dependent.
    const modules = {
      "@assesskit/runtime/node": {
        ...node,
        loadSchemaSet: (directory: string) =>
          node.loadSchemaSet(directory === "./schemas" ? schemaDirectory : directory),
      },
      "node:fs/promises": {
        readFile: async () =>
          new TextEncoder().encode(
            `<qti-assessment-item xmlns="${ASI}" identifier="capital" title="Capital" adaptive="false"/>`,
          ),
      },
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});
