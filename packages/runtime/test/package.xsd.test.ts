import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import { CP_NAMESPACE } from "../src/metadata/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { CPX_NAMESPACE, readManifest, readPackage, writeManifest, writePackage } from "../src/package/index.js";
import { manifests } from "./arbitraries/package.js";
import { declaredNames, unusedNames, usedNames } from "./schema-declarations.js";

const root = resolve(import.meta.dirname, "../../..");
const examples = join(requireCorpus(root), "qti-examples/qtiv3-examples");

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(root));
});

afterAll(() => {
  schemas.close();
});

async function messages(path: string, content: string | Uint8Array): Promise<string[]> {
  return (await validateXmlFiles(schemas, [{ path, content }])).map(({ message }) => message);
}

describe("the XSD validation of the manifest writer", () => {
  const paths = readdirSync(examples, { recursive: true, encoding: "utf8" }).filter((path) =>
    path.endsWith("/imsmanifest.xml"),
  );

  it("accepts the manifest that writeManifest writes for each of the 24 example manifests", async () => {
    expect(paths).toHaveLength(24);
    for (const path of paths) {
      const manifest = readManifest(new Uint8Array(readFileSync(join(examples, path))), { path });
      expect(await messages(path, writeManifest(manifest)), path).toEqual([]);
    }
  });

  it("writes the type imsbasiclti_xmlv1p3 that the schema enumerates for the packages whose manifests spell imslti_xmlv1p1, which it rejects", async () => {
    const original = new Uint8Array(readFileSync(join(examples, "packaging/lti/imsmanifest.xml")));
    expect((await messages("lti.xml", original)).join("\n")).toContain("imslti_xmlv1p1");
    expect(writeManifest(readManifest(original))).toContain('type="imsbasiclti_xmlv1p3"');
  });

  it("writes every element and attribute that the schemas declare, and reads them back", () => {
    const written = [
      ...paths.map((path) => writeManifest(readManifest(new Uint8Array(readFileSync(join(examples, path)))))),
      ...fc.sample(manifests, { numRuns: 200, seed: 20_230_105 }).map(writeManifest),
    ];
    for (const text of written) expect(writeManifest(readManifest(text))).toBe(text);
    const declared = declaredNames(requireSchemas(root), [
      "imsqtiv3p0_imscpv1p2_v1p0.xsd",
      "imsqtiv3p0_cpextv1p2_v1p0.xsd",
    ]);
    expect(unusedNames(declared, usedNames(written, [CP_NAMESPACE, CPX_NAMESPACE]))).toEqual([]);
  });

  it("accepts the manifest that writeManifest writes for any manifest", async () => {
    await fc.assert(
      fc.asyncProperty(manifests, async (manifest) => {
        // The schema's wildcard in the DRD is strict, so that an extension must be an element that a schema declares.
        const withoutExtensions = {
          ...manifest,
          resources: manifest.resources.map((resource) => ({
            ...resource,
            variants: resource.variants.map((variant) => ({ ...variant, drd: { ...variant.drd, extensions: [] } })),
          })),
        };
        expect(await messages("imsmanifest.xml", writeManifest(withoutExtensions))).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it("accepts the manifest of a package that writePackage writes", async () => {
    const manifest = readManifest(
      new Uint8Array(readFileSync(join(examples, "packaging/sharedStimulus/imsmanifest.xml"))),
    );
    const pkg = readPackage(writePackage(manifest, new Map()));
    expect(await messages("imsmanifest.xml", pkg.file("imsmanifest.xml") ?? new Uint8Array())).toEqual([]);
  });

  it("shows that the schema, like the reader, allows no organization, item or nested manifest", async () => {
    const manifest = writeManifest({ identifier: "m", metadata: { schema: "QTI Package" }, resources: [] });
    expect(
      await messages(
        "m.xml",
        manifest.replace("<organizations/>", "<organizations><item identifier='i'/></organizations>"),
      ),
    ).not.toEqual([]);
  });
});
