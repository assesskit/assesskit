import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { examplesIn, runExample } from "../../../scripts/tsdoc-examples.js";
import { sourceLoader, sourcesBelow } from "../../../scripts/tsdoc-sources.js";

/** The root of the repository. */
const ROOT = resolve(import.meta.dirname, "../../..");

const examples = examplesIn(sourcesBelow(ROOT, "packages/runtime/src"));
const load = sourceLoader(ROOT, (specifier) => import(specifier));

describe("the examples of the TSDoc comments", () => {
  it("has an example for the main function of the modules", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)("shows the results that the example of $file from line $line gives", async (example) => {
    expect(await runExample(example, load)).toBeGreaterThan(0);
  });
});
