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
import { DOCUMENT_ARBITRARIES } from "./arbitraries/asi.js";
import { inventoryElements } from "./asi-elements.js";
import { PLACES, vocabularyOf } from "./asi-vocabularies.js";

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

  it("[A79] writes a tolerance that refers to a variable in braces and one that gives a number, which the schema accepts", async () => {
    const document = readAsi(
      `<qti-response-processing ${NAMESPACE}><qti-response-condition><qti-response-if><qti-equal tolerance-mode="absolute" tolerance="{T} 0.5"><qti-variable identifier="A"/><qti-variable identifier="B"/></qti-equal><qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value></qti-response-if></qti-response-condition></qti-response-processing>`,
    );
    expect(await validated(document)).toEqual([]);
    expect(writeAsi(document)).toContain('tolerance="{T} 0.5"');
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

  /** The documents of each kind to generate; items have the most elements, so they get more. */
  const runsOf = (kind: string) => (kind === "item" ? 450 : 150);

  beforeAll(async () => {
    for (const [kind, arbitrary] of DOCUMENT_ARBITRARIES) {
      const documents = fc.sample(arbitrary, { numRuns: runsOf(kind), seed: 20261030 });
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
  const missing = (first: number, last: number, letter = "A") =>
    inventoryElements(first, last, letter).filter((name) => !seen.has(name));

  it("[A1] are valid against the schema for every kind of document", () => {
    for (const [kind, checked] of samples) {
      expect(checked.length, kind).toBe(runsOf(kind));
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

  it("[A131][A132][A133][A134][A135][A136][A137][A138][A139][A140][A141][A142][A143][A144][A145][A146][A147][A148][A149][A150][A151][A152][A153] use every interaction", () => {
    expect(missing(131, 153)).toEqual([]);
  });

  it("[A154][A155][A156][A157][A158][A159][A160][A161][A162][A163][A164][A165] use every choice, prompt and label", () => {
    expect(missing(154, 165)).toEqual([]);
  });

  it("[A166][A167][A168][A169][A170] use every element of portable custom interactions", () => {
    expect(missing(166, 170)).toEqual([]);
  });

  it("[A171][A172][A173][A174][A175][A176][A177][A178][A179][A180][A181][A182][A183][A184][A185] use every element of feedback, templates, rubric blocks and catalogs", () => {
    expect(missing(171, 185)).toEqual([]);
  });

  it("[A186][A187][A188][A189][A190][A191][A192][A193][A194][A195][A196][A197][A198][A199][A200][A201][A202] use every element of the companion materials", () => {
    expect(missing(186, 202)).toEqual([]);
  });

  it("[H1][H2][H3][H4][H5][H6][H7][H8][H9][H10][H11][H12][H13][H14][H15][H16][H17][H18][H19][H20][H21][H22][H23][H24][H25][H26][H27][H28][H29][H30][H31][H32][H33][H34][H35][H36][H37][H38][H39][H40][H41][H42][H43][H44][H45][H46][H47][H48][H49][H50][H51][H52][H53][H54][H55][H56][H57][H58][H59][H60][H61][H62][H63][H64][H65][H66][H67][H68][H69][H70][H71][H72][H73][H74][H75][H76] use every HTML element", () => {
    expect(missing(1, 76, "H")).toEqual([]);
  });
});

/** An item with the given body and the content that follows the body. */
const itemWith = (body: string, after = "", before = "") =>
  `<qti-assessment-item ${NAMESPACE} identifier="rich" title="Rich" time-dependent="false">${before}<qti-item-body>${body}</qti-item-body>${after}</qti-assessment-item>`;

const IMAGE = '<img src="images/map.png" alt="A map"/>';

describe("writeAsi: interactions", () => {
  it("[A132][A133][A162][A164][A146][A131][A163][A144][A165] write the choice, order, associate and match interactions that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        `<qti-choice-interaction response-identifier="R1" shuffle="true" max-choices="2" min-choices="1" orientation="horizontal" data-min-selections-message="a" data-max-selections-message="b"><qti-prompt>Pick <b>two</b></qti-prompt><qti-simple-choice identifier="A" fixed="true">a</qti-simple-choice><qti-simple-choice identifier="B" template-identifier="T" show-hide="hide">b</qti-simple-choice></qti-choice-interaction>
<qti-order-interaction response-identifier="R2" shuffle="true" min-choices="2" max-choices="3" orientation="vertical" data-choices-container-width="100"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-order-interaction>
<qti-associate-interaction response-identifier="R3" shuffle="true" max-associations="3" min-associations="1"><qti-simple-associable-choice identifier="A" match-max="1" match-min="0" match-group="g">a</qti-simple-associable-choice><qti-simple-associable-choice identifier="B" match-max="2" fixed="true">b</qti-simple-associable-choice></qti-associate-interaction>
<qti-match-interaction response-identifier="R4" shuffle="true" max-associations="2" min-associations="0" data-first-column-header="h"><qti-simple-match-set><qti-simple-associable-choice identifier="C" match-max="1">c</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set><qti-simple-associable-choice identifier="D" match-max="2">d</qti-simple-associable-choice></qti-simple-match-set></qti-match-interaction>`,
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A137][A155][A156][A157][A142][A159][A143][A160][A161][A152][A136] write the gap match, hottext, inline choice and text interactions that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        `<qti-gap-match-interaction response-identifier="R1" shuffle="true" min-associations="1" max-associations="2" data-choices-container-width="150" data-min-selections-message="a" data-max-selections-message="b"><qti-prompt>Fill</qti-prompt><qti-gap-text identifier="W" match-max="1" match-min="0" match-group="g">winter</qti-gap-text><qti-gap-img identifier="I" match-max="1" object-label="sun" top="1" left="2">${IMAGE}</qti-gap-img><blockquote><p>A <qti-gap identifier="G1" required="true"/> day</p></blockquote></qti-gap-match-interaction>
<qti-hottext-interaction response-identifier="R2" max-choices="2" min-choices="1" data-min-selections-message="a" data-max-selections-message="b"><qti-prompt>Find</qti-prompt><p>Sing <qti-hottext identifier="H1">a</qti-hottext> song</p></qti-hottext-interaction>
<p>Cheese is <qti-inline-choice-interaction response-identifier="R3" shuffle="true" required="true" min-choices="1" data-prompt="p" data-min-selections-message="m"><qti-label>Color</qti-label><qti-inline-choice identifier="Y" fixed="true">yellow</qti-inline-choice><qti-inline-choice identifier="N">none</qti-inline-choice></qti-inline-choice-interaction> and born in <qti-text-entry-interaction response-identifier="R4" base="10" string-identifier="S4" expected-length="4" pattern-mask="[0-9]+" placeholder-text="year" format="plain" data-patternmask-message="Digits"/>.</p>
<qti-extended-text-interaction response-identifier="R5" base="10" string-identifier="S5" expected-length="200" pattern-mask=".+" placeholder-text="Write" max-strings="2" min-strings="1" expected-lines="5" format="preformatted" data-patternmask-message="m"><qti-prompt>Describe</qti-prompt></qti-extended-text-interaction>`,
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A151][A153][A135][A145][A133] write the slider, upload, end attempt, media and custom interactions that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        `<qti-slider-interaction response-identifier="R1" lower-bound="0" upper-bound="10.5" step="0.5" step-label="true" orientation="vertical" reverse="true"><qti-prompt>Slide</qti-prompt></qti-slider-interaction>
<qti-upload-interaction response-identifier="R2" type="image/png application/pdf"><qti-prompt>Upload</qti-prompt></qti-upload-interaction>
<p><qti-end-attempt-interaction response-identifier="R3" title="Hint" count-attempt="false"/></p>
<qti-media-interaction response-identifier="R4" autostart="true" min-plays="1" max-plays="3" loop="true" coords="0,0,100,60"><qti-prompt>Listen</qti-prompt><audio src="a.mp3" controls="controls"/></qti-media-interaction>
<qti-custom-interaction xmlns:ext="urn:ext" response-identifier="R5" ext:flag="1"><ext:widget size="3">text</ext:widget></qti-custom-interaction>`,
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A134][A141][A158][A140][A138][A154][A139][A150][A149][A148] write the drawing and graphic interactions that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        `<qti-drawing-interaction response-identifier="R1"><qti-prompt>Draw</qti-prompt>${IMAGE}</qti-drawing-interaction>
<qti-hotspot-interaction response-identifier="R2" min-choices="1" max-choices="2" data-min-selections-message="a" data-max-selections-message="b"><qti-prompt>Where</qti-prompt><object type="image/png" data="map.png" width="206" height="280">Map</object><qti-hotspot-choice identifier="A" shape="circle" coords="77,115,8" hotspot-label="Edinburgh"/><qti-hotspot-choice identifier="B" shape="rect" coords="0,0,10,10" template-identifier="T" show-hide="hide"/></qti-hotspot-interaction>
<qti-graphic-order-interaction response-identifier="R3" min-choices="2" max-choices="4">${IMAGE}<qti-hotspot-choice identifier="A" shape="poly" coords="0,0,5,5,0,5"/></qti-graphic-order-interaction>
<qti-graphic-associate-interaction response-identifier="R4" min-associations="1" max-associations="3"><picture><source srcset="a.webp"/>${IMAGE}</picture><qti-associable-hotspot identifier="A" match-max="2" match-min="1" match-group="g" shape="ellipse" coords="1,2,3,4" hotspot-label="Spot" template-identifier="T" show-hide="show"/></qti-graphic-associate-interaction>
<qti-graphic-gap-match-interaction response-identifier="R5" min-associations="1" max-associations="2" data-min-selections-message="a" data-max-selections-message="b" data-choices-container-width="80">${IMAGE}<qti-gap-img identifier="I" match-max="1">${IMAGE}</qti-gap-img><qti-gap-text identifier="T" match-max="1">T</qti-gap-text><qti-associable-hotspot identifier="H" match-max="1" shape="default" coords="0,0,0"/></qti-graphic-gap-match-interaction>
<qti-select-point-interaction response-identifier="R6" min-choices="1" max-choices="3">${IMAGE}</qti-select-point-interaction>
<qti-position-object-stage id="stage">${IMAGE}<qti-position-object-interaction response-identifier="R7" center-point="10 20" min-choices="0" max-choices="1">${IMAGE}</qti-position-object-interaction></qti-position-object-stage>`,
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A147][A166][A167][A168][A169][A170] write a portable custom interaction with modules, markup, variables and a catalog that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        '<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:example.com:pci:graph" module="graph" data-min="0"><qti-prompt>Plot</qti-prompt><qti-interaction-modules primary-configuration="modules/primary.js" secondary-configuration="modules/secondary.js"><qti-interaction-module id="graph" primary-path="modules/graph.js" fallback-path="https://cdn.example.com/graph.js"/><qti-interaction-module id="lib"/></qti-interaction-modules><qti-interaction-markup><div class="graph"><p>Graph <qti-printed-variable identifier="N"/></p></div><template><span>t</span></template></qti-interaction-markup><qti-template-variable template-identifier="N"/><qti-context-variable identifier="CTX"/><qti-stylesheet href="css/graph.css" type="text/css"/><qti-catalog-info><qti-catalog id="c1"><qti-card support="spoken"><qti-html-content>Plot</qti-html-content></qti-card></qti-catalog></qti-catalog-info></qti-portable-custom-interaction>',
      ),
    );
    expect(await validated(document)).toEqual([]);
  });
});

describe("writeAsi: feedback, templates, rubric blocks, catalogs and companion materials", () => {
  it("[A176][A177][A175][A183][A184][A181][A182] write feedback, template content, printed variables and a rubric block that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        '<qti-feedback-block outcome-identifier="FB" identifier="ok" show-hide="show"><qti-content-body><p>Correct</p></qti-content-body></qti-feedback-block><p>You <qti-feedback-inline outcome-identifier="FB" identifier="no" show-hide="hide">did not</qti-feedback-inline> pass <qti-template-inline template-identifier="T" identifier="t1" show-hide="show">now</qti-template-inline> with <qti-printed-variable identifier="SCORE" format="%.2f" base="8" index="2" power-form="true" field="f" delimiter="," mapping-indicator=":"/>.</p><qti-template-block template-identifier="T" identifier="b1" show-hide="hide"><qti-content-body><p>Shown</p></qti-content-body></qti-template-block><qti-rubric-block view="author scorer" use="scoring" class="r"><qti-stylesheet href="r.css" type="text/css"/><qti-content-body><p>Give a point</p></qti-content-body></qti-rubric-block>',
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A180][A171][A172][A173][A174][A178][A179] write modal feedback and catalogs with cards, entries, content and files that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        '<p data-catalog-idref="glossary">Word</p>',
        '<qti-modal-feedback outcome-identifier="FB" show-hide="show" identifier="m1" title="Result"><qti-stylesheet href="m.css" type="text/css"/><qti-content-body><p>Well done</p></qti-content-body><qti-catalog-info><qti-catalog id="mc"><qti-card support="spoken"><qti-html-content>Well done</qti-html-content></qti-card></qti-catalog></qti-catalog-info></qti-modal-feedback>',
        '<qti-catalog-info><qti-catalog id="glossary"><qti-card support="glossary-on-screen" xml:lang="en"><qti-html-content xml:lang="en">A <b>word</b></qti-html-content><qti-file-href mime-type="audio/mpeg">word.mp3</qti-file-href></qti-card><qti-card support="keyword-translation"><qti-card-entry xml:lang="id" default="true"><qti-html-content>word</qti-html-content></qti-card-entry><qti-card-entry xml:lang="fr"><qti-file-href mime-type="audio/mpeg">mot.mp3</qti-file-href></qti-card-entry></qti-card><qti-card support="ext:note"/></qti-catalog></qti-catalog-info>',
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A185][A175] write test feedback with a content body that the schema accepts", async () => {
    const document = readAsi(
      `<qti-assessment-test ${NAMESPACE} identifier="T" title="t"><qti-test-part identifier="P" navigation-mode="linear" submission-mode="individual"><qti-assessment-section-ref identifier="s" href="s.xml"/><qti-test-feedback access="during" outcome-identifier="FB" identifier="fb1" show-hide="show" title="Halfway"><qti-content-body><p>Keep going</p></qti-content-body></qti-test-feedback></qti-test-part></qti-assessment-test>`,
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[A189][A186][A187][A188][A190][A191][A192][A193][A194][A195][A196][A197][A198][A199][A200][A201][A202] write companion materials that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        "<p>x</p>",
        "",
        '<qti-companion-materials-info><qti-calculator><qti-calculator-type>scientific</qti-calculator-type><qti-description>Scientific</qti-description><qti-calculator-info mime-type="application/x-calc"><qti-file-href>calc.js</qti-file-href><qti-resource-icon>calc.png</qti-resource-icon></qti-calculator-info></qti-calculator><qti-rule><qti-description>Ruler</qti-description><qti-rule-system-si><qti-minimum-length>5</qti-minimum-length><qti-minor-increment unit="Millimeter">1</qti-minor-increment><qti-major-increment unit="Centimeter">10</qti-major-increment></qti-rule-system-si></qti-rule><qti-rule><qti-description>Yardstick</qti-description><qti-rule-system-us><qti-minimum-length>2</qti-minimum-length><qti-major-increment unit="Inch">1</qti-major-increment></qti-rule-system-us></qti-rule><qti-protractor><qti-description>Protractor</qti-description><qti-increment-si><qti-minor-increment unit="Radian">0.1</qti-minor-increment><qti-major-increment unit="Radian">1</qti-major-increment></qti-increment-si></qti-protractor><qti-protractor><qti-description>US protractor</qti-description><qti-increment-us><qti-major-increment unit="Degree">10</qti-major-increment></qti-increment-us></qti-protractor><qti-digital-material mime-type="text/html"><qti-file-href>periodic.html</qti-file-href></qti-digital-material><qti-physical-material>A compass</qti-physical-material></qti-companion-materials-info>',
      ),
    );
    expect(await validated(document)).toEqual([]);
  });
});

describe("writeAsi: HTML, MathML and SSML", () => {
  it("[H1][H38][H43][H46][H64][H65][H66][H68][H69][H70][H71][H14][H17][H18][H74][H44][H41][H23][H24][H19][H76][H7][H58][H72][H47][H54][H50][H52][H51][H53][H20][H62][H27][H26][H12][H49][H10][H13][H36] write the HTML elements that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        `<div id="d" class="a b" lang="id" xml:lang="id-ID" dir="rtl" role="note" aria-label="Note" aria-hidden="true" data-x="1"><p>Link <a href="https://example.com/x" type="text/html">here</a> and ${IMAGE} and <object data="a.swf" type="application/x-shockwave-flash" width="100" height="50%"><param name="speed" value="fast" valuetype="DATA" type="text/plain"/>No plug-in</object><br/><q cite="u.html">q</q><bdo title="t" dir="rtl">c</bdo><ruby><rb>漢</rb><rp>(</rp><rt>kan</rt><rp>)</rp></ruby></p><hr/>
<table summary="Scores"><caption>Scores</caption><col span="2"/><colgroup span="3"><col/></colgroup><thead><tr><th scope="col" abbr="N" axis="a">Name</th></tr></thead><tbody><tr><td rowspan="2" colspan="3" align="center" valign="top">1</td></tr></tbody><tfoot><tr><td>sum</td></tr></tfoot></table>
<table><tr><td>a</td></tr></table>
<ul><li>a</li><li>b <b>c</b></li></ul><ol><li>one</li></ol><dl><dt>Term</dt><dd>One</dd></dl>
<video src="a.mp4" poster="p.png" width="320" height="200" preload="none" controls="controls" autoplay="false" loop="true" muted="muted" crossorigin="anonymous"><source src="a.webm" type="video/webm"/><track kind="subtitles" src="a.vtt" srclang="en" default="default"/>No video</video>
<p><picture><source srcset="a.webp" type="image/webp"/>${IMAGE}</picture></p>
<details open="true"><summary>More</summary><p>Text</p></details>
<figure><figcaption>Cap</figcaption><p>x</p></figure><blockquote cite="https://example.com/q"><p>Q</p></blockquote></div>`,
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  const Ssml = `xmlns:ssml="http://www.w3.org/2001/10/synthesis"`;

  it("[M1] write MathML that the schema accepts, in a paragraph and in a choice", async () => {
    const math =
      '<m:math xmlns:m="http://www.w3.org/1998/Math/MathML" display="inline"><m:semantics><m:mfrac><m:mn>1</m:mn><m:mi>x</m:mi></m:mfrac><m:annotation encoding="x"> a </m:annotation></m:semantics></m:math>';
    const document = readAsi(
      itemWith(
        `<p>Solve ${math}.</p><qti-choice-interaction response-identifier="R"><qti-simple-choice identifier="A">${math}</qti-simple-choice></qti-choice-interaction>`,
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[M2][M3][M4][M5][M6][M7][M8][M9][M10][M11][M12][M13][M16] write the SSML elements and the lexicon reference that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        `<p><ssml:speak ${Ssml} version="1.1" xml:lang="en"><ssml:lexicon xml:id="names" uri="lexicon/names.pls" type="application/pls+xml"/><ssml:p>Para <ssml:s>Sentence <ssml:say-as interpret-as="cardinal">12</ssml:say-as> <ssml:phoneme alphabet="x-sampa" ph="t@meIt@U">tomato</ssml:phoneme> <ssml:sub alias="water">H2O</ssml:sub> <ssml:voice gender="female">Hi</ssml:voice> <ssml:emphasis level="strong">now</ssml:emphasis> <ssml:break time="500ms"/> <ssml:prosody rate="slow" pitch="+2st">slowly</ssml:prosody> <ssml:mark name="here"/> <ssml:audio src="a.mp3">Fallback</ssml:audio></ssml:s></ssml:p></ssml:speak></p>`,
      ),
    );
    expect(await validated(document)).toEqual([]);
  });

  it("[M17][A6] write the reference to a CSS style sheet in an item, a stimulus and a portable custom interaction that the schema accepts", async () => {
    const sheets = '<qti-stylesheet href="css/item.css" type="text/css" media="screen" title="Screen"/>';
    expect(
      await validated(
        readAsi(
          `<qti-assessment-stimulus ${NAMESPACE} identifier="st" title="t">${sheets}<qti-stimulus-body><p>x</p></qti-stimulus-body></qti-assessment-stimulus>`,
        ),
      ),
    ).toEqual([]);
    expect(await validated(readAsi(itemWith("<p>x</p>", "", sheets)))).toEqual([]);
  });
});

describe("the vocabularies of the content", () => {
  /** The text of the ASI schema. */
  const schemaText = readFileSync(join(requireSchemas(root), "imsqti_asiv3p0p1_v1p0.xsd"), "utf8");

  /** The terms of each enumeration that the schema declares in line for an attribute, as written. */
  function schemaTerms(attribute: string): string[][] {
    return schemaText
      .split(`<xs:attribute name="${attribute}"`)
      .slice(1)
      .flatMap((declaration) => {
        const opening = declaration.slice(0, declaration.indexOf(">"));
        if (opening.endsWith("/")) return [];
        const body = declaration.slice(0, declaration.indexOf("</xs:attribute>"));
        return [
          body
            .split('<xs:enumeration value="')
            .slice(1)
            .map((part) => part.slice(0, part.indexOf('"'))),
        ];
      })
      .filter((terms) => terms.length > 0);
  }

  /** Checks that the terms are the ones of the schema, that each is valid in a document, and that other text is not. */
  async function checkVocabulary(row: string): Promise<void> {
    const { element, attribute, terms } = vocabularyOf(row);
    const declared = schemaTerms(attribute);
    expect(declared.length, attribute).toBeGreaterThan(0);
    for (const list of declared) expect([...list].sort(), attribute).toEqual([...terms].sort());
    const { markup } = PLACES[element];
    for (const term of terms) {
      const document = readAsi(itemWith(markup(` ${attribute}="${term}"`)));
      expect(await validated(document), term).toEqual([]);
    }
    const other = itemWith(markup(` ${attribute}="no-such-term"`));
    expect((await issuesOf("other.xml", other)).length, attribute).toBeGreaterThan(0);
  }

  it("[W1] ARIAAutoCompleteEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.1)", async () => {
    await checkVocabulary("W1");
  });

  it("[W2] ARIACheckedEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.2)", async () => {
    await checkVocabulary("W2");
  });

  it("[W3] ARIACurrentEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.3)", async () => {
    await checkVocabulary("W3");
  });

  it("[W4] ARIAExpandedEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.4)", async () => {
    await checkVocabulary("W4");
  });

  it("[W5] ARIAInvalidEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.5)", async () => {
    await checkVocabulary("W5");
  });

  it("[W6] ARIALiveValueEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.6)", async () => {
    await checkVocabulary("W6");
  });

  it("[W7] ARIAOrientationValueEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.7)", async () => {
    await checkVocabulary("W7");
  });

  it("[W8] ARIAPressedEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.8)", async () => {
    await checkVocabulary("W8");
  });

  it("[W9] ARIARoleValue: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.9)", async () => {
    await checkVocabulary("W9");
  });

  it("[W10] ARIASelectedEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.10)", async () => {
    await checkVocabulary("W10");
  });

  it("[W11] ARIASortEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.11)", async () => {
    await checkVocabulary("W11");
  });

  it("[W12] AlignEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.12)", async () => {
    await checkVocabulary("W12");
  });

  it("[W14] CORSSettingsEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.14)", async () => {
    await checkVocabulary("W14");
  });

  it("[W17] DIR: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.17)", async () => {
    await checkVocabulary("W17");
  });

  it("[W19] KindValueEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.19)", async () => {
    await checkVocabulary("W19");
  });

  it("[W24] ParamTypeEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.24)", async () => {
    await checkVocabulary("W24");
  });

  it("[W25] PreLoadValueEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.25)", async () => {
    await checkVocabulary("W25");
  });

  it("[W34] SuppressTTSEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.34)", async () => {
    await checkVocabulary("W34");
  });

  it("[W35] TableCellScopeEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.35)", async () => {
    await checkVocabulary("W35");
  });

  it("[W42] ValignEnum: has the terms of the schema, writes each in a document that the schema accepts, and the schema refuses any other (INFO §8.42)", async () => {
    await checkVocabulary("W42");
  });

  it("[W46][W48] StringList, ARIARelevantList: write lists that the schema accepts", async () => {
    const document = readAsi(
      itemWith(
        '<div class="a b c" aria-relevant="additions removals text"/><div aria-relevant="all"/><p class="">x</p>',
      ),
    );
    expect(await validated(document)).toEqual([]);
    expect((await issuesOf("other.xml", itemWith('<div aria-relevant="bogus"/>'))).length).toBeGreaterThan(0);
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

  it("[A1][A10][C] are written to documents that the schema accepts, and are read again", async () => {
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
      const written = writeAsi(document);
      expect(
        (await issuesOf(path, written)).map(({ message }) => message),
        path,
      ).toEqual([]);
      expect(readAsi(written), path).toEqual(document);
    }
    // 251 items, 28 tests, 5 response processing templates, a stimulus and an outcome declaration.
    expect(count).toBe(286);
  }, 120_000);

  it("[X][N] are invalid in the two cases above, which the reader refuses for the same reason", async () => {
    for (const [path, reason] of Invalid) {
      const bytes = new Uint8Array(readFileSync(join(examples, path)));
      expect((await issuesOf(path, bytes))[0]?.message, path).toContain(reason);
      expect(() => readAsi(bytes, { path }), path).toThrow(ReadError);
    }
  });
});

describe("the element table", () => {
  it("is the table that scripts/asi-table.ts generates from the pinned ASI schema", () => {
    expect(readFileSync(join(root, "packages/olah/src/asi/element-table.ts"), "utf8")).toBe(generate(root));
  });
});
