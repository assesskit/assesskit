import { readFileSync } from "node:fs";
import { DataError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { type CharacterStrokes, writeCharacterModule } from "../src/index.js";

/** The reference strokes of 十 in hanzi-writer-data 2.0.1, read as an author's tool reads a file of it. */
const TEN: CharacterStrokes = JSON.parse(
  readFileSync(new URL("fixtures/hanzi-writer-data/5341.json", import.meta.url), "utf8"),
);

/** Runs the text of a character module as RequireJS would, and returns what it defines. */
function defined(text: string): unknown {
  let value: unknown;
  new Function("define", text)((definition: unknown) => {
    value = definition;
  });
  return value;
}

describe("writeCharacterModule", () => {
  it("writes an AMD module that defines the character and its strokes as Hanzi Writer's data gives them", () => {
    const text = writeCharacterModule("十", TEN);
    expect(text.startsWith('define({"character":"十","strokes":["M 541 450')).toBe(true);
    expect(text.endsWith(");\n")).toBe(true);
    expect(defined(text)).toEqual({ character: "十", ...TEN });
  });

  it("keeps the strokes of the radical, and leaves out what it does not hold", () => {
    const text = writeCharacterModule("十", { ...TEN, radStrokes: [0, 1] });
    expect(defined(text)).toEqual({ character: "十", ...TEN, radStrokes: [0, 1] });
    expect(defined(writeCharacterModule("十", TEN))).not.toHaveProperty("radStrokes");
  });

  it("refuses what is not a character or reference strokes", () => {
    const median = TEN.medians[0] ?? [];
    const cases: readonly [unknown, unknown][] = [
      ["", TEN],
      ["十十十十十十十十十", TEN],
      ["十", { strokes: [], medians: [] }],
      ["十", { ...TEN, medians: [median] }],
      ["十", { ...TEN, strokes: [TEN.strokes[0], "M 0 0 <script>"] }],
      ["十", { ...TEN, strokes: [TEN.strokes[0], `M ${"1 ".repeat(2048)}`] }],
      ["十", { ...TEN, medians: [median, [[0, 0]]] }],
      ["十", { ...TEN, radStrokes: [2] }],
      ["十", { ...TEN, color: "red" }],
      ["十", JSON.parse('{"strokes":["M 0 0 L 1 1 Z"],"medians":[[[0,0],[1,null]]]}')],
      ["十", { strokes: Array.from({ length: 65 }, () => "M 0 0 L 1 1 Z"), medians: [] }],
      ["十", null],
      [10, TEN],
    ];
    for (const [character, strokes] of cases) {
      // The input of other types comes from JSON, as an author's tool reads it.
      const [text, data] = JSON.parse(JSON.stringify([character, strokes]));
      expect(() => writeCharacterModule(text, data), JSON.stringify([character, strokes])).toThrow(DataError);
    }
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/custom-interactions/stroke-writing.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/custom-interactions": await import("../src/index.js"),
      "@assesskit/custom-interactions/node": await import("../src/node/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});
