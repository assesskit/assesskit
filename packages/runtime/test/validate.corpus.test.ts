import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AssessmentTest, readAsi } from "../src/asi/index.js";
import type { Issue } from "../src/errors.js";
import { readPackageFile } from "../src/node/index.js";
import type { Resolvers } from "../src/package/index.js";
import { readResults } from "../src/results/index.js";
import { validateAsi, validatePackage, validateResults, validateTest } from "../src/validate/index.js";
import { EXAMPLES, exampleItems } from "./corpus-items.js";

/** Counts the issues by severity and rule: `error assesskit/validate/duplicate-id 2`, sorted. */
function tally(issues: readonly Issue[]): string[] {
  const counts = new Map<string, number>();
  for (const { severity, rule } of issues)
    counts.set(`${severity} ${rule}`, (counts.get(`${severity} ${rule}`) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, count]) => `${key} ${count}`);
}

/** The paths of the documents with an error of each rule. */
function errorFiles(
  found: readonly { readonly path: string; readonly issues: readonly Issue[] }[],
): Record<string, string[]> {
  const files = new Map<string, Set<string>>();
  for (const { path, issues } of found) {
    for (const { severity, rule } of issues) {
      if (severity === "error") files.set(rule, (files.get(rule) ?? new Set()).add(path));
    }
  }
  return Object.fromEntries(
    [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([rule, paths]) => [rule, [...paths].sort()]),
  );
}

describe("the items of the 1EdTech examples", () => {
  const found = exampleItems().map(({ path, item }) => ({
    path,
    issues: validateAsi({ kind: "item", item }, { path }),
  }));

  it("are validated with the findings below, which are all defects of the examples", () => {
    expect(found).toHaveLength(251);
    expect(tally(found.flatMap(({ issues }) => issues))).toEqual([
      "error assesskit/validate/assignment-type 3",
      "error assesskit/validate/declared-value 4",
      "error assesskit/validate/extension-attribute 60",
      "error assesskit/validate/operand-type 2",
      "error assesskit/validate/undeclared-variable 4",
      "error assesskit/validate/unresolved-include 3",
      "warning assesskit/validate/constraint-without-default 3",
      "warning assesskit/validate/identifier-style 7",
      "warning assesskit/validate/match-float 1",
      "warning assesskit/validate/standard-outcome 2",
      "warning assesskit/validate/unbound-response 7",
      "warning assesskit/validate/unreachable-content 56",
    ]);
  });

  it("have the errors in these items: an integer outcome that match_correct gives a float, qti-member with its operands the wrong way round, a misspelled completionStatus, correct responses that are no identifiers, a data attribute misnamed alt, and includes that nobody resolved", () => {
    expect(errorFiles(found)).toEqual({
      "assesskit/validate/assignment-type": [
        "packaging/items/choice_ruby.xml",
        "packaging/items/feedback_adaptive.xml",
      ],
      "assesskit/validate/declared-value": ["packaging/pci/src/fractions1.xml", "packaging/pci/src/fractions_deps.xml"],
      "assesskit/validate/extension-attribute": expect.any(Array),
      "assesskit/validate/operand-type": ["packaging/items/feedback_adaptive.xml"],
      "assesskit/validate/undeclared-variable": [
        "packaging/maxfiles/example/adaptive.xml",
        "packaging/test_package_minfiles/example/adaptive.xml",
      ],
      "assesskit/validate/unresolved-include": [
        "tests/rtest01-set01.xml",
        "tests/rtest01-set02.xml",
        "tests/rtest01-set03.xml",
      ],
    });
  });

  it("find the extension attribute alt of an object only in the items of the shared vocabulary", () => {
    const files = errorFiles(found)["assesskit/validate/extension-attribute"] ?? [];
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((path) => path.startsWith("items/shared-vocabulary/"))).toBe(true);
    const messages = found
      .flatMap(({ issues }) => issues)
      .filter(({ rule }) => rule === "assesskit/validate/extension-attribute");
    expect(
      new Set(messages.map(({ message }) => /attribute (\S+) of the (\S+) /.exec(message)?.slice(1).join(" "))),
    ).toEqual(new Set(["alt object"]));
  });
});

describe("the tests of the 1EdTech examples", () => {
  /** Items that stand in for the ones the tests name: links to a tool, whose variables are not known. */
  const resolvers: Resolvers = {
    items: (href) => ({
      resource: href,
      deliverable: { kind: "lti", identifier: href, link: { title: href, custom: new Map(), extensions: [] } },
      hazards: [],
      variants: [],
    }),
    sections: () => {
      throw new Error("The tests of the examples have no section reference.");
    },
    stimuli: () => {
      throw new Error("The tests of the examples have no stimulus.");
    },
  };
  const tests = readdirSync(join(EXAMPLES, "tests"))
    .sort()
    .flatMap((file): { file: string; test: AssessmentTest }[] => {
      const text = readFileSync(join(EXAMPLES, "tests", file), "utf8");
      const document = text.includes("<qti-assessment-test") ? readAsi(text, { path: file }) : undefined;
      return document?.kind === "test" ? [{ file, test: document.test }] : [];
    });

  it("are valid: the structure, the branch rules and the variables of the 16 tests have no finding", () => {
    expect(tests).toHaveLength(16);
    for (const { file, test } of tests) expect(validateTest(test, file, resolvers), file).toEqual([]);
  });
});

describe("the packages of the 1EdTech examples", () => {
  const zips = readdirSync(EXAMPLES, { recursive: true, encoding: "utf8" })
    .filter(
      (path) =>
        path.endsWith(".zip") && !["CAT/CAT_Test01_Adaptive_EchoAdapt.zip", "PCI/sample_pci.zip"].includes(path),
    )
    .sort();

  it("are validated, 24 archives, with the findings below", async () => {
    expect(zips).toHaveLength(24);
    const found: Record<string, string[]> = {};
    for (const zip of zips) {
      const issues = validatePackage(await readPackageFile(join(EXAMPLES, zip)));
      if (issues.length > 0) found[zip] = tally(issues);
    }
    expect(found).toEqual({
      "items/shared-vocabulary/shared-vocabulary-imsmanifest.zip": [
        "error assesskit/validate/extension-attribute 61",
        "warning assesskit/validate/standard-outcome 1",
        "warning assesskit/validate/unbound-response 1",
      ],
      "packaging/BBQsTest/BBQsTest.zip": [
        "warning assesskit/validate/identifier-mismatch 22",
        "warning assesskit/validate/identifier-style 1",
        "warning assesskit/validate/unbound-response 1",
      ],
      "packaging/basicFeedbackTest/basicFeedbackTest.zip": [
        "error assesskit/validate/adaptive-simultaneous 2",
        "warning assesskit/validate/identifier-mismatch 4",
      ],
      "packaging/ccPackage/ccPackage.zip": [
        "warning assesskit/validate/identifier-mismatch 10",
        "warning assesskit/validate/unreachable-content 56",
      ],
      "packaging/englishBasicLevelV2/englishBasicLevelV2.zip": [
        "warning assesskit/validate/identifier-mismatch 1",
        "warning assesskit/validate/identifier-style 2",
      ],
      "packaging/feedbackTest/feedbackTest.zip": [
        "error assesskit/package/unknown-resource 1",
        "error assesskit/validate/adaptive-simultaneous 3",
        "warning assesskit/validate/identifier-mismatch 1",
        "warning assesskit/validate/identifier-style 3",
        "warning assesskit/validate/unbound-response 1",
      ],
      "packaging/items/items.zip": [
        "error assesskit/asi/missing-attribute 1",
        "error assesskit/validate/assignment-type 3",
        "error assesskit/validate/operand-type 2",
        "warning assesskit/validate/constraint-without-default 3",
        "warning assesskit/validate/identifier-style 2",
        "warning assesskit/validate/match-float 1",
        "warning assesskit/validate/standard-outcome 1",
        "warning assesskit/validate/unbound-response 1",
      ],
      "packaging/maxfiles/maxfiles.zip": ["error assesskit/validate/undeclared-variable 2"],
      "packaging/metaData/metaData.zip": ["error assesskit/validate/metadata-identifier 1"],
      "packaging/pci-simple/pci_simple_example.zip": ["warning assesskit/pci/type-identifier 1"],
      "packaging/pci/pci_item_examples.zip": [
        "error assesskit/asi/attribute 1",
        "error assesskit/validate/declared-value 4",
        "error assesskit/validate/missing-file 4",
        "error assesskit/validate/unlisted-file 1",
        "warning assesskit/pci/type-identifier 1",
        "warning assesskit/validate/identifier-style 1",
      ],
      "packaging/test_package_minfiles/test_package_minfiles.zip": [
        "error assesskit/validate/adaptive-simultaneous 1",
        "error assesskit/validate/metadata-identifier 1",
        "error assesskit/validate/undeclared-variable 2",
        "warning assesskit/validate/identifier-mismatch 4",
      ],
    });
  });
});

describe("the results reports of the 1EdTech examples", () => {
  const report = (name: string) => readResults(readFileSync(join(EXAMPLES, "results", name), "utf8"));

  it("have item results without a sequenceIndex in the conformance example, and none in the report", () => {
    const issues = validateResults(report("conformance-use-case-1.xml"));
    expect(issues.length).toBeGreaterThan(0);
    expect(new Set(issues.map(({ rule }) => rule))).toEqual(new Set(["assesskit/validate/sequence-index"]));
    expect(validateResults(report("report.xml"))).toEqual([]);
  });
});
