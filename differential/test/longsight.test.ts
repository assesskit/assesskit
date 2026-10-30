import { describe, expect, it } from "vitest";
import { correctResponses, longsight } from "../src/index.ts";
import { CHOICE_ITEM, TEMPLATE_ITEM } from "./items.ts";

describe("longsight", () => {
  it("scores a response with the item's response processing", () => {
    const run = (response: string) =>
      longsight.run({ name: "choice", xml: CHOICE_ITEM, responses: { RESPONSE: response }, seed: 1 });
    expect(run("B")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 1 } } });
    expect(run("A")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 0 } } });
  });

  it("draws template values from the seed", () => {
    const run = (seed: number) => longsight.run({ name: "template", xml: TEMPLATE_ITEM, responses: {}, seed });
    expect(run(7)).toMatchObject({ accepted: true });
    expect(run(7)).toEqual(run(7));
    const values = new Set([1, 2, 3, 4, 5].map((seed) => JSON.stringify(run(seed))));
    expect(values.size).toBeGreaterThan(1);
  });

  it("reports why it does not accept a document", () => {
    const run = longsight.run({ name: "broken", xml: "<qti-assessment-item", responses: {}, seed: 1 });
    expect(run.accepted).toBe(false);
    expect(run).toHaveProperty("reason");
  });
});

describe("correctResponses", () => {
  it("reads the correct responses of the response declarations", () => {
    expect(correctResponses(CHOICE_ITEM, 1)).toEqual({ RESPONSE: "B" });
  });

  it("is undefined for a document the oracle does not accept", () => {
    expect(correctResponses("<nothing/>", 1)).toBeUndefined();
  });
});
