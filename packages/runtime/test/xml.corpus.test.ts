import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { XmlDocument } from "libxml2-wasm";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { parseXml, ReadError, SecurityError, serializeXml, type XmlElement, type XmlNode } from "../src/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const paths = readdirSync(examples, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".xml"))
  .sort();

/** The examples that the runtime's reader rejects, with the reason: a saved web page, and a file that is not well-formed (design §0). */
const REJECTED = new Map<string, typeof ReadError | typeof SecurityError>([
  ["CAT/test.xml", SecurityError],
  ["results/full-example.xml", ReadError],
]);

/** Two LTI link files declare the relative namespace /xsd/imslticc_v1p0, which libxml2 cannot canonicalize. */
const WITH_RELATIVE_NAMESPACE = new Set([
  "packaging/lti/links/streaming_video_experiment101.xml",
  "packaging/testWithLti/links/periodicTable.xml",
]);

function withoutPositions(node: XmlNode): XmlNode {
  if (node.kind !== "element") return node;
  const { line: _line, column: _column, ...rest } = node;
  return { ...rest, children: node.children.map(withoutPositions) };
}

function canonical(source: Uint8Array | string): string {
  const document = XmlDocument.fromBuffer(typeof source === "string" ? new TextEncoder().encode(source) : source);
  try {
    return document.canonicalizeToString({ withComments: false });
  } finally {
    document.dispose();
  }
}

describe("the 1EdTech examples", () => {
  const readable = paths.filter((path) => !REJECTED.has(path));

  it("[S13] have 327 XML files at the pinned commit, of which 325 are read", () => {
    expect(paths).toHaveLength(327);
    expect(readable).toHaveLength(325);
  });

  it("[S13] are read, except the two that cannot be", () => {
    for (const [path, error] of REJECTED) {
      expect(() => parseXml(new Uint8Array(readFileSync(join(examples, path))), { path }), path).toThrow(error);
    }
  });

  it("[S13] are read and written back to a document that libxml2 canonicalizes like the original", () => {
    for (const path of readable.filter((candidate) => !WITH_RELATIVE_NAMESPACE.has(candidate))) {
      const bytes = new Uint8Array(readFileSync(join(examples, path)));
      const written = serializeXml(parseXml(bytes, { path }));
      expect(canonical(written), path).toBe(canonical(bytes));
    }
  });

  it("[S13] cannot be canonicalized by libxml2 in only the two cases that declare a relative namespace", () => {
    for (const path of WITH_RELATIVE_NAMESPACE) {
      expect(() => canonical(new Uint8Array(readFileSync(join(examples, path)))), path).toThrow(
        "Failed to canonicalize",
      );
    }
  });

  it("[S13] are read from what they are written to as the tree they were", () => {
    for (const path of readable) {
      const root = parseXml(new Uint8Array(readFileSync(join(examples, path))), { path });
      const written = serializeXml(root);
      const again = parseXml(written, { path });
      expect(withoutPositions(again), path).toEqual(withoutPositions(root));
      expect(serializeXml(again), path).toBe(written);
    }
  });

  it("[S13] give each element a position inside the file", () => {
    const root: XmlElement = parseXml(new Uint8Array(readFileSync(join(examples, "packaging/items/choice.xml"))));
    expect([root.name, root.line, root.column]).toEqual(["qti-assessment-item", 3, 1]);
  });
});
