import { describe, expect, it } from "vitest";
import { compare, longsight, longsightRandom, runtime } from "../src/index.ts";
import { CHOICE_ITEM, TEMPLATE_ITEM } from "./items.ts";

describe("runtime", () => {
  it("[D] scores a response as the oracle does", () => {
    const run = (response: string) =>
      runtime.run({ name: "choice", xml: CHOICE_ITEM, responses: { RESPONSE: response }, seed: 1 });
    expect(run("B")).toMatchObject({
      accepted: true,
      observation: { outcomes: { SCORE: 1, completionStatus: "unknown" } },
    });
    expect(run("A")).toMatchObject({ accepted: true, observation: { outcomes: { SCORE: 0 } } });
  });

  it("[D] draws the template values of the oracle from the oracle's generator", () => {
    const cases = [1, 2, 3].map((seed) => ({ name: `template ${seed}`, xml: TEMPLATE_ITEM, responses: {}, seed }));
    const report = compare(cases, longsight, runtime, []);
    expect(report).toMatchObject({ compared: 3, differences: [] });
  });

  it("reports why it does not accept a document", () => {
    expect(runtime.run({ name: "broken", xml: "<qti-assessment-item", responses: {}, seed: 1 })).toMatchObject({
      accepted: false,
    });
    const test = `<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="t" title="t"/>`;
    expect(runtime.run({ name: "test", xml: test, responses: {}, seed: 1 })).toEqual({
      accepted: false,
      reason: "The document is a test.",
    });
  });
});

describe("longsightRandom", () => {
  it("is the oracle's linear congruential generator for a numeric seed", () => {
    const random = longsightRandom(1);
    const first = (1664525 * 1 + 1013904223) >>> 0;
    expect(random.uniform()).toBe(first / 2 ** 32);
    expect(random.uniform()).toBe(((1664525 * first + 1013904223) >>> 0) / 2 ** 32);
  });
});
