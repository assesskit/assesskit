import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ELEMENTS,
  ELEMENT_TYPES,
  EXPRESSION,
  formatAttributeValue,
  kindOf,
  parseAttributeValue,
  RUBRIC_KINDS,
  readElement,
  scoreRange,
  scoringRubricBlocks,
  scoringRubricOf,
  type TypeDef,
  typeNamed,
  withDescendants,
  writeElement,
} from "../src/asi/internal.js";
import {
  type AreaShape,
  ASI_NAMESPACE,
  type AsiDocument,
  type AssessmentItem,
  type AssessmentSection,
  type AssessmentStimulus,
  type AssessmentTest,
  checkScoringRubric,
  childNodes,
  coordinateCountFits,
  DataError,
  descendantNodes,
  type ElementVisit,
  type Expression,
  isBodyNode,
  isModelNode,
  type ModelNode,
  type OutcomeDeclaration,
  type OutcomeProcessing,
  type OutcomeRule,
  parseXml,
  ReadError,
  type ResponseProcessing,
  type ResponseRule,
  type RubricContent,
  type RubricRating,
  readAsi,
  readScoreCovers,
  readScoringRubrics,
  SCORE_COVERS_CLASS,
  SCORING_RUBRIC_CLASS,
  type ScoreCover,
  type ScoringRubric,
  scoreCoverBlocks,
  scoreCoversBlock,
  scoreFromRatings,
  scoringRubricBlock,
  serializeXml,
  type TemplateRule,
  walkDocument,
  writeAsi,
  XINCLUDE_NAMESPACE,
  type XmlElement,
} from "../src/index.js";
import { DOCUMENT_ARBITRARIES, modelArbitrary, SCORING_RUBRICS } from "./arbitraries/asi.js";
import { PLACES, VOCABULARIES, vocabularyOf } from "./asi-vocabularies.js";
import { fuzzReader } from "./fuzz.js";
import { runGuideSamples } from "./guide-samples.js";
import { ESSAY, ESSAY_MARKUP, KIND_EXAMPLES } from "./scoring-rubrics.js";

const NAMESPACE = `xmlns="${ASI_NAMESPACE}"`;
const SCHEMA_LOCATION =
  "http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd";

/** Reads a document and checks that writing it and reading that gives the same model. */
function checked(xml: string): AsiDocument {
  const document = readAsi(xml);
  expect(readAsi(writeAsi(document)), "the model after writing and reading").toEqual(document);
  return document;
}

function item(content = "", attributes = ""): string {
  return `<qti-assessment-item ${NAMESPACE} identifier="i" title="t" time-dependent="false"${attributes}>${content}</qti-assessment-item>`;
}

function itemOf(xml: string): AssessmentItem {
  const document = checked(xml);
  if (document.kind !== "item") throw new Error(`Expected an item, found ${document.kind}.`);
  return document.item;
}

function testOf(content: string, attributes = ""): AssessmentTest {
  const document = checked(
    `<qti-assessment-test ${NAMESPACE} identifier="T" title="t"${attributes}>${content}</qti-assessment-test>`,
  );
  if (document.kind !== "test") throw new Error(`Expected a test, found ${document.kind}.`);
  return document.test;
}

const PART = '<qti-test-part identifier="P" navigation-mode="linear" submission-mode="individual">';

/** A test with one part and the given content inside the part. */
function partOf(content: string) {
  const [part] = testOf(`${PART}${content}</qti-test-part>`).testParts;
  if (part === undefined) throw new Error("The test has no part.");
  return part;
}

function sectionOf(content: string, attributes = ""): AssessmentSection {
  const document = checked(
    `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"${attributes}>${content}</qti-assessment-section>`,
  );
  if (document.kind !== "section") throw new Error(`Expected a section, found ${document.kind}.`);
  return document.section;
}

function responseProcessingOf(content: string, attributes = ""): ResponseProcessing {
  const document = checked(`<qti-response-processing ${NAMESPACE}${attributes}>${content}</qti-response-processing>`);
  if (document.kind !== "response-processing") throw new Error(`Expected response processing, found ${document.kind}.`);
  return document.processing;
}

function outcomeProcessingOf(content: string): OutcomeProcessing {
  const document = checked(`<qti-outcome-processing ${NAMESPACE}>${content}</qti-outcome-processing>`);
  if (document.kind !== "outcome-processing") throw new Error(`Expected outcome processing, found ${document.kind}.`);
  return document.processing;
}

function responseRuleOf(markup: string): ResponseRule {
  const [rule] = responseProcessingOf(markup).rules;
  if (rule === undefined) throw new Error("The response processing has no rule.");
  return rule;
}

function outcomeRuleOf(markup: string): OutcomeRule {
  const [rule] = outcomeProcessingOf(markup).rules;
  if (rule === undefined) throw new Error("The outcome processing has no rule.");
  return rule;
}

function templateRuleOf(markup: string): TemplateRule {
  const [rule] = (
    itemOf(item(`<qti-template-processing>${markup}</qti-template-processing>`)).templateProcessing ?? {
      rules: [],
    }
  ).rules;
  if (rule === undefined) throw new Error("The template processing has no rule.");
  return rule;
}

/** Reads an expression as the condition of a response rule. */
function expressionOf(markup: string): Expression {
  const rule = responseRuleOf(
    `<qti-response-condition><qti-response-if>${markup}</qti-response-if></qti-response-condition>`,
  );
  if (rule.kind !== "response-condition") throw new Error(`Expected a condition, found ${rule.kind}.`);
  return rule.responseIf.condition;
}

function declarationOf(markup: string): OutcomeDeclaration {
  const document = checked(markup);
  if (document.kind !== "outcome-declaration") throw new Error(`Expected a declaration, found ${document.kind}.`);
  return document.declaration;
}

function stimulusOf(markup: string): AssessmentStimulus {
  const document = checked(markup);
  if (document.kind !== "stimulus") throw new Error(`Expected a stimulus, found ${document.kind}.`);
  return document.stimulus;
}

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("The function did not throw.");
}

/** The first issue of the ReadError a function throws. */
function readIssue(run: () => unknown) {
  const error = thrown(run);
  if (!(error instanceof ReadError)) throw error;
  const [issue] = error.issues;
  if (issue === undefined) throw new Error("The ReadError has no issue.");
  return issue;
}

const ONE_XML = '<qti-base-value base-type="integer">1</qti-base-value>';
const ONE: Expression = { kind: "base-value", baseType: "integer", value: "1" };
const RESPONSE_XML = '<qti-variable identifier="RESPONSE"/>';
const RESPONSE: Expression = { kind: "variable", identifier: "RESPONSE" };
const PAIR_XML = `${ONE_XML}${ONE_XML}`;
const PAIR: readonly Expression[] = [ONE, ONE];

function foreignElement(name: string, prefix = "x", namespace = "urn:x"): XmlElement {
  return { kind: "element", namespace, prefix, name, attributes: [], children: [] };
}

describe("attribute values", () => {
  const boolean = { kind: "boolean" } as const;
  const integer = { kind: "integer" } as const;
  const double = { kind: "double" } as const;
  const tolerance = { kind: "reference", value: "double" } as const;
  const count = { kind: "reference", value: "integer" } as const;
  const mode = { kind: "enum", terms: ["a", "b"] } as const;
  const use = { kind: "enum", terms: ["a"], extension: true } as const;

  it("reads booleans in the lexical forms of xs:boolean and writes true and false", () => {
    expect(["true", "false", "1", "0", " true "].map((text) => parseAttributeValue(boolean, text))).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(() => parseAttributeValue(boolean, "yes")).toThrow(DataError);
    expect(formatAttributeValue(boolean, false)).toBe("false");
    expect(() => formatAttributeValue(boolean, "true")).toThrow(
      new DataError('A value must be a boolean, found "true".'),
    );
  });

  it("reads integers within the safe range and refuses the others", () => {
    expect(parseAttributeValue(integer, " -42 ")).toBe(-42);
    expect(() => parseAttributeValue(integer, "1.5")).toThrow(DataError);
    expect(() => parseAttributeValue(integer, "9007199254740993")).toThrow(DataError);
    expect(formatAttributeValue(integer, 7)).toBe("7");
    expect(() => formatAttributeValue(integer, 1.5)).toThrow(DataError);
    expect(() => formatAttributeValue(integer, "7")).toThrow(new DataError('A value must be a number, found "7".'));
  });

  it("reads doubles with INF, -INF and NaN and writes them back", () => {
    expect(["1e3", " .5 ", "INF", "-INF", "-0"].map((text) => parseAttributeValue(double, text))).toEqual([
      1000,
      0.5,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -0,
    ]);
    expect(parseAttributeValue(double, "NaN")).toBeNaN();
    expect([Number.POSITIVE_INFINITY, Number.NaN, 0.1, -0].map((value) => formatAttributeValue(double, value))).toEqual(
      ["INF", "NaN", "0.1", "-0"],
    );
  });

  it("reads a reference to a variable where an integer can be, and writes either", () => {
    expect([" 5 ", "-3", "+3", "N", "ITEM.n"].map((text) => parseAttributeValue(count, text))).toEqual([
      5,
      -3,
      3,
      "N",
      "ITEM.n",
    ]);
    expect(() => parseAttributeValue(count, "1.5")).toThrow(DataError);
    expect(() => parseAttributeValue(count, "a b")).toThrow(DataError);
    expect(formatAttributeValue(count, "N")).toBe("N");
    expect(formatAttributeValue(count, 5)).toBe("5");
    expect(() => formatAttributeValue(count, 1.5)).toThrow(DataError);
    expect(() => formatAttributeValue(count, "1x")).toThrow(
      new DataError('A value must be a number or the identifier of a variable, found "1x".'),
    );
  });

  it("reads a reference to a variable where a double can be: INF and NaN are numbers", () => {
    expect(["0.1", "T", "INF", "1e2", ".5"].map((text) => parseAttributeValue(tolerance, text))).toEqual([
      0.1,
      "T",
      Number.POSITIVE_INFINITY,
      100,
      0.5,
    ]);
    expect(parseAttributeValue(tolerance, "NaN")).toBeNaN();
    expect(formatAttributeValue(tolerance, Number.POSITIVE_INFINITY)).toBe("INF");
    expect(() => formatAttributeValue(tolerance, "INF")).toThrow(DataError);
  });

  it("reads {identifier} where the schema leaves the string open, and writes a variable in braces", () => {
    const braced = { kind: "reference", value: "double", braced: true } as const;
    expect(["{T}", "T", "0.1", "{INF}", "INF", "{ITEM.n}"].map((text) => parseAttributeValue(braced, text))).toEqual([
      "T",
      "T",
      0.1,
      "INF",
      Number.POSITIVE_INFINITY,
      "ITEM.n",
    ]);
    for (const text of ["{}", "{1x}", "{a b}", "{T", "T}", "{{T}}", "", "a b"]) {
      expect(() => parseAttributeValue(braced, text), text).toThrow(DataError);
    }
    expect(["T", "INF", "ITEM.n"].map((value) => formatAttributeValue(braced, value))).toEqual([
      "{T}",
      "{INF}",
      "{ITEM.n}",
    ]);
    expect([0.5, Number.POSITIVE_INFINITY].map((value) => formatAttributeValue(braced, value))).toEqual(["0.5", "INF"]);
    expect(() => formatAttributeValue(braced, "1x")).toThrow(
      new DataError('A value must be a number or the identifier of a variable, found "1x".'),
    );
    expect(() => parseAttributeValue(tolerance, "{T}")).toThrow(DataError);
  });

  it("reads the terms of an enumeration and refuses any other, naming the terms", () => {
    expect(parseAttributeValue(mode, "a")).toBe("a");
    expect(() => parseAttributeValue(mode, "c")).toThrow(new DataError('The text "c" is not one of "a", "b".'));
    expect(() => formatAttributeValue(mode, "c")).toThrow(DataError);
    expect(() => formatAttributeValue(mode, 1)).toThrow(new DataError("A value must be a string, found 1."));
  });

  it("reads an ext: term where the vocabulary can be extended", () => {
    expect(parseAttributeValue(use, "ext:peer")).toBe("ext:peer");
    expect(() => parseAttributeValue(use, "ext:")).toThrow(
      new DataError('The text "ext:" is not one of "a" or an ext: term.'),
    );
    expect(() => parseAttributeValue(mode, "ext:peer")).toThrow(DataError);
  });

  it("reads a list by white space and writes one space, refusing an item that has white space", () => {
    const list = { kind: "list", item: { kind: "string" } } as const;
    expect(parseAttributeValue(list, " a \t b\n")).toEqual(["a", "b"]);
    expect(parseAttributeValue(list, "")).toEqual([]);
    expect(formatAttributeValue(list, ["a", "b"])).toBe("a b");
    expect(() => formatAttributeValue(list, ["a b"])).toThrow(
      new DataError('The item "a b" of a list must be text without white space.'),
    );
    expect(() => formatAttributeValue(list, [""])).toThrow(DataError);
    expect(() => formatAttributeValue(list, "a")).toThrow(new DataError('A value must be an array, found "a".'));
  });

  it("reads a list of references", () => {
    const list = { kind: "list", item: tolerance } as const;
    expect(parseAttributeValue(list, "0.5 T")).toEqual([0.5, "T"]);
    expect(formatAttributeValue(list, [0.5, "T"])).toBe("0.5 T");
  });

  it("keeps a string as written", () => {
    expect(parseAttributeValue({ kind: "string" }, "  a  b ")).toBe("  a  b ");
    expect(() => formatAttributeValue({ kind: "string" }, null)).toThrow(
      new DataError("A value must be a string, found null."),
    );
  });
});

describe("building and reading the covers", () => {
  /** The example of the convention: one rubric block that covers two responses. */
  const coversBlock =
    '<qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="CONTENT"><qti-content-body><p>Rate content once, across both writing tasks.</p><ul><li data-item-ref="W1" data-response-identifier="RESPONSE">Task 1: essay</li><li data-item-ref="W2" data-response-identifier="RESPONSE">Task 2: letter</li></ul></qti-content-body></qti-rubric-block>';
  const testWith = (blocks: string) =>
    `<qti-assessment-test ${NAMESPACE} identifier="T" title="t"><qti-outcome-declaration identifier="CONTENT" cardinality="single" base-type="float" external-scored="human"/>${blocks}${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part></qti-assessment-test>`;
  const covers: readonly ScoreCover[] = [
    { itemRef: "W1", responseIdentifier: "RESPONSE", label: "Task 1: essay" },
    { itemRef: "W2", responseIdentifier: "RESPONSE", label: "Task 2: letter" },
  ];
  const notes = [
    {
      kind: "p",
      children: [{ kind: "text", value: "Rate content once, across both writing tasks." }],
      extensions: [],
    },
  ] satisfies RubricContent[];

  it("reads the covers of the example block in document order, with the labels as text", () => {
    const read = checked(testWith(coversBlock));
    if (read.kind !== "test") throw new Error("Expected a test.");
    expect(readScoreCovers(read.test)).toEqual(new Map([["CONTENT", covers]]));
  });

  it("builds the block that reading the example gives, and writes it before the first test part", () => {
    const read = checked(testWith(coversBlock));
    if (read.kind !== "test") throw new Error("Expected a test.");
    const block = scoreCoversBlock("CONTENT", covers, notes);
    expect(block).toEqual(read.test.rubricBlocks[0]);
    const written = writeAsi({ kind: "test", test: { ...testModel(), rubricBlocks: [block] } });
    expect(written.indexOf("<qti-rubric-block")).toBeLessThan(written.indexOf("<qti-test-part"));
  });

  it("keeps the block as an ordinary rubric block of the test, with covers derived and not copied", () => {
    const read = checked(testWith(coversBlock));
    if (read.kind !== "test") throw new Error("Expected a test.");
    const [block] = read.test.rubricBlocks;
    expect(block).toMatchObject({
      kind: "rubric-block",
      view: ["scorer"],
      use: "scoring",
      class: ["external-score-covers"],
      extensions: [{ namespace: "", name: "data-outcome-identifier", value: "CONTENT" }],
    });
    expect(block?.contentBody.children).toHaveLength(2);
    expect(Object.keys(read.test)).not.toContain("scoreCovers");
  });

  it("reads the covers by outcome, from the test level only, and skips what is not a cover", () => {
    const block = (outcome: string, entries: string, attributes = "") =>
      `<qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="${outcome}"${attributes}><qti-content-body><ul>${entries}</ul></qti-content-body></qti-rubric-block>`;
    const read = checked(
      testWith(
        `${block("A", '<li data-item-ref="Q1" data-response-identifier="R">  one\n   two </li><li data-item-ref="Q2">no response</li>')}${block("B", '<li data-item-ref="Q3" data-response-identifier="R"/>')}${block("A", '<li data-item-ref="Q4" data-response-identifier="R2">four</li>')}<qti-rubric-block view="scorer" use="scoring" class="other"><qti-content-body><ul><li data-item-ref="Q5" data-response-identifier="R">x</li></ul></qti-content-body></qti-rubric-block>`,
      ).replace(
        `${PART}`,
        `${PART}<qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="C"><qti-content-body><ul><li data-item-ref="Q6" data-response-identifier="R">x</li></ul></qti-content-body></qti-rubric-block>`,
      ),
    );
    if (read.kind !== "test") throw new Error("Expected a test.");
    expect(readScoreCovers(read.test)).toEqual(
      new Map([
        [
          "A",
          [
            { itemRef: "Q1", responseIdentifier: "R", label: "one two" },
            { itemRef: "Q4", responseIdentifier: "R2", label: "four" },
          ],
        ],
        ["B", [{ itemRef: "Q3", responseIdentifier: "R" }]],
      ]),
    );
  });

  it("gives no covers for a test without covers blocks", () => {
    const read = checked(testWith(""));
    if (read.kind !== "test") throw new Error("Expected a test.");
    expect(readScoreCovers(read.test).size).toBe(0);
  });

  it("builds a block that a round trip keeps unchanged", () => {
    const block = scoreCoversBlock("CONTENT", covers, notes);
    const document: AsiDocument = { kind: "test", test: { ...testModel(), rubricBlocks: [block] } };
    const again = readAsi(writeAsi(document));
    expect(again).toEqual(document);
    if (again.kind !== "test") throw new Error("Expected a test.");
    expect(readScoreCovers(again.test)).toEqual(new Map([["CONTENT", covers]]));
  });

  it("writes the white space of a label normalized and leaves a block without notes with the list only", () => {
    const block = scoreCoversBlock("O", [{ itemRef: "Q", responseIdentifier: "R", label: " a \n b " }]);
    expect(block.contentBody.children).toEqual([
      {
        kind: "ul",
        items: [
          {
            kind: "li",
            children: [{ kind: "text", value: "a b" }],
            extensions: [
              { namespace: "", name: "data-item-ref", value: "Q" },
              { namespace: "", name: "data-response-identifier", value: "R" },
            ],
          },
        ],
        extensions: [],
      },
    ]);
  });

  it("refuses what is not an identifier, a list of covers or a list of notes", () => {
    expect(() => scoreCoversBlock("1x", [])).toThrow(DataError);
    expect(() => scoreCoversBlock("O", [{ itemRef: "a b", responseIdentifier: "R" }])).toThrow(
      new DataError('The item reference of a cover must be an identifier, found "a b".'),
    );
    expect(() => scoreCoversBlock("O", [{ itemRef: "Q", responseIdentifier: "" }])).toThrow(DataError);
    expect(() => scoreCoversBlock("O", [{ itemRef: "Q", responseIdentifier: "R", label: JSON.parse("5") }])).toThrow(
      new DataError("The label of a cover must be a string, found 5."),
    );
    expect(() => scoreCoversBlock("O", JSON.parse("{}"))).toThrow(
      new DataError("The covers must be an array, found an object."),
    );
    expect(() => scoreCoversBlock("O", JSON.parse("[null]"))).toThrow(
      new DataError("A cover must be an object, found null."),
    );
    expect(() => scoreCoversBlock("O", [], JSON.parse("null"))).toThrow(
      new DataError("The notes must be an array, found null."),
    );
    expect(() => scoreCoversBlock("O", [], JSON.parse('["x"]'))).toThrow(
      new DataError("The notes must be nodes of body content, found an array."),
    );
    expect(() => scoreCoversBlock(JSON.parse("1"), [])).toThrow(
      new DataError("The outcome identifier must be an identifier, found 1."),
    );
  });

  it("refuses a test whose rubric blocks are not the model", () => {
    expect(() => readScoreCovers(JSON.parse("null"))).toThrow(new DataError("The test must be an object, found null."));
    expect(() => readScoreCovers(JSON.parse('{"rubricBlocks":{}}'))).toThrow(
      new DataError("The rubric blocks of the test must be an array, found an object."),
    );
    expect(() => readScoreCovers(JSON.parse('{"rubricBlocks":[1]}'))).toThrow(
      new DataError("A rubric block must be an object, found 1."),
    );
    expect(() => readScoreCovers(JSON.parse('{"rubricBlocks":[{"contentBody":null}]}'))).toThrow(
      new DataError("The content body of a rubric block must be an object, found null."),
    );
    expect(() => readScoreCovers(JSON.parse('{"rubricBlocks":[{"contentBody":{"children":1}}]}'))).toThrow(
      new DataError("The children of the content body must be an array, found 1."),
    );
    expect(() =>
      readScoreCovers(JSON.parse('{"rubricBlocks":[{"contentBody":{"children":[]},"extensions":"x"}]}')),
    ).toThrow(new DataError('The extensions of a rubric block must be an array, found "x".'));
  });
});

/** A test with one part, as the model has it, for tests that put a rubric block into it. */
function testModel(): AssessmentTest {
  return testOf(`${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`);
}

describe("the covers as written", () => {
  const entries = (text: string): string =>
    `<qti-rubric-block view="scorer" use="scoring" class="external-score-covers other" data-outcome-identifier="CONTENT"><qti-content-body><p>Notes</p><ul>${text}</ul><ul><li data-item-ref="W3" data-response-identifier="R">Third</li></ul></qti-content-body></qti-rubric-block>`;
  const testWith = (blocks: string) =>
    `<qti-assessment-test ${NAMESPACE} identifier="T" title="t">${blocks}${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part></qti-assessment-test>`;

  it("reads the blocks that carry the class token with their entries as written, those without an attribute included", () => {
    const read = checked(
      testWith(
        entries(
          '<li data-item-ref="W1" data-response-identifier="R"> One\n  line </li><li data-item-ref="W2">No response</li><li>Nothing</li>',
        ),
      ),
    );
    if (read.kind !== "test") throw new Error("Expected a test.");
    const [block, ...others] = scoreCoverBlocks(read.test);
    expect(others).toEqual([]);
    expect(block?.outcomeIdentifier).toBe("CONTENT");
    expect(block?.entries).toEqual([
      { itemRef: "W1", responseIdentifier: "R", label: "One line" },
      { itemRef: "W2", label: "No response" },
      { label: "Nothing" },
      { itemRef: "W3", responseIdentifier: "R", label: "Third" },
    ]);
  });

  it("leaves out a rubric block without the class token and keeps one without an outcome, with the outcome absent", () => {
    const plain =
      '<qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block>';
    const unnamed =
      '<qti-rubric-block view="scorer" use="scoring" class="external-score-covers"><qti-content-body><ul/></qti-content-body></qti-rubric-block>';
    const read = checked(testWith(`${plain}${unnamed}`));
    if (read.kind !== "test") throw new Error("Expected a test.");
    expect(
      scoreCoverBlocks(read.test).map(({ outcomeIdentifier, entries: found }) => [outcomeIdentifier, found.length]),
    ).toEqual([[undefined, 0]]);
    expect(readScoreCovers(read.test).size).toBe(0);
  });

  it("names the class token that marks the block", () => {
    expect(SCORE_COVERS_CLASS).toBe("external-score-covers");
  });

  it("throws a DataError for a test whose rubric blocks are not the model", () => {
    for (const bad of [
      '{"rubricBlocks":"x"}',
      '{"rubricBlocks":[null]}',
      '{"rubricBlocks":[{"contentBody":{"children":"x"}}]}',
      "null",
    ]) {
      expect(() => scoreCoverBlocks(JSON.parse(bad))).toThrow(DataError);
    }
  });
});

/** An item whose body holds the markup of rubric blocks. */
const itemWithBlocks = (blocks: string, attributes = ""): AssessmentItem =>
  itemOf(item(`<qti-item-body>${blocks}</qti-item-body>`, attributes));

/** A test with the markup of rubric blocks as its own, before the test part. */
const testWithBlocks = (blocks: string): AssessmentTest =>
  testOf(`${blocks}${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`);

/** The markup of a rubric block of the convention with the given attributes and criteria lists. */
function rubricMarkup(body: string, attributes = ' data-outcome-identifier="SCORE"', view = "scorer"): string {
  return `<qti-rubric-block view="${view}" use="scoring" class="external-scoring-rubric"${attributes}><qti-content-body>${body}</qti-content-body></qti-rubric-block>`;
}

/** The markup of a criterion with levels given by their scores. */
const criterionMarkup = (identifier: string, scores: readonly string[], attributes = ""): string =>
  `<li data-criterion-identifier="${identifier}"${attributes}><ol>${scores.map((score) => `<li data-score="${score}">level ${score}</li>`).join("")}</ol></li>`;

/** The rubric of an outcome that a document gives, or `undefined`. */
const rubricOf = (document: AssessmentItem | AssessmentTest, outcome = "SCORE"): ScoringRubric | undefined =>
  readScoringRubrics(document).get(outcome);

describe("reading and building the scoring rubric", () => {
  it("reads the example block of an item and of a test as the same rubric, with its texts normalized", () => {
    expect(rubricOf(itemWithBlocks(ESSAY_MARKUP))).toEqual(ESSAY);
    expect(rubricOf(testWithBlocks(ESSAY_MARKUP))).toEqual(ESSAY);
  });

  it("builds the block that reading the example gives", () => {
    const compact = ESSAY_MARKUP.replace(/>\s+</g, "><").replace(/\s*\n\s*/g, " ");
    const notes = [
      { kind: "p", children: [{ kind: "text", value: "Rate the essay on each criterion." }], extensions: [] },
    ] satisfies RubricContent[];
    const [block] = testWithBlocks(compact).rubricBlocks;
    expect(scoringRubricBlock(ESSAY, notes)).toEqual(block);
  });

  it("builds a block that fits an item body and the rubric blocks of a test, and reads it back after writing", () => {
    const block = scoringRubricBlock(ESSAY);
    const inItem: AssessmentItem = { ...itemOf(item()), body: { kind: "item-body", children: [block] } };
    const inTest: AssessmentTest = { ...testModel(), rubricBlocks: [block] };
    const item2 = readAsi(writeAsi({ kind: "item", item: inItem }));
    const test2 = readAsi(writeAsi({ kind: "test", test: inTest }));
    if (item2.kind !== "item" || test2.kind !== "test") throw new Error("Expected an item and a test.");
    expect(rubricOf(item2.item)).toEqual(ESSAY);
    expect(rubricOf(test2.test)).toEqual(ESSAY);
  });

  it("writes the attributes of the convention, leaving the default weight out", () => {
    const written = writeAsi({ kind: "test", test: { ...testModel(), rubricBlocks: [scoringRubricBlock(ESSAY)] } });
    expect(written).toContain('class="external-scoring-rubric" xml:lang="en"');
    expect(written).toContain('data-outcome-identifier="SCORE" data-rubric-kind="analytic"');
    expect(written).toContain('<li data-criterion-identifier="content" data-weight="2">');
    expect(written).toContain('<li data-criterion-identifier="language">');
    expect(written).toContain('<li data-score="0" data-quality="Absent">No idea relates to the task.</li>');
  });

  it("reads and builds a rubric of every kind", () => {
    for (const kind of RUBRIC_KINDS) {
      const rubric = KIND_EXAMPLES[kind];
      const read = itemWithBlocks("");
      const inItem: AssessmentItem = { ...read, body: { kind: "item-body", children: [scoringRubricBlock(rubric)] } };
      expect(rubricOf(inItem), kind).toEqual(rubric);
    }
  });

  it("takes a missing kind for analytic and a missing weight for 1", () => {
    const markup = rubricMarkup(`<ol>${criterionMarkup("a", ["0", "1"])}</ol>`);
    expect(rubricOf(itemWithBlocks(markup))).toEqual({
      outcomeIdentifier: "SCORE",
      kind: "analytic",
      criteria: [
        {
          identifier: "a",
          weight: 1,
          levels: [
            { score: 0, description: "level 0" },
            { score: 1, description: "level 1" },
          ],
        },
      ],
    });
  });

  it("reads numbers as an xs:double attribute, with -0 as 0", () => {
    const criteria = criterionMarkup("a", ["1e1", "+2", " 3 ", "-0", "0.5"], ' data-weight=" 1.5e0 "');
    const rubric = rubricOf(itemWithBlocks(rubricMarkup(`<ol>${criteria}</ol>`)));
    expect(rubric?.criteria[0]?.weight).toBe(1.5);
    expect(rubric?.criteria[0]?.levels.map(({ score }) => score)).toEqual([10, 2, 3, 0, 0.5]);
    expect(Object.is(rubric?.criteria[0]?.levels[3]?.score, 0)).toBe(true);
  });

  it("adds up the criteria of several lists and keeps what lies between them as notes", () => {
    const markup = rubricMarkup(
      `<p>One</p><ol>${criterionMarkup("a", ["0", "1"])}</ol><p>Two</p><ol>${criterionMarkup("b", ["0", "1"])}</ol>`,
    );
    expect(rubricOf(itemWithBlocks(markup))?.criteria.map(({ identifier }) => identifier)).toEqual(["a", "b"]);
  });

  it("takes the language of the block, then that of the item, and a test has no other", () => {
    const body = `<ol>${criterionMarkup("a", ["0", "1"])}</ol>`;
    const bare = rubricMarkup(body);
    const own = rubricMarkup(body, ' data-outcome-identifier="SCORE" xml:lang="id"');
    expect(rubricOf(itemWithBlocks(bare, ' xml:lang="en"'))?.language).toBe("en");
    expect(rubricOf(itemWithBlocks(own, ' xml:lang="en"'))?.language).toBe("id");
    expect(rubricOf(itemWithBlocks(bare))?.language).toBeUndefined();
    expect(rubricOf(testWithBlocks(own))?.language).toBe("id");
    expect(rubricOf(testWithBlocks(bare))?.language).toBeUndefined();
  });

  it("reads a rubric for each outcome and lets the first marked block of an outcome decide", () => {
    const body = (identifier: string) => `<ol>${criterionMarkup(identifier, ["0", "1"])}</ol>`;
    const named = (outcome: string, identifier: string) =>
      rubricMarkup(body(identifier), ` data-outcome-identifier="${outcome}"`);
    const rubrics = readScoringRubrics(
      itemWithBlocks(`${named("A", "first")}${named("B", "other")}${named("A", "second")}`),
    );
    expect([...rubrics.keys()]).toEqual(["A", "B"]);
    expect(rubrics.get("A")?.criteria[0]?.identifier).toBe("first");
    const broken = rubricMarkup("<ol/>", ' data-outcome-identifier="A"');
    expect(readScoringRubrics(itemWithBlocks(`${broken}${named("A", "second")}`)).has("A")).toBe(false);
  });

  it("recognizes a block among the content of an item body and only among the rubric blocks of a test", () => {
    const markup = rubricMarkup(`<ol>${criterionMarkup("a", ["0", "1"])}</ol>`);
    expect(rubricOf(itemWithBlocks(`<p>Before</p>${markup}<p>After</p>`))?.criteria).toHaveLength(1);
    const inPart = testOf(`${PART}${markup}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`);
    expect(readScoringRubrics(inPart).size).toBe(0);
    const inSection = testOf(
      `${PART}<qti-assessment-section identifier="S" title="s" visible="true">${markup}</qti-assessment-section></qti-test-part>`,
    );
    expect(readScoringRubrics(inSection).size).toBe(0);
  });

  it("leaves out a block without the class token and one without an outcome", () => {
    const plain =
      '<qti-rubric-block view="scorer" use="scoring"><qti-content-body><ol><li>x</li></ol></qti-content-body></qti-rubric-block>';
    const unnamed = rubricMarkup(`<ol>${criterionMarkup("a", ["0", "1"])}</ol>`, "");
    expect(readScoringRubrics(itemWithBlocks(`${plain}${unnamed}`)).size).toBe(0);
  });

  it("refuses to take a block of the covers convention for a rubric", () => {
    const both = rubricMarkup(`<ol>${criterionMarkup("a", ["0", "1"])}</ol>`).replace(
      'class="external-scoring-rubric"',
      'class="external-scoring-rubric external-score-covers"',
    );
    expect(readScoringRubrics(itemWithBlocks(both)).size).toBe(0);
  });

  it("reads the text of an entry across inline elements and drops the levels from the text of a criterion", () => {
    const criterion = `<li data-criterion-identifier="a">Use <em>clear</em> words <ol><li data-score="0">Poor <b>use</b></li><li data-score="1">Good</li></ol></li>`;
    const rubric = rubricOf(itemWithBlocks(rubricMarkup(`<ol>${criterion}</ol>`)));
    expect(rubric?.criteria[0]?.description).toBe("Use clear words");
    expect(rubric?.criteria[0]?.levels[0]?.description).toBe("Poor use");
  });
});

describe("the rules of a scoring rubric as written", () => {
  /** Reads the one block that a markup holds and returns the codes and paths of what it breaks. */
  function issuesOf(markup: string): string[] {
    const [marked, ...others] = scoringRubricBlocks(itemWithBlocks(markup));
    if (marked === undefined || others.length > 0) throw new Error("Expected one marked block.");
    const { rubric, issues } = scoringRubricOf(marked.block, marked.language);
    expect(rubric === undefined, "the rubric is absent exactly when a rule is broken").toBe(issues.length > 0);
    return issues.map(({ code, path }) => `${code} ${path}`.trim());
  }
  const levels = (count: number) => Array.from({ length: count }, (_, score) => String(score));
  const analytic = (criteria: string, attributes = ' data-outcome-identifier="SCORE"') =>
    rubricMarkup(`<ol>${criteria}</ol>`, attributes);

  it("accepts the shapes of the four kinds", () => {
    for (const kind of RUBRIC_KINDS) {
      const block = scoringRubricBlock(KIND_EXAMPLES[kind]);
      const inItem: AssessmentItem = { ...itemOf(item()), body: { kind: "item-body", children: [block] } };
      const [marked] = scoringRubricBlocks(inItem);
      expect(marked && scoringRubricOf(marked.block).issues, kind).toEqual([]);
    }
  });

  it("reports a block that is not shown to scorers, or is shown to candidates", () => {
    const body = `<ol>${criterionMarkup("a", levels(2))}</ol>`;
    for (const view of ["proctor", "candidate scorer", "scorer candidate"]) {
      expect(issuesOf(rubricMarkup(body, ' data-outcome-identifier="SCORE"', view)), view).toEqual(["malformed"]);
    }
    expect(issuesOf(rubricMarkup(body, ' data-outcome-identifier="SCORE"', "proctor scorer"))).toEqual([]);
  });

  it("reports a missing outcome, an unknown kind and a block with both class tokens", () => {
    const body = `<ol>${criterionMarkup("a", levels(2))}</ol>`;
    expect(issuesOf(rubricMarkup(body, ""))).toEqual(["malformed"]);
    expect(issuesOf(rubricMarkup(body, ' data-outcome-identifier="SCORE" data-rubric-kind="rank"'))).toEqual([
      "malformed",
    ]);
    const both = rubricMarkup(body).replace(
      'class="external-scoring-rubric"',
      'class="external-score-covers external-scoring-rubric"',
    );
    expect(issuesOf(both)).toEqual(["malformed"]);
  });

  it("reports a block without criteria, whether it has no list or an empty one", () => {
    expect(issuesOf(rubricMarkup("<p>Notes</p>"))).toEqual(["malformed criteria"]);
    expect(issuesOf(rubricMarkup("<ol/>"))).toEqual(["malformed criteria"]);
  });

  it("reports a criterion without an identifier, with an identifier that is not one, or without levels", () => {
    expect(issuesOf(analytic(`<li><ol><li data-score="0"/><li data-score="1"/></ol></li>`))).toEqual([
      "malformed criteria[0].identifier",
    ]);
    expect(issuesOf(analytic(criterionMarkup("1x", levels(2))))).toEqual(["malformed criteria[0].identifier"]);
    expect(issuesOf(analytic(`<li data-criterion-identifier="a"><p>Text</p></li>`))).toEqual([
      "malformed criteria[0].levels",
    ]);
    const nested = `<li data-criterion-identifier="a"><div><ol><li data-score="0"/><li data-score="1"/></ol></div></li>`;
    expect(issuesOf(analytic(nested))).toEqual(["malformed criteria[0].levels"]);
  });

  it("reports a weight that is not a finite number greater than 0", () => {
    for (const weight of ["0", "-1", "abc", "INF", "NaN", "", "1 2"]) {
      expect(issuesOf(analytic(criterionMarkup("a", levels(2), ` data-weight="${weight}"`))), weight).toEqual([
        "malformed criteria[0].weight",
      ]);
    }
  });

  it("reports a level without a score and a score that is not a finite number of 0 or more", () => {
    expect(
      issuesOf(analytic(`<li data-criterion-identifier="a"><ol><li>x</li><li data-score="1"/></ol></li>`)),
    ).toEqual(["malformed criteria[0].levels[0].score"]);
    for (const score of ["-1", "INF", "NaN", "x", ""]) {
      expect(issuesOf(analytic(criterionMarkup("a", [score, "1"]))), score).toEqual([
        "malformed criteria[0].levels[0].score",
      ]);
    }
  });

  it("reports the shape that the kind requires", () => {
    const kind = (name: string) => ` data-outcome-identifier="SCORE" data-rubric-kind="${name}"`;
    expect(issuesOf(analytic(criterionMarkup("a", levels(1))))).toEqual(["shape criteria[0].levels"]);
    expect(
      issuesOf(analytic(criterionMarkup("a", levels(2)) + criterionMarkup("b", levels(2)), kind("holistic"))),
    ).toEqual(["shape criteria"]);
    expect(issuesOf(analytic(criterionMarkup("a", levels(2), ' data-weight="2"'), kind("holistic")))).toEqual([
      "shape criteria[0].weight",
    ]);
    expect(issuesOf(analytic(criterionMarkup("a", levels(3)), kind("checklist")))).toEqual([
      "shape criteria[0].levels",
    ]);
    expect(issuesOf(analytic(criterionMarkup("a", ["1", "2"]), kind("checklist")))).toEqual([
      "shape criteria[0].levels",
    ]);
    expect(issuesOf(analytic(criterionMarkup("a", ["1", "0"]), kind("checklist")))).toEqual([]);
    expect(issuesOf(analytic(criterionMarkup("a", levels(2)), kind("single-point")))).toEqual([
      "shape criteria[0].levels",
    ]);
    expect(issuesOf(analytic(criterionMarkup("a", ["2", "1", "0"]), kind("single-point")))).toEqual([
      "shape criteria[0].levels",
    ]);
    expect(issuesOf(analytic(criterionMarkup("a", ["2", "1", "0"])))).toEqual([]);
  });

  it("reports an identifier or a score that occurs twice", () => {
    expect(issuesOf(analytic(criterionMarkup("a", levels(2)) + criterionMarkup("a", levels(2))))).toEqual([
      "duplicate criteria[1].identifier",
    ]);
    expect(issuesOf(analytic(criterionMarkup("a", ["1", "1", "2"])))).toEqual([
      "duplicate criteria[0].levels[1].score",
    ]);
  });

  it("reports a malformed value without the shape rules that need a complete rubric", () => {
    expect(issuesOf(analytic(criterionMarkup("a", ["x"])))).toEqual(["malformed criteria[0].levels[0].score"]);
  });
});

describe("checking a scoring rubric", () => {
  const broken = (change: (rubric: ScoringRubric) => unknown): unknown =>
    change(JSON.parse(JSON.stringify(KIND_EXAMPLES["single-point"])));

  it("accepts a rubric of every kind and the rubric that the reader gives", () => {
    for (const kind of RUBRIC_KINDS) expect(() => checkScoringRubric(KIND_EXAMPLES[kind]), kind).not.toThrow();
    expect(() => checkScoringRubric(ESSAY)).not.toThrow();
  });

  it("names the path and the rule of the first one broken", () => {
    const withLevels = (count: number) =>
      broken((rubric) => ({
        ...rubric,
        criteria: [rubric.criteria[0], { ...rubric.criteria[1], levels: [{ score: 0 }, { score: 1 }].slice(0, count) }],
      }));
    expect(() => checkScoringRubric(withLevels(2))).toThrow(
      new DataError(
        "The scoring rubric is invalid at criteria[1].levels: a single-point criterion has three levels, found 2.",
      ),
    );
    expect(() => checkScoringRubric({ ...ESSAY, outcomeIdentifier: "1x" })).toThrow(
      new DataError(
        'The scoring rubric is invalid at outcomeIdentifier: the outcome identifier must be an identifier, found "1x".',
      ),
    );
    expect(() => checkScoringRubric({ ...ESSAY, criteria: [] })).toThrow(
      new DataError(
        "The scoring rubric is invalid at criteria: a scoring rubric has one or more criteria, found none.",
      ),
    );
    const twice = { ...ESSAY, criteria: [ESSAY.criteria[0], ESSAY.criteria[0]] };
    expect(() => checkScoringRubric(twice)).toThrow(
      new DataError(
        "The scoring rubric is invalid at criteria[1].identifier: the criterion identifier content occurs twice, so a rating cannot name one.",
      ),
    );
    const heavy = { ...KIND_EXAMPLES.holistic, criteria: [{ ...KIND_EXAMPLES.holistic.criteria[0], weight: 2 }] };
    expect(() => checkScoringRubric(heavy)).toThrow(DataError);
  });

  it("refuses values that are not the model, as JSON passes them", () => {
    for (const bad of [
      "null",
      "[]",
      '{"outcomeIdentifier":1}',
      '{"outcomeIdentifier":"S","kind":"rank","criteria":[]}',
      '{"outcomeIdentifier":"S","kind":"analytic","criteria":{}}',
      '{"outcomeIdentifier":"S","kind":"analytic","criteria":[],"extra":1}',
      '{"outcomeIdentifier":"S","kind":"analytic","language":"","criteria":[]}',
      '{"outcomeIdentifier":"S","kind":"analytic","criteria":[{"identifier":"a","weight":"1","levels":[]}]}',
      '{"outcomeIdentifier":"S","kind":"analytic","criteria":[{"identifier":"a","weight":0,"levels":[]}]}',
      '{"outcomeIdentifier":"S","kind":"analytic","criteria":[{"identifier":"a","weight":1,"levels":[{"score":"1"}]}]}',
      '{"outcomeIdentifier":"S","kind":"analytic","criteria":[{"identifier":"a","weight":1,"levels":[{"score":-1}]}]}',
    ]) {
      expect(() => checkScoringRubric(JSON.parse(bad)), bad).toThrow(DataError);
    }
    expect(() => checkScoringRubric(JSON.parse("null"))).toThrow(
      new DataError("The scoring rubric is invalid: expected an object, found null."),
    );
  });
});

describe("the score that ratings give", () => {
  const rate = (rubric: ScoringRubric, ...scores: readonly number[]): RubricRating[] =>
    rubric.criteria.flatMap(({ identifier }, index) => {
      const score = scores[index];
      return score === undefined ? [] : [{ criterion: identifier, score }];
    });

  it("is the sum of weight times the chosen score, for each kind", () => {
    expect(scoreFromRatings(ESSAY, rate(ESSAY, 2, 1))).toBe(5);
    expect(scoreFromRatings(ESSAY, rate(ESSAY, 1, 0))).toBe(2);
    expect(scoreFromRatings(KIND_EXAMPLES.holistic, rate(KIND_EXAMPLES.holistic, 3))).toBe(3);
    expect(scoreFromRatings(KIND_EXAMPLES.checklist, rate(KIND_EXAMPLES.checklist, 1, 0, 1))).toBe(3);
    expect(scoreFromRatings(KIND_EXAMPLES.checklist, rate(KIND_EXAMPLES.checklist, 0, 0, 0))).toBe(0);
    expect(scoreFromRatings(KIND_EXAMPLES["single-point"], rate(KIND_EXAMPLES["single-point"], 2, 1))).toBe(5);
  });

  it("is null while a criterion has no rating, for an empty list too", () => {
    expect(scoreFromRatings(ESSAY, [])).toBeNull();
    expect(scoreFromRatings(ESSAY, rate(ESSAY, 2))).toBeNull();
    expect(scoreFromRatings(ESSAY, [{ criterion: "language", score: 1 }])).toBeNull();
  });

  it("ranges from the sum of the lowest levels to the sum of the highest", () => {
    expect(scoreRange(ESSAY)).toEqual({ minimum: 0, maximum: 5 });
    expect(scoreRange(KIND_EXAMPLES.checklist)).toEqual({ minimum: 0, maximum: 4 });
    expect(scoreRange(KIND_EXAMPLES["single-point"])).toEqual({ minimum: 3, maximum: 11 });
    const lowest = rate(KIND_EXAMPLES["single-point"], 0, 1);
    expect(scoreFromRatings(KIND_EXAMPLES["single-point"], lowest)).toBe(3);
  });

  it("does not depend on the order of the ratings", () => {
    const ratings = rate(ESSAY, 2, 1);
    expect(scoreFromRatings(ESSAY, [...ratings].reverse())).toBe(scoreFromRatings(ESSAY, ratings));
  });

  it("sums in the order of the criteria in binary floating point", () => {
    const rubric: ScoringRubric = {
      outcomeIdentifier: "S",
      kind: "analytic",
      criteria: [0.1, 0.1, 0.1].map((weight, index) => ({
        identifier: `c${index}`,
        weight,
        levels: [{ score: 0 }, { score: 1 }],
      })),
    };
    expect(scoreFromRatings(rubric, rate(rubric, 1, 1, 1))).toBe(0.1 + 0.1 + 0.1);
  });

  it("refuses a rating of an unknown criterion, a criterion rated twice and a score that no level has", () => {
    expect(() => scoreFromRatings(ESSAY, [{ criterion: "style", score: 1 }])).toThrow(
      new DataError('A rating names the criterion "style", which the scoring rubric does not have.'),
    );
    expect(() =>
      scoreFromRatings(ESSAY, [
        { criterion: "content", score: 1 },
        { criterion: "content", score: 2 },
      ]),
    ).toThrow(new DataError('The criterion "content" has more than one rating.'));
    expect(() => scoreFromRatings(ESSAY, [{ criterion: "content", score: 3 }])).toThrow(
      new DataError('The rating of the criterion "content" gives the score 3, which no level of the criterion has.'),
    );
  });

  it("refuses a rubric that fails the check and ratings that are not the model, as JSON passes them", () => {
    expect(() => scoreFromRatings(JSON.parse("null"), [])).toThrow(DataError);
    expect(() => scoreFromRatings({ ...ESSAY, criteria: [] }, [])).toThrow(DataError);
    for (const bad of [
      "null",
      "{}",
      "[null]",
      '[{"criterion":1,"score":1}]',
      '[{"criterion":"content","score":"2"}]',
      '[{"criterion":"content"}]',
      '[{"criterion":"content","score":2,"note":"x"}]',
    ]) {
      expect(() => scoreFromRatings(ESSAY, JSON.parse(bad)), bad).toThrow(DataError);
    }
    expect(() => scoreFromRatings(ESSAY, [{ criterion: "content", score: Number.NaN }])).toThrow(DataError);
    expect(() => scoreFromRatings(ESSAY, [{ criterion: "content", score: Number.POSITIVE_INFINITY }])).toThrow(
      DataError,
    );
  });
});

describe("the arguments of the rubric functions", () => {
  it("refuses a document that is not an item or a test of the model", () => {
    expect(() => readScoringRubrics(JSON.parse("null"))).toThrow(
      new DataError("The document must be an object, found null."),
    );
    expect(() => readScoringRubrics(JSON.parse('{"kind":"section"}'))).toThrow(
      new DataError('The document must be an item or a test of the model, found "section".'),
    );
    expect(() => readScoringRubrics(JSON.parse('{"kind":"assessment-test","rubricBlocks":"x"}'))).toThrow(DataError);
    expect(() => readScoringRubrics(JSON.parse('{"kind":"assessment-item","body":{"children":1}}'))).toThrow(DataError);
  });

  it("refuses a marked block that is not the model", () => {
    const block = (properties: string) =>
      `{"kind":"assessment-test","rubricBlocks":[{"kind":"rubric-block","class":["external-scoring-rubric"],${properties}}]}`;
    for (const bad of [
      block('"view":["scorer"],"contentBody":null,"extensions":[]'),
      block('"view":["scorer"],"contentBody":{"children":1},"extensions":[]'),
      block('"view":["scorer"],"contentBody":{"children":[]},"extensions":"x"'),
      block('"view":"scorer","contentBody":{"children":[]},"extensions":[]'),
    ]) {
      expect(() => readScoringRubrics(JSON.parse(bad)), bad).toThrow(DataError);
    }
  });

  it("refuses notes that are not nodes, or hold a list, and a rubric that fails the check", () => {
    expect(() => scoringRubricBlock(ESSAY, JSON.parse("null"))).toThrow(
      new DataError("The notes must be an array, found null."),
    );
    expect(() => scoringRubricBlock(ESSAY, JSON.parse('["x"]'))).toThrow(
      new DataError("The notes must be nodes of body content, found an array."),
    );
    expect(() => scoringRubricBlock(ESSAY, [{ kind: "ol", items: [], extensions: [] }])).toThrow(
      new DataError("The notes must not contain an ol, which a reader would take for the criteria."),
    );
    expect(() => scoringRubricBlock(JSON.parse("{}"))).toThrow(DataError);
    expect(() => scoringRubricBlock({ ...ESSAY, kind: "holistic" })).toThrow(DataError);
  });

  it("names the class token that marks the block", () => {
    expect(SCORING_RUBRIC_CLASS).toBe("external-scoring-rubric");
  });
});

describe("reading documents", () => {
  it("qti-assessment-item: reads every attribute and leaves the omitted ones omitted", () => {
    const read = itemOf(item("", ' label="L" xml:lang="en-GB" tool-name="Tool" tool-version="1.2" adaptive="true"'));
    expect(read).toEqual({
      kind: "assessment-item",
      identifier: "i",
      title: "t",
      label: "L",
      language: "en-GB",
      toolName: "Tool",
      toolVersion: "1.2",
      adaptive: true,
      timeDependent: false,
      extensions: [],
      contextDeclarations: [],
      responseDeclarations: [],
      outcomeDeclarations: [],
      templateDeclarations: [],
      stimulusRefs: [],
      stylesheets: [],
      modalFeedback: [],
    });
    expect(itemOf(item()).adaptive).toBeUndefined();
  });

  it("qti-assessment-stimulus: reads the body and the attributes", () => {
    const stimulus = stimulusOf(
      `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="Passage" label="P" xml:lang="id" tool-name="T" tool-version="2"><qti-stylesheet href="s.css" type="text/css"/><qti-stimulus-body><p>Text</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    expect(stimulus).toMatchObject({
      kind: "assessment-stimulus",
      identifier: "st",
      title: "Passage",
      label: "P",
      language: "id",
      toolName: "T",
      toolVersion: "2",
      stylesheets: [{ kind: "stylesheet", href: "s.css", type: "text/css" }],
    });
    expect(stimulus.body.children).toHaveLength(1);
  });

  it("qti-assessment-stimulus-ref: reads the identifier, the href and the title", () => {
    const { stimulusRefs } = itemOf(
      item('<qti-assessment-stimulus-ref identifier="st" href="passages/a.xml" title="A"/>'),
    );
    expect(stimulusRefs).toEqual([
      { kind: "assessment-stimulus-ref", identifier: "st", href: "passages/a.xml", title: "A", extensions: [] },
    ]);
  });

  it("qti-item-body: reads text and elements as typed nodes, and leaves comments out", () => {
    const { body } = itemOf(
      item('<qti-item-body id="b" class="x y" dir="rtl"><p>One <b>two</b></p><!--note--></qti-item-body>'),
    );
    expect(body).toEqual({
      kind: "item-body",
      id: "b",
      class: ["x", "y"],
      dir: "rtl",
      children: [
        {
          kind: "p",
          children: [
            { kind: "text", value: "One " },
            { kind: "b", children: [{ kind: "text", value: "two" }], extensions: [] },
          ],
          extensions: [],
        },
      ],
    });
  });

  it("qti-stimulus-body: reads the content as typed nodes", () => {
    const { body } = stimulusOf(
      `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t"><qti-stimulus-body xml:lang="en"><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    expect(body).toMatchObject({ kind: "stimulus-body", language: "en", children: [{ kind: "p" }] });
  });

  it("qti-stylesheet: reads the href, the type, the media and the title", () => {
    const { stylesheets } = itemOf(item('<qti-stylesheet href="a.css" type="text/css" media="print" title="Print"/>'));
    expect(stylesheets).toEqual([
      { kind: "stylesheet", href: "a.css", type: "text/css", media: "print", title: "Print" },
    ]);
  });
});

describe("reading the structure of a test", () => {
  it("qti-assessment-item-ref: reads the attributes and the children in schema order", () => {
    const section = sectionOf(
      '<qti-assessment-item-ref identifier="Q1" href="q1.xml" required="true" fixed="false" category="math easy" class="c"><qti-pre-condition>' +
        `${ONE_XML}</qti-pre-condition><qti-variable-mapping source-identifier="A" target-identifier="B"/><qti-weight identifier="W" value="2"/><qti-template-default template-identifier="T">${ONE_XML}</qti-template-default></qti-assessment-item-ref>`,
    );
    expect(section.children).toEqual([
      {
        kind: "assessment-item-ref",
        identifier: "Q1",
        href: "q1.xml",
        required: true,
        fixed: false,
        category: ["math", "easy"],
        class: ["c"],
        extensions: [],
        preConditions: [{ kind: "pre-condition", operand: ONE }],
        branchRules: [],
        variableMappings: [{ kind: "variable-mapping", sourceIdentifier: "A", targetIdentifier: "B" }],
        weights: [{ kind: "weight", identifier: "W", value: 2 }],
        templateDefaults: [{ kind: "template-default", templateIdentifier: "T", expression: ONE }],
      },
    ]);
  });

  it("qti-assessment-section: reads sections, references and includes in document order", () => {
    const section = sectionOf(
      '<qti-assessment-item-ref identifier="a" href="a.xml"/><qti-assessment-section identifier="in" title="Inner" visible="false" keep-together="false"/><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="more.xml"/><qti-assessment-section-ref identifier="r" href="r.xml"/>',
      ' required="true" fixed="true" class="part"',
    );
    expect(section).toMatchObject({
      kind: "assessment-section",
      identifier: "S",
      title: "s",
      visible: true,
      required: true,
      fixed: true,
      class: ["part"],
    });
    expect(section.children.map((child) => child.kind)).toEqual([
      "assessment-item-ref",
      "assessment-section",
      "element",
      "assessment-section-ref",
    ]);
    expect(section.children[1]).toMatchObject({ visible: false, keepTogether: false });
    expect(section.children[2]).toMatchObject({ namespace: XINCLUDE_NAMESPACE, name: "include", prefix: "xi" });
  });

  it("qti-assessment-section-ref: reads the identifier, the class and the href", () => {
    const part = partOf('<qti-assessment-section-ref identifier="r" href="sections/r.xml" class="a b"/>');
    expect(part.sections).toEqual([
      { kind: "assessment-section-ref", identifier: "r", href: "sections/r.xml", class: ["a", "b"], extensions: [] },
    ]);
  });

  it("qti-assessment-test: reads the parts, the declarations and the outcome processing", () => {
    const test = testOf(
      '<qti-context-declaration identifier="C" cardinality="single"/><qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/><qti-time-limits max-time="600"/>' +
        `${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part><qti-outcome-processing/><qti-test-feedback access="atEnd" outcome-identifier="SCORE" show-hide="show" identifier="F"/>`,
      ' class="exam" tool-name="T" tool-version="3"',
    );
    expect(test).toMatchObject({
      kind: "assessment-test",
      identifier: "T",
      title: "t",
      class: ["exam"],
      toolName: "T",
      toolVersion: "3",
      timeLimits: { kind: "time-limits", maxTime: 600 },
      outcomeProcessing: { kind: "outcome-processing", rules: [] },
    });
    expect(test.contextDeclarations).toHaveLength(1);
    expect(test.outcomeDeclarations).toHaveLength(1);
    expect(test.testParts).toHaveLength(1);
    expect(test.testFeedback).toHaveLength(1);
  });

  it("qti-branch-rule: reads the target and the condition", () => {
    const part = partOf(
      `<qti-branch-rule target="EXIT_TEST">${RESPONSE_XML}</qti-branch-rule><qti-assessment-section-ref identifier="s" href="s.xml"/>`,
    );
    expect(part.branchRules).toEqual([{ kind: "branch-rule", target: "EXIT_TEST", expression: RESPONSE }]);
  });

  it("qti-item-session-control: reads the numbers and booleans and leaves the defaults out", () => {
    const part = partOf(
      '<qti-item-session-control max-attempts="3" show-feedback="true" allow-review="false" show-solution="true" allow-comment="true" allow-skipping="false" validate-responses="true"/><qti-assessment-section-ref identifier="s" href="s.xml"/>',
    );
    expect(part.itemSessionControl).toEqual({
      kind: "item-session-control",
      maxAttempts: 3,
      showFeedback: true,
      allowReview: false,
      showSolution: true,
      allowComment: true,
      allowSkipping: false,
      validateResponses: true,
    });
    const bare = partOf('<qti-item-session-control/><qti-assessment-section-ref identifier="s" href="s.xml"/>');
    expect(bare.itemSessionControl).toEqual({ kind: "item-session-control" });
  });

  it("qti-ordering: reads shuffle and keeps attributes and elements of other namespaces", () => {
    const section = sectionOf('<qti-ordering shuffle="true" xmlns:x="urn:x" x:seed="7"><x:hint/></qti-ordering>');
    expect(section.ordering).toEqual({
      kind: "ordering",
      shuffle: true,
      extensions: [{ namespace: "urn:x", prefix: "x", name: "seed", value: "7" }],
      extensionElements: [foreignElement("hint")],
    });
  });

  it("qti-pre-condition: reads the expression as its operand", () => {
    const section = sectionOf(`<qti-pre-condition>${RESPONSE_XML}</qti-pre-condition>`);
    expect(section.preConditions).toEqual([{ kind: "pre-condition", operand: RESPONSE }]);
  });

  it("qti-selection: reads select and with-replacement", () => {
    const section = sectionOf('<qti-selection select="2" with-replacement="true"/>');
    expect(section.selection).toEqual({
      kind: "selection",
      select: 2,
      withReplacement: true,
      extensions: [],
      extensionElements: [],
    });
  });

  it("qti-template-default: reads the template identifier and the expression", () => {
    const section = sectionOf(
      `<qti-assessment-item-ref identifier="a" href="a.xml"><qti-template-default template-identifier="N">${ONE_XML}</qti-template-default></qti-assessment-item-ref>`,
    );
    expect(section.children[0]).toMatchObject({ templateDefaults: [{ templateIdentifier: "N", expression: ONE }] });
  });

  it("qti-test-part: reads the modes, the rubric blocks and the sections", () => {
    const part = partOf(
      `<qti-pre-condition>${ONE_XML}</qti-pre-condition><qti-time-limits min-time="5"/><qti-assessment-section identifier="s" title="s" visible="true"/>`,
    );
    expect(part).toMatchObject({
      kind: "test-part",
      identifier: "P",
      navigationMode: "linear",
      submissionMode: "individual",
      timeLimits: { minTime: 5 },
      sections: [{ kind: "assessment-section", identifier: "s" }],
    });
    expect(
      testOf(
        `<qti-test-part identifier="Q" title="Part" class="c" navigation-mode="nonlinear" submission-mode="simultaneous"><qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`,
      ).testParts[0],
    ).toMatchObject({
      title: "Part",
      class: ["c"],
      navigationMode: "nonlinear",
      submissionMode: "simultaneous",
    });
  });

  it("qti-time-limits: reads the limits as numbers and the late submission flag", () => {
    const part = partOf(
      '<qti-time-limits min-time="1.5" max-time="3600" allow-late-submission="true"/><qti-assessment-section-ref identifier="s" href="s.xml"/>',
    );
    expect(part.timeLimits).toEqual({ kind: "time-limits", minTime: 1.5, maxTime: 3600, allowLateSubmission: true });
  });

  it("qti-variable-mapping: reads the source and the target", () => {
    const section = sectionOf(
      '<qti-assessment-item-ref identifier="a" href="a.xml"><qti-variable-mapping source-identifier="SCORE" target-identifier="Q1_SCORE"/></qti-assessment-item-ref>',
    );
    expect(section.children[0]).toMatchObject({
      variableMappings: [{ kind: "variable-mapping", sourceIdentifier: "SCORE", targetIdentifier: "Q1_SCORE" }],
    });
  });

  it("qti-weight: reads the identifier and the value as a number", () => {
    const section = sectionOf(
      '<qti-assessment-item-ref identifier="a" href="a.xml"><qti-weight identifier="W1" value="0.5"/></qti-assessment-item-ref>',
    );
    expect(section.children[0]).toMatchObject({ weights: [{ kind: "weight", identifier: "W1", value: 0.5 }] });
  });

  it("qti-adaptive-engine-ref: reads the identifier and the href", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="engine.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection?.adaptiveEngineRef).toEqual({
      kind: "adaptive-engine-ref",
      identifier: "E",
      href: "engine.json",
    });
  });

  it("qti-adaptive-selection: excludes selection and ordering in the same section", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection).toMatchObject({ kind: "adaptive-selection" });
    const issue = readIssue(() =>
      readAsi(
        `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/></qti-adaptive-selection><qti-selection select="1"/></qti-assessment-section>`,
      ),
    );
    expect(issue).toMatchObject({ code: "assesskit/asi/exclusive" });
  });

  it("qti-adaptive-settings-ref: reads the identifier and the href", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/><qti-adaptive-settings-ref identifier="S" href="settings.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection?.adaptiveSettingsRef).toEqual({
      kind: "adaptive-settings-ref",
      identifier: "S",
      href: "settings.json",
    });
  });

  it("qti-metadata-ref: reads the identifier and the href", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/><qti-metadata-ref identifier="M" href="metadata.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection?.metadataRef).toEqual({
      kind: "metadata-ref",
      identifier: "M",
      href: "metadata.json",
    });
  });

  it("qti-usagedata-ref: reads the identifier and the href", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/><qti-usagedata-ref identifier="U" href="usage.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection?.usagedataRef).toEqual({
      kind: "usagedata-ref",
      identifier: "U",
      href: "usage.json",
    });
  });
});

describe("reading declarations", () => {
  const response = (content: string, attributes = 'cardinality="single" base-type="string"') =>
    itemOf(item(`<qti-response-declaration identifier="R" ${attributes}>${content}</qti-response-declaration>`))
      .responseDeclarations[0];

  it("qti-area-map-entry: reads the shape, the coordinates and the mapped value", () => {
    const declaration = response(
      '<qti-area-mapping><qti-area-map-entry shape="circle" coords="10,20,5" mapped-value="2"/></qti-area-mapping>',
      'cardinality="multiple" base-type="point"',
    );
    expect(declaration?.areaMapping?.areaMapEntries).toEqual([
      { kind: "area-map-entry", shape: "circle", coords: "10,20,5", mappedValue: 2 },
    ]);
  });

  it("qti-area-mapping: reads the bounds and the default as numbers", () => {
    const declaration = response(
      '<qti-area-mapping lower-bound="0" upper-bound="5" default-value="-1"><qti-area-map-entry shape="rect" coords="0,0,9,9" mapped-value="1"/></qti-area-mapping>',
      'cardinality="multiple" base-type="point"',
    );
    expect(declaration?.areaMapping).toMatchObject({
      kind: "area-mapping",
      lowerBound: 0,
      upperBound: 5,
      defaultValue: -1,
    });
  });

  it("qti-context-declaration: reads the identifier, the cardinality and the default value", () => {
    const { contextDeclarations } = itemOf(
      item(
        '<qti-context-declaration identifier="C" cardinality="record"><qti-default-value><qti-value field-identifier="f" base-type="string">x</qti-value></qti-default-value></qti-context-declaration>',
      ),
    );
    expect(contextDeclarations).toEqual([
      {
        kind: "context-declaration",
        identifier: "C",
        cardinality: "record",
        defaultValue: {
          kind: "default-value",
          values: [{ kind: "value", fieldIdentifier: "f", baseType: "string", value: "x" }],
        },
      },
    ]);
  });

  it("qti-correct-response: reads the interpretation and the values in order", () => {
    const declaration = response(
      '<qti-correct-response interpretation="Both"><qti-value>A</qti-value><qti-value>B</qti-value></qti-correct-response>',
      'cardinality="ordered" base-type="identifier"',
    );
    expect(declaration?.correctResponse).toEqual({
      kind: "correct-response",
      interpretation: "Both",
      values: [
        { kind: "value", value: "A" },
        { kind: "value", value: "B" },
      ],
    });
  });

  it("qti-default-value: reads the interpretation and the values", () => {
    const declaration = response(
      '<qti-default-value interpretation="Start"><qti-value>0</qti-value></qti-default-value>',
    );
    expect(declaration?.defaultValue).toEqual({
      kind: "default-value",
      interpretation: "Start",
      values: [{ kind: "value", value: "0" }],
    });
  });

  const outcome = (content: string) =>
    declarationOf(
      `<qti-outcome-declaration ${NAMESPACE} identifier="O" cardinality="single" base-type="integer">${content}</qti-outcome-declaration>`,
    );

  it("qti-interpolation-table: reads the default and the entries in order", () => {
    const table = outcome(
      '<qti-interpolation-table default-value="F"><qti-interpolation-table-entry source-value="50" target-value="D"/><qti-interpolation-table-entry source-value="80" target-value="A"/></qti-interpolation-table>',
    ).lookupTable;
    expect(table).toMatchObject({ kind: "interpolation-table", defaultValue: "F" });
    expect(
      table?.kind === "interpolation-table" && table.interpolationTableEntries.map((entry) => entry.sourceValue),
    ).toEqual([50, 80]);
  });

  it("qti-interpolation-table-entry: reads include-boundary as a boolean and leaves its default out", () => {
    const table = outcome(
      '<qti-interpolation-table><qti-interpolation-table-entry source-value="1.5" include-boundary="false" target-value="B"/><qti-interpolation-table-entry source-value="2" target-value="A"/></qti-interpolation-table>',
    ).lookupTable;
    if (table?.kind !== "interpolation-table") throw new Error("Expected an interpolation table.");
    expect(table.interpolationTableEntries).toEqual([
      { kind: "interpolation-table-entry", sourceValue: 1.5, includeBoundary: false, targetValue: "B" },
      { kind: "interpolation-table-entry", sourceValue: 2, targetValue: "A" },
    ]);
  });

  it("qti-map-entry: reads the key, the value and case-sensitive", () => {
    const declaration = response(
      '<qti-mapping default-value="0"><qti-map-entry map-key="Paris" mapped-value="1" case-sensitive="true"/></qti-mapping>',
    );
    expect(declaration?.mapping?.mapEntries).toEqual([
      { kind: "map-entry", mapKey: "Paris", mappedValue: 1, caseSensitive: true },
    ]);
  });

  it("qti-mapping: reads the bounds and the default", () => {
    const declaration = response(
      '<qti-mapping lower-bound="0" upper-bound="3" default-value="0.5"><qti-map-entry map-key="a" mapped-value="1"/></qti-mapping>',
    );
    expect(declaration?.mapping).toMatchObject({ kind: "mapping", lowerBound: 0, upperBound: 3, defaultValue: 0.5 });
  });

  it("qti-match-table: reads the default and the entries", () => {
    const table = outcome(
      '<qti-match-table default-value="none"><qti-match-table-entry source-value="1" target-value="string"/></qti-match-table>',
    ).lookupTable;
    expect(table).toEqual({
      kind: "match-table",
      defaultValue: "none",
      matchTableEntries: [{ kind: "match-table-entry", sourceValue: 1, targetValue: "string" }],
    });
  });

  it("qti-match-table-entry: reads the source as an integer and the target as a base type, as the schema has it", () => {
    const table = outcome(
      '<qti-match-table><qti-match-table-entry source-value="-2" target-value="identifier"/></qti-match-table>',
    ).lookupTable;
    expect(table?.kind === "match-table" && table.matchTableEntries[0]).toEqual({
      kind: "match-table-entry",
      sourceValue: -2,
      targetValue: "identifier",
    });
    const issue = readIssue(() =>
      readAsi(
        `<qti-outcome-declaration ${NAMESPACE} identifier="O" cardinality="single"><qti-match-table><qti-match-table-entry source-value="1" target-value="A"/></qti-match-table></qti-outcome-declaration>`,
      ),
    );
    expect(issue).toMatchObject({ code: "assesskit/asi/invalid-value", severity: "error" });
  });

  it("qti-outcome-declaration: reads the attributes and leaves normal-minimum out when the document omits it", () => {
    const declaration = declarationOf(
      `<qti-outcome-declaration ${NAMESPACE} identifier="SCORE" cardinality="single" base-type="float" view="author scorer" interpretation="points" long-interpretation="https://example.com/i" normal-maximum="10" mastery-value="6" external-scored="human" variable-identifier-ref="v"/>`,
    );
    expect(declaration).toEqual({
      kind: "outcome-declaration",
      identifier: "SCORE",
      cardinality: "single",
      baseType: "float",
      view: ["author", "scorer"],
      interpretation: "points",
      longInterpretation: "https://example.com/i",
      normalMaximum: 10,
      masteryValue: 6,
      externalScored: "human",
      variableIdentifierRef: "v",
    });
  });

  it("qti-outcome-declaration: an absent normal-minimum stays absent although the 3.0.1 schema defaults it to 0.0", () => {
    const declaration = declarationOf(
      `<qti-outcome-declaration ${NAMESPACE} identifier="SCORE" cardinality="single" base-type="float"/>`,
    );
    expect("normalMinimum" in declaration).toBe(false);
    expect(
      declarationOf(`<qti-outcome-declaration ${NAMESPACE} identifier="S" cardinality="single" normal-minimum="-1"/>`)
        .normalMinimum,
    ).toBe(-1);
    expect(writeAsi({ kind: "outcome-declaration", declaration })).not.toContain("normal-minimum");
    const attributes = ELEMENT_TYPES.OutcomeDeclaration.attributes;
    expect(attributes.find(({ name }) => name === "normal-minimum")).toMatchObject({ default: "0.0" });
  });

  it("qti-response-declaration: reads the declaration with its mapping and correct response", () => {
    const declaration = response(
      '<qti-correct-response><qti-value>x</qti-value></qti-correct-response><qti-mapping><qti-map-entry map-key="x" mapped-value="1"/></qti-mapping>',
    );
    expect(declaration).toMatchObject({
      kind: "response-declaration",
      identifier: "R",
      cardinality: "single",
      baseType: "string",
    });
    expect(declaration?.mapping?.mapEntries).toHaveLength(1);
  });

  it("qti-template-declaration: reads param-variable and math-variable as booleans", () => {
    const { templateDeclarations } = itemOf(
      item(
        '<qti-template-declaration identifier="N" cardinality="single" base-type="integer" param-variable="true" math-variable="false"/>',
      ),
    );
    expect(templateDeclarations).toEqual([
      {
        kind: "template-declaration",
        identifier: "N",
        cardinality: "single",
        baseType: "integer",
        paramVariable: true,
        mathVariable: false,
      },
    ]);
  });

  it("qti-value: keeps the text exactly and reads the field identifier and base type", () => {
    const declaration = response(
      '<qti-correct-response><qti-value field-identifier="f" base-type="float">  1.50 </qti-value></qti-correct-response>',
      'cardinality="record"',
    );
    expect(declaration?.correctResponse?.values).toEqual([
      { kind: "value", fieldIdentifier: "f", baseType: "float", value: "  1.50 " },
    ]);
  });
});

describe("reading rules", () => {
  const setOutcome = `<qti-set-outcome-value identifier="SCORE">${ONE_XML}</qti-set-outcome-value>`;
  const setOutcomeModel = { kind: "set-outcome-value", identifier: "SCORE", expression: ONE };

  it("qti-exit-response: is a rule without content", () => {
    expect(responseRuleOf("<qti-exit-response/>")).toEqual({ kind: "exit-response" });
  });

  it("qti-exit-template: is a rule without content", () => {
    expect(templateRuleOf("<qti-exit-template/>")).toEqual({ kind: "exit-template" });
  });

  it("qti-exit-test: is a rule without content", () => {
    expect(outcomeRuleOf("<qti-exit-test/>")).toEqual({ kind: "exit-test" });
  });

  it("qti-lookup-outcome-value: reads the identifier and the expression", () => {
    expect(
      responseRuleOf(`<qti-lookup-outcome-value identifier="GRADE">${RESPONSE_XML}</qti-lookup-outcome-value>`),
    ).toEqual({ kind: "lookup-outcome-value", identifier: "GRADE", expression: RESPONSE });
  });

  it("qti-outcome-condition: reads the if, the else-ifs and the else", () => {
    const rule = outcomeRuleOf(
      `<qti-outcome-condition><qti-outcome-if>${ONE_XML}${setOutcome}</qti-outcome-if><qti-outcome-else-if>${ONE_XML}</qti-outcome-else-if><qti-outcome-else>${setOutcome}</qti-outcome-else></qti-outcome-condition>`,
    );
    expect(rule).toEqual({
      kind: "outcome-condition",
      outcomeIf: { kind: "outcome-if", condition: ONE, rules: [setOutcomeModel] },
      outcomeElseIfs: [{ kind: "outcome-else-if", condition: ONE, rules: [] }],
      outcomeElse: { kind: "outcome-else", rules: [setOutcomeModel] },
    });
  });

  it("qti-outcome-else: reads its rules", () => {
    const rule = outcomeRuleOf(
      `<qti-outcome-condition><qti-outcome-if>${ONE_XML}</qti-outcome-if><qti-outcome-else><qti-exit-test/></qti-outcome-else></qti-outcome-condition>`,
    );
    expect(rule.kind === "outcome-condition" && rule.outcomeElse).toEqual({
      kind: "outcome-else",
      rules: [{ kind: "exit-test" }],
    });
  });

  it("qti-outcome-else-if: has the shape of qti-outcome-if with its own kind", () => {
    const rule = outcomeRuleOf(
      `<qti-outcome-condition><qti-outcome-if>${ONE_XML}</qti-outcome-if><qti-outcome-else-if>${RESPONSE_XML}<qti-exit-test/></qti-outcome-else-if></qti-outcome-condition>`,
    );
    expect(rule.kind === "outcome-condition" && rule.outcomeElseIfs).toEqual([
      { kind: "outcome-else-if", condition: RESPONSE, rules: [{ kind: "exit-test" }] },
    ]);
  });

  it("qti-outcome-if: reads the condition and the rules", () => {
    const rule = outcomeRuleOf(
      `<qti-outcome-condition><qti-outcome-if>${ONE_XML}${setOutcome}${setOutcome}</qti-outcome-if></qti-outcome-condition>`,
    );
    expect(rule.kind === "outcome-condition" && rule.outcomeIf).toEqual({
      kind: "outcome-if",
      condition: ONE,
      rules: [setOutcomeModel, setOutcomeModel],
    });
  });

  it("qti-outcome-processing: is a document that holds rules and keeps an include as XML", () => {
    const processing = outcomeProcessingOf(
      `${setOutcome}<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="more.xml"/>`,
    );
    expect(processing.rules.map((rule) => rule.kind)).toEqual(["set-outcome-value", "element"]);
  });

  it("qti-outcome-processing-fragment: nests rules like the processing", () => {
    expect(outcomeRuleOf(`<qti-outcome-processing-fragment>${setOutcome}</qti-outcome-processing-fragment>`)).toEqual({
      kind: "outcome-processing-fragment",
      rules: [setOutcomeModel],
    });
  });

  it("qti-response-condition: reads the if, the else-ifs and the else", () => {
    const rule = responseRuleOf(
      `<qti-response-condition><qti-response-if>${ONE_XML}${setOutcome}</qti-response-if><qti-response-else-if>${RESPONSE_XML}</qti-response-else-if><qti-response-else>${setOutcome}</qti-response-else></qti-response-condition>`,
    );
    expect(rule).toEqual({
      kind: "response-condition",
      responseIf: { kind: "response-if", condition: ONE, rules: [setOutcomeModel] },
      responseElseIfs: [{ kind: "response-else-if", condition: RESPONSE, rules: [] }],
      responseElse: { kind: "response-else", rules: [setOutcomeModel] },
    });
  });

  it("qti-response-else: reads its rules", () => {
    const rule = responseRuleOf(
      `<qti-response-condition><qti-response-if>${ONE_XML}</qti-response-if><qti-response-else><qti-exit-response/></qti-response-else></qti-response-condition>`,
    );
    expect(rule.kind === "response-condition" && rule.responseElse).toEqual({
      kind: "response-else",
      rules: [{ kind: "exit-response" }],
    });
  });

  it("qti-response-else-if: has the shape of qti-response-if with its own kind", () => {
    const rule = responseRuleOf(
      `<qti-response-condition><qti-response-if>${ONE_XML}</qti-response-if><qti-response-else-if>${ONE_XML}<qti-exit-response/></qti-response-else-if></qti-response-condition>`,
    );
    expect(rule.kind === "response-condition" && rule.responseElseIfs[0]).toEqual({
      kind: "response-else-if",
      condition: ONE,
      rules: [{ kind: "exit-response" }],
    });
  });

  it("qti-response-if: reads the condition and the rules", () => {
    const rule = responseRuleOf(
      `<qti-response-condition><qti-response-if>${ONE_XML}${setOutcome}</qti-response-if></qti-response-condition>`,
    );
    expect(rule.kind === "response-condition" && rule.responseIf).toEqual({
      kind: "response-if",
      condition: ONE,
      rules: [setOutcomeModel],
    });
  });

  it("qti-response-processing: reads the template and its location, and the rules", () => {
    const processing = responseProcessingOf(
      setOutcome,
      ' template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct" template-location="templates/mc.xml"',
    );
    expect(processing).toEqual({
      kind: "response-processing",
      template: "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct",
      templateLocation: "templates/mc.xml",
      rules: [setOutcomeModel],
    });
  });

  it("qti-response-processing-fragment: nests rules like the processing", () => {
    expect(
      responseRuleOf(`<qti-response-processing-fragment>${setOutcome}</qti-response-processing-fragment>`),
    ).toEqual({
      kind: "response-processing-fragment",
      rules: [setOutcomeModel],
    });
  });

  it("qti-set-correct-response: reads the identifier and the expression", () => {
    expect(templateRuleOf(`<qti-set-correct-response identifier="R">${ONE_XML}</qti-set-correct-response>`)).toEqual({
      kind: "set-correct-response",
      identifier: "R",
      expression: ONE,
    });
  });

  it("qti-set-default-value: reads the identifier and the expression", () => {
    expect(templateRuleOf(`<qti-set-default-value identifier="R">${ONE_XML}</qti-set-default-value>`)).toEqual({
      kind: "set-default-value",
      identifier: "R",
      expression: ONE,
    });
  });

  it("qti-set-outcome-value: reads the identifier and the expression", () => {
    expect(responseRuleOf(setOutcome)).toEqual(setOutcomeModel);
  });

  it("qti-set-template-value: reads the identifier and the expression", () => {
    expect(templateRuleOf(`<qti-set-template-value identifier="N">${ONE_XML}</qti-set-template-value>`)).toEqual({
      kind: "set-template-value",
      identifier: "N",
      expression: ONE,
    });
  });

  const setTemplate = `<qti-set-template-value identifier="N">${ONE_XML}</qti-set-template-value>`;
  const setTemplateModel = { kind: "set-template-value", identifier: "N", expression: ONE };

  it("qti-template-condition: reads the if, the else-ifs and the else", () => {
    expect(
      templateRuleOf(
        `<qti-template-condition><qti-template-if>${ONE_XML}${setTemplate}</qti-template-if><qti-template-else-if>${ONE_XML}</qti-template-else-if><qti-template-else>${setTemplate}</qti-template-else></qti-template-condition>`,
      ),
    ).toEqual({
      kind: "template-condition",
      templateIf: { kind: "template-if", condition: ONE, rules: [setTemplateModel] },
      templateElseIfs: [{ kind: "template-else-if", condition: ONE, rules: [] }],
      templateElse: { kind: "template-else", rules: [setTemplateModel] },
    });
  });

  it("qti-template-constraint: reads the expression", () => {
    expect(templateRuleOf(`<qti-template-constraint>${ONE_XML}</qti-template-constraint>`)).toEqual({
      kind: "template-constraint",
      expression: ONE,
    });
  });

  it("qti-template-else: reads its rules", () => {
    const rule = templateRuleOf(
      `<qti-template-condition><qti-template-if>${ONE_XML}</qti-template-if><qti-template-else><qti-exit-template/></qti-template-else></qti-template-condition>`,
    );
    expect(rule.kind === "template-condition" && rule.templateElse).toEqual({
      kind: "template-else",
      rules: [{ kind: "exit-template" }],
    });
  });

  it("qti-template-else-if: has the shape of qti-template-if with its own kind", () => {
    const rule = templateRuleOf(
      `<qti-template-condition><qti-template-if>${ONE_XML}</qti-template-if><qti-template-else-if>${ONE_XML}<qti-exit-template/></qti-template-else-if></qti-template-condition>`,
    );
    expect(rule.kind === "template-condition" && rule.templateElseIfs[0]).toEqual({
      kind: "template-else-if",
      condition: ONE,
      rules: [{ kind: "exit-template" }],
    });
  });

  it("qti-template-if: reads the condition and the rules", () => {
    const rule = templateRuleOf(
      `<qti-template-condition><qti-template-if>${ONE_XML}${setTemplate}</qti-template-if></qti-template-condition>`,
    );
    expect(rule.kind === "template-condition" && rule.templateIf).toEqual({
      kind: "template-if",
      condition: ONE,
      rules: [setTemplateModel],
    });
  });

  it("qti-template-processing: reads the rules of an item in order", () => {
    const { templateProcessing } = itemOf(
      item(`<qti-template-processing>${setTemplate}<qti-exit-template/></qti-template-processing>`),
    );
    expect(templateProcessing).toEqual({
      kind: "template-processing",
      rules: [setTemplateModel, { kind: "exit-template" }],
    });
  });
});

describe("reading expressions", () => {
  it("qti-and: reads its operands in document order", () => {
    expect(expressionOf(`<qti-and>${ONE_XML}${RESPONSE_XML}</qti-and>`)).toEqual({
      kind: "and",
      operands: [ONE, RESPONSE],
    });
  });

  it("qti-any-n: reads min and max as numbers or variable names", () => {
    expect(expressionOf(`<qti-any-n min="1" max="N">${ONE_XML}</qti-any-n>`)).toEqual({
      kind: "any-n",
      min: 1,
      max: "N",
      operands: [ONE],
    });
  });

  it("qti-base-value: keeps the text and reads the base type", () => {
    expect(expressionOf('<qti-base-value base-type="float"> 1.50</qti-base-value>')).toEqual({
      kind: "base-value",
      baseType: "float",
      value: " 1.50",
    });
  });

  it("qti-container-size: reads its operand", () => {
    expect(expressionOf(`<qti-container-size>${RESPONSE_XML}</qti-container-size>`)).toEqual({
      kind: "container-size",
      operand: RESPONSE,
    });
  });

  it("qti-contains: reads its two operands", () => {
    expect(expressionOf(`<qti-contains>${PAIR_XML}</qti-contains>`)).toEqual({ kind: "contains", operands: PAIR });
  });

  it("qti-correct: reads the identifier", () => {
    expect(expressionOf('<qti-correct identifier="RESPONSE"/>')).toEqual({ kind: "correct", identifier: "RESPONSE" });
  });

  it("qti-custom-operator: reads class and definition, operands, and the extensions", () => {
    expect(
      expressionOf(
        `<qti-custom-operator class="Fn" definition="urn:fn" xmlns:x="urn:x" x:flag="1">${ONE_XML}<x:data/></qti-custom-operator>`,
      ),
    ).toEqual({
      kind: "custom-operator",
      class: "Fn",
      definition: "urn:fn",
      extensions: [{ namespace: "urn:x", prefix: "x", name: "flag", value: "1" }],
      operands: [ONE],
      extensionElements: [foreignElement("data")],
    });
  });

  it("qti-default: reads the identifier", () => {
    expect(expressionOf('<qti-default identifier="SCORE"/>')).toEqual({ kind: "default", identifier: "SCORE" });
  });

  it("qti-delete: reads its two operands", () => {
    expect(expressionOf(`<qti-delete>${PAIR_XML}</qti-delete>`)).toEqual({ kind: "delete", operands: PAIR });
  });

  it("qti-divide: reads its two operands", () => {
    expect(expressionOf(`<qti-divide>${PAIR_XML}</qti-divide>`)).toEqual({ kind: "divide", operands: PAIR });
  });

  it("qti-duration-gte: reads its two operands", () => {
    expect(expressionOf(`<qti-duration-gte>${PAIR_XML}</qti-duration-gte>`)).toEqual({
      kind: "duration-gte",
      operands: PAIR,
    });
  });

  it("qti-duration-lt: reads its two operands", () => {
    expect(expressionOf(`<qti-duration-lt>${PAIR_XML}</qti-duration-lt>`)).toEqual({
      kind: "duration-lt",
      operands: PAIR,
    });
  });

  it("qti-equal: reads the tolerance as numbers and variable names and leaves the defaults out", () => {
    expect(
      expressionOf(
        `<qti-equal tolerance-mode="relative" tolerance="0.1 T" include-lower-bound="false">${PAIR_XML}</qti-equal>`,
      ),
    ).toEqual({
      kind: "equal",
      toleranceMode: "relative",
      tolerance: [0.1, "T"],
      includeLowerBound: false,
      operands: PAIR,
    });
    expect(expressionOf(`<qti-equal>${PAIR_XML}</qti-equal>`)).toEqual({ kind: "equal", operands: PAIR });
  });

  it("qti-equal: reads a tolerance that refers to a variable in braces, and writes it that way", () => {
    const markup = `<qti-equal tolerance-mode="absolute" tolerance="{T} 0.5">${PAIR_XML}</qti-equal>`;
    expect(expressionOf(markup)).toMatchObject({ kind: "equal", tolerance: ["T", 0.5] });
    const written = writeAsi({
      kind: "response-processing",
      processing: responseProcessingOf(
        `<qti-response-condition><qti-response-if>${markup}</qti-response-if></qti-response-condition>`,
      ),
    });
    expect(written).toContain('tolerance="{T} 0.5"');
  });

  it("qti-equal-rounded: reads the mode and the figures", () => {
    expect(
      expressionOf(`<qti-equal-rounded rounding-mode="decimalPlaces" figures="2">${PAIR_XML}</qti-equal-rounded>`),
    ).toEqual({
      kind: "equal-rounded",
      roundingMode: "decimalPlaces",
      figures: 2,
      operands: PAIR,
    });
  });

  it("qti-field-value: reads the field identifier and the operand", () => {
    expect(expressionOf(`<qti-field-value field-identifier="stringValue">${RESPONSE_XML}</qti-field-value>`)).toEqual({
      kind: "field-value",
      fieldIdentifier: "stringValue",
      operand: RESPONSE,
    });
  });

  it("qti-gcd: reads its operands", () => {
    expect(expressionOf(`<qti-gcd>${PAIR_XML}</qti-gcd>`)).toEqual({ kind: "gcd", operands: PAIR });
  });

  it("qti-gt: reads its two operands", () => {
    expect(expressionOf(`<qti-gt>${PAIR_XML}</qti-gt>`)).toEqual({ kind: "gt", operands: PAIR });
  });

  it("qti-gte: reads its two operands", () => {
    expect(expressionOf(`<qti-gte>${PAIR_XML}</qti-gte>`)).toEqual({ kind: "gte", operands: PAIR });
  });

  it("qti-index: reads n as a number or a variable name", () => {
    expect(expressionOf(`<qti-index n="2">${RESPONSE_XML}</qti-index>`)).toEqual({
      kind: "index",
      n: 2,
      operand: RESPONSE,
    });
    expect(expressionOf(`<qti-index n="N">${RESPONSE_XML}</qti-index>`)).toEqual({
      kind: "index",
      n: "N",
      operand: RESPONSE,
    });
  });

  it("qti-inside: reads the shape and the coordinates", () => {
    expect(expressionOf(`<qti-inside shape="circle" coords="10,20,5">${RESPONSE_XML}</qti-inside>`)).toEqual({
      kind: "inside",
      shape: "circle",
      coords: "10,20,5",
      operand: RESPONSE,
    });
  });

  it("qti-integer-divide: reads its two operands", () => {
    expect(expressionOf(`<qti-integer-divide>${PAIR_XML}</qti-integer-divide>`)).toEqual({
      kind: "integer-divide",
      operands: PAIR,
    });
  });

  it("qti-integer-modulus: reads its two operands", () => {
    expect(expressionOf(`<qti-integer-modulus>${PAIR_XML}</qti-integer-modulus>`)).toEqual({
      kind: "integer-modulus",
      operands: PAIR,
    });
  });

  it("qti-integer-to-float: reads its operand", () => {
    expect(expressionOf(`<qti-integer-to-float>${ONE_XML}</qti-integer-to-float>`)).toEqual({
      kind: "integer-to-float",
      operand: ONE,
    });
  });

  it("qti-is-null: reads its operand", () => {
    expect(expressionOf(`<qti-is-null>${RESPONSE_XML}</qti-is-null>`)).toEqual({ kind: "is-null", operand: RESPONSE });
  });

  it("qti-lcm: reads its operands", () => {
    expect(expressionOf(`<qti-lcm>${PAIR_XML}</qti-lcm>`)).toEqual({ kind: "lcm", operands: PAIR });
  });

  it("qti-lt: reads its two operands", () => {
    expect(expressionOf(`<qti-lt>${PAIR_XML}</qti-lt>`)).toEqual({ kind: "lt", operands: PAIR });
  });

  it("qti-lte: reads its two operands", () => {
    expect(expressionOf(`<qti-lte>${PAIR_XML}</qti-lte>`)).toEqual({ kind: "lte", operands: PAIR });
  });

  it("qti-map-response: reads the identifier", () => {
    expect(expressionOf('<qti-map-response identifier="RESPONSE"/>')).toEqual({
      kind: "map-response",
      identifier: "RESPONSE",
    });
  });

  it("qti-map-response-point: reads the identifier", () => {
    expect(expressionOf('<qti-map-response-point identifier="RESPONSE"/>')).toEqual({
      kind: "map-response-point",
      identifier: "RESPONSE",
    });
  });

  it("qti-match: reads its two operands", () => {
    expect(expressionOf(`<qti-match>${RESPONSE_XML}<qti-correct identifier="RESPONSE"/></qti-match>`)).toEqual({
      kind: "match",
      operands: [RESPONSE, { kind: "correct", identifier: "RESPONSE" }],
    });
  });

  it("qti-math-constant: reads the name", () => {
    expect(expressionOf('<qti-math-constant name="pi"/>')).toEqual({ kind: "math-constant", name: "pi" });
  });

  it("qti-math-operator: reads the name and the operands", () => {
    expect(expressionOf(`<qti-math-operator name="atan2">${PAIR_XML}</qti-math-operator>`)).toEqual({
      kind: "math-operator",
      name: "atan2",
      operands: PAIR,
    });
  });

  it("qti-max: reads its operands", () => {
    expect(expressionOf(`<qti-max>${PAIR_XML}</qti-max>`)).toEqual({ kind: "max", operands: PAIR });
  });

  it("qti-member: reads its two operands", () => {
    expect(expressionOf(`<qti-member>${PAIR_XML}</qti-member>`)).toEqual({ kind: "member", operands: PAIR });
  });

  it("qti-min: reads its operands", () => {
    expect(expressionOf(`<qti-min>${PAIR_XML}</qti-min>`)).toEqual({ kind: "min", operands: PAIR });
  });

  it("qti-multiple: reads no operands as an empty list", () => {
    expect(expressionOf("<qti-multiple/>")).toEqual({ kind: "multiple", operands: [] });
    expect(expressionOf(`<qti-multiple>${PAIR_XML}</qti-multiple>`)).toEqual({ kind: "multiple", operands: PAIR });
  });

  it("qti-not: reads its operand", () => {
    expect(expressionOf(`<qti-not>${RESPONSE_XML}</qti-not>`)).toEqual({ kind: "not", operand: RESPONSE });
  });

  it("qti-null: has no content", () => {
    expect(expressionOf("<qti-null/>")).toEqual({ kind: "null" });
  });

  it("qti-or: reads its operands", () => {
    expect(expressionOf(`<qti-or>${PAIR_XML}</qti-or>`)).toEqual({ kind: "or", operands: PAIR });
  });

  it("qti-ordered: reads no operands as an empty list", () => {
    expect(expressionOf("<qti-ordered/>")).toEqual({ kind: "ordered", operands: [] });
    expect(expressionOf(`<qti-ordered>${PAIR_XML}</qti-ordered>`)).toEqual({ kind: "ordered", operands: PAIR });
  });

  it("qti-pattern-match: keeps the pattern as written, a variable reference included", () => {
    expect(expressionOf(`<qti-pattern-match pattern="[a-z]+{N}">${RESPONSE_XML}</qti-pattern-match>`)).toEqual({
      kind: "pattern-match",
      pattern: "[a-z]+{N}",
      operand: RESPONSE,
    });
  });

  it("qti-power: reads its two operands", () => {
    expect(expressionOf(`<qti-power>${PAIR_XML}</qti-power>`)).toEqual({ kind: "power", operands: PAIR });
  });

  it("qti-product: reads its operands", () => {
    expect(expressionOf(`<qti-product>${PAIR_XML}</qti-product>`)).toEqual({ kind: "product", operands: PAIR });
  });

  it("qti-random: reads its operand", () => {
    expect(expressionOf(`<qti-random>${RESPONSE_XML}</qti-random>`)).toEqual({ kind: "random", operand: RESPONSE });
  });

  it("qti-random-float: reads min and max as numbers or variable names", () => {
    expect(expressionOf('<qti-random-float min="0.5" max="M"/>')).toEqual({ kind: "random-float", min: 0.5, max: "M" });
    expect(expressionOf('<qti-random-float max="1"/>')).toEqual({ kind: "random-float", max: 1 });
  });

  it("qti-random-integer: reads min, max and step", () => {
    expect(expressionOf('<qti-random-integer min="-2" max="10" step="2"/>')).toEqual({
      kind: "random-integer",
      min: -2,
      max: 10,
      step: 2,
    });
  });

  it("qti-repeat: reads number-repeats as a number or a variable name", () => {
    expect(expressionOf(`<qti-repeat number-repeats="3">${ONE_XML}</qti-repeat>`)).toEqual({
      kind: "repeat",
      numberRepeats: 3,
      operands: [ONE],
    });
    expect(expressionOf(`<qti-repeat number-repeats="N">${ONE_XML}</qti-repeat>`)).toMatchObject({
      numberRepeats: "N",
    });
  });

  it("qti-round: reads its operand", () => {
    expect(expressionOf(`<qti-round>${ONE_XML}</qti-round>`)).toEqual({ kind: "round", operand: ONE });
  });

  it("qti-round-to: reads the mode and the figures", () => {
    expect(
      expressionOf(`<qti-round-to rounding-mode="significantFigures" figures="3">${ONE_XML}</qti-round-to>`),
    ).toEqual({
      kind: "round-to",
      roundingMode: "significantFigures",
      figures: 3,
      operand: ONE,
    });
  });

  it("qti-stats-operator: reads the name and the operand", () => {
    expect(expressionOf(`<qti-stats-operator name="popSD">${RESPONSE_XML}</qti-stats-operator>`)).toEqual({
      kind: "stats-operator",
      name: "popSD",
      operand: RESPONSE,
    });
  });

  it("qti-string-match: reads case-sensitive and substring", () => {
    expect(
      expressionOf(`<qti-string-match case-sensitive="true" substring="true">${PAIR_XML}</qti-string-match>`),
    ).toEqual({
      kind: "string-match",
      caseSensitive: true,
      substring: true,
      operands: PAIR,
    });
  });

  it("qti-substring: reads case-sensitive", () => {
    expect(expressionOf(`<qti-substring case-sensitive="false">${PAIR_XML}</qti-substring>`)).toEqual({
      kind: "substring",
      caseSensitive: false,
      operands: PAIR,
    });
  });

  it("qti-subtract: reads its two operands", () => {
    expect(expressionOf(`<qti-subtract>${PAIR_XML}</qti-subtract>`)).toEqual({ kind: "subtract", operands: PAIR });
  });

  it("qti-sum: reads its numeric operands", () => {
    expect(expressionOf(`<qti-sum>${ONE_XML}${RESPONSE_XML}</qti-sum>`)).toEqual({
      kind: "sum",
      operands: [ONE, RESPONSE],
    });
    const issue = readIssue(() => expressionOf(`<qti-sum><qti-and>${ONE_XML}</qti-and></qti-sum>`));
    expect(issue).toMatchObject({ code: "assesskit/asi/element" });
  });

  it("qti-truncate: reads its operand", () => {
    expect(expressionOf(`<qti-truncate>${ONE_XML}</qti-truncate>`)).toEqual({ kind: "truncate", operand: ONE });
  });

  it("qti-variable: reads the identifier and the weight identifier", () => {
    expect(expressionOf('<qti-variable identifier="ITEM.SCORE" weight-identifier="W"/>')).toEqual({
      kind: "variable",
      identifier: "ITEM.SCORE",
      weightIdentifier: "W",
    });
  });

  it("qti-number-correct: reads the section and the categories", () => {
    expect(
      expressionOf('<qti-number-correct section-identifier="S1" include-category="a b" exclude-category="c"/>'),
    ).toEqual({
      kind: "number-correct",
      sectionIdentifier: "S1",
      includeCategory: ["a", "b"],
      excludeCategory: ["c"],
    });
  });

  it("qti-number-incorrect: reads the section and the categories", () => {
    expect(expressionOf('<qti-number-incorrect section-identifier="S1"/>')).toEqual({
      kind: "number-incorrect",
      sectionIdentifier: "S1",
    });
  });

  it("qti-number-presented: reads the categories", () => {
    expect(expressionOf('<qti-number-presented include-category="a"/>')).toEqual({
      kind: "number-presented",
      includeCategory: ["a"],
    });
  });

  it("qti-number-responded: has no attributes to read in its simplest form", () => {
    expect(expressionOf("<qti-number-responded/>")).toEqual({ kind: "number-responded" });
  });

  it("qti-number-selected: reads the exclude categories", () => {
    expect(expressionOf('<qti-number-selected exclude-category="x y"/>')).toEqual({
      kind: "number-selected",
      excludeCategory: ["x", "y"],
    });
  });

  it("qti-outcome-maximum: reads the outcome and the weight", () => {
    expect(expressionOf('<qti-outcome-maximum outcome-identifier="SCORE" weight-identifier="W"/>')).toEqual({
      kind: "outcome-maximum",
      outcomeIdentifier: "SCORE",
      weightIdentifier: "W",
    });
  });

  it("qti-outcome-minimum: reads the outcome and the section", () => {
    expect(expressionOf('<qti-outcome-minimum outcome-identifier="SCORE" section-identifier="S"/>')).toEqual({
      kind: "outcome-minimum",
      outcomeIdentifier: "SCORE",
      sectionIdentifier: "S",
    });
  });

  it("qti-test-variables: reads the variable, the base type and the weight", () => {
    expect(
      expressionOf('<qti-test-variables variable-identifier="SCORE" base-type="float" weight-identifier="W"/>'),
    ).toEqual({
      kind: "test-variables",
      variableIdentifier: "SCORE",
      baseType: "float",
      weightIdentifier: "W",
    });
  });
});

/** Reads the children of an item body. */
function bodyOf(content: string, attributes = "") {
  return itemOf(item(`<qti-item-body${attributes}>${content}</qti-item-body>`)).body?.children ?? [];
}

/** Reads the children of the element in an item body that wraps the content: inline content sits in a `p`, flow in a `div`. */
function wrappedBy(element: "p" | "div", content: string) {
  const [wrapper] = bodyOf(`<${element}>${content}</${element}>`);
  if (wrapper?.kind !== element) throw new Error(`Expected a ${element}.`);
  return wrapper.children;
}

const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const SSML_NAMESPACE = "http://www.w3.org/2001/10/synthesis";

describe("reading flow content", () => {
  it("reads text and elements in document order, with each run of text as one node", () => {
    expect(bodyOf("<p>One <b>two</b> three<i>four</i></p>")).toEqual([
      {
        kind: "p",
        children: [
          { kind: "text", value: "One " },
          { kind: "b", children: [{ kind: "text", value: "two" }], extensions: [] },
          { kind: "text", value: " three" },
          { kind: "i", children: [{ kind: "text", value: "four" }], extensions: [] },
        ],
        extensions: [],
      },
    ]);
  });

  it("reads a CDATA section and entities as text, joins the runs of text around a comment and leaves out comments and processing instructions", () => {
    const [paragraph] = bodyOf("<p>a &lt; b <![CDATA[<c>]]> d<!--note--> e<?target data?></p>");
    expect(paragraph).toMatchObject({ children: [{ kind: "text", value: "a < b <c> d e" }] });
  });

  it("keeps white space between the elements of mixed content and drops it between those of element-only content", () => {
    const [list, paragraph] = bodyOf("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n<p><b>x</b> <i>y</i></p>");
    expect(list).toMatchObject({ kind: "ul", items: [{ kind: "li" }, { kind: "li" }] });
    expect(paragraph).toMatchObject({
      children: [{ kind: "b" }, { kind: "text", value: " " }, { kind: "i" }],
    });
  });

  it("refuses text in content that takes elements only, and an element that the content does not take", () => {
    expect(readIssue(() => readAsi(item("<qti-item-body>text</qti-item-body>")))).toMatchObject({
      code: "assesskit/asi/text",
      message: "The element qti-item-body must not contain text.",
    });
    expect(readIssue(() => readAsi(item("<qti-item-body><p><div>x</div></p></qti-item-body>")))).toMatchObject({
      code: "assesskit/asi/element",
      message: "The element p cannot contain div here.",
    });
    expect(
      readIssue(() => readAsi(item("<qti-item-body><p><x:a xmlns:x='urn:x'/></p></qti-item-body>"))),
    ).toMatchObject({
      code: "assesskit/asi/element",
    });
  });

  it("keeps an xi:include in content as an XML element, where the content takes one", () => {
    const [paragraph] = bodyOf('<p>a<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="part.xml"/></p>');
    expect(paragraph).toMatchObject({
      children: [
        { kind: "text", value: "a" },
        {
          kind: "element",
          namespace: XINCLUDE_NAMESPACE,
          name: "include",
          prefix: "xi",
          attributes: [{ namespace: "", name: "href", value: "part.xml" }],
        },
      ],
    });
  });

  it("writes text escaped, and nothing for a text without characters", () => {
    const paragraph = {
      kind: "p",
      children: [
        { kind: "text", value: "a <b> & c" },
        { kind: "text", value: "" },
      ],
      extensions: [],
    };
    const written = writeAsi({
      kind: "item",
      item: { ...itemOf(item()), body: { kind: "item-body", children: [paragraph] } } as AssessmentItem,
    });
    expect(written).toContain("<p>a &lt;b&gt; &amp; c</p>");
  });

  it("refuses to write text where the content takes elements only, and an element that the content does not take", () => {
    const write = (children: unknown[]) =>
      writeAsi({ kind: "item", item: { ...itemOf(item()), body: { kind: "item-body", children } } as AssessmentItem });
    expect(() => write([{ kind: "text", value: "x" }])).toThrow(
      new DataError(
        "The property children of qti-item-body does not take text. It is in qti-assessment-item/qti-item-body.",
      ),
    );
    expect(() => write([{ kind: "p", children: [{ kind: "text", value: JSON.parse("5") }], extensions: [] }])).toThrow(
      /The value of a text in children of p must be a string, found 5/,
    );
    expect(() => write([{ kind: "tbody", rows: [], extensions: [] }])).toThrow(
      /A member of children of qti-item-body must have the kind "rubric-block"/,
    );
    expect(() => write([foreignElement("a")])).toThrow(
      new DataError(
        "The property children of qti-item-body does not accept the element a. It is in qti-assessment-item/qti-item-body.",
      ),
    );
  });
});

describe("reading HTML", () => {
  it("img: needs the source and the alternative text, and reads the optional attributes", () => {
    const [image] = wrappedBy("p", '<img src="fig/a.png" alt="A cat" longdesc="fig/a.html" height="40" width="50%"/>');
    expect(image).toEqual({
      kind: "img",
      src: "fig/a.png",
      alt: "A cat",
      longdesc: "fig/a.html",
      height: "40",
      width: "50%",
      extensions: [],
    });
    expect(readIssue(() => readAsi(item('<qti-item-body><p><img src="a.png"/></p></qti-item-body>')))).toMatchObject({
      code: "assesskit/asi/missing-attribute",
      message: expect.stringContaining("The element img must have the attribute alt."),
    });
  });

  it("a: needs the reference and reads the type", () => {
    const [paragraph] = bodyOf('<p><a href="https://example.com/x" type="text/html">link</a></p>');
    expect(paragraph).toMatchObject({
      children: [{ kind: "a", href: "https://example.com/x", type: "text/html" }],
    });
    expect(readIssue(() => readAsi(item("<qti-item-body><p><a>x</a></p></qti-item-body>")))).toMatchObject({
      code: "assesskit/asi/missing-attribute",
    });
  });

  it("object, param: the object needs the data and the type, and holds parameters and the fallback", () => {
    const [object] = wrappedBy(
      "p",
      '<object data="a.swf" type="application/x-shockwave-flash" width="100" height="50%"><param name="speed" value="fast" valuetype="DATA" type="text/plain"/><param name="src" value="b.xml" valuetype="REF"/>No plug-in.</object>',
    );
    expect(object).toMatchObject({
      kind: "object",
      data: "a.swf",
      type: "application/x-shockwave-flash",
      width: "100",
      height: "50%",
      children: [
        { kind: "param", name: "speed", value: "fast", valuetype: "DATA", type: "text/plain" },
        { kind: "param", name: "src", value: "b.xml", valuetype: "REF" },
        { kind: "text", value: "No plug-in." },
      ],
    });
  });

  it("table: reads the caption, columns, head, bodies, foot, rows and cells", () => {
    const [table] = bodyOf(
      '<table summary="Scores"><caption>Scores</caption><col span="2"/><colgroup span="3"><col/></colgroup><thead><tr><th scope="col" abbr="N" axis="a" headers="x y">Name</th></tr></thead><tbody><tr><td rowspan="2" colspan="3" align="center" valign="top">1</td></tr></tbody><tfoot><tr><td>sum</td></tr></tfoot></table>',
    );
    expect(table).toMatchObject({
      kind: "table",
      summary: "Scores",
      caption: { kind: "caption", children: [{ kind: "text", value: "Scores" }] },
      cols: [{ kind: "col", span: 2 }],
      colgroups: [{ kind: "colgroup", span: 3, cols: [{ kind: "col" }] }],
      thead: {
        kind: "thead",
        rows: [
          {
            kind: "tr",
            cells: [
              { kind: "th", scope: "col", abbr: "N", axis: "a", headers: ["x", "y"], children: [{ kind: "text" }] },
            ],
          },
        ],
      },
      bodies: [
        {
          kind: "tbody",
          rows: [{ kind: "tr", cells: [{ kind: "td", rowspan: 2, colspan: 3, align: "center", valign: "top" }] }],
        },
      ],
      tfoot: { kind: "tfoot", rows: [{ kind: "tr", cells: [{ kind: "td" }] }] },
    });
    expect(table).toMatchObject({ rows: [] });
  });

  it("table: takes rows without a body, and refuses rows together with bodies", () => {
    const [table] = bodyOf("<table><tr><td>a</td></tr><tr><td>b</td></tr></table>");
    expect(table).toMatchObject({ kind: "table", bodies: [], rows: [{ kind: "tr" }, { kind: "tr" }] });
    expect(
      readIssue(() => readAsi(item("<qti-item-body><table><tbody/><tr><td>a</td></tr></table></qti-item-body>"))),
    ).toMatchObject({ code: "assesskit/asi/exclusive" });
  });

  it("ul, ol, li: hold their items", () => {
    const [unordered, ordered] = bodyOf("<ul><li>a</li><li>b <b>c</b></li></ul><ol><li>one</li></ol>");
    expect(unordered).toMatchObject({
      kind: "ul",
      items: [{ kind: "li" }, { kind: "li", children: [{ kind: "text", value: "b " }, { kind: "b" }] }],
    });
    expect(ordered).toMatchObject({ kind: "ol", items: [{ kind: "li", children: [{ kind: "text", value: "one" }] }] });
  });

  it("dl, dt, dd: keep terms and descriptions in one array, in document order", () => {
    const [list] = bodyOf("<dl><dt>Term</dt><dd>One</dd><dd>Two</dd><dt>Other</dt></dl>");
    expect(list).toMatchObject({
      kind: "dl",
      items: [{ kind: "dt" }, { kind: "dd" }, { kind: "dd" }, { kind: "dt" }],
    });
  });

  it("video, audio, source, track: read the media attributes and keep the fallback", () => {
    const [video, audio] = bodyOf(
      '<video src="a.mp4" poster="p.png" width="320" height="200" preload="none" controls="controls" autoplay="false" loop="true" muted="muted" crossorigin="anonymous" mediagroup="g"><source src="a.webm" type="video/webm" srcset="a.webm 1x" media="screen" sizes="100vw"/><track kind="subtitles" src="a.vtt" srclang="en" default="default"/>No video.</video><audio src="a.mp3" preload="auto"/>',
    );
    expect(video).toMatchObject({
      kind: "video",
      src: "a.mp4",
      poster: "p.png",
      width: 320,
      height: 200,
      preload: "none",
      controls: "controls",
      autoplay: "false",
      loop: "true",
      muted: "muted",
      crossorigin: "anonymous",
      mediagroup: "g",
      children: [
        { kind: "source", src: "a.webm", type: "video/webm", srcset: "a.webm 1x", media: "screen", sizes: "100vw" },
        { kind: "track", trackKind: "subtitles", src: "a.vtt", srclang: "en", default: "default" },
        { kind: "text", value: "No video." },
      ],
    });
    expect(audio).toMatchObject({ kind: "audio", src: "a.mp3", preload: "auto" });
  });

  it("picture: holds the sources and the image", () => {
    const [picture] = wrappedBy(
      "p",
      '<picture><source srcset="a.webp" type="image/webp"/><img src="a.png" alt="A"/></picture>',
    );
    expect(picture).toMatchObject({
      kind: "picture",
      sources: [{ kind: "source", srcset: "a.webp", type: "image/webp" }],
      img: { kind: "img", src: "a.png" },
    });
  });

  it("ruby, rb, rt, rp, rtc: keep the base, the annotation and the fallback parentheses", () => {
    const [annotated] = wrappedBy("p", "<ruby><rb>漢</rb><rp>(</rp><rt>kan</rt><rp>)</rp></ruby>");
    expect(annotated).toMatchObject({
      kind: "ruby",
      children: [{ kind: "rb" }, { kind: "rp" }, { kind: "rt" }, { kind: "rp" }],
    });
    const [ruby] = wrappedBy("p", "<ruby>x<rtc><rt>y</rt></rtc></ruby>");
    expect(ruby).toMatchObject({
      kind: "ruby",
      children: [{ kind: "text" }, { kind: "rtc", children: [{ kind: "rt" }] }],
    });
  });

  it("details, summary, figure, figcaption, blockquote, q, bdo, br, hr: read their own attributes and content", () => {
    const [details, figure, quote, inline, rule] = wrappedBy(
      "div",
      '<details open="true"><summary>More</summary><p>Text</p></details><figure><figcaption>Cap</figcaption><img src="a.png" alt=""/></figure><blockquote cite="https://example.com/q"><p>Q</p></blockquote><p>a<q cite="u.html">b</q><bdo title="t" dir="rtl">c</bdo><br/></p><hr/>',
    );
    expect(details).toMatchObject({ kind: "details", open: true, summary: { kind: "summary" } });
    expect(figure).toMatchObject({ kind: "figure", children: [{ kind: "figcaption" }, { kind: "img" }] });
    expect(quote).toMatchObject({ kind: "blockquote", cite: "https://example.com/q" });
    expect(inline).toMatchObject({
      children: [
        { kind: "text" },
        { kind: "q", cite: "u.html" },
        { kind: "bdo", title: "t", dir: "rtl" },
        { kind: "br" },
      ],
    });
    expect(rule).toEqual({ kind: "hr", extensions: [] });
  });

  it("div, span: keep the common attributes and the extension attributes", () => {
    const [block] = bodyOf(
      '<div id="d" class="a b" lang="id" xml:lang="id-ID" label="L" dir="rtl" data-catalog-idref="c" data-qti-suppress-tts="all" role="note" aria-label="Note" aria-hidden="true" data-x="1"><span>s</span></div>',
    );
    expect(block).toMatchObject({
      kind: "div",
      id: "d",
      class: ["a", "b"],
      lang: "id",
      language: "id-ID",
      label: "L",
      dir: "rtl",
      dataCatalogIdref: "c",
      dataQtiSuppressTts: "all",
      role: "note",
      ariaLabel: "Note",
      ariaHidden: true,
      extensions: [{ namespace: "", name: "data-x", value: "1" }],
      children: [{ kind: "span" }],
    });
  });

  it("refuses a value that is not in the lexical form of its attribute", () => {
    expect(
      readIssue(() => readAsi(item('<qti-item-body><table><tr><td colspan="x">a</td></tr></table></qti-item-body>'))),
    ).toMatchObject({
      code: "assesskit/asi/invalid-value",
    });
  });

  it("write the attributes in the order of the schema and the text escaped", () => {
    const written = writeAsi({
      kind: "item",
      item: itemOf(item('<qti-item-body><p><a href="a?b=1&amp;c=2">x &amp; y</a></p></qti-item-body>')),
    });
    expect(written).toContain('<p><a href="a?b=1&amp;c=2">x &amp; y</a></p>');
  });
});

describe("reading MathML and SSML", () => {
  const math =
    '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML" display="inline"><m:mfrac><m:mn>1</m:mn><m:mi>x</m:mi></m:mfrac><m:annotation encoding="x"> a </m:annotation></m:math>';

  it("m3:math: keeps the subtree as it is, with its namespace, prefix, attributes and white space", () => {
    const [paragraph, choices] = bodyOf(
      `<p>Solve ${math}.</p><qti-choice-interaction response-identifier="R"><qti-simple-choice identifier="A">${math}</qti-simple-choice></qti-choice-interaction>`,
    );
    const expected = {
      kind: "element",
      namespace: MATHML_NAMESPACE,
      prefix: "m",
      name: "math",
      attributes: [{ namespace: "", name: "display", value: "inline" }],
      children: [
        {
          kind: "element",
          namespace: MATHML_NAMESPACE,
          prefix: "m",
          name: "mfrac",
          attributes: [],
          children: [
            {
              kind: "element",
              namespace: MATHML_NAMESPACE,
              prefix: "m",
              name: "mn",
              attributes: [],
              children: [{ kind: "text", value: "1" }],
            },
            {
              kind: "element",
              namespace: MATHML_NAMESPACE,
              prefix: "m",
              name: "mi",
              attributes: [],
              children: [{ kind: "text", value: "x" }],
            },
          ],
        },
        {
          kind: "element",
          namespace: MATHML_NAMESPACE,
          prefix: "m",
          name: "annotation",
          attributes: [{ namespace: "", name: "encoding", value: "x" }],
          children: [{ kind: "text", value: " a " }],
        },
      ],
    };
    expect(paragraph).toMatchObject({
      children: [{ kind: "text", value: "Solve " }, expected, { kind: "text", value: "." }],
    });
    expect(choices).toMatchObject({ simpleChoices: [{ children: [expected] }] });
  });

  it("m3:math: is written back with the prefix it had", () => {
    const written = writeAsi({ kind: "item", item: itemOf(item(`<qti-item-body><p>${math}</p></qti-item-body>`)) });
    expect(written).toContain("<m:math");
    expect(written).toContain('xmlns:m="http://www.w3.org/1998/Math/MathML"');
    expect(written).toContain('<m:annotation encoding="x"> a </m:annotation></m:math>');
  });

  const ssml = (name: string, attributes = "", content = "") =>
    `<ssml:${name} xmlns:ssml="${SSML_NAMESPACE}"${attributes}>${content}</ssml:${name}>`;
  const embedded = (name: string, attributes = "", content = "") => {
    const [paragraph] = bodyOf(`<p>${ssml(name, attributes, content)}</p>`);
    if (paragraph?.kind !== "p") throw new Error("Expected a paragraph.");
    const [node] = paragraph.children;
    return node;
  };

  it("ssml11:speak: is kept as it is", () => {
    expect(embedded("speak", ' version="1.1" xml:lang="en"', "Hello")).toMatchObject({
      kind: "element",
      namespace: SSML_NAMESPACE,
      prefix: "ssml",
      name: "speak",
      attributes: [
        { namespace: "", name: "version", value: "1.1" },
        { namespace: "http://www.w3.org/XML/1998/namespace", prefix: "xml", name: "lang", value: "en" },
      ],
      children: [{ kind: "text", value: "Hello" }],
    });
  });

  it("ssml11:audio: is kept as it is", () => {
    expect(embedded("audio", ' src="a.mp3"', "Fallback")).toMatchObject({
      name: "audio",
      attributes: [{ name: "src", value: "a.mp3" }],
      children: [{ kind: "text", value: "Fallback" }],
    });
  });

  it("ssml11:break: is kept as it is", () => {
    expect(embedded("break", ' time="500ms"')).toMatchObject({
      name: "break",
      attributes: [{ name: "time", value: "500ms" }],
    });
  });

  it("ssml11:emphasis: is kept as it is", () => {
    expect(embedded("emphasis", ' level="strong"', "now")).toMatchObject({
      name: "emphasis",
      children: [{ value: "now" }],
    });
  });

  it("ssml11:mark: is kept as it is", () => {
    expect(embedded("mark", ' name="here"')).toMatchObject({
      name: "mark",
      attributes: [{ name: "name", value: "here" }],
    });
  });

  it("ssml11:p: is kept as it is", () => {
    expect(embedded("p", "", "A paragraph.")).toMatchObject({ name: "p", children: [{ value: "A paragraph." }] });
  });

  it("ssml11:phoneme: is kept as it is", () => {
    expect(embedded("phoneme", ' alphabet="x-sampa" ph="t@meIt@U"', "tomato")).toMatchObject({
      name: "phoneme",
      attributes: [
        { name: "alphabet", value: "x-sampa" },
        { name: "ph", value: "t@meIt@U" },
      ],
    });
  });

  it("ssml11:prosody: is kept as it is", () => {
    expect(embedded("prosody", ' rate="slow" pitch="+2st"', "slowly")).toMatchObject({
      name: "prosody",
      attributes: [{ name: "rate" }, { name: "pitch" }],
    });
  });

  it("ssml11:s: is kept as it is", () => {
    expect(embedded("s", "", "A sentence.")).toMatchObject({ name: "s", children: [{ value: "A sentence." }] });
  });

  it("ssml11:say-as: is kept as it is", () => {
    expect(embedded("say-as", ' interpret-as="cardinal"', "12")).toMatchObject({
      name: "say-as",
      attributes: [{ name: "interpret-as", value: "cardinal" }],
    });
  });

  it("ssml11:sub: is kept as it is", () => {
    expect(embedded("sub", ' alias="water"', "H2O")).toMatchObject({
      name: "sub",
      attributes: [{ name: "alias", value: "water" }],
    });
  });

  it("ssml11:voice: is kept as it is", () => {
    expect(embedded("voice", ' gender="female"', "Hi")).toMatchObject({
      name: "voice",
      attributes: [{ name: "gender", value: "female" }],
    });
  });

  it("ssml11:lexicon: a speak element keeps the reference to a PLS pronunciation lexicon", () => {
    const speak = embedded(
      "speak",
      ' version="1.1" xml:lang="en"',
      `<ssml:lexicon xmlns:ssml="${SSML_NAMESPACE}" uri="lexicon/names.pls" type="application/pls+xml"/>Rama`,
    );
    expect(speak).toMatchObject({
      children: [
        {
          name: "lexicon",
          attributes: [
            { name: "uri", value: "lexicon/names.pls" },
            { name: "type", value: "application/pls+xml" },
          ],
        },
        { kind: "text", value: "Rama" },
      ],
    });
  });

  it("qti-stylesheet: keeps the reference to a CSS 2.1 or 3 style sheet in an item, a stimulus and a portable custom interaction", () => {
    const sheets = '<qti-stylesheet href="css/item.css" type="text/css" media="screen" title="Screen"/>';
    expect(itemOf(item(sheets)).stylesheets).toEqual([
      { kind: "stylesheet", href: "css/item.css", type: "text/css", media: "screen", title: "Screen" },
    ]);
    expect(
      stimulusOf(
        `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t">${sheets}<qti-stimulus-body><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
      ).stylesheets,
    ).toHaveLength(1);
    const [pci] = bodyOf(
      '<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:x"><qti-interaction-markup/><qti-stylesheet href="css/pci.css" type="text/css"/></qti-portable-custom-interaction>',
    );
    expect(pci).toMatchObject({ stylesheets: [{ kind: "stylesheet", href: "css/pci.css", type: "text/css" }] });
  });
});

/** Reads one element of an item body, which must be of the given kind. */
function onlyIn<TKind extends string>(content: string, kind: TKind) {
  const [node, ...rest] = bodyOf(content);
  if (node === undefined || rest.length > 0 || node.kind !== kind) throw new Error(`Expected one ${kind}.`);
  return node;
}

describe("reading interactions", () => {
  it("qti-choice-interaction: reads the limits, the orientation, the prompt and the choices", () => {
    const interaction = onlyIn(
      '<qti-choice-interaction response-identifier="RESPONSE" shuffle="true" max-choices="2" min-choices="1" orientation="horizontal" data-min-selections-message="Pick one" data-max-selections-message="Pick two at most"><qti-prompt>Which <b>two</b> are prime?</qti-prompt><qti-simple-choice identifier="A" fixed="true">2</qti-simple-choice><qti-simple-choice identifier="B" show-hide="hide" template-identifier="T">4</qti-simple-choice></qti-choice-interaction>',
      "choice-interaction",
    );
    expect(interaction).toMatchObject({
      responseIdentifier: "RESPONSE",
      shuffle: true,
      maxChoices: 2,
      minChoices: 1,
      orientation: "horizontal",
      dataMinSelectionsMessage: "Pick one",
      dataMaxSelectionsMessage: "Pick two at most",
      prompt: {
        kind: "prompt",
        children: [{ kind: "text", value: "Which " }, { kind: "b" }, { kind: "text", value: " are prime?" }],
      },
      simpleChoices: [
        { kind: "simple-choice", identifier: "A", fixed: true, children: [{ kind: "text", value: "2" }] },
        { kind: "simple-choice", identifier: "B", showHide: "hide", templateIdentifier: "T" },
      ],
    });
  });

  it("qti-choice-interaction: leaves the attributes it does not read omitted, with their defaults not applied", () => {
    const interaction = onlyIn(
      '<qti-choice-interaction response-identifier="R"><qti-simple-choice identifier="A">a</qti-simple-choice></qti-choice-interaction>',
      "choice-interaction",
    );
    expect(Object.keys(interaction).sort()).toEqual(["extensions", "kind", "responseIdentifier", "simpleChoices"]);
  });

  it("qti-order-interaction: reads the limits and the orientation, and orders simple choices", () => {
    const interaction = onlyIn(
      '<qti-order-interaction response-identifier="R" shuffle="true" min-choices="2" max-choices="3" orientation="vertical" data-choices-container-width="200"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-order-interaction>',
      "order-interaction",
    );
    expect(interaction).toMatchObject({
      shuffle: true,
      minChoices: 2,
      maxChoices: 3,
      orientation: "vertical",
      dataChoicesContainerWidth: 200,
      simpleChoices: [{ identifier: "A" }, { identifier: "B" }],
    });
  });

  it("qti-associate-interaction: reads the association limits and the choices with the number of times each takes part", () => {
    const interaction = onlyIn(
      '<qti-associate-interaction response-identifier="R" shuffle="true" min-associations="1" max-associations="3"><qti-simple-associable-choice identifier="A" match-max="1" match-min="0" match-group="g1 g2">Antonio</qti-simple-associable-choice><qti-simple-associable-choice identifier="C" match-max="2" fixed="true">Capulet</qti-simple-associable-choice></qti-associate-interaction>',
      "associate-interaction",
    );
    expect(interaction).toMatchObject({
      shuffle: true,
      minAssociations: 1,
      maxAssociations: 3,
      simpleAssociableChoices: [
        { identifier: "A", matchMax: 1, matchMin: 0, matchGroup: ["g1", "g2"] },
        { identifier: "C", matchMax: 2, fixed: true },
      ],
    });
  });

  it("qti-match-interaction: holds two sets of choices", () => {
    const interaction = onlyIn(
      '<qti-match-interaction response-identifier="R" shuffle="true" max-associations="4" min-associations="0" data-first-column-header="Hero"><qti-simple-match-set><qti-simple-associable-choice identifier="C" match-max="1">Capulet</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set><qti-simple-associable-choice identifier="D" match-max="4">Demetrius</qti-simple-associable-choice><qti-simple-associable-choice identifier="L" match-max="2">Lysander</qti-simple-associable-choice></qti-simple-match-set></qti-match-interaction>',
      "match-interaction",
    );
    expect(interaction).toMatchObject({
      maxAssociations: 4,
      dataFirstColumnHeader: "Hero",
      simpleMatchSets: [
        { kind: "simple-match-set", simpleAssociableChoices: [{ identifier: "C" }] },
        {
          simpleAssociableChoices: [
            { identifier: "D", matchMax: 4 },
            { identifier: "L", matchMax: 2 },
          ],
        },
      ],
    });
  });

  it("qti-gap-match-interaction: holds the choices, and the text with the gaps", () => {
    const interaction = onlyIn(
      '<qti-gap-match-interaction response-identifier="R" shuffle="true" min-associations="1" max-associations="2" data-choices-container-width="150"><qti-gap-text identifier="W" match-max="1">winter</qti-gap-text><qti-gap-img identifier="I" match-max="1" object-label="sun" top="1" left="2"><img src="sun.png" alt="Sun"/></qti-gap-img><blockquote><p>Shall I compare thee to a <qti-gap identifier="G1" required="true"/> day?</p></blockquote></qti-gap-match-interaction>',
      "gap-match-interaction",
    );
    expect(interaction).toMatchObject({
      dataChoicesContainerWidth: 150,
      choices: [
        { kind: "gap-text", identifier: "W", matchMax: 1, children: [{ kind: "text", value: "winter" }] },
        {
          kind: "gap-img",
          identifier: "I",
          matchMax: 1,
          objectLabel: "sun",
          top: "1",
          left: "2",
          image: { kind: "img" },
        },
      ],
      children: [
        {
          kind: "blockquote",
          children: [
            {
              kind: "p",
              children: [
                { kind: "text", value: "Shall I compare thee to a " },
                { kind: "gap", identifier: "G1", required: true },
                { kind: "text", value: " day?" },
              ],
            },
          ],
        },
      ],
    });
  });

  it("qti-inline-choice-interaction: sits in a sentence and holds the label and the choices", () => {
    const [paragraph] = bodyOf(
      '<p>Cheese is <qti-inline-choice-interaction response-identifier="R" shuffle="true" required="true" min-choices="1" data-prompt="Choose" data-min-selections-message="Required"><qti-label>Color</qti-label><qti-inline-choice identifier="Y" fixed="true">yellow</qti-inline-choice><qti-inline-choice identifier="N">none</qti-inline-choice></qti-inline-choice-interaction>.</p>',
    );
    expect(paragraph).toMatchObject({
      children: [
        { kind: "text", value: "Cheese is " },
        {
          kind: "inline-choice-interaction",
          shuffle: true,
          required: true,
          minChoices: 1,
          dataPrompt: "Choose",
          labelElement: { kind: "label", children: [{ kind: "text", value: "Color" }] },
          inlineChoices: [
            { kind: "inline-choice", identifier: "Y", fixed: true },
            { kind: "inline-choice", identifier: "N" },
          ],
        },
        { kind: "text", value: "." },
      ],
    });
  });

  it("qti-text-entry-interaction: sits in a sentence and reads the answer constraints", () => {
    const [paragraph] = bodyOf(
      '<p>Born in <qti-text-entry-interaction response-identifier="R" base="16" string-identifier="S" expected-length="4" pattern-mask="[0-9]+" placeholder-text="year" format="digits" data-patternmask-message="Digits"/>.</p>',
    );
    expect(paragraph).toMatchObject({
      children: [
        { kind: "text" },
        {
          kind: "text-entry-interaction",
          responseIdentifier: "R",
          base: 16,
          stringIdentifier: "S",
          expectedLength: 4,
          patternMask: "[0-9]+",
          placeholderText: "year",
          format: "digits",
          dataPatternmaskMessage: "Digits",
        },
        { kind: "text" },
      ],
    });
  });

  it("qti-extended-text-interaction: reads the answer constraints and the format", () => {
    const interaction = onlyIn(
      '<qti-extended-text-interaction response-identifier="R" base="10" string-identifier="S" expected-length="200" pattern-mask=".+" placeholder-text="Write" max-strings="2" min-strings="1" expected-lines="5" format="preformatted" data-patternmask-message="m"><qti-prompt>Describe it.</qti-prompt></qti-extended-text-interaction>',
      "extended-text-interaction",
    );
    expect(interaction).toMatchObject({
      maxStrings: 2,
      minStrings: 1,
      expectedLines: 5,
      expectedLength: 200,
      format: "preformatted",
      prompt: { children: [{ value: "Describe it." }] },
    });
  });

  it("qti-slider-interaction: reads the bounds, the step and the appearance", () => {
    const interaction = onlyIn(
      '<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="10.5" step="0.5" step-label="true" orientation="vertical" reverse="true"/>',
      "slider-interaction",
    );
    expect(interaction).toMatchObject({
      lowerBound: 0,
      upperBound: 10.5,
      step: 0.5,
      stepLabel: true,
      orientation: "vertical",
      reverse: true,
    });
  });

  it("qti-upload-interaction: reads the MIME types that it accepts", () => {
    const interaction = onlyIn(
      '<qti-upload-interaction response-identifier="R" type="image/png application/pdf"/>',
      "upload-interaction",
    );
    expect(interaction).toMatchObject({ type: ["image/png", "application/pdf"] });
  });

  it("qti-end-attempt-interaction: needs the title and reads whether the attempt counts", () => {
    const [interaction] = wrappedBy(
      "p",
      '<qti-end-attempt-interaction response-identifier="HINT" title="Show hint" count-attempt="false"/>',
    );
    expect(interaction).toMatchObject({ responseIdentifier: "HINT", title: "Show hint", countAttempt: false });
    expect(
      readIssue(() =>
        readAsi(item('<qti-item-body><p><qti-end-attempt-interaction response-identifier="H"/></p></qti-item-body>')),
      ),
    ).toMatchObject({ code: "assesskit/asi/missing-attribute" });
  });

  it("qti-media-interaction: reads the plays and the media element", () => {
    const interaction = onlyIn(
      '<qti-media-interaction response-identifier="R" autostart="true" min-plays="1" max-plays="3" loop="true" coords="0,0,100,60"><qti-prompt>Listen.</qti-prompt><audio src="a.mp3" controls="controls"/></qti-media-interaction>',
      "media-interaction",
    );
    expect(interaction).toMatchObject({
      autostart: true,
      minPlays: 1,
      maxPlays: 3,
      loop: true,
      coords: "0,0,100,60",
      media: { kind: "audio", src: "a.mp3" },
    });
  });

  it("qti-hotspot-interaction: holds the image and the hotspots with their shapes", () => {
    const interaction = onlyIn(
      '<qti-hotspot-interaction response-identifier="R" min-choices="1" max-choices="2"><qti-prompt>Where?</qti-prompt><object type="image/png" data="uk.png" width="206" height="280">UK</object><qti-hotspot-choice identifier="A" shape="circle" coords="77,115,8" hotspot-label="Edinburgh"/><qti-hotspot-choice identifier="B" shape="rect" coords="0,0,10,10"/></qti-hotspot-interaction>',
      "hotspot-interaction",
    );
    expect(interaction).toMatchObject({
      minChoices: 1,
      maxChoices: 2,
      image: { kind: "object", data: "uk.png", type: "image/png" },
      hotspotChoices: [
        { kind: "hotspot-choice", identifier: "A", shape: "circle", coords: "77,115,8", hotspotLabel: "Edinburgh" },
        { identifier: "B", shape: "rect" },
      ],
    });
  });

  it("qti-graphic-order-interaction: holds the image and the hotspots to put in order", () => {
    const interaction = onlyIn(
      '<qti-graphic-order-interaction response-identifier="R" min-choices="2" max-choices="4"><img src="g.png" alt="Map"/><qti-hotspot-choice identifier="A" shape="rect" coords="0,0,5,5"/></qti-graphic-order-interaction>',
      "graphic-order-interaction",
    );
    expect(interaction).toMatchObject({
      minChoices: 2,
      maxChoices: 4,
      image: { kind: "img" },
      hotspotChoices: [{ identifier: "A" }],
    });
  });

  it("qti-graphic-associate-interaction: holds the image and the associable hotspots", () => {
    const interaction = onlyIn(
      '<qti-graphic-associate-interaction response-identifier="R" min-associations="1" max-associations="3"><picture><source srcset="a.webp"/><img src="a.png" alt="A"/></picture><qti-associable-hotspot identifier="A" match-max="2" match-min="1" match-group="g" shape="ellipse" coords="1,2,3,4" hotspot-label="Spot"/></qti-graphic-associate-interaction>',
      "graphic-associate-interaction",
    );
    expect(interaction).toMatchObject({
      maxAssociations: 3,
      image: { kind: "picture" },
      associableHotspots: [
        {
          kind: "associable-hotspot",
          identifier: "A",
          matchMax: 2,
          matchMin: 1,
          matchGroup: ["g"],
          shape: "ellipse",
          hotspotLabel: "Spot",
        },
      ],
    });
  });

  it("qti-graphic-gap-match-interaction: holds the image, the choices to drop and the hotspots to drop them on", () => {
    const interaction = onlyIn(
      '<qti-graphic-gap-match-interaction response-identifier="R" min-associations="1" max-associations="2" data-choices-container-width="80"><img src="g.png" alt="Map"/><qti-gap-img identifier="I" match-max="1"><img src="i.png" alt="I"/></qti-gap-img><qti-gap-text identifier="T" match-max="1">T</qti-gap-text><qti-associable-hotspot identifier="H" match-max="1" shape="default" coords="0,0"/></qti-graphic-gap-match-interaction>',
      "graphic-gap-match-interaction",
    );
    expect(interaction).toMatchObject({
      dataChoicesContainerWidth: 80,
      image: { kind: "img" },
      choices: [{ kind: "gap-img" }, { kind: "gap-text" }],
      associableHotspots: [{ identifier: "H", shape: "default" }],
    });
  });

  it("qti-select-point-interaction: holds the image on which the candidate marks points", () => {
    const interaction = onlyIn(
      '<qti-select-point-interaction response-identifier="R" min-choices="1" max-choices="3"><img src="g.png" alt="Map"/></qti-select-point-interaction>',
      "select-point-interaction",
    );
    expect(interaction).toMatchObject({ minChoices: 1, maxChoices: 3, image: { kind: "img" } });
  });

  it("qti-position-object-stage: holds the image and the position object interactions", () => {
    const stage = onlyIn(
      '<qti-position-object-stage id="stage"><img src="g.png" alt="Map"/><qti-position-object-interaction response-identifier="R1" center-point="10 20" min-choices="0" max-choices="1"><img src="pin.png" alt="Pin"/></qti-position-object-interaction></qti-position-object-stage>',
      "position-object-stage",
    );
    expect(stage).toMatchObject({
      id: "stage",
      image: { kind: "img" },
      positionObjectInteractions: [
        {
          kind: "position-object-interaction",
          responseIdentifier: "R1",
          centerPoint: [10, 20],
          maxChoices: 1,
          image: { kind: "img" },
        },
      ],
    });
  });

  it("qti-hottext-interaction: holds a text with the words that the candidate can select", () => {
    const interaction = onlyIn(
      '<qti-hottext-interaction response-identifier="R" max-choices="2" min-choices="1" data-min-selections-message="a" data-max-selections-message="b"><qti-prompt>Find the error.</qti-prompt><p>Sing <qti-hottext identifier="A">a</qti-hottext> song</p></qti-hottext-interaction>',
      "hottext-interaction",
    );
    expect(interaction).toMatchObject({
      maxChoices: 2,
      minChoices: 1,
      children: [
        {
          kind: "p",
          children: [
            { kind: "text", value: "Sing " },
            { kind: "hottext", identifier: "A", children: [{ kind: "text", value: "a" }] },
            { kind: "text", value: " song" },
          ],
        },
      ],
    });
  });

  it("qti-drawing-interaction: holds the canvas image", () => {
    const interaction = onlyIn(
      '<qti-drawing-interaction response-identifier="R"><qti-prompt>Draw.</qti-prompt><img src="canvas.png" alt="Canvas"/></qti-drawing-interaction>',
      "drawing-interaction",
    );
    expect(interaction).toMatchObject({ prompt: { kind: "prompt" }, image: { kind: "img", src: "canvas.png" } });
  });

  it("qti-custom-interaction: keeps any content, in any namespace, as XML elements", () => {
    const interaction = onlyIn(
      '<qti-custom-interaction xmlns:ext="urn:ext" response-identifier="R" ext:flag="1"><ext:widget xmlns:ext="urn:ext" size="3">text</ext:widget><p>in the ASI namespace</p></qti-custom-interaction>',
      "custom-interaction",
    );
    expect(interaction).toMatchObject({
      responseIdentifier: "R",
      extensions: [{ namespace: "urn:ext", name: "flag", value: "1" }],
      extensionElements: [
        {
          kind: "element",
          namespace: "urn:ext",
          name: "widget",
          attributes: [{ name: "size", value: "3" }],
          children: [{ kind: "text", value: "text" }],
        },
        { kind: "element", namespace: ASI_NAMESPACE, name: "p" },
      ],
    });
  });
});

describe("reading portable custom interactions", () => {
  const pci =
    '<qti-portable-custom-interaction response-identifier="RESPONSE" custom-interaction-type-identifier="urn:fdc:example.com:pci:graph" module="graph" data-min="0"><qti-prompt>Plot it.</qti-prompt><qti-interaction-modules primary-configuration="modules/primary.js" secondary-configuration="modules/secondary.js"><qti-interaction-module id="graph" primary-path="modules/graph.js" fallback-path="https://cdn.example.com/graph.js"/><qti-interaction-module id="lib"/></qti-interaction-modules><qti-interaction-markup><div class="graph" data-points="3"><p>Graph here <qti-printed-variable identifier="N"/></p></div><template><span>t</span></template></qti-interaction-markup><qti-template-variable template-identifier="N"/><qti-template-variable template-identifier="M"/><qti-context-variable identifier="CTX"/><qti-stylesheet href="css/graph.css" type="text/css"/><qti-catalog-info><qti-catalog id="c1"><qti-card support="spoken"><qti-html-content>Plot the points.</qti-html-content></qti-card></qti-catalog></qti-catalog-info></qti-portable-custom-interaction>';

  it("qti-portable-custom-interaction: reads the type, the modules, the markup, the variables, the style sheets and the catalogs", () => {
    const [interaction] = bodyOf(pci);
    expect(interaction).toMatchObject({
      kind: "portable-custom-interaction",
      responseIdentifier: "RESPONSE",
      customInteractionTypeIdentifier: "urn:fdc:example.com:pci:graph",
      module: "graph",
      extensions: [{ name: "data-min", value: "0" }],
      prompt: { kind: "prompt" },
      interactionModules: {
        kind: "interaction-modules",
        primaryConfiguration: "modules/primary.js",
        secondaryConfiguration: "modules/secondary.js",
        interactionModules: [
          {
            kind: "interaction-module",
            id: "graph",
            primaryPath: "modules/graph.js",
            fallbackPath: "https://cdn.example.com/graph.js",
          },
          { kind: "interaction-module", id: "lib" },
        ],
      },
      interactionMarkup: {
        kind: "interaction-markup",
        children: [{ kind: "div", class: ["graph"], extensions: [{ name: "data-points", value: "3" }] }],
        templates: [{ kind: "template" }],
      },
      templateVariables: [
        { kind: "template-variable", templateIdentifier: "N" },
        { kind: "template-variable", templateIdentifier: "M" },
      ],
      contextVariables: [{ kind: "context-variable", identifier: "CTX" }],
      stylesheets: [{ kind: "stylesheet", href: "css/graph.css", type: "text/css" }],
      catalogInfo: { kind: "catalog-info", catalogs: [{ kind: "catalog", id: "c1" }] },
    });
  });

  it("qti-portable-custom-interaction: needs the type and the markup, and the module list leaves its configuration files omitted", () => {
    expect(
      readIssue(() =>
        readAsi(
          item(
            '<qti-item-body><qti-portable-custom-interaction response-identifier="R"><qti-interaction-markup/></qti-portable-custom-interaction></qti-item-body>',
          ),
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/missing-attribute" });
    expect(
      readIssue(() =>
        readAsi(
          item(
            '<qti-item-body><qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:x"/></qti-item-body>',
          ),
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/missing-element" });
    const [interaction] = bodyOf(
      '<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:x"><qti-interaction-modules><qti-interaction-module id="m"/></qti-interaction-modules><qti-interaction-markup/></qti-portable-custom-interaction>',
    );
    expect(interaction).toMatchObject({ interactionModules: { interactionModules: [{ id: "m" }] } });
    expect(interaction).not.toHaveProperty("interactionModules.primaryConfiguration");
  });
});

describe("reading feedback, templates, rubric blocks and catalogs", () => {
  it("qti-feedback-block, qti-feedback-inline: read the outcome, the identifier and whether to show or hide", () => {
    const [block, paragraph] = bodyOf(
      '<qti-feedback-block outcome-identifier="FEEDBACK" identifier="correct" show-hide="show"><qti-content-body><p>Correct.</p></qti-content-body></qti-feedback-block><p>You <qti-feedback-inline outcome-identifier="FEEDBACK" identifier="wrong" show-hide="hide">did not</qti-feedback-inline> pass.</p>',
    );
    expect(block).toMatchObject({
      kind: "feedback-block",
      outcomeIdentifier: "FEEDBACK",
      identifier: "correct",
      showHide: "show",
      contentBody: { kind: "content-body", children: [{ kind: "p" }] },
    });
    expect(paragraph).toMatchObject({
      children: [
        { kind: "text", value: "You " },
        {
          kind: "feedback-inline",
          outcomeIdentifier: "FEEDBACK",
          identifier: "wrong",
          showHide: "hide",
          children: [{ kind: "text", value: "did not" }],
        },
        { kind: "text", value: " pass." },
      ],
    });
  });

  it("qti-template-block, qti-template-inline: read the template variable and the identifier", () => {
    const [block, paragraph] = bodyOf(
      '<qti-template-block template-identifier="T" identifier="a" show-hide="show"><qti-content-body><p>Shown.</p></qti-content-body></qti-template-block><p><qti-template-inline template-identifier="T" identifier="b" show-hide="hide">hidden</qti-template-inline></p>',
    );
    expect(block).toMatchObject({
      kind: "template-block",
      templateIdentifier: "T",
      identifier: "a",
      showHide: "show",
      contentBody: { children: [{ kind: "p" }] },
    });
    expect(paragraph).toMatchObject({
      children: [{ kind: "template-inline", templateIdentifier: "T", identifier: "b", showHide: "hide" }],
    });
  });

  it("qti-printed-variable: reads the variable and the formatting attributes", () => {
    const [paragraph] = bodyOf(
      '<p><qti-printed-variable identifier="SCORE" format="%.2f" base="8" index="2" power-form="true" field="f" delimiter="," mapping-indicator=":"/><qti-printed-variable identifier="N" base="B" index="I"/></p>',
    );
    expect(paragraph).toMatchObject({
      children: [
        {
          kind: "printed-variable",
          identifier: "SCORE",
          format: "%.2f",
          base: 8,
          index: 2,
          powerForm: true,
          field: "f",
          delimiter: ",",
          mappingIndicator: ":",
        },
        { kind: "printed-variable", identifier: "N", base: "B", index: "I" },
      ],
    });
  });

  it("qti-rubric-block: reads the views and the use in an item body, and the content body after the style sheets", () => {
    const [block] = bodyOf(
      '<qti-rubric-block view="author scorer" use="scoring" class="r"><qti-stylesheet href="r.css" type="text/css"/><qti-content-body><p>Give one point.</p></qti-content-body><qti-catalog-info><qti-catalog id="r1"><qti-card support="braille"><qti-card-entry xml:lang="en"/></qti-card></qti-catalog></qti-catalog-info></qti-rubric-block>',
    );
    expect(block).toMatchObject({
      kind: "rubric-block",
      view: ["author", "scorer"],
      use: "scoring",
      class: ["r"],
      stylesheets: [{ kind: "stylesheet" }],
      contentBody: { children: [{ kind: "p" }] },
      catalogInfo: { catalogs: [{ id: "r1" }] },
    });
  });

  it("qti-test-feedback: reads when it is shown, the outcome and whether to show or hide", () => {
    const test = testOf(
      `${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/><qti-test-feedback access="during" outcome-identifier="FB" identifier="fb1" show-hide="show" title="Halfway"><qti-content-body><p>Keep going.</p></qti-content-body></qti-test-feedback></qti-test-part>`,
    );
    expect(test.testParts[0]?.testFeedback).toMatchObject([
      {
        kind: "test-feedback",
        access: "during",
        outcomeIdentifier: "FB",
        identifier: "fb1",
        showHide: "show",
        title: "Halfway",
      },
    ]);
  });

  it("qti-modal-feedback: needs the outcome, the identifier and the show or hide, and holds the content body", () => {
    const { modalFeedback } = itemOf(
      item(
        '<qti-modal-feedback outcome-identifier="FB" show-hide="show" identifier="m1" title="Result"><qti-stylesheet href="m.css" type="text/css"/><qti-content-body><p>Well done.</p></qti-content-body><qti-catalog-info><qti-catalog id="mc"><qti-card support="spoken"><qti-html-content>Well done.</qti-html-content></qti-card></qti-catalog></qti-catalog-info></qti-modal-feedback>',
      ),
    );
    expect(modalFeedback).toMatchObject([
      {
        kind: "modal-feedback",
        outcomeIdentifier: "FB",
        showHide: "show",
        identifier: "m1",
        title: "Result",
        stylesheets: [{ kind: "stylesheet" }],
        contentBody: { children: [{ kind: "p" }] },
        catalogInfo: { catalogs: [{ id: "mc" }] },
      },
    ]);
    expect(
      readIssue(() =>
        readAsi(
          item('<qti-modal-feedback outcome-identifier="FB" identifier="m"><qti-content-body/></qti-modal-feedback>'),
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/missing-attribute" });
  });

  it("catalog, card, card entry, html content, file reference: read the cards of a support by language", () => {
    const { catalogInfo } = itemOf(
      item(
        '<qti-catalog-info><qti-catalog id="glossary"><qti-card support="glossary-on-screen" xml:lang="en"><qti-html-content xml:lang="en">A <b>word</b>.</qti-html-content><qti-file-href mime-type="audio/mpeg">word.mp3</qti-file-href></qti-card><qti-card support="keyword-translation"><qti-card-entry xml:lang="id" default="true"><qti-html-content>word</qti-html-content></qti-card-entry><qti-card-entry xml:lang="fr"><qti-file-href mime-type="audio/mpeg">mot.mp3</qti-file-href></qti-card-entry></qti-card><qti-card support="ext:note"/></qti-catalog></qti-catalog-info>',
      ),
    );
    expect(catalogInfo).toMatchObject({
      kind: "catalog-info",
      catalogs: [
        {
          kind: "catalog",
          id: "glossary",
          cards: [
            {
              kind: "card",
              support: "glossary-on-screen",
              language: "en",
              htmlContent: {
                kind: "html-content",
                language: "en",
                children: [{ kind: "text", value: "A " }, { kind: "b" }, { kind: "text", value: "." }],
              },
              fileHrefs: [{ kind: "file-href", mimeType: "audio/mpeg", value: "word.mp3" }],
            },
            {
              support: "keyword-translation",
              cardEntries: [
                { kind: "card-entry", language: "id", default: true, htmlContent: { children: [{ value: "word" }] } },
                { language: "fr", fileHrefs: [{ mimeType: "audio/mpeg", value: "mot.mp3" }] },
              ],
            },
            { support: "ext:note" },
          ],
        },
      ],
    });
  });

  it("card, catalog: refuse a card with content and entries together", () => {
    expect(
      readIssue(() =>
        readAsi(
          item(
            '<qti-catalog-info><qti-catalog id="c"><qti-card support="spoken"><qti-html-content>x</qti-html-content><qti-card-entry/></qti-card></qti-catalog></qti-catalog-info>',
          ),
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/exclusive" });
  });

  it("data-catalog-idref: stays on the element that refers to the catalog", () => {
    const [paragraph] = bodyOf('<p data-catalog-idref="glossary">Word</p>');
    expect(paragraph).toMatchObject({ dataCatalogIdref: "glossary" });
  });
});

describe("reading companion materials", () => {
  const materials =
    '<qti-companion-materials-info><qti-calculator><qti-calculator-type>scientific</qti-calculator-type><qti-description>Scientific</qti-description><qti-calculator-info mime-type="application/x-calc"><qti-file-href>calc.js</qti-file-href><qti-resource-icon>calc.png</qti-resource-icon></qti-calculator-info></qti-calculator><qti-rule><qti-description>Ruler</qti-description><qti-rule-system-si><qti-minimum-length>5</qti-minimum-length><qti-minor-increment unit="Millimeter">1</qti-minor-increment><qti-major-increment unit="Centimeter">10</qti-major-increment></qti-rule-system-si></qti-rule><qti-rule><qti-description>Yardstick</qti-description><qti-rule-system-us><qti-minimum-length>2</qti-minimum-length><qti-major-increment unit="Inch">1</qti-major-increment></qti-rule-system-us></qti-rule><qti-protractor><qti-description>Protractor</qti-description><qti-increment-si><qti-minor-increment unit="Radian">0.1</qti-minor-increment><qti-major-increment unit="Radian">1</qti-major-increment></qti-increment-si></qti-protractor><qti-protractor><qti-description>US protractor</qti-description><qti-increment-us><qti-major-increment unit="Degree">10</qti-major-increment></qti-increment-us></qti-protractor><qti-digital-material mime-type="text/html"><qti-file-href>periodic.html</qti-file-href></qti-digital-material><qti-physical-material>A compass</qti-physical-material></qti-companion-materials-info>';

  it("qti-companion-materials-info, qti-calculator: read the calculators of an item", () => {
    const { companionMaterials } = itemOf(item(materials));
    expect(companionMaterials?.calculators).toEqual([
      {
        kind: "calculator",
        calculatorType: { kind: "calculator-type", value: "scientific" },
        description: { kind: "description", value: "Scientific" },
        calculatorInfo: {
          kind: "calculator-info",
          mimeType: "application/x-calc",
          fileHref: { kind: "file-href", value: "calc.js" },
          resourceIcon: { kind: "resource-icon", value: "calc.png" },
        },
      },
    ]);
  });

  it("qti-rule: reads a ruler in SI or US units with its lengths and increments", () => {
    const rules = itemOf(item(materials)).companionMaterials?.rules;
    expect(rules).toMatchObject([
      {
        kind: "rule",
        description: { value: "Ruler" },
        ruleSystem: {
          kind: "rule-system-si",
          minimumLength: { kind: "minimum-length", value: 5 },
          minorIncrement: { kind: "minor-increment", unit: "Millimeter", value: "1" },
          majorIncrement: { kind: "major-increment", unit: "Centimeter", value: "10" },
        },
      },
      {
        ruleSystem: {
          kind: "rule-system-us",
          minimumLength: { value: 2 },
          majorIncrement: { unit: "Inch", value: "1" },
        },
      },
    ]);
  });

  it("qti-protractor: reads a protractor with SI or US increments", () => {
    const protractors = itemOf(item(materials)).companionMaterials?.protractors;
    expect(protractors).toMatchObject([
      {
        kind: "protractor",
        description: { value: "Protractor" },
        increment: {
          kind: "increment-si",
          minorIncrement: { unit: "Radian", value: "0.1" },
          majorIncrement: { unit: "Radian", value: "1" },
        },
      },
      { increment: { kind: "increment-us", majorIncrement: { unit: "Degree", value: "10" } } },
    ]);
  });

  it("qti-digital-material, qti-physical-material: read the digital files and the physical items", () => {
    const { companionMaterials } = itemOf(item(materials));
    expect(companionMaterials?.digitalMaterials).toMatchObject([
      { kind: "digital-material", mimeType: "text/html", fileHref: { value: "periodic.html" } },
    ]);
    expect(companionMaterials?.physicalMaterials).toEqual([{ kind: "physical-material", value: "A compass" }]);
  });

  it("qti-companion-materials-info: keeps the elements of other namespaces, and refuses a unit that the vocabulary does not have", () => {
    const { companionMaterials } = itemOf(
      item(
        '<qti-companion-materials-info><qti-physical-material>x</qti-physical-material><ext:note xmlns:ext="urn:ext"/></qti-companion-materials-info>',
      ),
    );
    expect(companionMaterials).toMatchObject({ extensionElements: [{ namespace: "urn:ext", name: "note" }] });
    expect(
      readIssue(() =>
        readAsi(
          item(
            '<qti-companion-materials-info><qti-rule><qti-description>R</qti-description><qti-rule-system-si><qti-minimum-length>1</qti-minimum-length><qti-major-increment unit="Foot">1</qti-major-increment></qti-rule-system-si></qti-rule></qti-companion-materials-info>',
          ),
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/invalid-value" });
  });
});

describe("reading common attributes and extension points", () => {
  const body = (attributes: string) => itemOf(item(`<qti-item-body${attributes}><p>x</p></qti-item-body>`)).body;
  const rubric = (attributes: string, content = "") =>
    testOf(
      `<qti-rubric-block${attributes}><qti-content-body><p>r</p></qti-content-body>${content}</qti-rubric-block>${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`,
    ).rubricBlocks[0];

  it("id: keeps the id of a body and the xs:ID identifier of a response declaration", () => {
    expect(body(' id="b1"')).toMatchObject({ id: "b1" });
    const { responseDeclarations } = itemOf(item('<qti-response-declaration identifier="R" cardinality="single"/>'));
    expect(responseDeclarations[0]).toMatchObject({ identifier: "R" });
  });

  it("class: reads the tokens of the list and writes them separated by one space", () => {
    const read = body(' class=" a  b\tc "');
    expect(read?.class).toEqual(["a", "b", "c"]);
    expect(
      writeAsi({ kind: "item", item: itemOf(item('<qti-item-body class="a  b"><p>x</p></qti-item-body>')) }),
    ).toContain('class="a b"');
  });

  it("lang and xml:lang: keeps both attributes apart", () => {
    const { body: read } = stimulusOf(
      `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t"><qti-stimulus-body lang="fr" xml:lang="fr-CA"><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    expect(read).toMatchObject({ lang: "fr", language: "fr-CA" });
  });

  it("label: reads the label of a body", () => {
    expect(body(' label="Question 1"')).toMatchObject({ label: "Question 1" });
  });

  it("dir: accepts ltr, rtl and auto and rejects any other term", () => {
    for (const dir of ["ltr", "rtl", "auto"]) expect(body(` dir="${dir}"`)).toMatchObject({ dir });
    expect(readIssue(() => readAsi(item('<qti-item-body dir="up"><p>x</p></qti-item-body>')))).toMatchObject({
      code: "assesskit/asi/invalid-value",
    });
  });

  it("data-catalog-idref: reads the reference of a body to its catalog", () => {
    expect(body(' data-catalog-idref="catalog1"')).toMatchObject({ dataCatalogIdref: "catalog1" });
  });

  it("data-qti-suppress-tts: accepts the three terms and rejects any other", () => {
    for (const term of ["computer-read-aloud", "screen-reader", "all"]) {
      expect(rubric(` view="candidate" use="instructions" data-qti-suppress-tts="${term}"`)).toMatchObject({
        dataQtiSuppressTts: term,
      });
    }
    expect(readIssue(() => rubric(' view="candidate" use="instructions" data-qti-suppress-tts="none"'))).toMatchObject({
      code: "assesskit/asi/invalid-value",
    });
  });

  it("data-ssml: reads the string of a rubric block", () => {
    expect(rubric(' view="candidate" use="instructions" data-ssml="{&quot;a&quot;:1}"')).toMatchObject({
      dataSsml: '{"a":1}',
    });
  });

  it("xml:base: reads the base of a rubric block and writes xml:base", () => {
    const read = rubric(' view="candidate" use="instructions" xml:base="media/"');
    expect(read).toMatchObject({ xmlBase: "media/" });
    const test = testOf(
      `<qti-rubric-block view="candidate" use="instructions" xml:base="media/"><qti-content-body><p>r</p></qti-content-body></qti-rubric-block>${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`,
    );
    expect(writeAsi({ kind: "test", test })).toContain('xml:base="media/"');
  });

  it("response-identifier: is a property of the interactions of a body", () => {
    const { body } = itemOf(
      item(
        '<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1"><qti-simple-choice identifier="A">a</qti-simple-choice></qti-choice-interaction></qti-item-body>',
      ),
    );
    expect(body?.children).toMatchObject([
      { kind: "choice-interaction", responseIdentifier: "RESPONSE", maxChoices: 1 },
    ]);
  });

  it("role and aria-*: reads the attributes of a stimulus body by their types", () => {
    const { body: read } = stimulusOf(
      `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t"><qti-stimulus-body role="region" aria-label="Passage" aria-hidden="true" aria-level="2" aria-live="polite" aria-relevant="additions text" aria-controls="a b" aria-valuemax="3.50"><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    expect(read).toMatchObject({
      role: "region",
      ariaLabel: "Passage",
      ariaHidden: true,
      ariaLevel: 2,
      ariaLive: "polite",
      ariaRelevant: ["additions", "text"],
      ariaControls: ["a", "b"],
      ariaValuemax: "3.50",
    });
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t"><qti-stimulus-body role="boss"><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/invalid-value" });
  });

  it("data-*: keeps data attributes in extensions, in document order", () => {
    const read = itemOf(item("", ' data-b="2" data-a="1"'));
    expect(read.extensions).toEqual([
      { namespace: "", name: "data-b", value: "2" },
      { namespace: "", name: "data-a", value: "1" },
    ]);
    expect(rubric(' view="candidate" use="instructions" data-x="y"')?.extensions).toEqual([
      { namespace: "", name: "data-x", value: "y" },
    ]);
  });

  it("namespaces: reads the ASI namespace under any prefix and ignores xsi:schemaLocation", () => {
    const prefixed = `<q:qti-assessment-item xmlns:q="${ASI_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SCHEMA_LOCATION}" identifier="i" title="t" time-dependent="false"><q:qti-item-body><q:p>x</q:p></q:qti-item-body></q:qti-assessment-item>`;
    expect(itemOf(prefixed).identifier).toBe("i");
    expect(itemOf(prefixed).extensions).toEqual([]);
  });

  it("namespaces: rejects another namespace and an element that is no document", () => {
    const wrong = readIssue(() =>
      readAsi(
        '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="i" title="t" time-dependent="false"/>',
      ),
    );
    expect(wrong).toMatchObject({ code: "assesskit/asi/document-element" });
    expect(wrong.message).toContain("http://www.imsglobal.org/xsd/imsqti_v3p0");
    expect(readIssue(() => readAsi(`<div ${NAMESPACE}/>`))).toMatchObject({ code: "assesskit/asi/document-element" });
  });

  it("namespaces: writes the ASI namespace and the schema location of version 3.0.1", () => {
    expect(writeAsi({ kind: "item", item: itemOf(item()) })).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<qti-assessment-item xmlns="${ASI_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SCHEMA_LOCATION}" identifier="i" title="t" time-dependent="false"/>`,
    );
  });

  it("extension elements and attributes: keeps them where the schema allows them, as XML", () => {
    const { companionMaterials } = itemOf(
      item(
        '<qti-companion-materials-info xmlns:x="urn:x"><qti-physical-material>ruler</qti-physical-material><x:tool x:size="9"/></qti-companion-materials-info>',
      ),
    );
    expect(companionMaterials).toMatchObject({
      physicalMaterials: [{ kind: "physical-material", value: "ruler" }],
      extensionElements: [
        {
          kind: "element",
          namespace: "urn:x",
          prefix: "x",
          name: "tool",
          attributes: [{ namespace: "urn:x", prefix: "x", name: "size", value: "9" }],
          children: [],
        },
      ],
    });
    expect(readIssue(() => readAsi(item('<qti-stylesheet href="a" type="text/css" x="1"/>')))).toMatchObject({
      code: "assesskit/asi/attribute",
    });
  });

  it("ext: terms: accepts an extension term where the schema allows it and nowhere else", () => {
    expect(rubric(' view="candidate" use="ext:peer-review"')).toMatchObject({ use: "ext:peer-review" });
    expect(readIssue(() => rubric(' view="candidate" use="peer-review"'))).toMatchObject({
      code: "assesskit/asi/invalid-value",
    });
    expect(readIssue(() => rubric(' view="candidate" use="ext:"'))).toMatchObject({
      code: "assesskit/asi/invalid-value",
    });
    expect(readIssue(() => rubric(' view="ext:x" use="instructions"'))).toMatchObject({
      code: "assesskit/asi/invalid-value",
    });
  });
});

describe("reading input and errors", () => {
  it("reads text, bytes and a tree alike", () => {
    const xml = item("<qti-item-body><p>é</p></qti-item-body>");
    const fromText = readAsi(xml);
    expect(readAsi(new TextEncoder().encode(xml))).toEqual(fromText);
    expect(readAsi(parseXml(xml))).toEqual(fromText);
  });

  it("ignores the positions and namespace declarations of the tree in the model", () => {
    const read = itemOf(
      item(
        '<qti-item-body><m:math xmlns:m="http://www.w3.org/1998/Math/MathML"><m:mi>x</m:mi></m:math></qti-item-body>',
      ),
    );
    const [math] = read.body?.children ?? [];
    expect(math).toEqual({
      kind: "element",
      namespace: "http://www.w3.org/1998/Math/MathML",
      prefix: "m",
      name: "math",
      attributes: [],
      children: [
        {
          kind: "element",
          namespace: "http://www.w3.org/1998/Math/MathML",
          prefix: "m",
          name: "mi",
          attributes: [],
          children: [{ kind: "text", value: "x" }],
        },
      ],
    });
  });

  it("names the document, the line and the element path of a problem", () => {
    const issue = readIssue(() =>
      readAsi(
        `<qti-assessment-item ${NAMESPACE} identifier="i" title="t" time-dependent="false">\n<qti-response-declaration identifier="R"/></qti-assessment-item>`,
        { path: "items/a.xml" },
      ),
    );
    expect(issue).toEqual({
      severity: "error",
      code: "assesskit/asi/missing-attribute",
      message: "The element qti-response-declaration must have the attribute cardinality.",
      location: { path: "items/a.xml", line: 2, column: 1, element: "qti-assessment-item/qti-response-declaration" },
    });
    const error = thrown(() => readAsi(item("<qti-response-declaration/>"), { path: "a.xml" }));
    expect(error).toBeInstanceOf(ReadError);
    expect((error as ReadError).message).toContain("(line 1, column ");
  });

  it("rejects an attribute the schema does not have, a missing one and a value that is not in its form", () => {
    expect(readIssue(() => readAsi(item('<qti-stylesheet href="a.css" type="text/css" color="red"/>')))).toMatchObject({
      code: "assesskit/asi/attribute",
      message: "The attribute color is not allowed on qti-stylesheet.",
    });
    expect(
      readIssue(() => readAsi(`<qti-assessment-item ${NAMESPACE} title="t" time-dependent="false"/>`)),
    ).toMatchObject({
      code: "assesskit/asi/missing-attribute",
      message: "The element qti-assessment-item must have the attribute identifier.",
    });
    expect(readIssue(() => readAsi(item("", ' adaptive="maybe"')))).toMatchObject({
      code: "assesskit/asi/invalid-value",
      message:
        'The attribute adaptive of qti-assessment-item is invalid: The text "maybe" is not a boolean: expected true, false, 1 or 0.',
    });
  });

  it("rejects an integer attribute that is not a safe integer", () => {
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-item-session-control max-attempts="9007199254740993"/></qti-assessment-section>`,
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/invalid-value" });
  });

  it("rejects an element the type does not contain, and text where only elements go", () => {
    expect(readIssue(() => readAsi(item("<qti-weight identifier='w' value='1'/>")))).toMatchObject({
      code: "assesskit/asi/element",
      message: "The element qti-assessment-item cannot contain qti-weight here.",
    });
    expect(readIssue(() => readAsi(item("text")))).toMatchObject({
      code: "assesskit/asi/text",
      message: "The element qti-assessment-item must not contain text.",
    });
    expect(readIssue(() => readAsi(item('<x:y xmlns:x="urn:x"/>')))).toMatchObject({ code: "assesskit/asi/element" });
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-test ${NAMESPACE} identifier="T" title="t"><xi:include xmlns:xi="${XINCLUDE_NAMESPACE}" href="a.xml"/></qti-assessment-test>`,
        ),
      ),
    ).toMatchObject({ code: "assesskit/asi/element" });
  });

  it("rejects a second child where the schema allows one, and a missing required one", () => {
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-selection select="1"/><qti-selection select="2"/></qti-assessment-section>`,
        ),
      ),
    ).toMatchObject({
      code: "assesskit/asi/element",
      message: "The element qti-assessment-section may have one selection, found 2.",
    });
    expect(
      readIssue(() =>
        readAsi(
          `<qti-response-processing ${NAMESPACE}><qti-response-condition><qti-response-if/></qti-response-condition></qti-response-processing>`,
        ),
      ),
    ).toMatchObject({
      code: "assesskit/asi/missing-element",
      message: "The element qti-response-if must have a condition.",
    });
    expect(readIssue(() => readAsi(`<qti-assessment-stimulus ${NAMESPACE} identifier="s" title="t"/>`))).toMatchObject({
      code: "assesskit/asi/missing-element",
    });
  });

  it("rejects more operands than the operator takes", () => {
    expect(readIssue(() => expressionOf(`<qti-equal>${ONE_XML}${ONE_XML}${ONE_XML}</qti-equal>`))).toMatchObject({
      code: "assesskit/asi/element",
      message: "The element qti-equal may have 2 operands, found 3.",
    });
  });

  it("rejects content in an element that must be empty, and an element in a text", () => {
    expect(readIssue(() => responseRuleOf("<qti-exit-response>x</qti-exit-response>"))).toMatchObject({
      code: "assesskit/asi/text",
    });
    expect(readIssue(() => responseRuleOf("<qti-exit-response><qti-null/></qti-exit-response>"))).toMatchObject({
      code: "assesskit/asi/element",
      message: "The element qti-exit-response must be empty, found qti-null.",
    });
    expect(
      readIssue(() =>
        readAsi(
          item(
            '<qti-response-declaration identifier="R" cardinality="single"><qti-correct-response><qti-value>a<b/></qti-value></qti-correct-response></qti-response-declaration>',
          ),
        ),
      ),
    ).toMatchObject({
      code: "assesskit/asi/element",
      message: "The element qti-value must contain text only, found b.",
    });
  });

  it("reads CDATA as the text of an element with text", () => {
    const declaration = itemOf(
      item(
        '<qti-response-declaration identifier="R" cardinality="single"><qti-correct-response><qti-value><![CDATA[a<b]]></qti-value></qti-correct-response></qti-response-declaration>',
      ),
    ).responseDeclarations[0];
    expect(declaration?.correctResponse?.values[0]?.value).toBe("a<b");
  });

  it("rejects a section that has an adaptive selection and a selection, and one that has an item and an ordering", () => {
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e"/></qti-adaptive-selection><qti-ordering/></qti-assessment-section>`,
        ),
      ),
    ).toMatchObject({
      code: "assesskit/asi/exclusive",
    });
  });

  it("passes the errors of the XML reader on", () => {
    expect(readIssue(() => readAsi("<a>"))).toMatchObject({ code: "assesskit/xml/not-well-formed" });
    expect(() => readAsi('<!DOCTYPE a [<!ENTITY e "x">]><a/>')).toThrow(/DOCTYPE/);
    expect(() => readAsi(item(), { limits: { maxBytes: 10 } })).toThrow(/maxBytes/);
  });

  it("refuses arguments of other types", () => {
    expect(() => readAsi(JSON.parse("5"))).toThrow(
      new DataError("The input must be a string, a Uint8Array or an XmlElement, found 5."),
    );
    expect(() => readAsi(JSON.parse("null"))).toThrow(DataError);
    expect(() => readAsi(JSON.parse('{"kind":"item"}'))).toThrow(DataError);
    expect(() => readAsi(item(), JSON.parse("null"))).toThrow(
      new DataError("The options must be an object, found null."),
    );
    expect(() => readAsi(item(), JSON.parse('{"path":5}'))).toThrow(
      new DataError("The option path must be a string, found 5."),
    );
    expect(() => readAsi(item(), JSON.parse('{"limits":"x"}'))).toThrow(
      new DataError('The option limits must be an object, found "x".'),
    );
    expect(() => readAsi(item(), JSON.parse('{"limits":null}'))).toThrow(DataError);
    expect(() => readAsi(item(), JSON.parse('{"limits":{"maxBytes":"x"}}'))).toThrow(DataError);
  });
});

/** The element of the model that a path of keys leads to. */
function dig(value: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (typeof current === "object" && current !== null ? Reflect.get(current, key) : undefined),
    value,
  );
}

/** Checks the vocabulary of an attribute: every term reads as itself and is written as itself, and other text is refused. */
function checkVocabulary(row: string): void {
  const { element, attribute, property, terms } = vocabularyOf(row);
  const { markup, path } = PLACES[element];
  const body = (text: string) => `<qti-item-body>${markup(` ${attribute}="${text}"`)}</qti-item-body>`;
  for (const term of terms) {
    const read = itemOf(item(body(term)));
    expect(dig(read.body?.children[0], path), term).toMatchObject({ [property]: term });
    expect(writeAsi({ kind: "item", item: read }), term).toContain(`${attribute}="${term}"`);
  }
  for (const text of ["", "x", `${terms[0]}x`, `x${terms[0]}`, ` ${terms[0]?.toUpperCase()}`]) {
    expect(
      readIssue(() => readAsi(item(body(text)))),
      text,
    ).toMatchObject({ code: "assesskit/asi/invalid-value" });
  }
}

describe("vocabularies of the content", () => {
  it("ARIAAutoCompleteEnum: reads 4 terms of aria-autocomplete and refuses any other text", () => {
    checkVocabulary("W1");
  });

  it("ARIACheckedEnum: reads 4 terms of aria-checked and refuses any other text", () => {
    checkVocabulary("W2");
  });

  it("ARIACurrentEnum: reads 8 terms of aria-current and refuses any other text", () => {
    checkVocabulary("W3");
  });

  it("ARIAExpandedEnum: reads 3 terms of aria-expanded and refuses any other text", () => {
    checkVocabulary("W4");
  });

  it("ARIAInvalidEnum: reads 4 terms of aria-invalid and refuses any other text", () => {
    checkVocabulary("W5");
  });

  it("ARIALiveValueEnum: reads 3 terms of aria-live and refuses any other text", () => {
    checkVocabulary("W6");
  });

  it("ARIAOrientationValueEnum: reads 2 terms of aria-orientation and refuses any other text", () => {
    checkVocabulary("W7");
  });

  it("ARIAPressedEnum: reads 4 terms of aria-pressed and refuses any other text", () => {
    checkVocabulary("W8");
  });

  it("ARIARoleValue: reads 74 terms of role and refuses any other text", () => {
    checkVocabulary("W9");
  });

  it("ARIASelectedEnum: reads 3 terms of aria-selected and refuses any other text", () => {
    checkVocabulary("W10");
  });

  it("ARIASortEnum: reads 4 terms of aria-sort and refuses any other text", () => {
    checkVocabulary("W11");
  });

  it("AlignEnum: reads 5 terms of align and refuses any other text", () => {
    checkVocabulary("W12");
  });

  it("CORSSettingsEnum: reads 2 terms of crossorigin and refuses any other text", () => {
    checkVocabulary("W14");
  });

  it("DIR: reads 3 terms of dir and refuses any other text", () => {
    checkVocabulary("W17");
  });

  it("KindValueEnum: reads 5 terms of kind and refuses any other text", () => {
    checkVocabulary("W19");
  });

  it("ParamTypeEnum: reads 2 terms of valuetype and refuses any other text", () => {
    checkVocabulary("W24");
  });

  it("PreLoadValueEnum: reads 3 terms of preload and refuses any other text", () => {
    checkVocabulary("W25");
  });

  it("SuppressTTSEnum: reads 3 terms of data-qti-suppress-tts and refuses any other text", () => {
    checkVocabulary("W34");
  });

  it("TableCellScopeEnum: reads 4 terms of scope and refuses any other text", () => {
    checkVocabulary("W35");
  });

  it("ValignEnum: reads 4 terms of valign and refuses any other text", () => {
    checkVocabulary("W42");
  });
});

describe("vocabularies of the content: lists", () => {
  it("StringList: reads the class as the strings separated by white space and writes them with one space", () => {
    const read = itemOf(
      item('<qti-item-body><div class="  a  b&#9;c&#10;d ">x</div><p class="">y</p></qti-item-body>'),
    );
    expect(read.body?.children).toMatchObject([{ class: ["a", "b", "c", "d"] }, { class: [] }]);
    expect(writeAsi({ kind: "item", item: read })).toContain('<div class="a b c d">');
    expect(writeAsi({ kind: "item", item: read })).toContain('<p class="">');
    expect(() =>
      writeAsi({
        kind: "item",
        item: {
          ...read,
          body: { kind: "item-body", children: [{ kind: "div", class: ["a b"], children: [], extensions: [] }] },
        } as AssessmentItem,
      }),
    ).toThrow(/must be text without white space/);
  });

  it("ARIARelevantList: reads the terms additions, all, removals and text as a list and refuses any other", () => {
    const relevant = (value: string) => bodyOf(`<div aria-relevant="${value}"/>`)[0];
    expect(relevant("additions")).toMatchObject({ ariaRelevant: ["additions"] });
    expect(relevant("all")).toMatchObject({ ariaRelevant: ["all"] });
    expect(relevant("removals text")).toMatchObject({ ariaRelevant: ["removals", "text"] });
    expect(relevant("additions removals text")).toMatchObject({ ariaRelevant: ["additions", "removals", "text"] });
    for (const text of ["bogus", "additions bogus", "ALL"]) {
      expect(
        readIssue(() => readAsi(item(`<qti-item-body><div aria-relevant="${text}"/></qti-item-body>`))),
        text,
      ).toMatchObject({
        code: "assesskit/asi/invalid-value",
      });
    }
  });
});

describe("the nodes of the content", () => {
  const body = (content: string): readonly ModelNode[] =>
    itemOf(item(`<qti-item-body>${content}</qti-item-body>`)).body?.children ?? [];
  const kindsOf = (nodes: readonly ModelNode[]): string[] => nodes.map(({ kind }) => kind);

  it("lists the nodes directly below a node in every place the model keeps them: prompt, choices, content body", () => {
    const [interaction] = body(
      '<qti-choice-interaction response-identifier="R"><qti-prompt>Pick</qti-prompt><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-choice-interaction>',
    );
    expect(interaction && kindsOf(childNodes(interaction))).toEqual(["prompt", "simple-choice", "simple-choice"]);
    const [feedback] = body(
      '<qti-feedback-block outcome-identifier="O" identifier="x" show-hide="show"><qti-content-body><p>x</p></qti-content-body></qti-feedback-block>',
    );
    expect(feedback && kindsOf(childNodes(feedback))).toEqual(["content-body"]);
  });

  it("lists the nodes at any depth in document order, text included, without the node itself", () => {
    const [paragraph] = body("<p>One <em>two <strong>three</strong></em> four</p>");
    expect(paragraph && kindsOf(descendantNodes(paragraph))).toEqual(["text", "em", "text", "strong", "text", "text"]);
    const [text] = body("<p>x</p>").flatMap((node) => childNodes(node));
    expect(text && descendantNodes(text)).toEqual([]);
  });

  it("lists each of some nodes before its descendants, in document order", () => {
    const nodes = body("<p>One <em>two</em></p><p>three</p>");
    expect(kindsOf(withDescendants(nodes))).toEqual(["p", "text", "em", "text", "p", "text"]);
    expect(withDescendants(nodes)).toEqual(nodes.flatMap((node) => [node, ...descendantNodes(node)]));
    expect(withDescendants([])).toEqual([]);
  });

  it("takes MathML as a leaf, because the model keeps it as XML", () => {
    const [paragraph] = body('<p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></p>');
    const [math] = paragraph ? childNodes(paragraph) : [];
    expect(math?.kind).toBe("element");
    expect(math && childNodes(math)).toEqual([]);
    expect(paragraph && kindsOf(descendantNodes(paragraph))).toEqual(["element"]);
  });

  it("does not take the attributes or the lists of strings for nodes", () => {
    const [paragraph] = body('<p class="a b" data-x="1">x</p>');
    expect(paragraph && kindsOf(childNodes(paragraph))).toEqual(["text"]);
  });

  it("tells a node from other values by the string kind", () => {
    expect(isModelNode({ kind: "p" })).toBe(true);
    expect(isBodyNode({ kind: "text", value: "x" })).toBe(true);
    for (const value of [null, undefined, "p", 1, [], { kind: 1 }, { name: "p" }]) {
      expect(isModelNode(value)).toBe(false);
      expect(isBodyNode(value)).toBe(false);
    }
  });
});

describe("the shapes of areas", () => {
  it("takes the number of coordinates that each shape needs: three, four, an even six or more, or any", () => {
    const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];
    const fitting = (shape: AreaShape): number[] => counts.filter((count) => coordinateCountFits(shape, count));
    expect(fitting("circle")).toEqual([3]);
    expect(fitting("rect")).toEqual([4]);
    expect(fitting("ellipse")).toEqual([4]);
    expect(fitting("poly")).toEqual([6, 8, 10]);
    expect(fitting("default")).toEqual(counts);
  });

  it("takes no coordinates for a shape that the information model does not have", () => {
    expect(coordinateCountFits(JSON.parse('"triangle"'), 3)).toBe(false);
  });
});

describe("walking a document", () => {
  const namesOf = (document: AsiDocument): string[] => {
    const names: string[] = [];
    walkDocument(document, ({ name }) => names.push(name));
    return names;
  };

  it("visits the elements of a document in document order, an element before its children, by their element names", () => {
    const document = checked(
      item(
        '<qti-response-declaration identifier="R" cardinality="single" base-type="string"/><qti-item-body><p>a <em>b</em><qti-text-entry-interaction response-identifier="R"/></p></qti-item-body>',
      ),
    );
    expect(namesOf(document)).toEqual([
      "qti-assessment-item",
      "qti-response-declaration",
      "qti-item-body",
      "p",
      "em",
      "qti-text-entry-interaction",
    ]);
  });

  it("tells the HTML label from qti-label, which have the same kind", () => {
    const document = checked(
      item(
        '<qti-item-body><p><label>x</label><qti-inline-choice-interaction response-identifier="R"><qti-label>y</qti-label><qti-inline-choice identifier="A">a</qti-inline-choice></qti-inline-choice-interaction></p></qti-item-body>',
      ),
    );
    const found: string[] = [];
    walkDocument(document, ({ name, model }) => {
      if (model.kind === "label") found.push(name);
    });
    expect(found).toEqual(["label", "qti-label"]);
  });

  it("gives the parent, the model, the attribute definitions and the kind of attribute wildcard of an element", () => {
    const document = checked(item('<qti-item-body><p data-x="1" class="c">a</p></qti-item-body>'));
    const visits: ElementVisit[] = [];
    walkDocument(document, (visit) => visits.push(visit));
    const paragraph = visits.find(({ name }) => name === "p");
    expect(paragraph?.parent?.name).toBe("qti-item-body");
    expect(paragraph?.parent?.parent?.name).toBe("qti-assessment-item");
    expect(paragraph?.parent?.parent?.parent).toBeUndefined();
    expect(paragraph?.model).toMatchObject({ kind: "p", class: ["c"] });
    expect(paragraph?.attributes.map(({ name }) => name)).toContain("class");
    expect(paragraph?.attributeWildcard).toBe("any");
    expect(visits[0]?.attributeWildcard).toBe("any");
    expect(visits.find(({ name }) => name === "qti-item-body")?.attributeWildcard).toBeUndefined();
  });

  it("keeps MathML, SSML and xi:include out of the visits and gives them as the foreign elements of the element that holds them", () => {
    const document = checked(
      item(
        '<qti-item-body><p>a <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></p></qti-item-body>',
      ),
    );
    const visits: ElementVisit[] = [];
    walkDocument(document, (visit) => visits.push(visit));
    expect(visits.map(({ name }) => name)).toEqual(["qti-assessment-item", "qti-item-body", "p"]);
    expect(visits.find(({ name }) => name === "p")?.foreign.map(({ name }) => name)).toEqual(["math"]);
  });

  it("walks every kind of document", () => {
    for (const xml of [
      `<qti-assessment-stimulus ${NAMESPACE} identifier="s" title="t"><qti-stimulus-body><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
      `<qti-assessment-section ${NAMESPACE} identifier="s" title="t" visible="true"/>`.replace(
        "/>",
        '><qti-assessment-item-ref identifier="a" href="a.xml"/></qti-assessment-section>',
      ),
      `<qti-outcome-declaration ${NAMESPACE} identifier="O" cardinality="single" base-type="float"/>`,
      `<qti-outcome-processing ${NAMESPACE}/>`,
      `<qti-response-processing ${NAMESPACE}/>`,
    ]) {
      expect(namesOf(readAsi(xml))[0]).toMatch(/^qti-/);
    }
  });

  it("throws a DataError for a model that is not the shape the schema gives it, naming where", () => {
    const document = checked(item("<qti-item-body><p>a</p></qti-item-body>"));
    if (document.kind !== "item") throw new Error("Expected an item.");
    const withBody = (children: unknown): AsiDocument =>
      JSON.parse(
        JSON.stringify({ kind: "item", item: { ...document.item, body: { ...document.item.body, children } } }),
      );
    expect(() => walkDocument(withBody("x"), () => undefined)).toThrow(
      'The property children of qti-item-body must be an array, found "x". It is in qti-assessment-item/qti-item-body.',
    );
    expect(() => walkDocument(withBody([null]), () => undefined)).toThrow(
      "A member of children of qti-item-body must be an object",
    );
    expect(() => walkDocument(withBody([{ kind: "nope" }]), () => undefined)).toThrow('has the kind "nope"');
    expect(() => walkDocument(JSON.parse("null"), () => undefined)).toThrow("The document must be an object");
    expect(() => walkDocument(JSON.parse('{"kind":"x"}'), () => undefined)).toThrow(DataError);
    expect(() => walkDocument(document, JSON.parse("1"))).toThrow("The visitor must be a function");
  });
});

describe("writing documents", () => {
  it("writes attributes and child elements in the order of the schema, whatever the order of the properties", () => {
    const written = writeAsi({
      kind: "item",
      item: {
        modalFeedback: [],
        stylesheets: [{ kind: "stylesheet", type: "text/css", href: "a.css" }],
        timeDependent: true,
        extensions: [{ namespace: "", name: "data-z", value: "1" }],
        title: "t",
        identifier: "i",
        kind: "assessment-item",
        stimulusRefs: [],
        outcomeDeclarations: [],
        templateDeclarations: [],
        responseDeclarations: [],
        contextDeclarations: [],
      },
    });
    expect(written).toContain(
      'identifier="i" title="t" time-dependent="true" data-z="1"><qti-stylesheet href="a.css" type="text/css"/>',
    );
  });

  it("writes an include and the elements of other namespaces where the type accepts them", () => {
    const include: XmlElement = {
      kind: "element",
      namespace: XINCLUDE_NAMESPACE,
      prefix: "xi",
      name: "include",
      attributes: [{ namespace: "", name: "href", value: "more.xml" }],
      children: [],
    };
    const section = sectionOf("");
    const written = writeAsi({
      kind: "section",
      section: {
        ...section,
        children: [include],
        ordering: { kind: "ordering", extensions: [], extensionElements: [foreignElement("hint")] },
      },
    });
    expect(written).toContain('<xi:include href="more.xml" xmlns:xi="http://www.w3.org/2001/XInclude"/>');
    expect(written).toContain('<qti-ordering><x:hint xmlns:x="urn:x"/></qti-ordering>');
  });

  it("writes a text and leaves an empty one without a text node", () => {
    const item = itemOf(
      '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="t" time-dependent="false"><qti-response-declaration identifier="R" cardinality="single"><qti-default-value><qti-value/></qti-default-value></qti-response-declaration></qti-assessment-item>',
    );
    expect(writeAsi({ kind: "item", item })).toContain("<qti-value/>");
  });

  it("writes the same text for the model that it reads back", () => {
    const xml = writeAsi({
      kind: "item",
      item: itemOf(item('<qti-item-body id="b"><p>a &amp; b</p></qti-item-body>')),
    });
    expect(writeAsi(readAsi(xml))).toBe(xml);
  });

  const valid = (): AssessmentItem => itemOf(item());
  const write = (model: unknown) => writeAsi({ kind: "item", item: model as AssessmentItem });

  it("refuses a document of another kind or of other types", () => {
    expect(() => writeAsi(JSON.parse("null"))).toThrow(new DataError("The document must be an object, found null."));
    expect(() => writeAsi(JSON.parse('{"kind":"page"}'))).toThrow(
      /The kind of a document must be one of "item", "section", "stimulus", "test", "outcome-declaration", "outcome-processing", "response-processing", found "page"\./,
    );
    expect(() => writeAsi(JSON.parse("{}"))).toThrow(DataError);
    expect(() => writeAsi(JSON.parse('{"kind":"item"}'))).toThrow(
      new DataError(
        "The model of qti-assessment-item must be an object, found undefined. It is in qti-assessment-item.",
      ),
    );
  });

  it("refuses a model that is not the model of the element", () => {
    expect(() => write({ ...valid(), kind: "assessment-test" })).toThrow(
      new DataError(
        'The kind of qti-assessment-item must be "assessment-item", found "assessment-test". It is in qti-assessment-item.',
      ),
    );
    expect(() => write({ ...valid(), color: "red" })).toThrow(
      new DataError('The property "color" does not belong to qti-assessment-item. It is in qti-assessment-item.'),
    );
    expect(() => write({ ...valid(), identifier: undefined })).toThrow(
      new DataError("The property identifier of qti-assessment-item is required. It is in qti-assessment-item."),
    );
    expect(() => write({ ...valid(), title: 5 })).toThrow(
      new DataError(
        "The property title of qti-assessment-item is invalid: A value must be a string, found 5. It is in qti-assessment-item.",
      ),
    );
    expect(() => write({ ...valid(), adaptive: "yes" })).toThrow(DataError);
  });

  it("refuses lists and members that are not the model", () => {
    expect(() => write({ ...valid(), stylesheets: {} })).toThrow(
      new DataError(
        "The property stylesheets of qti-assessment-item must be an array, found an object. It is in qti-assessment-item.",
      ),
    );
    expect(() => write({ ...valid(), stylesheets: [null] })).toThrow(DataError);
    expect(() => write({ ...valid(), stylesheets: [{ kind: "weight" }] })).toThrow(
      /A member of stylesheets of qti-assessment-item must have the kind "stylesheet", found "weight"/,
    );
    expect(() => write({ ...valid(), extensions: "x" })).toThrow(DataError);
    expect(() => write({ ...valid(), extensions: [{ name: "a" }] })).toThrow(
      /An extension attribute of qti-assessment-item must have a namespace, name and value/,
    );
    expect(() => write({ ...valid(), extensions: undefined })).toThrow(DataError);
  });

  it("refuses more members than a slot takes, a missing required one and a clash", () => {
    const section = sectionOf("");
    const selection = { kind: "selection", select: 1, extensions: [], extensionElements: [] };
    const writeSection = (model: unknown) => writeAsi({ kind: "section", section: model as AssessmentSection });
    expect(() =>
      writeSection({
        ...section,
        selection,
        ordering: { kind: "ordering", extensions: [], extensionElements: [] },
        adaptiveSelection: {
          kind: "adaptive-selection",
          adaptiveEngineRef: { kind: "adaptive-engine-ref", identifier: "E", href: "e" },
        },
      }),
    ).toThrow(/The element qti-assessment-section cannot have both/);
    expect(() => writeSection({ ...section, adaptiveSelection: { kind: "adaptive-selection" } })).toThrow(
      /The property adaptiveEngineRef of qti-adaptive-selection is required/,
    );
    const equal = { kind: "equal", operands: [ONE, ONE, ONE] };
    const rules = [
      {
        kind: "response-condition",
        responseIf: { kind: "response-if", condition: equal, rules: [] },
        responseElseIfs: [],
      },
    ];
    expect(() =>
      writeAsi({
        kind: "response-processing",
        processing: { kind: "response-processing", rules } as ResponseProcessing,
      }),
    ).toThrow(/The property operands of qti-equal may have 2 members, found 3/);
  });

  it("refuses an include where the type has none, and an element that is no include or no foreign element", () => {
    const section = sectionOf("");
    const test = testOf(`${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`);
    const include = { kind: "element", namespace: XINCLUDE_NAMESPACE, name: "include", attributes: [], children: [] };
    expect(() =>
      writeAsi({ kind: "test", test: { ...test, testParts: [include] } as unknown as AssessmentTest }),
    ).toThrow(/The property testParts of qti-assessment-test does not accept xi:include/);
    expect(() =>
      writeAsi({ kind: "section", section: { ...section, rubricBlocks: [include] } as unknown as AssessmentSection }),
    ).toThrow(/The property rubricBlocks of qti-assessment-section does not accept xi:include/);
    expect(() =>
      writeAsi({
        kind: "section",
        section: {
          ...section,
          ordering: {
            kind: "ordering",
            extensions: [],
            extensionElements: [{ ...foreignElement("a"), namespace: ASI_NAMESPACE }],
          },
        } as AssessmentSection,
      }),
    ).toThrow(/must be an element of another namespace/);
    expect(() =>
      writeAsi({
        kind: "section",
        section: {
          ...section,
          ordering: { kind: "ordering", extensions: [{ namespace: "", name: "a", value: "b" }], extensionElements: [] },
        } as AssessmentSection,
      }),
    ).toThrow(
      new DataError(
        "The extension attribute a of qti-ordering must be in a namespace. It is in qti-assessment-section/qti-ordering.",
      ),
    );
  });

  it("refuses content that is no node, and a text element without its value", () => {
    const body = { kind: "item-body", children: ["x"] };
    expect(() => write({ ...valid(), body })).toThrow(
      /A member of children of qti-item-body must be an object, found "x"/,
    );
    expect(() => write({ ...valid(), body: { kind: "item-body", children: {} } })).toThrow(DataError);
    expect(() =>
      write({
        ...valid(),
        responseDeclarations: [
          {
            kind: "response-declaration",
            identifier: "R",
            cardinality: "single",
            defaultValue: { kind: "default-value", values: [{ kind: "value" }] },
          },
        ],
      }),
    ).toThrow(/The property value of qti-value is required/);
  });

  it("refuses a member of the content that is null or has no kind, and a text without a string", () => {
    const withChildren = (children: unknown[]) => write({ ...valid(), body: { kind: "item-body", children } });
    expect(() => withChildren([JSON.parse("null")])).toThrow(
      new DataError(
        "A member of children of qti-item-body must be an object, found null. It is in qti-assessment-item/qti-item-body.",
      ),
    );
    expect(() => withChildren([JSON.parse("{}")])).toThrow(/must have the kind "rubric-block"/);
    expect(() => withChildren([{ kind: "p", children: [JSON.parse('{"kind":"text"}')], extensions: [] }])).toThrow(
      /The value of a text in children of p must be a string, found undefined/,
    );
    expect(() => withChildren([{ kind: "p", children: [{ kind: "text", value: "a" }] }])).toThrow(
      /The property extensions of p must be an array/,
    );
  });

  it("writes the elements of the ASI namespace among the extension elements of a custom interaction, which takes any namespace", () => {
    const paragraph = { kind: "element", namespace: ASI_NAMESPACE, name: "p", attributes: [], children: [] };
    const interaction = {
      kind: "custom-interaction",
      responseIdentifier: "R",
      extensions: [],
      extensionElements: [paragraph, foreignElement("a")],
    };
    const written = write({ ...valid(), body: { kind: "item-body", children: [interaction] } });
    expect(written).toContain("<qti-custom-interaction");
    expect(written).toContain("<p/>");
    expect(readAsi(written)).toMatchObject({
      item: { body: { children: [{ kind: "custom-interaction", extensionElements: [{ name: "p" }, { name: "a" }] }] } },
    });
  });

  it("leaves the validity of names and characters to the XML writer", () => {
    expect(() => write({ ...valid(), title: "a\u0001b" })).toThrow(/character U\+0001/);
  });
});

describe("the element table", () => {
  const types = Object.entries<TypeDef>(ELEMENT_TYPES);
  it("has no element twice in the list of expressions", () => {
    const expressions = EXPRESSION.map(({ element }) => element);
    expect(new Set(expressions).size).toBe(expressions.length);
  });

  it("gives the elements of a slot kinds of their own, so that a member tells which element it is", () => {
    for (const [name, type] of types) {
      if (type.content.kind !== "slots") continue;
      for (const slot of type.content.slots) {
        const kinds = slot.accepts.map(({ element }) => kindOf(element));
        expect(new Set(kinds).size, `${name} ${slot.property}`).toBe(kinds.length);
        expect(kinds, `${name} ${slot.property}`).not.toContain("text");
        expect(kinds, `${name} ${slot.property}`).not.toContain("element");
      }
    }
  });

  it("has the seven documents of the schema", () => {
    expect(Object.keys(DOCUMENT_ELEMENTS).sort()).toEqual([
      "qti-assessment-item",
      "qti-assessment-section",
      "qti-assessment-stimulus",
      "qti-assessment-test",
      "qti-outcome-declaration",
      "qti-outcome-processing",
      "qti-response-processing",
    ]);
  });

  it("holds flow content in the property children, with text only where the schema mixes it", () => {
    const flow = types.flatMap(([name, type]) =>
      type.content.kind === "slots"
        ? type.content.slots
            .filter((slot) => slot.text === true || slot.foreign !== undefined)
            .map((slot) => ({ name, slot }))
        : [],
    );
    expect(flow.length).toBeGreaterThan(40);
    for (const { name, slot } of flow) {
      expect(slot.property, name).toBe("children");
      expect(slot.max, name).toBe("unbounded");
    }
    for (const [name, type] of types) {
      if (type.content.kind !== "slots") continue;
      const takesText = type.content.slots.filter((slot) => slot.text === true);
      if (takesText.length > 0) expect(type.content.slots, name).toEqual(takesText);
    }
  });

  it("refers to types it has, and every type is used", () => {
    const used = new Set([
      ...Object.values(DOCUMENT_ELEMENTS),
      ...types.flatMap(([, type]) =>
        type.content.kind === "slots"
          ? type.content.slots.flatMap(({ accepts }) => accepts.map(({ type: name }) => name))
          : [],
      ),
    ]);
    expect([...used].filter((name) => !(name in ELEMENT_TYPES))).toEqual([]);
    expect(types.map(([name]) => name).filter((name) => !used.has(name))).toEqual([]);
  });

  it("gives every attribute and slot of a type its own property", () => {
    for (const [name, type] of types) {
      const properties = [
        ...type.attributes.map(({ property }) => property),
        ...(type.content.kind === "slots" ? type.content.slots.map(({ property }) => property) : []),
      ];
      expect(new Set(properties).size, name).toBe(properties.length);
      expect(properties, name).not.toContain("kind");
    }
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/asi.md", import.meta.url);
    const asi = await import("../src/asi/index.js");
    expect(await runGuideSamples(guide, { "@assesskit/runtime/asi": asi })).toBeGreaterThan(0);
  });

  it("shows the results that the samples of the conventions give", async () => {
    const guide = new URL("../../../docs/runtime/conventions.md", import.meta.url);
    const asi = await import("../src/asi/index.js");
    expect(await runGuideSamples(guide, { "@assesskit/runtime/asi": asi })).toBe(5);
  });
});

describe("properties", () => {
  /** Every element of the schema with the type that gives its model: the documents and what the slots accept. */
  const elements = new Map<string, { readonly type: string; readonly element: string }>(
    Object.entries(DOCUMENT_ELEMENTS).map(([element, type]) => [`${element} ${type}`, { type, element }]),
  );
  for (const [, type] of Object.entries<TypeDef>(ELEMENT_TYPES)) {
    if (type.content.kind !== "slots") continue;
    for (const slot of type.content.slots)
      for (const { element, type: name } of slot.accepts) elements.set(`${element} ${name}`, { type: name, element });
  }

  it("reads every element of the schema back to the model it was written from, in the type that models it", () => {
    expect(new Set([...elements.values()].map(({ type }) => type))).toEqual(new Set(Object.keys(ELEMENT_TYPES)));
    for (const { type, element } of elements.values()) {
      const info = typeNamed(type);
      fc.assert(
        fc.property(modelArbitrary(type, element), (model) => {
          const written = parseXml(serializeXml(writeElement(info, element, model)));
          expect(readElement(info, written, { path: undefined, trail: [] })).toEqual(model);
        }),
        { numRuns: 10 },
      );
    }
  }, 120_000);

  it("reads every kind of document back to the model it was written from", () => {
    for (const [kind, arbitrary] of DOCUMENT_ARBITRARIES) {
      fc.assert(
        fc.property(arbitrary, (document) => {
          const written = writeAsi(document);
          expect(readAsi(written), kind).toEqual(document);
          expect(writeAsi(readAsi(written)), kind).toBe(written);
        }),
        { numRuns: 100 },
      );
    }
  }, 60_000);

  it("reads the text of a paragraph back as one text node, whatever its characters", () => {
    const characters = fc.constantFrom(..."ab 19<>&\"'-é日😀\t\n");
    fc.assert(
      fc.property(fc.string({ unit: characters, minLength: 1, maxLength: 20 }), (text) => {
        const document: AsiDocument = {
          kind: "item",
          item: {
            ...itemOf(item()),
            body: {
              kind: "item-body",
              children: [{ kind: "p", children: [{ kind: "text", value: text }], extensions: [] }],
            },
          },
        };
        expect(readAsi(writeAsi(document))).toEqual(document);
      }),
    );
  });

  it("refuse any text that is not a term of the vocabulary", () => {
    for (const { element, attribute, terms } of VOCABULARIES) {
      const { markup } = PLACES[element];
      fc.assert(
        fc.property(
          fc.stringMatching(/^[a-zA-Z0-9 -]{0,12}$/).filter((text) => !terms.includes(text)),
          (text) => {
            const body = `<qti-item-body>${markup(` ${attribute}="${text}"`)}</qti-item-body>`;
            expect(
              readIssue(() => readAsi(item(body))),
              attribute,
            ).toMatchObject({ code: "assesskit/asi/invalid-value" });
          },
        ),
        { numRuns: 30 },
      );
    }
  });

  it("reads a mutated document into a model or refuses it with a ReadError or a SecurityError", () => {
    fuzzReader(
      fc.constantFrom(...DOCUMENT_ARBITRARIES.values()).chain((arbitrary) => arbitrary.map(writeAsi)),
      readAsi,
    );
  });

  it("reads back any scoring rubric that the builder writes, in an item and in a test, through the XML", () => {
    fc.assert(
      fc.property(SCORING_RUBRICS, (rubric) => {
        const block = scoringRubricBlock(rubric);
        const inItem: AssessmentItem = { ...itemOf(item()), body: { kind: "item-body", children: [block] } };
        const inTest: AssessmentTest = { ...testModel(), rubricBlocks: [block] };
        expect(() => checkScoringRubric(rubric)).not.toThrow();
        for (const document of [
          { kind: "item", item: inItem },
          { kind: "test", test: inTest },
        ] as const) {
          const again = readAsi(writeAsi(document));
          const found = again.kind === "item" ? again.item : again.kind === "test" ? again.test : undefined;
          expect(found && readScoringRubrics(found).get(rubric.outcomeIdentifier)).toEqual(rubric);
        }
      }),
    );
  });

  it("scores any complete ratings between the lowest and the highest sum, whatever their order, and gives null for less", () => {
    const rated = SCORING_RUBRICS.chain((rubric) =>
      fc
        .tuple(...rubric.criteria.map(({ levels }) => fc.constantFrom(...levels.map(({ score }) => score))))
        .chain((scores) => {
          const ratings = rubric.criteria.map(({ identifier }, index) => ({
            criterion: identifier,
            score: scores[index] ?? 0,
          }));
          return fc.tuple(
            fc.constant(rubric),
            fc.shuffledSubarray(ratings, { minLength: ratings.length, maxLength: ratings.length }),
            fc.integer({ min: 0, max: ratings.length - 1 }),
          );
        }),
    );
    fc.assert(
      fc.property(rated, ([rubric, ratings, omitted]) => {
        const score = scoreFromRatings(rubric, ratings);
        const lowest = rubric.criteria.reduce(
          (sum, { weight, levels }) => sum + weight * Math.min(...levels.map((level) => level.score)),
          0,
        );
        const highest = rubric.criteria.reduce(
          (sum, { weight, levels }) => sum + weight * Math.max(...levels.map((level) => level.score)),
          0,
        );
        expect(score).not.toBeNull();
        expect(score).toBeGreaterThanOrEqual(lowest);
        expect(score).toBeLessThanOrEqual(highest);
        expect(
          scoreFromRatings(
            rubric,
            ratings.toSorted((first, second) => first.criterion.localeCompare(second.criterion)),
          ),
        ).toBe(score);
        expect(
          scoreFromRatings(
            rubric,
            ratings.filter((_, index) => index !== omitted),
          ),
        ).toBeNull();
        expect(scoreRange(rubric)).toEqual({ minimum: lowest, maximum: highest });
      }),
    );
  });

  it("reads a mutated document with a scoring rubric into the rubrics or refuses it with a ReadError or a SecurityError", () => {
    const documents = SCORING_RUBRICS.map((rubric) => {
      const block = scoringRubricBlock(rubric);
      return writeAsi({ kind: "item", item: { ...itemOf(item()), body: { kind: "item-body", children: [block] } } });
    });
    fuzzReader(documents, (input) => {
      const document = readAsi(input);
      return document.kind === "item" ? readScoringRubrics(document.item) : undefined;
    });
  });
});
