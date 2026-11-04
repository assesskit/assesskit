import { describe, expect, it } from "vitest";
import {
  type AssessmentItem,
  createItemVariables,
  createRandom,
  describeInteractions,
  type InteractionDescriptor,
  ProcessingError,
  type Value,
  validateBindings,
  validateResponse,
} from "../src/index.js";
import { drawOrders } from "../src/interactions/internal.js";
import { exampleItems } from "./corpus-items.js";

const items = exampleItems();

/** The interactions in the markup of a document, counted by kind without reading it: comments are left out. */
function interactionsIn(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [, kind] of source.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<qti-([a-z-]+-interaction)[\s/>]/g)) {
    if (kind !== undefined) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

/** The correct responses an item declares; empty for the examples whose declared values are not values of their types. */
function declaredResponses(item: AssessmentItem): ReadonlyMap<string, Value | null> {
  try {
    return createItemVariables(item).correctResponses;
  } catch (error) {
    if (error instanceof ProcessingError) return new Map();
    throw error;
  }
}

describe("the interactions of the 1EdTech examples", () => {
  it("are all described: the descriptors of an item are the interaction elements of its markup, by kind", () => {
    expect(items).toHaveLength(251);
    const described = new Map<string, number>();
    for (const { path, item, source } of items) {
      const descriptors = describeInteractions(item);
      const expected = interactionsIn(source);
      const found = new Map<string, number>();
      for (const { kind } of descriptors) found.set(kind, (found.get(kind) ?? 0) + 1);
      expect(found, path).toEqual(expected);
      for (const [kind, count] of found) described.set(kind, (described.get(kind) ?? 0) + count);
    }
    expect(Object.fromEntries(described)).toMatchObject({
      "choice-interaction": 138,
      "text-entry-interaction": 102,
      "extended-text-interaction": 29,
      "inline-choice-interaction": 28,
      "graphic-gap-match-interaction": 15,
      "match-interaction": 13,
      "gap-match-interaction": 12,
      "hotspot-interaction": 12,
      "end-attempt-interaction": 8,
      "order-interaction": 7,
      "portable-custom-interaction": 6,
    });
    expect(described.size).toBe(21);
  });

  it("bind a response variable that the interaction accepts, in every example", () => {
    for (const { path, item } of items) expect(validateBindings(item), path).toEqual([]);
  });

  it("have a correct response that is a valid response, but for one example that pairs a hotspot with a choice", () => {
    const rejected: string[] = [];
    let checked = 0;
    for (const { path, item } of items) {
      const correct = declaredResponses(item);
      for (const descriptor of describeInteractions(item)) {
        const response = correct.get(descriptor.responseIdentifier) ?? null;
        if (response === null) continue;
        checked++;
        const { status, reasons } = validateResponse(descriptor, response);
        if (status !== "answered") rejected.push(`${path} ${descriptor.responseIdentifier}: ${reasons.join(", ")}`);
      }
    }
    expect(checked).toBe(240);
    // media_coords.xml gives the correct response "C1 squirrel", from the hotspot C1 to the gap image squirrel, where
    // The information model pairs a choice with a hotspot.
    expect(rejected).toEqual(["packaging/items/media_coords.xml RESPONSE: unknown-choice"]);
  });

  it("shuffle to a permutation of the choices, with the fixed choices where the document has them", () => {
    let shuffling = 0;
    for (const { path, item } of items) {
      for (const descriptor of describeInteractions(item)) {
        const orders = drawOrders(descriptor, createRandom(7));
        const sets: readonly (readonly InteractionDescriptor["choices"][number][])[] =
          descriptor.matchSets ?? (descriptor.choices.length === 0 ? [] : [descriptor.choices]);
        sets.forEach((set, place) => {
          const order = orders[place] ?? [];
          expect([...order].sort(), path).toEqual(set.map(({ identifier }) => identifier).sort());
          set.forEach((choice, index) => {
            if (choice.fixed || !descriptor.shuffle) expect(order[index], path).toBe(choice.identifier);
          });
        });
        if (descriptor.shuffle) shuffling++;
      }
    }
    expect(shuffling).toBeGreaterThan(50);
  });
});
