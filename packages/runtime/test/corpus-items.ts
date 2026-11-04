import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { requireCorpus } from "../../../scripts/corpus.js";
import { type AssessmentItem, readAsi } from "../src/asi/index.js";
import { ReadError } from "../src/errors.js";

/** The directory of the 1EdTech examples of QTI 3. */
export const EXAMPLES = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");

/** An item of the examples with the text it was read from. */
export interface ExampleItem {
  /** The path below the examples. */
  readonly path: string;
  /** The item. */
  readonly item: AssessmentItem;
  /** The document as written. */
  readonly source: string;
}

/** The items of the examples that `readAsi` reads, by path, in path order; the schema rejects the others. */
export function exampleItems(): readonly ExampleItem[] {
  const items: ExampleItem[] = [];
  for (const path of readdirSync(EXAMPLES, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".xml"))
    .sort()) {
    const source = readFileSync(join(EXAMPLES, path), "utf8");
    if (!source.includes("<qti-assessment-item")) continue;
    try {
      const document = readAsi(source, { path });
      if (document.kind === "item") items.push({ path, item: document.item, source });
    } catch (error) {
      if (!(error instanceof ReadError)) throw error;
    }
  }
  return items;
}
