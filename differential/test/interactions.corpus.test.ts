import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AsiDocument, describeInteractions, ReadError, readAsi } from "@assesskit/runtime";
import { parseQtiXml } from "@longsightgroup/qti3-core";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../scripts/corpus.ts";

const root = resolve(import.meta.dirname, "../..");
const examples = resolve(requireCorpus(root), "qti-examples/qtiv3-examples");

/** What both implementations say about an interaction. */
interface Summary {
  readonly responseIdentifier: string;
  readonly shuffle: boolean;
  readonly choices: readonly string[];
}

/** The interactions of every item that both implementations accept, by path. */
function summaries(): Map<string, { readonly oracle: Summary[]; readonly subject: Summary[] }> {
  const found = new Map<string, { oracle: Summary[]; subject: Summary[] }>();
  for (const path of readdirSync(examples, { recursive: true, encoding: "utf8" }).filter((file) =>
    file.endsWith(".xml"),
  )) {
    const xml = readFileSync(resolve(examples, path), "utf8");
    if (!xml.includes("<qti-assessment-item")) continue;
    const parsed = parseQtiXml(xml);
    if (!parsed.ok || parsed.document === undefined) continue;
    let document: AsiDocument;
    try {
      document = readAsi(xml, { path });
    } catch (error) {
      if (error instanceof ReadError) continue;
      throw error;
    }
    if (document.kind !== "item") continue;
    found.set(path, {
      oracle: parsed.document.item.interactions.map((interaction) => ({
        responseIdentifier: interaction.responseIdentifier ?? "",
        shuffle: interaction.attributes.shuffle === "true",
        choices: interaction.choices.map(({ identifier }) => identifier),
      })),
      subject: describeInteractions(document.item).map((descriptor) => ({
        responseIdentifier: descriptor.responseIdentifier,
        shuffle: descriptor.shuffle,
        choices: descriptor.choices.map(({ identifier }) => identifier),
      })),
    });
  }
  return found;
}

describe("runtime against the oracle on the interactions of the corpus items", () => {
  const found = summaries();

  it("list the same interactions in the same order, with the same response variables", () => {
    expect(found.size).toBeGreaterThan(200);
    for (const [path, { oracle, subject }] of found) {
      expect(
        subject.map((entry) => entry.responseIdentifier),
        path,
      ).toEqual(oracle.map((entry) => entry.responseIdentifier));
    }
  });

  it("shuffle the same interactions", () => {
    for (const [path, { oracle, subject }] of found) {
      expect(
        subject.map((entry) => entry.shuffle),
        path,
      ).toEqual(oracle.map((entry) => entry.shuffle));
    }
  });

  it("list the same choices, in the same order, for every interaction but those that differ in what they call a choice", () => {
    const differing: string[] = [];
    for (const [path, { oracle, subject }] of found) {
      oracle.forEach((entry, place) => {
        if (JSON.stringify(entry.choices) !== JSON.stringify(subject[place]?.choices)) {
          differing.push(
            `${path} ${entry.responseIdentifier}: ${JSON.stringify(entry.choices)} ${JSON.stringify(subject[place]?.choices)}`,
          );
        }
      });
    }
    expect(differing).toEqual([]);
  });
});
