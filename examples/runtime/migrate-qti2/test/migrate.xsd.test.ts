import { join, resolve } from "node:path";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "@assesskit/runtime/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireCorpus } from "../../../../scripts/corpus.ts";
import { requireSchemas } from "../../../../scripts/schemas.ts";
import { migrateSample } from "../src/migrate-sample.ts";
import { readSamples } from "../src/samples.ts";

const root = resolve(import.meta.dirname, "../../../..");

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(root));
});

afterAll(() => {
  schemas.close();
});

describe("the QTI 3 documents of the migrator, against the official schemas", () => {
  it("are valid for 19 of the 21 items that it migrates, and the other two keep elements of the QTI 2.2 HTML5 namespace", async () => {
    const samples = readSamples(join(requireCorpus(root), "qti-examples/qtiv2p2-examples/items"));
    const invalid: string[] = [];
    let migrated = 0;
    for (const sample of samples) {
      const migration = await migrateSample(sample);
      if (!migration.ok) continue;
      migrated += 1;
      const documents = [...migration.files]
        .filter(([path]) => path.endsWith(".xml"))
        .map(([path, content]) => ({ path, content }));
      const issues = await validateXmlFiles(schemas, documents);
      if (issues.some(({ severity }) => severity === "error")) invalid.push(sample.identifier);
    }
    expect(migrated).toBe(21);
    expect(invalid.sort()).toEqual(["audio_video", "figures"]);
  });
});
