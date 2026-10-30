import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireSchemas } from "../../../scripts/schemas.js";
import { ASI_NAMESPACE, readAsi, writeAsi } from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(resolve(import.meta.dirname, "../../..")));
});

afterAll(() => {
  schemas.close();
});

const NS = `xmlns="${ASI_NAMESPACE}"`;

/** The item with the given elements before its body, and the markup as its body. */
const itemOf = (body: string, before = ""): string =>
  `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false"><qti-outcome-declaration identifier="O" cardinality="single" base-type="identifier"/>${before}<qti-item-body>${body}</qti-item-body></qti-assessment-item>`;

const issuesOf = (xml: string) => validateXmlFiles(schemas, [{ path: "document.xml", content: xml }]);

/** Writes the document that `readAsi` reads from the markup, reads the written text back, and returns the schema's issues. */
async function writtenIssues(xml: string) {
  const written = writeAsi(readAsi(xml));
  expect(writeAsi(readAsi(written))).toBe(written);
  return issuesOf(written);
}

describe("the vocabularies of the content", () => {
  it("[W15] CalculatorTypeEnum: writes basic, graphing, scientific and standard that the schema accepts, and the schema refuses another term", async () => {
    const calculator = (type: string): string =>
      itemOf(
        "<p>x</p>",
        `<qti-companion-materials-info><qti-calculator><qti-calculator-type>${type}</qti-calculator-type><qti-description>c</qti-description></qti-calculator></qti-companion-materials-info>`,
      );
    for (const type of ["basic", "graphing", "scientific", "standard"])
      expect(await writtenIssues(calculator(type))).toEqual([]);
    expect(await issuesOf(calculator("financial"))).not.toEqual([]);
  });

  /** An item whose companion materials have a ruler or a protractor whose increments are in the unit. */
  function increments(place: "rule-si" | "rule-us" | "protractor-si" | "protractor-us", unit: string): string {
    const units = `<qti-minor-increment unit="${unit}">1</qti-minor-increment><qti-major-increment unit="${unit}">2</qti-major-increment>`;
    const markup = {
      "rule-si": `<qti-rule><qti-description>r</qti-description><qti-rule-system-si><qti-minimum-length>1</qti-minimum-length>${units}</qti-rule-system-si></qti-rule>`,
      "rule-us": `<qti-rule><qti-description>r</qti-description><qti-rule-system-us><qti-minimum-length>1</qti-minimum-length>${units}</qti-rule-system-us></qti-rule>`,
      "protractor-si": `<qti-protractor><qti-description>p</qti-description><qti-increment-si>${units}</qti-increment-si></qti-protractor>`,
      "protractor-us": `<qti-protractor><qti-description>p</qti-description><qti-increment-us>${units}</qti-increment-us></qti-protractor>`,
    }[place];
    return itemOf("<p>x</p>", `<qti-companion-materials-info>${markup}</qti-companion-materials-info>`);
  }

  it("[W28] SIUnitTypeEnum: writes Millimeter, Centimeter, Meter and Kilometer on a metric ruler that the schema accepts, and the schema refuses another unit", async () => {
    for (const unit of ["Millimeter", "Centimeter", "Meter", "Kilometer"]) {
      expect(await writtenIssues(increments("rule-si", unit))).toEqual([]);
    }
    expect(await issuesOf(increments("rule-si", "Inch"))).not.toEqual([]);
  });

  it("[W40] USUnitTypeEnum: writes Inch, Foot, Yard and Mile on a ruler in US units that the schema accepts, and the schema refuses another unit", async () => {
    for (const unit of ["Inch", "Foot", "Yard", "Mile"])
      expect(await writtenIssues(increments("rule-us", unit))).toEqual([]);
    expect(await issuesOf(increments("rule-us", "Meter"))).not.toEqual([]);
  });

  it("[W27] SIRadialUnitTypeEnum: writes Radian on a protractor in SI units that the schema accepts, and the schema refuses another unit", async () => {
    expect(await writtenIssues(increments("protractor-si", "Radian"))).toEqual([]);
    expect(await issuesOf(increments("protractor-si", "Degree"))).not.toEqual([]);
  });

  it("[W39] USRadialUnitTypeEnum: writes Degree, Minute and Second on a protractor in US units that the schema accepts, and the schema refuses another unit", async () => {
    for (const unit of ["Degree", "Minute", "Second"])
      expect(await writtenIssues(increments("protractor-us", unit))).toEqual([]);
    expect(await issuesOf(increments("protractor-us", "Radian"))).not.toEqual([]);
  });

  it("[W30] ShowHideEnum: writes show and hide on feedback that the schema accepts, and the schema refuses another term", async () => {
    const feedback = (term: string): string =>
      itemOf(
        `<qti-feedback-block outcome-identifier="O" identifier="x" show-hide="${term}"><qti-content-body><p>x</p></qti-content-body></qti-feedback-block>`,
      );
    for (const term of ["show", "hide"]) expect(await writtenIssues(feedback(term))).toEqual([]);
    expect(await issuesOf(feedback("visible"))).not.toEqual([]);
  });

  it("[W33][W54] SupportEnum and SupportEnumExt: writes the 15 supports and ext: terms on a card that the schema accepts, and the schema refuses another term", async () => {
    const supports = [
      "additional-directions",
      "audio-description",
      "braille",
      "glossary-on-screen",
      "high-contrast",
      "keyboard-directions",
      "keyword-translation",
      "linguistic-guidance",
      "long-description",
      "sign-language",
      "simplified-graphics",
      "simplified-language-portions",
      "spoken",
      "tactile",
      "transcript",
      "ext:flashcards",
      "ext:org.example-deck_2",
    ];
    const card = (support: string): string =>
      itemOf("<p>x</p>", "").replace(
        "</qti-item-body>",
        `</qti-item-body><qti-catalog-info><qti-catalog id="c"><qti-card support="${support}"><qti-html-content>x</qti-html-content></qti-card></qti-catalog></qti-catalog-info>`,
      );
    for (const support of supports) expect(await writtenIssues(card(support))).toEqual([]);
    for (const support of ["hint", "line-reader", "ext:has space"])
      expect(await issuesOf(card(support))).not.toEqual([]);
  });

  it("[W36] TestFeedbackAccessEnum: writes during and atEnd on test feedback that the schema accepts, and the schema refuses another term", async () => {
    const test = (access: string): string =>
      `<qti-assessment-test ${NS} identifier="test" title="Test"><qti-outcome-declaration identifier="O" cardinality="single" base-type="identifier"/><qti-test-part identifier="p" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="s" title="S" visible="true"><qti-assessment-item-ref identifier="i" href="i.xml"/></qti-assessment-section><qti-test-feedback access="${access}" outcome-identifier="O" show-hide="show" identifier="x"><qti-content-body><p>x</p></qti-content-body></qti-test-feedback></qti-test-part></qti-assessment-test>`;
    for (const access of ["during", "atEnd"]) expect(await writtenIssues(test(access))).toEqual([]);
    expect(await issuesOf(test("always"))).not.toEqual([]);
  });

  it("[W41][W55] UseEnum and UseEnumExt: writes instructions, scoring, navigation and ext: terms on a rubric block that the schema accepts, and the schema refuses another term", async () => {
    const rubric = (use: string): string =>
      itemOf(
        `<qti-rubric-block view="author" use="${use}"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block>`,
      );
    for (const use of ["instructions", "scoring", "navigation", "ext:hint", "ext:org.example-kind_1"]) {
      expect(await writtenIssues(rubric(use))).toEqual([]);
    }
    for (const use of ["hint", "ext:has space"]) expect(await issuesOf(rubric(use))).not.toEqual([]);
  });

  it("[W49] ViewEnum: writes the six views, alone and together, on a rubric block that the schema accepts, and the schema refuses another term", async () => {
    const rubric = (view: string): string =>
      itemOf(
        `<qti-rubric-block view="${view}" use="instructions"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block>`,
      );
    for (const view of [
      "author",
      "candidate",
      "proctor",
      "scorer",
      "testConstructor",
      "tutor",
      "author candidate tutor",
    ]) {
      expect(await writtenIssues(rubric(view))).toEqual([]);
    }
    expect(await issuesOf(rubric("student"))).not.toEqual([]);
  });
});
