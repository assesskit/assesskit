import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generate } from "../../../scripts/asi-table.js";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import {
  ASI_NAMESPACE,
  type AsiDocument,
  type AssessmentTest,
  parseXml,
  ReadError,
  readAsi,
  SecurityError,
  scoreCoversBlock,
  writeAsi,
  type XmlElement,
} from "../src/index.js";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "../src/node/index.js";
import { DOCUMENT_ARBITRARIES } from "./asi-arbitraries.js";
import { inventoryElements } from "./asi-elements.js";

const root = resolve(import.meta.dirname, "../../..");
const examples = join(requireCorpus(root), "qti-examples/qtiv3-examples");
const NAMESPACE = `xmlns="${ASI_NAMESPACE}"`;

let schemas: SchemaSet;

beforeAll(async () => {
  schemas = await loadSchemaSet(requireSchemas(root));
});

afterAll(() => {
  schemas.close();
});

/** Returns the issues the schema reports for a document. */
function issuesOf(path: string, content: string | Uint8Array) {
  return validateXmlFiles(schemas, [{ path, content }]);
}

/** Writes a document, reads it back, and returns the issues for what was written. */
async function validated(document: AsiDocument) {
  const written = writeAsi(document);
  expect(readAsi(written)).toEqual(document);
  return issuesOf("written.xml", written);
}

const ITEM = `<qti-assessment-item ${NAMESPACE} identifier="choice" title="Capital" label="L" xml:lang="en" tool-name="olah" tool-version="1" adaptive="false" time-dependent="false" data-owner="test">
  <qti-context-declaration identifier="CTX" cardinality="single" base-type="string"><qti-default-value><qti-value>x</qti-value></qti-default-value></qti-context-declaration>
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>B</qti-value></qti-correct-response>
    <qti-mapping lower-bound="0" upper-bound="1" default-value="0"><qti-map-entry map-key="B" mapped-value="1"/></qti-mapping>
  </qti-response-declaration>
  <qti-response-declaration identifier="POINTS" cardinality="multiple" base-type="point"><qti-area-mapping default-value="0"><qti-area-map-entry shape="circle" coords="10,20,5" mapped-value="1"/></qti-area-mapping></qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" normal-maximum="1" external-scored="human"/>
  <qti-outcome-declaration identifier="GRADE" cardinality="single" base-type="string"><qti-interpolation-table default-value="F"><qti-interpolation-table-entry source-value="0.5" include-boundary="false" target-value="A"/></qti-interpolation-table></qti-outcome-declaration>
  <qti-template-declaration identifier="N" cardinality="single" base-type="integer" param-variable="true"/>
  <qti-template-processing><qti-set-template-value identifier="N"><qti-random-integer min="1" max="9"/></qti-set-template-value><qti-template-constraint><qti-gt><qti-variable identifier="N"/><qti-base-value base-type="integer">2</qti-base-value></qti-gt></qti-template-constraint></qti-template-processing>
  <qti-assessment-stimulus-ref identifier="passage" href="passages/a.xml" title="Passage"/>
  <qti-companion-materials-info><qti-calculator><qti-calculator-type>basic</qti-calculator-type><qti-description>Basic</qti-description></qti-calculator></qti-companion-materials-info>
  <qti-stylesheet href="style.css" type="text/css"/>
  <qti-item-body class="body" dir="ltr"><p>Which city is the capital?</p><qti-choice-interaction response-identifier="RESPONSE" max-choices="1"><qti-simple-choice identifier="A">A</qti-simple-choice><qti-simple-choice identifier="B">B</qti-simple-choice></qti-choice-interaction></qti-item-body>
  <qti-response-processing><qti-response-condition><qti-response-if><qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-if><qti-response-else><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">0</qti-base-value></qti-set-outcome-value></qti-response-else></qti-response-condition></qti-response-processing>
  <qti-modal-feedback outcome-identifier="SCORE" show-hide="show" identifier="right" title="Right"><qti-content-body><p>Correct.</p></qti-content-body></qti-modal-feedback>
</qti-assessment-item>`;

const TEST = `<qti-assessment-test ${NAMESPACE} identifier="exam" title="Exam" class="exam" tool-name="olah" tool-version="1">
  <qti-outcome-declaration identifier="CONTENT" cardinality="single" base-type="float" external-scored="human"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-time-limits max-time="3600"/>
  <qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="CONTENT"><qti-content-body><p>Rate content once.</p><ul><li data-item-ref="W1" data-response-identifier="RESPONSE">Task 1</li></ul></qti-content-body></qti-rubric-block>
  <qti-test-part identifier="P1" navigation-mode="linear" submission-mode="individual">
    <qti-pre-condition><qti-base-value base-type="boolean">true</qti-base-value></qti-pre-condition>
    <qti-branch-rule target="EXIT_TEST"><qti-base-value base-type="boolean">false</qti-base-value></qti-branch-rule>
    <qti-item-session-control max-attempts="1" show-feedback="true"/>
    <qti-assessment-section identifier="S1" title="Writing" visible="true" required="true">
      <qti-selection select="1"/><qti-ordering shuffle="true"/>
      <qti-assessment-item-ref identifier="W1" href="w1.xml" category="writing"><qti-weight identifier="W" value="2"/><qti-variable-mapping source-identifier="SCORE" target-identifier="W1_SCORE"/></qti-assessment-item-ref>
      <qti-assessment-section-ref identifier="S2" href="s2.xml"/>
    </qti-assessment-section>
    <qti-test-feedback access="atEnd" outcome-identifier="SCORE" show-hide="show" identifier="F"><qti-content-body><p>Done.</p></qti-content-body></qti-test-feedback>
  </qti-test-part>
  <qti-outcome-processing><qti-set-outcome-value identifier="SCORE"><qti-sum><qti-test-variables variable-identifier="SCORE"/><qti-number-correct section-identifier="S1"/></qti-sum></qti-set-outcome-value></qti-outcome-processing>
</qti-assessment-test>`;

describe("writeAsi: worked examples", () => {
  it("[A1][A28][A29][A30][A37][A38][A39][A40] writes an item with every kind of declaration that the schema accepts", async () => {
    const document = readAsi(ITEM);
    expect(await validated(document)).toEqual([]);
  });

  it("[A7][A8][A10][A17] writes a test with parts, sections, rules and rubric blocks that the schema accepts", async () => {
    expect(await validated(readAsi(TEST))).toEqual([]);
  });

  it("[O1][O3] writes the covers block that the schema accepts, before the test parts", async () => {
    const document = readAsi(TEST);
    if (document.kind !== "test") throw new Error("Expected a test.");
    const notes: XmlElement[] = [];
    const block = scoreCoversBlock(
      "CONTENT",
      [{ itemRef: "W1", responseIdentifier: "RESPONSE", label: "Task 1" }],
      notes,
    );
    const test: AssessmentTest = { ...document.test, rubricBlocks: [block] };
    expect(await validated({ kind: "test", test })).toEqual([]);
  });

  it("[A2][A5] writes a stimulus with a stylesheet and a body that the schema accepts", async () => {
    const document = readAsi(
      `<qti-assessment-stimulus ${NAMESPACE} identifier="passage" title="Passage"><qti-stylesheet href="s.css" type="text/css"/><qti-stimulus-body role="region" aria-label="Passage"><p>Text</p></qti-stimulus-body></qti-assessment-stimulus>`,
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A8][A22] writes a section with an adaptive selection that the schema accepts", async () => {
    const document = readAsi(
      `<qti-assessment-section ${NAMESPACE} identifier="cat" title="Adaptive" visible="true"><qti-adaptive-selection><qti-adaptive-engine-ref identifier="E" href="engine.json"/><qti-adaptive-settings-ref identifier="S" href="settings.json"/></qti-adaptive-selection></qti-assessment-section>`,
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A55] writes response processing that names a template that the schema accepts", async () => {
    const document = readAsi(
      `<qti-response-processing ${NAMESPACE} template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>`,
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A49] writes outcome processing that the schema accepts", async () => {
    const document = readAsi(
      `<qti-outcome-processing ${NAMESPACE}><qti-outcome-condition><qti-outcome-if><qti-base-value base-type="boolean">true</qti-base-value><qti-exit-test/></qti-outcome-if></qti-outcome-condition></qti-outcome-processing>`,
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A37] writes an outcome declaration that the schema accepts", async () => {
    const document = readAsi(
      `<qti-outcome-declaration ${NAMESPACE} identifier="SCORE" cardinality="single" base-type="float" view="author scorer" normal-maximum="10" mastery-value="6"/>`,
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[N] shows what the schema reports for a document written without a required attribute", async () => {
    const written = writeAsi(readAsi(ITEM)).replace(' title="Capital"', "");
    expect((await issuesOf("untitled.xml", written)).map(({ message }) => message)).toEqual([
      "Element '{http://www.imsglobal.org/xsd/imsqtiasi_v3p0}qti-assessment-item': The attribute 'title' is required but missing.",
    ]);
  });
});

describe("writeAsi: generated documents", () => {
  /** Documents of each kind from the arbitraries, with the issues the schema reports for them. */
  const samples = new Map<string, { document: AsiDocument; issues: readonly { message: string }[] }[]>();

  beforeAll(async () => {
    for (const [kind, arbitrary] of DOCUMENT_ARBITRARIES) {
      const documents = fc.sample(arbitrary, { numRuns: 150, seed: 20261030 });
      const checked = [];
      for (const document of documents)
        checked.push({ document, issues: await issuesOf(`${kind}.xml`, writeAsi(document)) });
      samples.set(kind, checked);
      for (const { document } of checked) visit(parseXml(writeAsi(document)));
    }
  }, 120_000);

  /** The elements of the ASI namespace in the documents written from the samples. */
  const seen = new Set<string>();
  const visit = (element: XmlElement): void => {
    if (element.namespace === ASI_NAMESPACE) seen.add(element.name);
    for (const child of element.children) if (child.kind === "element") visit(child);
  };
  const missing = (first: number, last: number) => inventoryElements(first, last).filter((name) => !seen.has(name));

  it("[A1] are valid against the schema for every kind of document", () => {
    for (const [kind, checked] of samples) {
      expect(checked.length, kind).toBe(150);
      expect(
        checked.flatMap(({ issues }) => issues.map(({ message }) => message)),
        kind,
      ).toEqual([]);
    }
  });

  it("[A1][A2][A3][A4][A5][A6] use every element of the documents", () => {
    expect(missing(1, 6)).toEqual([]);
  });

  it("[A7][A8][A9][A10][A11][A12][A13][A14][A15][A16][A17][A18][A19][A20][A21][A22][A23][A24][A25] use every element of the test structure and of adaptive sections", () => {
    expect(missing(7, 25)).toEqual([]);
  });

  it("[A26][A27][A28][A29][A30][A31][A32][A33][A34][A35][A36][A37][A38][A39][A40] use every element of the declarations", () => {
    expect(missing(26, 40)).toEqual([]);
  });

  it("[A41][A42][A43][A44][A45][A46][A47][A48][A49][A50][A51][A52][A53][A54][A55][A56][A57][A58][A59][A60][A61][A62][A63][A64][A65][A66] use every rule", () => {
    expect(missing(41, 66)).toEqual([]);
  });

  it("[A67][A68][A69][A70][A71][A72][A73][A74][A75][A76][A77][A78][A79][A80][A81][A82][A83][A84][A85][A86][A87][A88][A89][A90][A91][A92][A93][A94][A95][A96][A97][A98][A99][A100][A101][A102][A103][A104][A105][A106][A107][A108][A109][A110][A111][A112][A113][A114][A115][A116][A117][A118][A119][A120][A121][A122][A123][A124][A125][A126][A127][A128][A129][A130] use every expression", () => {
    expect(missing(67, 130)).toEqual([]);
  });
});

describe("the 1EdTech examples", () => {
  const paths = readdirSync(examples, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".xml"))
    .sort();

  /** The examples that the ASI schema itself rejects, with the first reason. */
  const Invalid = new Map([
    ["packaging/items/data-attributes.xml", "The attribute 'use' is required but missing."],
    ["packaging/pci/src/fractions_deps_2.xml", "The attribute 'fallback-configuration' is not allowed."],
  ]);

  it("[A1][A10][C] are written to documents that the schema accepts, unless the schema rejects the example itself", async () => {
    let count = 0;
    for (const path of paths) {
      const bytes = new Uint8Array(readFileSync(join(examples, path)));
      let document: AsiDocument;
      try {
        document = readAsi(bytes, { path });
      } catch (error) {
        if (error instanceof ReadError || error instanceof SecurityError) continue;
        throw error;
      }
      count++;
      const issues = await issuesOf(path, writeAsi(document));
      const reason = Invalid.get(path);
      if (reason === undefined)
        expect(
          issues.map(({ message }) => message),
          path,
        ).toEqual([]);
      else expect(issues[0]?.message, path).toContain(reason);
    }
    // 253 items, 28 tests, 5 response processing templates, a stimulus and an outcome declaration.
    expect(count).toBe(288);
  }, 120_000);

  it("[X] are invalid in the two cases above before they are read", async () => {
    for (const [path, reason] of Invalid) {
      const issues = await issuesOf(path, new Uint8Array(readFileSync(join(examples, path))));
      expect(issues[0]?.message, path).toContain(reason);
    }
  });
});

describe("the element table", () => {
  it("is the table that scripts/asi-table.ts generates from the pinned ASI schema", () => {
    expect(readFileSync(join(root, "packages/olah/src/asi/element-table.ts"), "utf8")).toBe(generate(root));
  });
});
