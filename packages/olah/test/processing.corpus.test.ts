import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import {
  type AssessmentItem,
  createItemVariables,
  createRandom,
  ProcessingError,
  type ResponseProcessing,
  readAsi,
  runResponseProcessing,
  runTemplateProcessing,
  STANDARD_TEMPLATES,
  standardTemplateUri,
  type Value,
} from "../src/index.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const TEMPLATE_BASE = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/";

function processingAt(path: string): ResponseProcessing {
  const document = readAsi(readFileSync(join(examples, path)));
  if (document.kind !== "response-processing") throw new Error(`${path} is no response processing.`);
  return document.processing;
}

/** The items of the examples, by path. */
const items = new Map<string, AssessmentItem>();
for (const path of readdirSync(examples, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".xml"))
  .sort()) {
  const text = readFileSync(join(examples, path), "utf8");
  if (!text.includes("<qti-assessment-item")) continue;
  const document = readAsi(text, { path });
  if (document.kind === "item") items.set(path, document.item);
}

/** Runs template processing, then response processing with no responses or with the correct responses. */
function scored(item: AssessmentItem, correct: boolean): ReadonlyMap<string, Value | null> {
  const random = createRandom(1);
  const instance = runTemplateProcessing(item, createItemVariables(item), { random });
  const responses = new Map(instance.responses);
  if (correct) for (const [identifier, value] of instance.correctResponses) responses.set(identifier, value);
  return runResponseProcessing(item, { ...instance, responses }, { random }).outcomes;
}

/** The items whose content breaks a rule of processing, with the error each raises. */
const CONTENT_ERRORS = new Map([
  ["packaging/BBQsTest/id-bd44a757f562/SineRule-001.xml", "No custom operator is registered"],
  ["packaging/items/choice_ruby.xml", "The variable SCORE is a single integer and cannot be set to a single float."],
  [
    "packaging/items/feedback_adaptive.xml",
    "The variable FEEDBACK is a multiple identifier and cannot be set to a single identifier.",
  ],
  ["packaging/maxfiles/example/adaptive.xml", "sets completion_status, which is not an outcome variable"],
  [
    "packaging/pci/src/fractions1.xml",
    'The correct response of RESPONSE has the text "1", which is not a value of base type identifier.',
  ],
  [
    "packaging/pci/src/fractions_deps.xml",
    'The correct response of RESPONSE has the text "1", which is not a value of base type identifier.',
  ],
  [
    "packaging/pci/src/fractions_deps_2.xml",
    'The correct response of RESPONSE has the text "1", which is not a value of base type identifier.',
  ],
  ["packaging/test_package_minfiles/example/adaptive.xml", "sets completion_status, which is not an outcome variable"],
]);

describe("standard templates", () => {
  it("[B45][A55][C] equal the published files that the examples carry", () => {
    const copies = new Map([
      ["match_correct", "packaging/maxfiles/rptemplates/match_correct.xml"],
      ["map_response", "packaging/maxfiles/rptemplates/map_response.xml"],
      ["CC2_match", "packaging/ccPackage/rptemplates/CC2_match.xml"],
      ["CC2_match_basic", "packaging/ccPackage/rptemplates/CC2_match_basic.xml"],
      ["CC2_map_response", "packaging/ccPackage/rptemplates/CC2_map_response.xml"],
    ]);
    for (const [name, path] of copies)
      expect(STANDARD_TEMPLATES.get(`${TEMPLATE_BASE}${name}.xml`), name).toEqual(processingAt(path));
  });

  it("[B45][C] has map_response_point as published: map_response with qti-map-response-point and SCORE 0 for NULL", () => {
    // The published map_response_point.xml, which the examples do not carry, differs from map_response.xml only there.
    const published = JSON.parse(
      JSON.stringify(processingAt("packaging/maxfiles/rptemplates/map_response.xml"))
        .replace('"kind":"map-response"', '"kind":"map-response-point"')
        .replace('"value":"0.0"', '"value":"0"'),
    );
    expect(STANDARD_TEMPLATES.get(`${TEMPLATE_BASE}map_response_point.xml`)).toEqual(published);
  });

  it("[B45][G43][C] names a standard template in every response processing template URI of the examples", () => {
    const uris = [...items.values()]
      .flatMap(({ responseProcessing }) => responseProcessing?.template ?? [])
      .filter((uri) => uri !== "");
    expect(new Set(uris).size).toBe(7);
    for (const uri of uris) expect(standardTemplateUri(uri), uri).toBeDefined();
  });
});

describe("the items of the examples", () => {
  it("[C] are read: 253 items", () => {
    expect(items.size).toBe(253);
  });

  it("[B11][C] run template and response processing, with no responses and with the correct responses", () => {
    const failures = new Map<string, string>();
    for (const [path, item] of items) {
      try {
        scored(item, false);
        scored(item, true);
      } catch (error) {
        if (!(error instanceof ProcessingError)) throw error;
        failures.set(path, error.message);
      }
    }
    expect([...failures.keys()]).toEqual([...CONTENT_ERRORS.keys()]);
    for (const [path, text] of CONTENT_ERRORS) expect(failures.get(path), path).toContain(text);
  });

  it("[B45][C] score 1 for the correct responses and 0 for none with match_correct and CC2_match (INFO §2.5.1)", () => {
    const matching = [...items].filter(
      ([path, { responseProcessing }]) =>
        !CONTENT_ERRORS.has(path) &&
        ["match_correct", "CC2_match"].some(
          (name) => standardTemplateUri(responseProcessing?.template ?? "") === `${TEMPLATE_BASE}${name}.xml`,
        ),
    );
    expect(matching.length).toBeGreaterThan(40);
    for (const [path, item] of matching) {
      expect(scored(item, true).get("SCORE"), path).toEqual({ cardinality: "single", baseType: "float", value: 1 });
      expect(scored(item, false).get("SCORE"), path).toEqual({ cardinality: "single", baseType: "float", value: 0 });
    }
  });
});
