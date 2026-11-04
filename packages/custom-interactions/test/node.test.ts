import { readFileSync } from "node:fs";
import { DataError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { readModuleFiles } from "../src/node/index.js";

/** The fonts of MathLive 0.111.1, which it loads all at once when a field first shows. */
const KATEX_FONTS = 20;

describe("readModuleFiles", () => {
  it("reads the module of math entry and MathLive's fonts beside it with their license, by their paths in the package", async () => {
    const files = await readModuleFiles("math-entry");
    const paths = [...files.keys()];
    expect(paths[0]).toBe("modules/math-entry.js");
    expect(paths.filter((path) => /^modules\/math-entry\/fonts\/KaTeX_[\w-]+\.woff2$/.test(path))).toHaveLength(
      KATEX_FONTS,
    );
    expect(paths).toContain("modules/math-entry/fonts/OFL.txt");
    expect(paths).toHaveLength(2 + KATEX_FONTS);
    expect(new TextDecoder().decode(files.get("modules/math-entry/fonts/OFL.txt"))).toContain(
      "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    );
    const script = new TextDecoder().decode(files.get("modules/math-entry.js"));
    expect(script.startsWith("/*! mathlive 0.111.1 (MIT)\nCopyright (c) 2017 - present Arno Gourdol.")).toBe(true);
  });

  it("reads the module of stroke writing alone: the characters are content of the item's package", async () => {
    const files = await readModuleFiles("stroke-writing");
    expect([...files.keys()]).toEqual(["modules/stroke-writing.js"]);
    const script = new TextDecoder().decode(files.get("modules/stroke-writing.js"));
    expect(
      script.startsWith("/*! hanzi-writer 3.7.3 (MIT)\nThe MIT License (MIT)\n\nCopyright (c) 2014 David Chanin"),
    ).toBe(true);
  });

  it("puts the files below another folder of the package, or at its root", async () => {
    expect([...(await readModuleFiles("math-entry", { directory: "items/shared/" })).keys()][0]).toBe(
      "items/shared/math-entry.js",
    );
    expect([...(await readModuleFiles("math-entry", { directory: "" })).keys()][0]).toBe("math-entry.js");
  });

  it("refuses a name that is not an interaction, a folder outside normal form and an unknown option", async () => {
    await expect(readModuleFiles(JSON.parse('"choice"'))).rejects.toThrow(
      new DataError('The name of an interaction must be one of "math-entry", "stroke-writing", found "choice".'),
    );
    for (const directory of ["/modules/", "modules", "../modules/", "modules/../", "a\\b/", "./"]) {
      await expect(readModuleFiles("math-entry", { directory }), directory).rejects.toThrow(DataError);
    }
    await expect(readModuleFiles("math-entry", JSON.parse('{"folder":"x/"}'))).rejects.toThrow(
      'The options has the properties "directory" and "signal", found "folder".',
    );
    await expect(readModuleFiles("math-entry", JSON.parse("null"))).rejects.toThrow(DataError);
    await expect(readModuleFiles("math-entry", { signal: JSON.parse("{}") })).rejects.toThrow(DataError);
  });

  it("stops at a signal that has aborted", async () => {
    await expect(readModuleFiles("math-entry", { signal: AbortSignal.abort() })).rejects.toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/custom-interactions/math-entry.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/custom-interactions": await import("../src/index.js"),
      "@assesskit/custom-interactions/node": await import("../src/node/index.js"),
      "@assesskit/runtime/asi": await import("@assesskit/runtime/asi"),
      "@assesskit/runtime/operators": await import("@assesskit/runtime/operators"),
      "@assesskit/runtime/package": await import("@assesskit/runtime/package"),
      "@assesskit/runtime/scoring": await import("@assesskit/runtime/scoring"),
      "@assesskit/runtime/validate": await import("@assesskit/runtime/validate"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});
