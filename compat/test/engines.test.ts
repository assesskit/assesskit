import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANNED_FEATURES, BASELINE, type Engine } from "../banned-features.ts";
import { ENGINE_PAIRS, imageOf } from "../engines.ts";

const FOLDER = import.meta.dirname;

/** Reads JSON that a file holds; the tests name the shape they expect. */
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

/** Returns the version of an engine in `browsers.json` of the `playwright-core` that a pair installs. */
function browserVersion(pair: string, engine: Engine): string | undefined {
  // The real path, because pnpm links the sibling playwright-core next to the real @playwright/test.
  const require = createRequire(
    realpathSync(join(FOLDER, "../engines", pair, "node_modules/@playwright/test/package.json")),
  );
  const file: { browsers: { name: string; browserVersion?: string }[] } = readJson(
    join(require.resolve("playwright-core/package.json"), "../browsers.json"),
  );
  return file.browsers.find(({ name }) => name === engine)?.browserVersion;
}

describe("the pinned engines", () => {
  it("pin the release of each pair exactly, in a package of its own", () => {
    for (const pair of ENGINE_PAIRS) {
      const manifest: { devDependencies: Record<string, string> } = readJson(
        join(FOLDER, "../engines", pair.name, "package.json"),
      );
      expect(manifest.devDependencies, pair.name).toEqual({ "@playwright/test": pair.playwright });
    }
  });

  it("give every engine of the baseline from a release whose browsers are at the baseline", () => {
    const covered = ENGINE_PAIRS.flatMap((pair) => pair.engines).sort();
    expect(covered).toEqual(Object.keys(BASELINE).sort());
    for (const pair of ENGINE_PAIRS) {
      for (const engine of pair.engines) {
        expect(browserVersion(pair.name, engine), `${pair.name} ${engine}`).toMatch(
          new RegExp(`^${BASELINE[engine].replace(".", "\\.")}`),
        );
      }
    }
  });

  it("run the engines of their pair, and in the image of their release", () => {
    for (const pair of ENGINE_PAIRS) {
      const config = readFileSync(join(FOLDER, "../engines", pair.name, "playwright.config.ts"), "utf8");
      const projects = [...config.matchAll(/browserName: "(\w+)"/g)].map((match) => match[1]);
      expect(projects, pair.name).toEqual(pair.engines);
      expect(imageOf(pair)).toBe(`mcr.microsoft.com/playwright:v${pair.playwright}-jammy`);
    }
  });

  it("are probed for every banned feature with engines of the baseline only", () => {
    for (const { feature, probes } of BANNED_FEATURES) {
      expect(probes.length, feature).toBeGreaterThan(0);
      for (const { absentIn } of probes)
        expect(
          absentIn.every((engine) => engine in BASELINE),
          feature,
        ).toBe(true);
    }
  });
});
