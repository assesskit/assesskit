import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { type AsiDocument, ReadError, readAsi, SecurityError, writeAsi, XINCLUDE_NAMESPACE } from "../src/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const paths = readdirSync(examples, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".xml"))
  .sort();

function bytesOf(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(examples, path)));
}

/** The documents of the examples that are assessment documents, by path; the others fail with the code returned by `skipped`. */
const documents = new Map<string, AsiDocument>();
const skipped = new Map<string, string>();
for (const path of paths) {
  try {
    documents.set(path, readAsi(bytesOf(path), { path }));
  } catch (error) {
    if (error instanceof ReadError) skipped.set(path, error.issues[0]?.code ?? "");
    else if (error instanceof SecurityError) skipped.set(path, "security");
    else throw error;
  }
}

describe("the 1EdTech examples", () => {
  it("[A1][A2][A10][A37][A49][A55][C] are read when they are assessment documents: 288 of 327 files", () => {
    const kinds = new Map<string, number>();
    for (const { kind } of documents.values()) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    expect(paths).toHaveLength(327);
    expect(Object.fromEntries(kinds)).toEqual({
      item: 253,
      test: 28,
      "response-processing": 5,
      stimulus: 1,
      "outcome-declaration": 1,
    });
  });

  it("[S13][C] are not read when they are no assessment document: manifests, results, usage data, metadata, links and a fragment", () => {
    expect(new Set(skipped.values())).toEqual(
      new Set(["olah/asi/document-element", "olah/xml/not-well-formed", "security"]),
    );
    expect(skipped.get("tests/rtest01-fragment.xml")).toBe("olah/asi/document-element");
    expect(skipped.get("CAT/test.xml")).toBe("security");
    expect(skipped.get("results/full-example.xml")).toBe("olah/xml/not-well-formed");
    expect(skipped.get("packaging/simple/imsmanifest.xml")).toBe("olah/asi/document-element");
  });

  it("[A1][A10][C] are read again from what is written, to the same model and the same text", () => {
    for (const [path, document] of documents) {
      const written = writeAsi(document);
      expect(readAsi(written, { path }), path).toEqual(document);
      expect(writeAsi(readAsi(written)), path).toBe(written);
    }
  });

  it("[A4][C] keep the include of a fragment as an XInclude element", () => {
    const document = documents.get("tests/rtest01-set01.xml");
    if (document?.kind !== "item") throw new Error("Expected an item.");
    const [include] =
      document.item.body?.children.filter((node) => node.kind === "element" && node.name === "include") ?? [];
    expect(include).toMatchObject({ kind: "element", namespace: XINCLUDE_NAMESPACE, name: "include", prefix: "xi" });
  });
});
