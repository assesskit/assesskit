import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { compileXsdRegex } from "../src/values/index.js";
import { loadRegexSuite } from "./w3c-regex-suite.js";

const suite = loadRegexSuite(resolve(requireCorpus(resolve(import.meta.dirname, "../../..")), "xsdtests"));

describe("[B79] the regular expression tests of the W3C XML Schema test suite", () => {
  it("reads the string tests of the suite", () => {
    expect(suite.length).toBeGreaterThan(1900);
  });

  for (const testCase of suite) {
    it(`${testCase.name}: ${testCase.patternGroups
      .flat()
      .map((pattern) => JSON.stringify(pattern))
      .join(" ")}`, () => {
      const compiled = (): ReturnType<typeof compileXsdRegex>[][] =>
        testCase.patternGroups.map((group) => group.map((pattern) => compileXsdRegex(pattern)));
      if (!testCase.schemaValid) {
        expect(compiled).toThrow();
        return;
      }
      const groups = compiled();
      for (const instance of testCase.instances) {
        const accepted = instance.values.every((value) =>
          groups.every((group) => group.some((pattern) => pattern.matches(value))),
        );
        expect(accepted, `${instance.name} with ${JSON.stringify(instance.values)}`).toBe(instance.valid);
      }
    });
  }
});
