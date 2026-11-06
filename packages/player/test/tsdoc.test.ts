import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { examplesIn, runExample } from "../../../scripts/tsdoc-examples.js";
import { sourceLoader, sourcesBelow } from "../../../scripts/tsdoc-sources.js";

/** The root of the repository. */
const ROOT = resolve(import.meta.dirname, "../../..");

/** The files whose examples need a page, which `tsdoc.browser.test.ts` runs. */
const IN_A_PAGE = ["packages/player/src/client/remote.ts", "packages/player/src/player/delivery/mount.ts"];

const all = examplesIn(sourcesBelow(ROOT, "packages/player/src"));
const examples = all.filter(({ file }) => !IN_A_PAGE.includes(file));
const load = sourceLoader(ROOT, (specifier) => import(specifier));

describe("the examples of the TSDoc comments", () => {
  it("has an example for the main function of the modules, and leaves those that need a page to the browser test", () => {
    expect(examples.length).toBeGreaterThan(0);
    expect(all.filter(({ file }) => IN_A_PAGE.includes(file)).map(({ file }) => file)).toStrictEqual(IN_A_PAGE);
  });

  it.each(examples)("shows the results that the example of $file from line $line gives", async (example) => {
    expect(await runExample(example, load)).toBeGreaterThan(0);
  });
});
