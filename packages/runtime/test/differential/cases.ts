import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readAsi } from "../../src/asi/index.js";
import { ReadError } from "../../src/errors.js";
import { describeInteractions, type InteractionDescriptor } from "../../src/interactions/index.js";
import { correctResponses, longsightRandom } from "./longsight.js";
import type { ItemCase, Observed, SessionCase, Turn } from "./model.js";

/** The seed that corpus cases draw their template values with. */
const CORPUS_SEED = 1;

const ITEM_ROOT = "<qti-assessment-item";

/** The turns of each session case. */
export const SESSION_TURNS = 4;

/** The turn of a session case that ends with the first end attempt interaction of its item, counted from 0. */
const HINT_TURN = 1;

/** The interactions whose responses session cases give: those that choose identifiers. */
const ANSWERED_KINDS: ReadonlySet<string> = new Set([
  "choice-interaction",
  "inline-choice-interaction",
  "hottext-interaction",
  "hotspot-interaction",
]);

/** Returns the item documents below a directory, by their paths below it, in order. */
function itemFiles(directory: string): { readonly file: string; readonly xml: string }[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".xml"))
    .map((file) => file.split("\\").join("/"))
    .sort()
    .flatMap((file) => {
      const xml = readFileSync(join(directory, file), "utf8");
      return xml.includes(ITEM_ROOT) ? [{ file, xml }] : [];
    });
}

/**
 * Builds cases from the item documents below a directory, leaving out other documents: each item once without responses, and once with the correct
 * responses its response declarations carry when the oracle accepts it. A case is named by the path of its file below the directory.
 *
 * @param directory - A directory of item documents, such as `qtiv3-examples` of the corpus.
 */
export function corpusCases(directory: string): ItemCase[] {
  return itemFiles(directory).flatMap(({ file, xml }) => {
    const base = { xml, seed: CORPUS_SEED };
    const correct = correctResponses(xml, CORPUS_SEED);
    const empty: ItemCase = { ...base, name: `${file} (no responses)`, responses: {} };
    return correct ? [empty, { ...base, name: `${file} (correct responses)`, responses: correct }] : [empty];
  });
}

/** Whether a turn can answer an interaction: it chooses identifiers into a single or multiple identifier variable. */
function isAnswered(descriptor: InteractionDescriptor): boolean {
  const { declaration } = descriptor;
  return (
    ANSWERED_KINDS.has(descriptor.kind) &&
    descriptor.choices.length > 0 &&
    declaration?.baseType === "identifier" &&
    (declaration.cardinality === "single" || declaration.cardinality === "multiple")
  );
}

/**
 * Builds session cases from the item documents below a directory: each item that the runtime reads and that has an interaction
 * choosing identifiers gets {@link SESSION_TURNS} turns. Each turn answers every such interaction with a choice drawn
 * from the oracle's generator, a list of one choice for a multiple variable, and submits; the second turn ends with the
 * first end attempt interaction of the item instead, when it has one. A case is named by the path of its file.
 *
 * @param directory - A directory of item documents, such as `qtiv3-examples` of the corpus.
 */
export function sessionCases(directory: string): SessionCase[] {
  const random = longsightRandom(CORPUS_SEED);
  return itemFiles(directory).flatMap(({ file, xml }) => {
    let descriptors: readonly InteractionDescriptor[];
    try {
      const document = readAsi(xml);
      descriptors = document.kind === "item" ? describeInteractions(document.item) : [];
    } catch (error) {
      if (error instanceof ReadError) return [];
      throw error;
    }
    const answered = descriptors.filter(isAnswered);
    if (answered.length === 0) return [];
    const hint = descriptors.find((descriptor) => descriptor.kind === "end-attempt-interaction")?.responseIdentifier;
    const turns = Array.from({ length: SESSION_TURNS }, (_, place): Turn => {
      const responses: Record<string, Observed> = {};
      for (const { responseIdentifier, choices, declaration } of answered) {
        const choice = choices[Math.floor(random.uniform() * choices.length)]?.identifier ?? "";
        responses[responseIdentifier] = declaration?.cardinality === "multiple" ? [choice] : choice;
      }
      return place === HINT_TURN && hint !== undefined ? { responses, endAttempt: hint } : { responses };
    });
    return [{ name: `${file} (turns)`, xml, turns, seed: CORPUS_SEED }];
  });
}
