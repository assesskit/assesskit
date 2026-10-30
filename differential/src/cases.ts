import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { correctResponses } from "./longsight.ts";
import type { ItemCase } from "./model.ts";

/** The seed that corpus cases draw their template values with. */
export const CORPUS_SEED = 1;

const ITEM_ROOT = "<qti-assessment-item";

/**
 * Builds cases from the item documents of a directory, leaving out other documents: each item once without responses, and once with the correct
 * responses its response declarations carry when the oracle accepts it.
 *
 * @param directory - A directory of item documents, such as `qtiv3-examples/packaging/items` of the corpus.
 */
export function corpusCases(directory: string): ItemCase[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".xml"))
    .sort()
    .flatMap((file) => {
      const xml = readFileSync(join(directory, file), "utf8");
      if (!xml.includes(ITEM_ROOT)) return [];
      const base = { xml, seed: CORPUS_SEED };
      const correct = correctResponses(xml, CORPUS_SEED);
      const empty: ItemCase = { ...base, name: `${file} (no responses)`, responses: {} };
      return correct ? [empty, { ...base, name: `${file} (correct responses)`, responses: correct }] : [empty];
    });
}
