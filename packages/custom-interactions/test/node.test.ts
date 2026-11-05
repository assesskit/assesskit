import { readFileSync } from "node:fs";
import { DataError } from "@assesskit/runtime/errors";
import { createScoringOperators } from "@assesskit/runtime/operators";
import { readManifest, readPackage, writePackage } from "@assesskit/runtime/package";
import { validatePackage } from "@assesskit/runtime/validate";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { writeCharacterModule } from "../src/index.js";
import { readModuleFiles } from "../src/node/index.js";
import { writeMathEntryItem, writeStepsItem, writeStrokeWritingItem } from "./fixtures/items.js";

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

  it("puts the files below modules/, which a tool that keeps them elsewhere renames", async () => {
    const files = await readModuleFiles("math-entry");
    expect([...files.keys()].every((path) => path.startsWith("modules/math-entry"))).toBe(true);
    const moved = new Map([...files].map(([path, bytes]) => [path.replace(/^modules\//u, "items/shared/"), bytes]));
    expect([...moved.keys()][0]).toBe("items/shared/math-entry.js");
  });

  it("refuses a name that is not an interaction and an unknown option", async () => {
    await expect(readModuleFiles(JSON.parse('"choice"'))).rejects.toThrow(
      new DataError('The name of an interaction must be one of "math-entry", "stroke-writing", found "choice".'),
    );
    await expect(readModuleFiles("math-entry", JSON.parse('{"directory":"x/"}'))).rejects.toThrow(
      'The options has the property "signal", found "directory".',
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

describe("the items in a package with their modules", () => {
  it("validate with no issue, the type identifiers being Federated Content URNs as QTI recommends", async () => {
    const items = new Map([
      ["items/expand.xml", writeMathEntryItem({ kind: "expression", expression: "2x+2" }, "Expand 2(x + 1).")],
      [
        "items/quarter.xml",
        writeMathEntryItem(
          { kind: "expression", expression: "\\frac14", decimalSeparator: "," },
          "Tulis seperempat.",
          'data-decimal-separator=","',
        ),
      ],
      ["items/steps.xml", writeStepsItem("Solve 2x + 3 = 7.")],
      ["items/ten.xml", writeStrokeWritingItem("Write the character for ten.")],
    ]);
    const strokes = JSON.parse(readFileSync(new URL("fixtures/hanzi-writer-data/5341.json", import.meta.url), "utf8"));
    const modules = new Map([
      ...(await readModuleFiles("math-entry")),
      ...(await readModuleFiles("stroke-writing")),
      ["modules/characters/5341.js", new TextEncoder().encode(writeCharacterModule("十", strokes))],
    ]);
    const resources = [...items.keys()]
      .map(
        (path, index) =>
          `<resource identifier="item-${index}" type="imsqti_item_xmlv3p0" href="${path}"><file href="${path}"/></resource>`,
      )
      .join("");
    const listed = [...modules.keys()].map((path) => `<file href="${path}"/>`).join("");
    const manifest =
      readManifest(`<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="items">
      <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
      <organizations/>
      <resources>${resources}<resource identifier="modules" type="webcontent">${listed}</resource></resources>
    </manifest>`);
    const files = new Map([
      ...[...items].map(([path, xml]) => [path, new TextEncoder().encode(xml)] as const),
      ...modules,
    ]);
    const pkg = readPackage(writePackage(manifest, files));
    expect(validatePackage(pkg, { customOperators: createScoringOperators() })).toEqual([]);
  });
});

describe("the README", () => {
  it("shows the results that its Quick start gives", async () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const modules = {
      "@assesskit/custom-interactions": await import("../src/index.js"),
      "@assesskit/custom-interactions/node": await import("../src/node/index.js"),
    };
    expect(await runGuideSamples(readme, modules)).toBeGreaterThan(0);
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
