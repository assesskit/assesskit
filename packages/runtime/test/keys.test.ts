import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { DEFAULT_KEY_LIMITS } from "../src/keys/index.js";

describe("DEFAULT_KEY_LIMITS", () => {
  it("holds the limits of a key, frozen", () => {
    expect(DEFAULT_KEY_LIMITS).toStrictEqual({ responses: 256, entries: 1_000, patternLength: 1_000 });
    expect(Object.isFrozen(DEFAULT_KEY_LIMITS)).toBe(true);
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/keys.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/runtime/keys": await import("../src/keys/index.js"),
      "@assesskit/runtime/scoring": await import("../src/scoring/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});
