import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatAttributeValue, parseAttributeValue } from "../src/asi/attribute-value.js";
import { DOCUMENT_ELEMENTS, ELEMENT_TYPES, EXPRESSION } from "../src/asi/element-table.js";
import { readElement } from "../src/asi/read.js";
import type { TypeDef } from "../src/asi/table.js";
import { typeNamed } from "../src/asi/type-index.js";
import { writeElement } from "../src/asi/write.js";
import {
  ASI_NAMESPACE,
  type AsiDocument,
  type AssessmentItem,
  type AssessmentSection,
  type AssessmentStimulus,
  type AssessmentTest,
  DataError,
  type Expression,
  type OutcomeDeclaration,
  type OutcomeProcessing,
  type OutcomeRule,
  parseXml,
  ReadError,
  type ResponseProcessing,
  type ResponseRule,
  readAsi,
  readScoreCovers,
  type ScoreCover,
  SecurityError,
  scoreCoversBlock,
  serializeXml,
  type TemplateRule,
  writeAsi,
  XINCLUDE_NAMESPACE,
  type XmlElement,
} from "../src/index.js";
import { DOCUMENT_ARBITRARIES, modelArbitrary } from "./asi-arbitraries.js";
import { inventoryElements } from "./asi-elements.js";

const NAMESPACE = `xmlns="${ASI_NAMESPACE}"`;
const SCHEMA_LOCATION =
  "http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd";
const SCHEMA = "imsqti_asiv3p0p1_v1p0.xsd";

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

describe("parseAttributeValue and formatAttributeValue", () => {
  const boolean = { kind: "boolean" } as const;
  const integer = { kind: "integer" } as const;
  const double = { kind: "double" } as const;
  const tolerance = { kind: "reference", value: "double" } as const;
  const count = { kind: "reference", value: "integer" } as const;
  const mode = { kind: "enum", terms: ["a", "b"] } as const;
  const use = { kind: "enum", terms: ["a"], extension: true } as const;

  it("[A12] reads booleans in the lexical forms of xs:boolean and writes true and false", () => {
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

  it("[A12] reads integers within the safe range and refuses the others", () => {
    expect(parseAttributeValue(integer, " -42 ")).toBe(-42);
    expect(() => parseAttributeValue(integer, "1.5")).toThrow(DataError);
    expect(() => parseAttributeValue(integer, "9007199254740993")).toThrow(DataError);
    expect(formatAttributeValue(integer, 7)).toBe("7");
    expect(() => formatAttributeValue(integer, 1.5)).toThrow(DataError);
    expect(() => formatAttributeValue(integer, "7")).toThrow(new DataError('A value must be a number, found "7".'));
  });

  it("[A18] reads doubles with INF, -INF and NaN and writes them back", () => {
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

  it("[A68] reads a reference to a variable where an integer can be, and writes either", () => {
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

  it("[A79] reads a reference to a variable where a double can be: INF and NaN are numbers", () => {
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

  it("[S5] reads the terms of an enumeration and refuses any other, naming the terms", () => {
    expect(parseAttributeValue(mode, "a")).toBe("a");
    expect(() => parseAttributeValue(mode, "c")).toThrow(new DataError('The text "c" is not one of "a", "b".'));
    expect(() => formatAttributeValue(mode, "c")).toThrow(DataError);
    expect(() => formatAttributeValue(mode, 1)).toThrow(new DataError("A value must be a string, found 1."));
  });

  it("[S15] reads an ext: term where the vocabulary can be extended", () => {
    expect(parseAttributeValue(use, "ext:peer")).toBe("ext:peer");
    expect(() => parseAttributeValue(use, "ext:")).toThrow(
      new DataError('The text "ext:" is not one of "a" or an ext: term.'),
    );
    expect(() => parseAttributeValue(mode, "ext:peer")).toThrow(DataError);
  });

  it("[S2] reads a list by white space and writes one space, refusing an item that has white space", () => {
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

  it("[A79] reads a list of references", () => {
    const list = { kind: "list", item: tolerance } as const;
    expect(parseAttributeValue(list, "0.5 T")).toEqual([0.5, "T"]);
    expect(formatAttributeValue(list, [0.5, "T"])).toBe("0.5 T");
  });

  it("[S1] keeps a string as written", () => {
    expect(parseAttributeValue({ kind: "string" }, "  a  b ")).toBe("  a  b ");
    expect(() => formatAttributeValue({ kind: "string" }, null)).toThrow(
      new DataError("A value must be a string, found null."),
    );
  });
});

describe("scoreCoversBlock and readScoreCovers", () => {
  /** The example of the convention: the markup of design §4.16, one rubric block that covers two responses. */
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
      kind: "element",
      namespace: ASI_NAMESPACE,
      name: "p",
      attributes: [],
      children: [{ kind: "text", value: "Rate content once, across both writing tasks." }],
    },
  ] satisfies XmlElement[];

  it("[O1] reads the covers of the example block in document order, with the labels as text", () => {
    const read = checked(testWith(coversBlock));
    if (read.kind !== "test") throw new Error("Expected a test.");
    expect(readScoreCovers(read.test)).toEqual(new Map([["CONTENT", covers]]));
  });

  it("[O1] builds the block that reading the example gives, and writes it before the first test part", () => {
    const read = checked(testWith(coversBlock));
    if (read.kind !== "test") throw new Error("Expected a test.");
    const block = scoreCoversBlock("CONTENT", covers, notes);
    expect(block).toEqual(read.test.rubricBlocks[0]);
    const written = writeAsi({ kind: "test", test: { ...testModel(), rubricBlocks: [block] } });
    expect(written.indexOf("<qti-rubric-block")).toBeLessThan(written.indexOf("<qti-test-part"));
  });

  it("[O2] keeps the block as an ordinary rubric block of the test, with covers derived and not copied", () => {
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

  it("[O2] reads the covers by outcome, from the test level only, and skips what is not a cover", () => {
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

  it("[O2] gives no covers for a test without covers blocks", () => {
    const read = checked(testWith(""));
    if (read.kind !== "test") throw new Error("Expected a test.");
    expect(readScoreCovers(read.test).size).toBe(0);
  });

  it("[O3] builds a block that a round trip keeps unchanged", () => {
    const block = scoreCoversBlock("CONTENT", covers, notes);
    const document: AsiDocument = { kind: "test", test: { ...testModel(), rubricBlocks: [block] } };
    const again = readAsi(writeAsi(document));
    expect(again).toEqual(document);
    if (again.kind !== "test") throw new Error("Expected a test.");
    expect(readScoreCovers(again.test)).toEqual(new Map([["CONTENT", covers]]));
  });

  it("[O3] writes the white space of a label normalized and leaves a block without notes with the list only", () => {
    const block = scoreCoversBlock("O", [{ itemRef: "Q", responseIdentifier: "R", label: " a \n b " }]);
    expect(block.contentBody.children).toEqual([
      {
        kind: "element",
        namespace: ASI_NAMESPACE,
        name: "ul",
        attributes: [],
        children: [
          {
            kind: "element",
            namespace: ASI_NAMESPACE,
            name: "li",
            attributes: [
              { namespace: "", name: "data-item-ref", value: "Q" },
              { namespace: "", name: "data-response-identifier", value: "R" },
            ],
            children: [{ kind: "text", value: "a b" }],
          },
        ],
      },
    ]);
  });

  it("[O3] refuses what is not an identifier, a list of covers or a list of notes", () => {
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

  it("[O2] refuses a test whose rubric blocks are not the model", () => {
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

describe("readAsi: documents", () => {
  it("[A1] qti-assessment-item: reads every attribute and leaves the omitted ones omitted", () => {
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

  it("[A2] qti-assessment-stimulus: reads the body and the attributes", () => {
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

  it("[A3] qti-assessment-stimulus-ref: reads the identifier, the href and the title", () => {
    const { stimulusRefs } = itemOf(
      item('<qti-assessment-stimulus-ref identifier="st" href="passages/a.xml" title="A"/>'),
    );
    expect(stimulusRefs).toEqual([
      { kind: "assessment-stimulus-ref", identifier: "st", href: "passages/a.xml", title: "A", extensions: [] },
    ]);
  });

  it("[A4] qti-item-body: keeps the content as XML nodes", () => {
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
          kind: "element",
          namespace: ASI_NAMESPACE,
          name: "p",
          attributes: [],
          children: [
            { kind: "text", value: "One " },
            {
              kind: "element",
              namespace: ASI_NAMESPACE,
              name: "b",
              attributes: [],
              children: [{ kind: "text", value: "two" }],
            },
          ],
        },
        { kind: "comment", value: "note" },
      ],
    });
  });

  it("[A5] qti-stimulus-body: keeps the content as XML nodes", () => {
    const { body } = stimulusOf(
      `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t"><qti-stimulus-body xml:lang="en"><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    expect(body).toMatchObject({ kind: "stimulus-body", language: "en", children: [{ kind: "element", name: "p" }] });
  });

  it("[A6] qti-stylesheet: reads the href, the type, the media and the title", () => {
    const { stylesheets } = itemOf(item('<qti-stylesheet href="a.css" type="text/css" media="print" title="Print"/>'));
    expect(stylesheets).toEqual([
      { kind: "stylesheet", href: "a.css", type: "text/css", media: "print", title: "Print" },
    ]);
  });
});

describe("readAsi: test structure", () => {
  it("[A7] qti-assessment-item-ref: reads the attributes and the children in schema order", () => {
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

  it("[A8] qti-assessment-section: reads sections, references and includes in document order", () => {
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

  it("[A9] qti-assessment-section-ref: reads the identifier, the class and the href", () => {
    const part = partOf('<qti-assessment-section-ref identifier="r" href="sections/r.xml" class="a b"/>');
    expect(part.sections).toEqual([
      { kind: "assessment-section-ref", identifier: "r", href: "sections/r.xml", class: ["a", "b"], extensions: [] },
    ]);
  });

  it("[A10] qti-assessment-test: reads the parts, the declarations and the outcome processing", () => {
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

  it("[A11] qti-branch-rule: reads the target and the condition", () => {
    const part = partOf(
      `<qti-branch-rule target="EXIT_TEST">${RESPONSE_XML}</qti-branch-rule><qti-assessment-section-ref identifier="s" href="s.xml"/>`,
    );
    expect(part.branchRules).toEqual([{ kind: "branch-rule", target: "EXIT_TEST", expression: RESPONSE }]);
  });

  it("[A12] qti-item-session-control: reads the numbers and booleans and leaves the defaults out", () => {
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

  it("[A13] qti-ordering: reads shuffle and keeps attributes and elements of other namespaces", () => {
    const section = sectionOf('<qti-ordering shuffle="true" xmlns:x="urn:x" x:seed="7"><x:hint/></qti-ordering>');
    expect(section.ordering).toEqual({
      kind: "ordering",
      shuffle: true,
      extensions: [{ namespace: "urn:x", prefix: "x", name: "seed", value: "7" }],
      extensionElements: [foreignElement("hint")],
    });
  });

  it("[A14] qti-pre-condition: reads the expression as its operand", () => {
    const section = sectionOf(`<qti-pre-condition>${RESPONSE_XML}</qti-pre-condition>`);
    expect(section.preConditions).toEqual([{ kind: "pre-condition", operand: RESPONSE }]);
  });

  it("[A15] qti-selection: reads select and with-replacement", () => {
    const section = sectionOf('<qti-selection select="2" with-replacement="true"/>');
    expect(section.selection).toEqual({
      kind: "selection",
      select: 2,
      withReplacement: true,
      extensions: [],
      extensionElements: [],
    });
  });

  it("[A16] qti-template-default: reads the template identifier and the expression", () => {
    const section = sectionOf(
      `<qti-assessment-item-ref identifier="a" href="a.xml"><qti-template-default template-identifier="N">${ONE_XML}</qti-template-default></qti-assessment-item-ref>`,
    );
    expect(section.children[0]).toMatchObject({ templateDefaults: [{ templateIdentifier: "N", expression: ONE }] });
  });

  it("[A17] qti-test-part: reads the modes, the rubric blocks and the sections", () => {
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

  it("[A18] qti-time-limits: reads the limits as numbers and the late submission flag", () => {
    const part = partOf(
      '<qti-time-limits min-time="1.5" max-time="3600" allow-late-submission="true"/><qti-assessment-section-ref identifier="s" href="s.xml"/>',
    );
    expect(part.timeLimits).toEqual({ kind: "time-limits", minTime: 1.5, maxTime: 3600, allowLateSubmission: true });
  });

  it("[A19] qti-variable-mapping: reads the source and the target", () => {
    const section = sectionOf(
      '<qti-assessment-item-ref identifier="a" href="a.xml"><qti-variable-mapping source-identifier="SCORE" target-identifier="Q1_SCORE"/></qti-assessment-item-ref>',
    );
    expect(section.children[0]).toMatchObject({
      variableMappings: [{ kind: "variable-mapping", sourceIdentifier: "SCORE", targetIdentifier: "Q1_SCORE" }],
    });
  });

  it("[A20] qti-weight: reads the identifier and the value as a number", () => {
    const section = sectionOf(
      '<qti-assessment-item-ref identifier="a" href="a.xml"><qti-weight identifier="W1" value="0.5"/></qti-assessment-item-ref>',
    );
    expect(section.children[0]).toMatchObject({ weights: [{ kind: "weight", identifier: "W1", value: 0.5 }] });
  });

  it("[A21] qti-adaptive-engine-ref: reads the identifier and the href", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="engine.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection?.adaptiveEngineRef).toEqual({
      kind: "adaptive-engine-ref",
      identifier: "E",
      href: "engine.json",
    });
  });

  it("[A22] qti-adaptive-selection: excludes selection and ordering in the same section", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection).toMatchObject({ kind: "adaptive-selection" });
    const issue = readIssue(() =>
      readAsi(
        `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/></qti-adaptive-selection><qti-selection select="1"/></qti-assessment-section>`,
      ),
    );
    expect(issue).toMatchObject({ code: "olah/asi/exclusive", source: SCHEMA });
  });

  it("[A23] qti-adaptive-settings-ref: reads the identifier and the href", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/><qti-adaptive-settings-ref identifier="S" href="settings.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection?.adaptiveSettingsRef).toEqual({
      kind: "adaptive-settings-ref",
      identifier: "S",
      href: "settings.json",
    });
  });

  it("[A24] qti-metadata-ref: reads the identifier and the href", () => {
    const section = sectionOf(
      '<qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e.json"/><qti-metadata-ref identifier="M" href="metadata.json"/></qti-adaptive-selection>',
    );
    expect(section.adaptiveSelection?.metadataRef).toEqual({
      kind: "metadata-ref",
      identifier: "M",
      href: "metadata.json",
    });
  });

  it("[A25] qti-usagedata-ref: reads the identifier and the href", () => {
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

describe("readAsi: declarations", () => {
  const response = (content: string, attributes = 'cardinality="single" base-type="string"') =>
    itemOf(item(`<qti-response-declaration identifier="R" ${attributes}>${content}</qti-response-declaration>`))
      .responseDeclarations[0];

  it("[A26] qti-area-map-entry: reads the shape, the coordinates and the mapped value", () => {
    const declaration = response(
      '<qti-area-mapping><qti-area-map-entry shape="circle" coords="10,20,5" mapped-value="2"/></qti-area-mapping>',
      'cardinality="multiple" base-type="point"',
    );
    expect(declaration?.areaMapping?.areaMapEntries).toEqual([
      { kind: "area-map-entry", shape: "circle", coords: "10,20,5", mappedValue: 2 },
    ]);
  });

  it("[A27] qti-area-mapping: reads the bounds and the default as numbers", () => {
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

  it("[A28] qti-context-declaration: reads the identifier, the cardinality and the default value", () => {
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

  it("[A29] qti-correct-response: reads the interpretation and the values in order", () => {
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

  it("[A30] qti-default-value: reads the interpretation and the values", () => {
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

  it("[A31] qti-interpolation-table: reads the default and the entries in order", () => {
    const table = outcome(
      '<qti-interpolation-table default-value="F"><qti-interpolation-table-entry source-value="50" target-value="D"/><qti-interpolation-table-entry source-value="80" target-value="A"/></qti-interpolation-table>',
    ).lookupTable;
    expect(table).toMatchObject({ kind: "interpolation-table", defaultValue: "F" });
    expect(
      table?.kind === "interpolation-table" && table.interpolationTableEntries.map((entry) => entry.sourceValue),
    ).toEqual([50, 80]);
  });

  it("[A32] qti-interpolation-table-entry: reads include-boundary as a boolean and leaves its default out", () => {
    const table = outcome(
      '<qti-interpolation-table><qti-interpolation-table-entry source-value="1.5" include-boundary="false" target-value="B"/><qti-interpolation-table-entry source-value="2" target-value="A"/></qti-interpolation-table>',
    ).lookupTable;
    if (table?.kind !== "interpolation-table") throw new Error("Expected an interpolation table.");
    expect(table.interpolationTableEntries).toEqual([
      { kind: "interpolation-table-entry", sourceValue: 1.5, includeBoundary: false, targetValue: "B" },
      { kind: "interpolation-table-entry", sourceValue: 2, targetValue: "A" },
    ]);
  });

  it("[A33] qti-map-entry: reads the key, the value and case-sensitive", () => {
    const declaration = response(
      '<qti-mapping default-value="0"><qti-map-entry map-key="Paris" mapped-value="1" case-sensitive="true"/></qti-mapping>',
    );
    expect(declaration?.mapping?.mapEntries).toEqual([
      { kind: "map-entry", mapKey: "Paris", mappedValue: 1, caseSensitive: true },
    ]);
  });

  it("[A34] qti-mapping: reads the bounds and the default", () => {
    const declaration = response(
      '<qti-mapping lower-bound="0" upper-bound="3" default-value="0.5"><qti-map-entry map-key="a" mapped-value="1"/></qti-mapping>',
    );
    expect(declaration?.mapping).toMatchObject({ kind: "mapping", lowerBound: 0, upperBound: 3, defaultValue: 0.5 });
  });

  it("[A35] qti-match-table: reads the default and the entries", () => {
    const table = outcome(
      '<qti-match-table default-value="none"><qti-match-table-entry source-value="1" target-value="string"/></qti-match-table>',
    ).lookupTable;
    expect(table).toEqual({
      kind: "match-table",
      defaultValue: "none",
      matchTableEntries: [{ kind: "match-table-entry", sourceValue: 1, targetValue: "string" }],
    });
  });

  it("[A36] qti-match-table-entry: reads the source as an integer and the target as a base type, as the schema has it", () => {
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
    expect(issue).toMatchObject({ code: "olah/asi/invalid-value", severity: "error" });
  });

  it("[A37] qti-outcome-declaration: reads the attributes and leaves normal-minimum out when the document omits it", () => {
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

  it("[G11] qti-outcome-declaration: an absent normal-minimum stays absent although the 3.0.1 schema defaults it to 0.0", () => {
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

  it("[A38] qti-response-declaration: reads the declaration with its mapping and correct response", () => {
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

  it("[A39] qti-template-declaration: reads param-variable and math-variable as booleans", () => {
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

  it("[A40] qti-value: keeps the text exactly and reads the field identifier and base type", () => {
    const declaration = response(
      '<qti-correct-response><qti-value field-identifier="f" base-type="float">  1.50 </qti-value></qti-correct-response>',
      'cardinality="record"',
    );
    expect(declaration?.correctResponse?.values).toEqual([
      { kind: "value", fieldIdentifier: "f", baseType: "float", value: "  1.50 " },
    ]);
  });
});

describe("readAsi: rules", () => {
  const setOutcome = `<qti-set-outcome-value identifier="SCORE">${ONE_XML}</qti-set-outcome-value>`;
  const setOutcomeModel = { kind: "set-outcome-value", identifier: "SCORE", expression: ONE };

  it("[A41] qti-exit-response: is a rule without content", () => {
    expect(responseRuleOf("<qti-exit-response/>")).toEqual({ kind: "exit-response" });
  });

  it("[A42] qti-exit-template: is a rule without content", () => {
    expect(templateRuleOf("<qti-exit-template/>")).toEqual({ kind: "exit-template" });
  });

  it("[A43] qti-exit-test: is a rule without content", () => {
    expect(outcomeRuleOf("<qti-exit-test/>")).toEqual({ kind: "exit-test" });
  });

  it("[A44] qti-lookup-outcome-value: reads the identifier and the expression", () => {
    expect(
      responseRuleOf(`<qti-lookup-outcome-value identifier="GRADE">${RESPONSE_XML}</qti-lookup-outcome-value>`),
    ).toEqual({ kind: "lookup-outcome-value", identifier: "GRADE", expression: RESPONSE });
  });

  it("[A45] qti-outcome-condition: reads the if, the else-ifs and the else", () => {
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

  it("[A46] qti-outcome-else: reads its rules", () => {
    const rule = outcomeRuleOf(
      `<qti-outcome-condition><qti-outcome-if>${ONE_XML}</qti-outcome-if><qti-outcome-else><qti-exit-test/></qti-outcome-else></qti-outcome-condition>`,
    );
    expect(rule.kind === "outcome-condition" && rule.outcomeElse).toEqual({
      kind: "outcome-else",
      rules: [{ kind: "exit-test" }],
    });
  });

  it("[A47] qti-outcome-else-if: has the shape of qti-outcome-if with its own kind", () => {
    const rule = outcomeRuleOf(
      `<qti-outcome-condition><qti-outcome-if>${ONE_XML}</qti-outcome-if><qti-outcome-else-if>${RESPONSE_XML}<qti-exit-test/></qti-outcome-else-if></qti-outcome-condition>`,
    );
    expect(rule.kind === "outcome-condition" && rule.outcomeElseIfs).toEqual([
      { kind: "outcome-else-if", condition: RESPONSE, rules: [{ kind: "exit-test" }] },
    ]);
  });

  it("[A48] qti-outcome-if: reads the condition and the rules", () => {
    const rule = outcomeRuleOf(
      `<qti-outcome-condition><qti-outcome-if>${ONE_XML}${setOutcome}${setOutcome}</qti-outcome-if></qti-outcome-condition>`,
    );
    expect(rule.kind === "outcome-condition" && rule.outcomeIf).toEqual({
      kind: "outcome-if",
      condition: ONE,
      rules: [setOutcomeModel, setOutcomeModel],
    });
  });

  it("[A49] qti-outcome-processing: is a document that holds rules and keeps an include as XML", () => {
    const processing = outcomeProcessingOf(
      `${setOutcome}<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="more.xml"/>`,
    );
    expect(processing.rules.map((rule) => rule.kind)).toEqual(["set-outcome-value", "element"]);
  });

  it("[A50] qti-outcome-processing-fragment: nests rules like the processing", () => {
    expect(outcomeRuleOf(`<qti-outcome-processing-fragment>${setOutcome}</qti-outcome-processing-fragment>`)).toEqual({
      kind: "outcome-processing-fragment",
      rules: [setOutcomeModel],
    });
  });

  it("[A51] qti-response-condition: reads the if, the else-ifs and the else", () => {
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

  it("[A52] qti-response-else: reads its rules", () => {
    const rule = responseRuleOf(
      `<qti-response-condition><qti-response-if>${ONE_XML}</qti-response-if><qti-response-else><qti-exit-response/></qti-response-else></qti-response-condition>`,
    );
    expect(rule.kind === "response-condition" && rule.responseElse).toEqual({
      kind: "response-else",
      rules: [{ kind: "exit-response" }],
    });
  });

  it("[A53] qti-response-else-if: has the shape of qti-response-if with its own kind", () => {
    const rule = responseRuleOf(
      `<qti-response-condition><qti-response-if>${ONE_XML}</qti-response-if><qti-response-else-if>${ONE_XML}<qti-exit-response/></qti-response-else-if></qti-response-condition>`,
    );
    expect(rule.kind === "response-condition" && rule.responseElseIfs[0]).toEqual({
      kind: "response-else-if",
      condition: ONE,
      rules: [{ kind: "exit-response" }],
    });
  });

  it("[A54] qti-response-if: reads the condition and the rules", () => {
    const rule = responseRuleOf(
      `<qti-response-condition><qti-response-if>${ONE_XML}${setOutcome}</qti-response-if></qti-response-condition>`,
    );
    expect(rule.kind === "response-condition" && rule.responseIf).toEqual({
      kind: "response-if",
      condition: ONE,
      rules: [setOutcomeModel],
    });
  });

  it("[A55] qti-response-processing: reads the template and its location, and the rules", () => {
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

  it("[A56] qti-response-processing-fragment: nests rules like the processing", () => {
    expect(
      responseRuleOf(`<qti-response-processing-fragment>${setOutcome}</qti-response-processing-fragment>`),
    ).toEqual({
      kind: "response-processing-fragment",
      rules: [setOutcomeModel],
    });
  });

  it("[A57] qti-set-correct-response: reads the identifier and the expression", () => {
    expect(templateRuleOf(`<qti-set-correct-response identifier="R">${ONE_XML}</qti-set-correct-response>`)).toEqual({
      kind: "set-correct-response",
      identifier: "R",
      expression: ONE,
    });
  });

  it("[A58] qti-set-default-value: reads the identifier and the expression", () => {
    expect(templateRuleOf(`<qti-set-default-value identifier="R">${ONE_XML}</qti-set-default-value>`)).toEqual({
      kind: "set-default-value",
      identifier: "R",
      expression: ONE,
    });
  });

  it("[A59] qti-set-outcome-value: reads the identifier and the expression", () => {
    expect(responseRuleOf(setOutcome)).toEqual(setOutcomeModel);
  });

  it("[A60] qti-set-template-value: reads the identifier and the expression", () => {
    expect(templateRuleOf(`<qti-set-template-value identifier="N">${ONE_XML}</qti-set-template-value>`)).toEqual({
      kind: "set-template-value",
      identifier: "N",
      expression: ONE,
    });
  });

  const setTemplate = `<qti-set-template-value identifier="N">${ONE_XML}</qti-set-template-value>`;
  const setTemplateModel = { kind: "set-template-value", identifier: "N", expression: ONE };

  it("[A61] qti-template-condition: reads the if, the else-ifs and the else", () => {
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

  it("[A62] qti-template-constraint: reads the expression", () => {
    expect(templateRuleOf(`<qti-template-constraint>${ONE_XML}</qti-template-constraint>`)).toEqual({
      kind: "template-constraint",
      expression: ONE,
    });
  });

  it("[A63] qti-template-else: reads its rules", () => {
    const rule = templateRuleOf(
      `<qti-template-condition><qti-template-if>${ONE_XML}</qti-template-if><qti-template-else><qti-exit-template/></qti-template-else></qti-template-condition>`,
    );
    expect(rule.kind === "template-condition" && rule.templateElse).toEqual({
      kind: "template-else",
      rules: [{ kind: "exit-template" }],
    });
  });

  it("[A64] qti-template-else-if: has the shape of qti-template-if with its own kind", () => {
    const rule = templateRuleOf(
      `<qti-template-condition><qti-template-if>${ONE_XML}</qti-template-if><qti-template-else-if>${ONE_XML}<qti-exit-template/></qti-template-else-if></qti-template-condition>`,
    );
    expect(rule.kind === "template-condition" && rule.templateElseIfs[0]).toEqual({
      kind: "template-else-if",
      condition: ONE,
      rules: [{ kind: "exit-template" }],
    });
  });

  it("[A65] qti-template-if: reads the condition and the rules", () => {
    const rule = templateRuleOf(
      `<qti-template-condition><qti-template-if>${ONE_XML}${setTemplate}</qti-template-if></qti-template-condition>`,
    );
    expect(rule.kind === "template-condition" && rule.templateIf).toEqual({
      kind: "template-if",
      condition: ONE,
      rules: [setTemplateModel],
    });
  });

  it("[A66] qti-template-processing: reads the rules of an item in order", () => {
    const { templateProcessing } = itemOf(
      item(`<qti-template-processing>${setTemplate}<qti-exit-template/></qti-template-processing>`),
    );
    expect(templateProcessing).toEqual({
      kind: "template-processing",
      rules: [setTemplateModel, { kind: "exit-template" }],
    });
  });
});

describe("readAsi: expressions", () => {
  it("[A67] qti-and: reads its operands in document order", () => {
    expect(expressionOf(`<qti-and>${ONE_XML}${RESPONSE_XML}</qti-and>`)).toEqual({
      kind: "and",
      operands: [ONE, RESPONSE],
    });
  });

  it("[A68] qti-any-n: reads min and max as numbers or variable names", () => {
    expect(expressionOf(`<qti-any-n min="1" max="N">${ONE_XML}</qti-any-n>`)).toEqual({
      kind: "any-n",
      min: 1,
      max: "N",
      operands: [ONE],
    });
  });

  it("[A69] qti-base-value: keeps the text and reads the base type", () => {
    expect(expressionOf('<qti-base-value base-type="float"> 1.50</qti-base-value>')).toEqual({
      kind: "base-value",
      baseType: "float",
      value: " 1.50",
    });
  });

  it("[A70] qti-container-size: reads its operand", () => {
    expect(expressionOf(`<qti-container-size>${RESPONSE_XML}</qti-container-size>`)).toEqual({
      kind: "container-size",
      operand: RESPONSE,
    });
  });

  it("[A71] qti-contains: reads its two operands", () => {
    expect(expressionOf(`<qti-contains>${PAIR_XML}</qti-contains>`)).toEqual({ kind: "contains", operands: PAIR });
  });

  it("[A72] qti-correct: reads the identifier", () => {
    expect(expressionOf('<qti-correct identifier="RESPONSE"/>')).toEqual({ kind: "correct", identifier: "RESPONSE" });
  });

  it("[A73] qti-custom-operator: reads class and definition, operands, and the extensions", () => {
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

  it("[A74] qti-default: reads the identifier", () => {
    expect(expressionOf('<qti-default identifier="SCORE"/>')).toEqual({ kind: "default", identifier: "SCORE" });
  });

  it("[A75] qti-delete: reads its two operands", () => {
    expect(expressionOf(`<qti-delete>${PAIR_XML}</qti-delete>`)).toEqual({ kind: "delete", operands: PAIR });
  });

  it("[A76] qti-divide: reads its two operands", () => {
    expect(expressionOf(`<qti-divide>${PAIR_XML}</qti-divide>`)).toEqual({ kind: "divide", operands: PAIR });
  });

  it("[A77] qti-duration-gte: reads its two operands", () => {
    expect(expressionOf(`<qti-duration-gte>${PAIR_XML}</qti-duration-gte>`)).toEqual({
      kind: "duration-gte",
      operands: PAIR,
    });
  });

  it("[A78] qti-duration-lt: reads its two operands", () => {
    expect(expressionOf(`<qti-duration-lt>${PAIR_XML}</qti-duration-lt>`)).toEqual({
      kind: "duration-lt",
      operands: PAIR,
    });
  });

  it("[A79] qti-equal: reads the tolerance as numbers and variable names and leaves the defaults out", () => {
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

  it("[A80] qti-equal-rounded: reads the mode and the figures", () => {
    expect(
      expressionOf(`<qti-equal-rounded rounding-mode="decimalPlaces" figures="2">${PAIR_XML}</qti-equal-rounded>`),
    ).toEqual({
      kind: "equal-rounded",
      roundingMode: "decimalPlaces",
      figures: 2,
      operands: PAIR,
    });
  });

  it("[A81] qti-field-value: reads the field identifier and the operand", () => {
    expect(expressionOf(`<qti-field-value field-identifier="stringValue">${RESPONSE_XML}</qti-field-value>`)).toEqual({
      kind: "field-value",
      fieldIdentifier: "stringValue",
      operand: RESPONSE,
    });
  });

  it("[A82] qti-gcd: reads its operands", () => {
    expect(expressionOf(`<qti-gcd>${PAIR_XML}</qti-gcd>`)).toEqual({ kind: "gcd", operands: PAIR });
  });

  it("[A83] qti-gt: reads its two operands", () => {
    expect(expressionOf(`<qti-gt>${PAIR_XML}</qti-gt>`)).toEqual({ kind: "gt", operands: PAIR });
  });

  it("[A84] qti-gte: reads its two operands", () => {
    expect(expressionOf(`<qti-gte>${PAIR_XML}</qti-gte>`)).toEqual({ kind: "gte", operands: PAIR });
  });

  it("[A85] qti-index: reads n as a number or a variable name", () => {
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

  it("[A86] qti-inside: reads the shape and the coordinates", () => {
    expect(expressionOf(`<qti-inside shape="circle" coords="10,20,5">${RESPONSE_XML}</qti-inside>`)).toEqual({
      kind: "inside",
      shape: "circle",
      coords: "10,20,5",
      operand: RESPONSE,
    });
  });

  it("[A87] qti-integer-divide: reads its two operands", () => {
    expect(expressionOf(`<qti-integer-divide>${PAIR_XML}</qti-integer-divide>`)).toEqual({
      kind: "integer-divide",
      operands: PAIR,
    });
  });

  it("[A88] qti-integer-modulus: reads its two operands", () => {
    expect(expressionOf(`<qti-integer-modulus>${PAIR_XML}</qti-integer-modulus>`)).toEqual({
      kind: "integer-modulus",
      operands: PAIR,
    });
  });

  it("[A89] qti-integer-to-float: reads its operand", () => {
    expect(expressionOf(`<qti-integer-to-float>${ONE_XML}</qti-integer-to-float>`)).toEqual({
      kind: "integer-to-float",
      operand: ONE,
    });
  });

  it("[A90] qti-is-null: reads its operand", () => {
    expect(expressionOf(`<qti-is-null>${RESPONSE_XML}</qti-is-null>`)).toEqual({ kind: "is-null", operand: RESPONSE });
  });

  it("[A91] qti-lcm: reads its operands", () => {
    expect(expressionOf(`<qti-lcm>${PAIR_XML}</qti-lcm>`)).toEqual({ kind: "lcm", operands: PAIR });
  });

  it("[A92] qti-lt: reads its two operands", () => {
    expect(expressionOf(`<qti-lt>${PAIR_XML}</qti-lt>`)).toEqual({ kind: "lt", operands: PAIR });
  });

  it("[A93] qti-lte: reads its two operands", () => {
    expect(expressionOf(`<qti-lte>${PAIR_XML}</qti-lte>`)).toEqual({ kind: "lte", operands: PAIR });
  });

  it("[A94] qti-map-response: reads the identifier", () => {
    expect(expressionOf('<qti-map-response identifier="RESPONSE"/>')).toEqual({
      kind: "map-response",
      identifier: "RESPONSE",
    });
  });

  it("[A95] qti-map-response-point: reads the identifier", () => {
    expect(expressionOf('<qti-map-response-point identifier="RESPONSE"/>')).toEqual({
      kind: "map-response-point",
      identifier: "RESPONSE",
    });
  });

  it("[A96] qti-match: reads its two operands", () => {
    expect(expressionOf(`<qti-match>${RESPONSE_XML}<qti-correct identifier="RESPONSE"/></qti-match>`)).toEqual({
      kind: "match",
      operands: [RESPONSE, { kind: "correct", identifier: "RESPONSE" }],
    });
  });

  it("[A97] qti-math-constant: reads the name", () => {
    expect(expressionOf('<qti-math-constant name="pi"/>')).toEqual({ kind: "math-constant", name: "pi" });
  });

  it("[A98] qti-math-operator: reads the name and the operands", () => {
    expect(expressionOf(`<qti-math-operator name="atan2">${PAIR_XML}</qti-math-operator>`)).toEqual({
      kind: "math-operator",
      name: "atan2",
      operands: PAIR,
    });
  });

  it("[A99] qti-max: reads its operands", () => {
    expect(expressionOf(`<qti-max>${PAIR_XML}</qti-max>`)).toEqual({ kind: "max", operands: PAIR });
  });

  it("[A100] qti-member: reads its two operands", () => {
    expect(expressionOf(`<qti-member>${PAIR_XML}</qti-member>`)).toEqual({ kind: "member", operands: PAIR });
  });

  it("[A101] qti-min: reads its operands", () => {
    expect(expressionOf(`<qti-min>${PAIR_XML}</qti-min>`)).toEqual({ kind: "min", operands: PAIR });
  });

  it("[A102] qti-multiple: reads no operands as an empty list", () => {
    expect(expressionOf("<qti-multiple/>")).toEqual({ kind: "multiple", operands: [] });
    expect(expressionOf(`<qti-multiple>${PAIR_XML}</qti-multiple>`)).toEqual({ kind: "multiple", operands: PAIR });
  });

  it("[A103] qti-not: reads its operand", () => {
    expect(expressionOf(`<qti-not>${RESPONSE_XML}</qti-not>`)).toEqual({ kind: "not", operand: RESPONSE });
  });

  it("[A104] qti-null: has no content", () => {
    expect(expressionOf("<qti-null/>")).toEqual({ kind: "null" });
  });

  it("[A105] qti-or: reads its operands", () => {
    expect(expressionOf(`<qti-or>${PAIR_XML}</qti-or>`)).toEqual({ kind: "or", operands: PAIR });
  });

  it("[A106] qti-ordered: reads no operands as an empty list", () => {
    expect(expressionOf("<qti-ordered/>")).toEqual({ kind: "ordered", operands: [] });
    expect(expressionOf(`<qti-ordered>${PAIR_XML}</qti-ordered>`)).toEqual({ kind: "ordered", operands: PAIR });
  });

  it("[A107] qti-pattern-match: keeps the pattern as written, a variable reference included", () => {
    expect(expressionOf(`<qti-pattern-match pattern="[a-z]+{N}">${RESPONSE_XML}</qti-pattern-match>`)).toEqual({
      kind: "pattern-match",
      pattern: "[a-z]+{N}",
      operand: RESPONSE,
    });
  });

  it("[A108] qti-power: reads its two operands", () => {
    expect(expressionOf(`<qti-power>${PAIR_XML}</qti-power>`)).toEqual({ kind: "power", operands: PAIR });
  });

  it("[A109] qti-product: reads its operands", () => {
    expect(expressionOf(`<qti-product>${PAIR_XML}</qti-product>`)).toEqual({ kind: "product", operands: PAIR });
  });

  it("[A110] qti-random: reads its operand", () => {
    expect(expressionOf(`<qti-random>${RESPONSE_XML}</qti-random>`)).toEqual({ kind: "random", operand: RESPONSE });
  });

  it("[A111] qti-random-float: reads min and max as numbers or variable names", () => {
    expect(expressionOf('<qti-random-float min="0.5" max="M"/>')).toEqual({ kind: "random-float", min: 0.5, max: "M" });
    expect(expressionOf('<qti-random-float max="1"/>')).toEqual({ kind: "random-float", max: 1 });
  });

  it("[A112] qti-random-integer: reads min, max and step", () => {
    expect(expressionOf('<qti-random-integer min="-2" max="10" step="2"/>')).toEqual({
      kind: "random-integer",
      min: -2,
      max: 10,
      step: 2,
    });
  });

  it("[A113] qti-repeat: reads number-repeats as a number or a variable name", () => {
    expect(expressionOf(`<qti-repeat number-repeats="3">${ONE_XML}</qti-repeat>`)).toEqual({
      kind: "repeat",
      numberRepeats: 3,
      operands: [ONE],
    });
    expect(expressionOf(`<qti-repeat number-repeats="N">${ONE_XML}</qti-repeat>`)).toMatchObject({
      numberRepeats: "N",
    });
  });

  it("[A114] qti-round: reads its operand", () => {
    expect(expressionOf(`<qti-round>${ONE_XML}</qti-round>`)).toEqual({ kind: "round", operand: ONE });
  });

  it("[A115] qti-round-to: reads the mode and the figures", () => {
    expect(
      expressionOf(`<qti-round-to rounding-mode="significantFigures" figures="3">${ONE_XML}</qti-round-to>`),
    ).toEqual({
      kind: "round-to",
      roundingMode: "significantFigures",
      figures: 3,
      operand: ONE,
    });
  });

  it("[A116] qti-stats-operator: reads the name and the operand", () => {
    expect(expressionOf(`<qti-stats-operator name="popSD">${RESPONSE_XML}</qti-stats-operator>`)).toEqual({
      kind: "stats-operator",
      name: "popSD",
      operand: RESPONSE,
    });
  });

  it("[A117] qti-string-match: reads case-sensitive and substring", () => {
    expect(
      expressionOf(`<qti-string-match case-sensitive="true" substring="true">${PAIR_XML}</qti-string-match>`),
    ).toEqual({
      kind: "string-match",
      caseSensitive: true,
      substring: true,
      operands: PAIR,
    });
  });

  it("[A118] qti-substring: reads case-sensitive", () => {
    expect(expressionOf(`<qti-substring case-sensitive="false">${PAIR_XML}</qti-substring>`)).toEqual({
      kind: "substring",
      caseSensitive: false,
      operands: PAIR,
    });
  });

  it("[A119] qti-subtract: reads its two operands", () => {
    expect(expressionOf(`<qti-subtract>${PAIR_XML}</qti-subtract>`)).toEqual({ kind: "subtract", operands: PAIR });
  });

  it("[A120] qti-sum: reads its numeric operands", () => {
    expect(expressionOf(`<qti-sum>${ONE_XML}${RESPONSE_XML}</qti-sum>`)).toEqual({
      kind: "sum",
      operands: [ONE, RESPONSE],
    });
    const issue = readIssue(() => expressionOf(`<qti-sum><qti-and>${ONE_XML}</qti-and></qti-sum>`));
    expect(issue).toMatchObject({ code: "olah/asi/element", source: SCHEMA });
  });

  it("[A121] qti-truncate: reads its operand", () => {
    expect(expressionOf(`<qti-truncate>${ONE_XML}</qti-truncate>`)).toEqual({ kind: "truncate", operand: ONE });
  });

  it("[A122] qti-variable: reads the identifier and the weight identifier", () => {
    expect(expressionOf('<qti-variable identifier="ITEM.SCORE" weight-identifier="W"/>')).toEqual({
      kind: "variable",
      identifier: "ITEM.SCORE",
      weightIdentifier: "W",
    });
  });

  it("[A123] qti-number-correct: reads the section and the categories", () => {
    expect(
      expressionOf('<qti-number-correct section-identifier="S1" include-category="a b" exclude-category="c"/>'),
    ).toEqual({
      kind: "number-correct",
      sectionIdentifier: "S1",
      includeCategory: ["a", "b"],
      excludeCategory: ["c"],
    });
  });

  it("[A124] qti-number-incorrect: reads the section and the categories", () => {
    expect(expressionOf('<qti-number-incorrect section-identifier="S1"/>')).toEqual({
      kind: "number-incorrect",
      sectionIdentifier: "S1",
    });
  });

  it("[A125] qti-number-presented: reads the categories", () => {
    expect(expressionOf('<qti-number-presented include-category="a"/>')).toEqual({
      kind: "number-presented",
      includeCategory: ["a"],
    });
  });

  it("[A126] qti-number-responded: has no attributes to read in its simplest form", () => {
    expect(expressionOf("<qti-number-responded/>")).toEqual({ kind: "number-responded" });
  });

  it("[A127] qti-number-selected: reads the exclude categories", () => {
    expect(expressionOf('<qti-number-selected exclude-category="x y"/>')).toEqual({
      kind: "number-selected",
      excludeCategory: ["x", "y"],
    });
  });

  it("[A128] qti-outcome-maximum: reads the outcome and the weight", () => {
    expect(expressionOf('<qti-outcome-maximum outcome-identifier="SCORE" weight-identifier="W"/>')).toEqual({
      kind: "outcome-maximum",
      outcomeIdentifier: "SCORE",
      weightIdentifier: "W",
    });
  });

  it("[A129] qti-outcome-minimum: reads the outcome and the section", () => {
    expect(expressionOf('<qti-outcome-minimum outcome-identifier="SCORE" section-identifier="S"/>')).toEqual({
      kind: "outcome-minimum",
      outcomeIdentifier: "SCORE",
      sectionIdentifier: "S",
    });
  });

  it("[A130] qti-test-variables: reads the variable, the base type and the weight", () => {
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

describe("readAsi: common attributes and extension points", () => {
  const body = (attributes: string) => itemOf(item(`<qti-item-body${attributes}><p>x</p></qti-item-body>`)).body;
  const rubric = (attributes: string, content = "") =>
    testOf(
      `<qti-rubric-block${attributes}><qti-content-body><p>r</p></qti-content-body>${content}</qti-rubric-block>${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`,
    ).rubricBlocks[0];

  it("[S1] id: keeps the id of a body and the xs:ID identifier of a response declaration", () => {
    expect(body(' id="b1"')).toMatchObject({ id: "b1" });
    const { responseDeclarations } = itemOf(item('<qti-response-declaration identifier="R" cardinality="single"/>'));
    expect(responseDeclarations[0]).toMatchObject({ identifier: "R" });
  });

  it("[S2] class: reads the tokens of the list and writes them separated by one space", () => {
    const read = body(' class=" a  b\tc "');
    expect(read?.class).toEqual(["a", "b", "c"]);
    expect(
      writeAsi({ kind: "item", item: itemOf(item('<qti-item-body class="a  b"><p>x</p></qti-item-body>')) }),
    ).toContain('class="a b"');
  });

  it("[S3] lang and xml:lang: keeps both attributes apart", () => {
    const { body: read } = stimulusOf(
      `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t"><qti-stimulus-body lang="fr" xml:lang="fr-CA"><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    expect(read).toMatchObject({ lang: "fr", language: "fr-CA" });
  });

  it("[S4] label: reads the label of a body", () => {
    expect(body(' label="Question 1"')).toMatchObject({ label: "Question 1" });
  });

  it("[S5] dir: accepts ltr, rtl and auto and rejects any other term", () => {
    for (const dir of ["ltr", "rtl", "auto"]) expect(body(` dir="${dir}"`)).toMatchObject({ dir });
    expect(readIssue(() => readAsi(item('<qti-item-body dir="up"><p>x</p></qti-item-body>')))).toMatchObject({
      code: "olah/asi/invalid-value",
    });
  });

  it("[S6] data-catalog-idref: reads the reference of a body to its catalog", () => {
    expect(body(' data-catalog-idref="catalog1"')).toMatchObject({ dataCatalogIdref: "catalog1" });
  });

  it("[S7] data-qti-suppress-tts: accepts the three terms and rejects any other", () => {
    for (const term of ["computer-read-aloud", "screen-reader", "all"]) {
      expect(rubric(` view="candidate" use="instructions" data-qti-suppress-tts="${term}"`)).toMatchObject({
        dataQtiSuppressTts: term,
      });
    }
    expect(readIssue(() => rubric(' view="candidate" use="instructions" data-qti-suppress-tts="none"'))).toMatchObject({
      code: "olah/asi/invalid-value",
    });
  });

  it("[S8] data-ssml: reads the string of a rubric block", () => {
    expect(rubric(' view="candidate" use="instructions" data-ssml="{&quot;a&quot;:1}"')).toMatchObject({
      dataSsml: '{"a":1}',
    });
  });

  it("[S9] xml:base: reads the base of a rubric block and writes xml:base", () => {
    const read = rubric(' view="candidate" use="instructions" xml:base="media/"');
    expect(read).toMatchObject({ xmlBase: "media/" });
    const test = testOf(
      `<qti-rubric-block view="candidate" use="instructions" xml:base="media/"><qti-content-body><p>r</p></qti-content-body></qti-rubric-block>${PART}<qti-assessment-section-ref identifier="s" href="s.xml"/></qti-test-part>`,
    );
    expect(writeAsi({ kind: "test", test })).toContain('xml:base="media/"');
  });

  it("[S10] response-identifier: stays on the interactions of a body, which are kept as XML", () => {
    const { body: read } = itemOf(
      item(
        '<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" max-choices="1"><qti-simple-choice identifier="A">a</qti-simple-choice></qti-choice-interaction></qti-item-body>',
      ),
    );
    const [interaction] = read?.children ?? [];
    expect(interaction).toMatchObject({ name: "qti-choice-interaction" });
    expect(interaction?.kind === "element" && interaction.attributes).toContainEqual({
      namespace: "",
      name: "response-identifier",
      value: "RESPONSE",
    });
  });

  it("[S11] role and aria-*: reads the attributes of a stimulus body by their types", () => {
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
    ).toMatchObject({ code: "olah/asi/invalid-value" });
  });

  it("[S12] data-*: keeps data attributes in extensions, in document order", () => {
    const read = itemOf(item("", ' data-b="2" data-a="1"'));
    expect(read.extensions).toEqual([
      { namespace: "", name: "data-b", value: "2" },
      { namespace: "", name: "data-a", value: "1" },
    ]);
    expect(rubric(' view="candidate" use="instructions" data-x="y"')?.extensions).toEqual([
      { namespace: "", name: "data-x", value: "y" },
    ]);
  });

  it("[S13] namespaces: reads the ASI namespace under any prefix and ignores xsi:schemaLocation", () => {
    const prefixed = `<q:qti-assessment-item xmlns:q="${ASI_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SCHEMA_LOCATION}" identifier="i" title="t" time-dependent="false"><q:qti-item-body><q:p>x</q:p></q:qti-item-body></q:qti-assessment-item>`;
    expect(itemOf(prefixed).identifier).toBe("i");
    expect(itemOf(prefixed).extensions).toEqual([]);
  });

  it("[S13] namespaces: rejects another namespace and an element that is no document", () => {
    const wrong = readIssue(() =>
      readAsi(
        '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="i" title="t" time-dependent="false"/>',
      ),
    );
    expect(wrong).toMatchObject({ code: "olah/asi/document-element", source: SCHEMA });
    expect(wrong.message).toContain("http://www.imsglobal.org/xsd/imsqti_v3p0");
    expect(readIssue(() => readAsi(`<div ${NAMESPACE}/>`))).toMatchObject({ code: "olah/asi/document-element" });
  });

  it("[S13] namespaces: writes the ASI namespace and the schema location of version 3.0.1", () => {
    expect(writeAsi({ kind: "item", item: itemOf(item()) })).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<qti-assessment-item xmlns="${ASI_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SCHEMA_LOCATION}" identifier="i" title="t" time-dependent="false"/>`,
    );
  });

  it("[S14] extension elements and attributes: keeps them where the schema allows them, as XML", () => {
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
      code: "olah/asi/attribute",
    });
  });

  it("[S15] ext: terms: accepts an extension term where the schema allows it and nowhere else", () => {
    expect(rubric(' view="candidate" use="ext:peer-review"')).toMatchObject({ use: "ext:peer-review" });
    expect(readIssue(() => rubric(' view="candidate" use="peer-review"'))).toMatchObject({
      code: "olah/asi/invalid-value",
    });
    expect(readIssue(() => rubric(' view="candidate" use="ext:"'))).toMatchObject({ code: "olah/asi/invalid-value" });
    expect(readIssue(() => rubric(' view="ext:x" use="instructions"'))).toMatchObject({
      code: "olah/asi/invalid-value",
    });
  });
});

describe("readAsi: input and errors", () => {
  it("[S13] reads text, bytes and a tree alike", () => {
    const xml = item("<qti-item-body><p>é</p></qti-item-body>");
    const fromText = readAsi(xml);
    expect(readAsi(new TextEncoder().encode(xml))).toEqual(fromText);
    expect(readAsi(parseXml(xml))).toEqual(fromText);
  });

  it("[S13] ignores the positions and namespace declarations of the tree in the model", () => {
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

  it("[S13] names the document, the line and the element path of a problem", () => {
    const issue = readIssue(() =>
      readAsi(
        `<qti-assessment-item ${NAMESPACE} identifier="i" title="t" time-dependent="false">\n<qti-response-declaration identifier="R"/></qti-assessment-item>`,
        { path: "items/a.xml" },
      ),
    );
    expect(issue).toEqual({
      severity: "error",
      code: "olah/asi/missing-attribute",
      message: "The element qti-response-declaration must have the attribute cardinality.",
      source: SCHEMA,
      location: { path: "items/a.xml", line: 2, column: 1, element: "qti-assessment-item/qti-response-declaration" },
    });
    const error = thrown(() => readAsi(item("<qti-response-declaration/>"), { path: "a.xml" }));
    expect(error).toBeInstanceOf(ReadError);
    expect((error as ReadError).message).toContain("(line 1, column ");
  });

  it("[A1] rejects an attribute the schema does not have, a missing one and a value that is not in its form", () => {
    expect(readIssue(() => readAsi(item('<qti-stylesheet href="a.css" type="text/css" color="red"/>')))).toMatchObject({
      code: "olah/asi/attribute",
      message: "The attribute color is not allowed on qti-stylesheet.",
    });
    expect(
      readIssue(() => readAsi(`<qti-assessment-item ${NAMESPACE} title="t" time-dependent="false"/>`)),
    ).toMatchObject({
      code: "olah/asi/missing-attribute",
      message: "The element qti-assessment-item must have the attribute identifier.",
    });
    expect(readIssue(() => readAsi(item("", ' adaptive="maybe"')))).toMatchObject({
      code: "olah/asi/invalid-value",
      message:
        'The attribute adaptive of qti-assessment-item is invalid: The text "maybe" is not a boolean: expected true, false, 1 or 0.',
    });
  });

  it("[A12] rejects an integer attribute that is not a safe integer", () => {
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-item-session-control max-attempts="9007199254740993"/></qti-assessment-section>`,
        ),
      ),
    ).toMatchObject({ code: "olah/asi/invalid-value" });
  });

  it("[A8] rejects an element the type does not contain, and text where only elements go", () => {
    expect(readIssue(() => readAsi(item("<qti-weight identifier='w' value='1'/>")))).toMatchObject({
      code: "olah/asi/element",
      message: "The element qti-assessment-item cannot contain qti-weight here.",
    });
    expect(readIssue(() => readAsi(item("text")))).toMatchObject({
      code: "olah/asi/text",
      message: "The element qti-assessment-item must not contain text.",
    });
    expect(readIssue(() => readAsi(item('<x:y xmlns:x="urn:x"/>')))).toMatchObject({ code: "olah/asi/element" });
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-test ${NAMESPACE} identifier="T" title="t"><xi:include xmlns:xi="${XINCLUDE_NAMESPACE}" href="a.xml"/></qti-assessment-test>`,
        ),
      ),
    ).toMatchObject({ code: "olah/asi/element" });
  });

  it("[A15] rejects a second child where the schema allows one, and a missing required one", () => {
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-selection select="1"/><qti-selection select="2"/></qti-assessment-section>`,
        ),
      ),
    ).toMatchObject({
      code: "olah/asi/element",
      message: "The element qti-assessment-section may have one selection, found 2.",
    });
    expect(
      readIssue(() =>
        readAsi(
          `<qti-response-processing ${NAMESPACE}><qti-response-condition><qti-response-if/></qti-response-condition></qti-response-processing>`,
        ),
      ),
    ).toMatchObject({
      code: "olah/asi/missing-element",
      message: "The element qti-response-if must have a condition.",
    });
    expect(readIssue(() => readAsi(`<qti-assessment-stimulus ${NAMESPACE} identifier="s" title="t"/>`))).toMatchObject({
      code: "olah/asi/missing-element",
    });
  });

  it("[A79] rejects more operands than the operator takes", () => {
    expect(readIssue(() => expressionOf(`<qti-equal>${ONE_XML}${ONE_XML}${ONE_XML}</qti-equal>`))).toMatchObject({
      code: "olah/asi/element",
      message: "The element qti-equal may have 2 operands, found 3.",
    });
  });

  it("[A41] rejects content in an element that must be empty, and an element in a text", () => {
    expect(readIssue(() => responseRuleOf("<qti-exit-response>x</qti-exit-response>"))).toMatchObject({
      code: "olah/asi/text",
    });
    expect(readIssue(() => responseRuleOf("<qti-exit-response><qti-null/></qti-exit-response>"))).toMatchObject({
      code: "olah/asi/element",
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
    ).toMatchObject({ code: "olah/asi/element", message: "The element qti-value must contain text only, found b." });
  });

  it("[A40] reads CDATA as the text of an element with text", () => {
    const declaration = itemOf(
      item(
        '<qti-response-declaration identifier="R" cardinality="single"><qti-correct-response><qti-value><![CDATA[a<b]]></qti-value></qti-correct-response></qti-response-declaration>',
      ),
    ).responseDeclarations[0];
    expect(declaration?.correctResponse?.values[0]?.value).toBe("a<b");
  });

  it("[A8] rejects a section that has an adaptive selection and a selection, and one that has an item and an ordering", () => {
    expect(
      readIssue(() =>
        readAsi(
          `<qti-assessment-section ${NAMESPACE} identifier="S" title="s" visible="true"><qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="e"/></qti-adaptive-selection><qti-ordering/></qti-assessment-section>`,
        ),
      ),
    ).toMatchObject({
      code: "olah/asi/exclusive",
    });
  });

  it("[S13] passes the errors of the XML reader on", () => {
    expect(readIssue(() => readAsi("<a>"))).toMatchObject({ code: "olah/xml/not-well-formed" });
    expect(() => readAsi('<!DOCTYPE a [<!ENTITY e "x">]><a/>')).toThrow(/DOCTYPE/);
    expect(() => readAsi(item(), { limits: { maxBytes: 10 } })).toThrow(/maxBytes/);
  });

  it("[S13] refuses arguments of other types", () => {
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

describe("writeAsi", () => {
  it("[A1] writes attributes and child elements in the order of the schema, whatever the order of the properties", () => {
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

  it("[A8] writes an include and the elements of other namespaces where the type accepts them", () => {
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

  it("[A40] writes a text and leaves an empty one without a text node", () => {
    const item = itemOf(
      '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="i" title="t" time-dependent="false"><qti-response-declaration identifier="R" cardinality="single"><qti-default-value><qti-value/></qti-default-value></qti-response-declaration></qti-assessment-item>',
    );
    expect(writeAsi({ kind: "item", item })).toContain("<qti-value/>");
  });

  it("[S13] writes the same text for the model that it reads back", () => {
    const xml = writeAsi({
      kind: "item",
      item: itemOf(item('<qti-item-body id="b"><p>a &amp; b</p></qti-item-body>')),
    });
    expect(writeAsi(readAsi(xml))).toBe(xml);
  });

  const valid = (): AssessmentItem => itemOf(item());
  const write = (model: unknown) => writeAsi({ kind: "item", item: model as AssessmentItem });

  it("[A1] refuses a document of another kind or of other types", () => {
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

  it("[A1] refuses a model that is not the model of the element", () => {
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

  it("[A1] refuses lists and members that are not the model", () => {
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

  it("[A15] refuses more members than a slot takes, a missing required one and a clash", () => {
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

  it("[A8] refuses an include where the type has none, and an element that is no include or no foreign element", () => {
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

  it("[A4] refuses content that is no node, and a text element without its value", () => {
    const body = { kind: "item-body", children: ["x"] };
    expect(() => write({ ...valid(), body })).toThrow(/A child of qti-item-body must be an XML node, found "x"/);
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

  it("[S13] leaves the validity of names and characters to the XML writer", () => {
    expect(() => write({ ...valid(), title: "a\u0001b" })).toThrow(/character U\+0001/);
  });
});

describe("the element table", () => {
  const types = Object.entries<TypeDef>(ELEMENT_TYPES);
  const accepted = new Set(
    types.flatMap(([, type]) =>
      type.content.kind === "slots"
        ? type.content.slots.flatMap(({ accepts }) => accepts.map(({ element }) => element))
        : [],
    ),
  );

  it("has the 64 expressions of the inventory, in the order of the schema's choice, and no other", () => {
    const expressions = EXPRESSION.map(({ element }) => element);
    expect(expressions).toHaveLength(64);
    expect([...expressions].sort()).toEqual(inventoryElements(67, 130).sort());
  });

  it("has every element of the rows A1 to A130, as a document or as a child", () => {
    const known = new Set([...accepted, ...Object.keys(DOCUMENT_ELEMENTS)]);
    expect(inventoryElements(1, 130).filter((element) => !known.has(element))).toEqual([]);
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

  it("keeps flow content as XML in the six types that mix text with HTML, MathML and SSML", () => {
    expect(types.filter(([, type]) => type.content.kind === "flow").map(([name]) => name)).toEqual([
      "FeedbackFlowContentBody",
      "HTMLContent",
      "ItemBody",
      "StimulusBody",
      "TestFeedbackFlowContentBody",
      "TestRubricBlockContentBody",
    ]);
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

describe("properties", () => {
  /** The element each type is used by, for the types of the table. */
  const elementOf = new Map<string, string>(
    Object.entries(DOCUMENT_ELEMENTS).map(([element, type]) => [type, element]),
  );
  for (const [, type] of Object.entries<TypeDef>(ELEMENT_TYPES)) {
    if (type.content.kind !== "slots") continue;
    for (const slot of type.content.slots)
      for (const accept of slot.accepts) elementOf.set(accept.type, accept.element);
  }

  it("[A1] reads the XML of every element type back to the model it was written from", () => {
    expect(elementOf.size).toBe(Object.keys(ELEMENT_TYPES).length);
    for (const [name, element] of elementOf) {
      const info = typeNamed(name);
      fc.assert(
        fc.property(modelArbitrary(name, element), (model) => {
          const written = parseXml(serializeXml(writeElement(info, element, model)));
          expect(readElement(info, written, { path: undefined, trail: [] })).toEqual(model);
        }),
        { numRuns: 25 },
      );
    }
  });

  it("[A1] reads every kind of document back to the model it was written from", () => {
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
  });

  it("[S13] reads a mutated document into a model or fails with a ReadError or a SecurityError", () => {
    const documents = [...DOCUMENT_ARBITRARIES.values()];
    fc.assert(
      fc.property(
        fc.constantFrom(...documents).chain((arbitrary) => arbitrary),
        fc.nat(),
        fc.string({ maxLength: 3 }),
        (document, at, insert) => {
          const written = writeAsi(document);
          const index = at % written.length;
          const mutated = written.slice(0, index) + insert + written.slice(index + (insert === "" ? 1 : 0));
          try {
            readAsi(mutated);
          } catch (error) {
            expect(error instanceof ReadError || error instanceof SecurityError, String(error)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
