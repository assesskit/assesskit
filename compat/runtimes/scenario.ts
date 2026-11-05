import { createCatRestHandler } from "@assesskit/player/cat-rest";
import { createRandom } from "@assesskit/runtime";
import { readAsi } from "@assesskit/runtime/asi";
import {
  type Action,
  createEngine,
  type DeliveryState,
  deserializeState,
  serializeState,
} from "@assesskit/runtime/delivery";
import { readView, writeView } from "@assesskit/runtime/delivery/wire";
import { SecurityError } from "@assesskit/runtime/errors";
import { buildOperatorCall, compareMathSteps, countLength, createScoringOperators } from "@assesskit/runtime/operators";
import { createPackageResolvers, readManifest, readPackage, writePackage } from "@assesskit/runtime/package";
import { createItemVariables, runResponseProcessing } from "@assesskit/runtime/processing";
import { writeResults } from "@assesskit/runtime/results";
import { compileScoring } from "@assesskit/runtime/scoring";
import { validatePackage } from "@assesskit/runtime/validate";
import { buildContainer, buildSingle, compileXsdRegex } from "@assesskit/runtime/values";
import { parseXml } from "@assesskit/runtime/xml";

/** What every runtime must give: plain data, the same on each. */
export interface Results {
  /** The package that the scenario writes, reads back and validates. */
  readonly pkg: { readonly paths: readonly string[]; readonly resources: number; readonly issues: number };
  /** The test session: what the candidate sees and does not see, and what each step gives. */
  readonly session: {
    readonly title: string | undefined;
    readonly choices: readonly string[] | undefined;
    readonly actions: readonly string[];
    readonly viewHoldsKey: boolean;
    readonly viewRead: string | undefined;
    readonly steps: readonly string[];
    readonly refusal: string;
    readonly status: string;
    readonly total: string;
    readonly reported: readonly string[];
    readonly totalXml: string | undefined;
  };
  /** The state of the session, written and read again. */
  readonly state: { readonly bytes: number; readonly equal: boolean };
  /** The limits and the pattern language, which use no platform API. */
  readonly limits: { readonly doctype: string; readonly nodes: string; readonly pattern: readonly boolean[] };
  /** The handler of the CAT binding over the `Request` and `Response` of the runtime. */
  readonly cat: { readonly refused: number; readonly oversize: number; readonly missing: number };
  /**
   * The verdicts of the scoring operators, whose comparator evaluates `Math`'s functions, which may differ in their last bit
   * between engines: its bound of agreement is wide enough that every engine gives the same verdicts.
   */
  readonly operators: {
    readonly verdicts: readonly (number | boolean | null)[];
    readonly steps: readonly (boolean | null)[];
  };
  /** The scores of an item whose keys `compileScoring` writes, in QTI's own expressions and with an operator. */
  readonly scoring: { readonly score: number | null; readonly feedback: readonly string[] };
}

const NAMESPACE = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';
const encoder = new TextEncoder();

/** An item with one choice interaction whose correct answer is `correct`. */
const item = (identifier: string, title: string, correct: string): string => `<qti-assessment-item ${NAMESPACE}
    identifier="${identifier}" title="${title}" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>${correct}</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
      <qti-prompt>${title}</qti-prompt>
      <qti-simple-choice identifier="A">Paris</qti-simple-choice>
      <qti-simple-choice identifier="B">Rome</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`;

const TEST = `<qti-assessment-test ${NAMESPACE} identifier="quiz" title="Quiz">
  <qti-outcome-declaration identifier="TOTAL" cardinality="single" base-type="float"/>
  <qti-test-part identifier="part" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="main" title="Main" visible="true">
      <qti-assessment-item-ref identifier="q1" href="items/q1.xml"/>
      <qti-assessment-item-ref identifier="q2" href="items/q2.xml"/>
    </qti-assessment-section>
  </qti-test-part>
  <qti-outcome-processing>
    <qti-set-outcome-value identifier="TOTAL">
      <qti-sum><qti-test-variables variable-identifier="SCORE"/></qti-sum>
    </qti-set-outcome-value>
  </qti-outcome-processing>
</qti-assessment-test>`;

const MANIFEST =
  readManifest(`<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1" identifier="quiz-package">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    <resource identifier="quiz" type="imsqti_test_xmlv3p0" href="test.xml">
      <file href="test.xml"/><dependency identifierref="q1"/><dependency identifierref="q2"/>
    </resource>
    <resource identifier="q1" type="imsqti_item_xmlv3p0" href="items/q1.xml"><file href="items/q1.xml"/></resource>
    <resource identifier="q2" type="imsqti_item_xmlv3p0" href="items/q2.xml"><file href="items/q2.xml"/></resource>
  </resources>
</manifest>`);

/** Writes a package, reads it back, validates it, and runs the session of its test from start to end. */
function runSession(): Pick<Results, "pkg" | "session" | "state"> {
  const zip = writePackage(
    MANIFEST,
    new Map([
      ["test.xml", encoder.encode(TEST)],
      ["items/q1.xml", encoder.encode(item("q1", "Capital of France?", "A"))],
      ["items/q2.xml", encoder.encode(item("q2", "Capital of Italy?", "B"))],
    ]),
  );
  const pkg = readPackage(zip);
  const document = pkg.document("test.xml");
  if (document.kind !== "test") throw new Error("Expected a test.");
  const engine = createEngine({
    kind: "test",
    test: document.test,
    base: "test.xml",
    resolvers: createPackageResolvers(pkg),
  });
  const steps: string[] = [];
  const apply = (state: DeliveryState, action: Action) => {
    const step = engine.apply(state, action);
    if (!step.ok) throw new Error(step.refusal.message);
    steps.push(step.events.map(({ type }) => type).join(" "));
    return step;
  };
  const started = engine.start({ seed: 7, at: 0 });
  if (!started.ok) throw new Error(started.refusal.message);
  const view = engine.view(started.state, 0);
  const wire = JSON.stringify(writeView(view));
  const answered = apply(started.state, {
    type: "set-responses",
    item: { ref: "q1", instance: 1 },
    responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
    at: 1_000,
  });
  const moved = apply(answered.state, { type: "move", to: "next", at: 2_000 });
  const refused = engine.apply(moved.state, { type: "move", to: "previous", at: 2_500 });
  const second = apply(moved.state, {
    type: "set-responses",
    item: { ref: "q2", instance: 1 },
    responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
    at: 3_000,
  });
  const ended = apply(second.state, { type: "end-test", at: 4_000 });
  const report = engine.results(ended.state);
  const text = serializeState(ended.state);
  return {
    pkg: {
      paths: [...pkg.paths].sort(),
      resources: pkg.manifest.resources.length,
      issues: validatePackage(pkg).length,
    },
    session: {
      title: view.current?.title,
      choices: view.current?.interactions[0]?.choices.map(({ identifier }) => identifier),
      actions: view.actions,
      viewHoldsKey: wire.includes("qti-correct-response"),
      viewRead: readView(JSON.parse(wire)).current?.title,
      steps,
      refusal: refused.ok ? "accepted" : refused.refusal.reason,
      status: ended.state.status,
      total: JSON.stringify(ended.state.outcomes.get("TOTAL")),
      reported: report.itemResults.map(({ identifier, sessionStatus }) => `${identifier} ${sessionStatus}`),
      totalXml: writeResults(report).match(/<outcomeVariable identifier="TOTAL".*?<\/outcomeVariable>/)?.[0],
    },
    state: { bytes: text.length, equal: serializeState(deserializeState(text)) === text },
  };
}

/** What the limits of the XML reader and the pattern language give, which no platform decides. */
function runLimits(): Results["limits"] {
  const refusal = (xml: string, limits: object): string => {
    try {
      parseXml(xml, { limits });
      return "no error";
    } catch (error) {
      return error instanceof SecurityError ? `SecurityError ${error.limit}` : String(error);
    }
  };
  const pattern = compileXsdRegex("[a-c]{2,3}\\d?");
  return {
    doctype: refusal('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', {}),
    nodes: refusal(`<a>${"<b/>".repeat(100)}</a>`, { maxNodes: 50 }),
    pattern: ["ab", "abc7", "a", "abcd"].map((text) => pattern.matches(text)),
  };
}

/** The statuses that the handler of the CAT binding answers to requests it refuses, from the `Request` and `Response` of the runtime. */
async function runCat(): Promise<Results["cat"]> {
  const unused = () => Promise.reject(new Error("The port is not called."));
  const port = {
    createSection: unused,
    getSection: unused,
    createSession: unused,
    submitResults: unused,
    endSession: unused,
    endSection: unused,
  };
  const handle = createCatRestHandler({ authorize: () => ({ port }), maxBodyBytes: 64 });
  const post = (path: string, body: string) =>
    handle(
      new Request(`https://engine.example/ims/cat/v1p0/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    );
  return {
    refused: (await post("sections", "{}")).status,
    oversize: (await post("sections", JSON.stringify({ padding: "x".repeat(100) }))).status,
    missing: (await post("elsewhere", "{}")).status,
  };
}

/** The verdicts of the scoring operators on pairs that call the functions, roots and branch cuts of the comparator. */
function runOperators(): Results["operators"] {
  const operators = createScoringOperators();
  const verdict = (key: string, response: string, form: "expression" | "equation" = "expression") => {
    const call = buildOperatorCall(
      { operator: "expression-equivalent", key: { kind: "expression", expression: key, form } },
      "R",
    );
    const result = operators.get(call.definition ?? "")?.([buildSingle("string", response)], call);
    return result === null || result === undefined || result.cardinality !== "single" ? null : (result.value as number);
  };
  const text = buildOperatorCall(
    {
      operator: "text-equivalent",
      key: { kind: "text", answers: [{ texts: ["Jakarta"] }], credit: [{ tolerance: { absolute: 5 }, share: 0.5 }] },
    },
    "R",
  );
  const textShare = operators.get(text.definition ?? "")?.([buildSingle("string", "Jakarta City")], text);
  return {
    verdicts: [
      verdict("\\sin^2x+\\cos^2x", "1"),
      verdict("\\cosh^2x-\\sinh^2x", "1"),
      verdict("\\ln(x^2)", "2\\ln x"),
      verdict("\\sqrt{x}\\sqrt{x}", "x"),
      verdict("\\arcsin\\frac{x}{3}+\\arccos\\frac{x}{3}", "\\frac{\\pi}{2}"),
      verdict("e^{\\tan x}\\cdot\\sqrt[3]{x}", "\\exp(\\tan x)x^{\\frac13}"),
      verdict("2x+3=7", "x=2", "equation"),
      textShare?.cardinality === "single" ? (textShare.value as number) : null,
      countLength("Saya suka matematika.", "words"),
    ],
    steps: compareMathSteps(["x^2=9", "x=\\pm3", "x=4"]).map((check) => check.equivalent),
  };
}

/** The scores of an item whose keys `compileScoring` writes: a negative mark, adjacent pairs, and a number in a text. */
function runScoring(): Results["scoring"] {
  const scoring = compileScoring([
    { identifier: "MARKED", key: { kind: "choice-marking", keys: ["A"], correct: 4, wrong: -1 } },
    { identifier: "STEPS", key: { kind: "order", order: ["A", "B", "C", "D"], scheme: "adjacent-pairs" } },
    { identifier: "HALF", key: { kind: "text", answers: [{ texts: ["0.5"] }], numericEquivalence: true } },
  ]);
  const read = readAsi(`<qti-assessment-item ${NAMESPACE} identifier="i" title="Item" time-dependent="false"/>`);
  if (read.kind !== "item") throw new Error("The scenario reads an item.");
  const { responseDeclarations, outcomeDeclarations, responseProcessing } = scoring;
  const item = { ...read.item, responseDeclarations, outcomeDeclarations, responseProcessing };
  const variables = createItemVariables(item);
  const responses = new Map(variables.responses)
    .set("MARKED", buildSingle("identifier", "B"))
    .set("STEPS", buildContainer("ordered", "identifier", ["B", "C", "D", "A"]))
    .set("HALF", buildSingle("string", "2/4"));
  const context = { random: createRandom(1), customOperators: createScoringOperators() };
  const { outcomes } = runResponseProcessing(item, { ...variables, responses }, context);
  const score = outcomes.get("SCORE");
  const feedback = outcomes.get("FEEDBACK");
  return {
    score: score?.cardinality === "single" ? Number(score.value) : null,
    feedback: feedback?.cardinality === "multiple" ? feedback.values.map(String) : [],
  };
}

/**
 * Runs the scenario: a package, a session, its state and report, the limits, the CAT handler, the scoring operators and a
 * compiled item.
 */
export async function runAll(): Promise<Results> {
  return {
    ...runSession(),
    limits: runLimits(),
    cat: await runCat(),
    operators: runOperators(),
    scoring: runScoring(),
  };
}
