import { type Action, createEngine, type DeliveryState, writeView } from "../src/delivery/index.js";
import { createPackageResolvers, readManifest, readPackage, writePackage } from "../src/package/index.js";
import { writeResults } from "../src/results/index.js";
import { buildSingle } from "../src/values/index.js";

// A package is a ZIP archive of QTI documents. This one is built in memory, so that the example runs as it is; in Node.js
// `readPackageFile` of `@assesskit/runtime/node` reads one from disk.
const NAMESPACE = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';
const item = (identifier: string, title: string, correct: string) => `<qti-assessment-item ${NAMESPACE}
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
const test = `<qti-assessment-test ${NAMESPACE} identifier="quiz" title="Quiz">
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
const manifest =
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
const encoder = new TextEncoder();
const zip = writePackage(
  manifest,
  new Map([
    ["test.xml", encoder.encode(test)],
    ["items/q1.xml", encoder.encode(item("q1", "Capital of France?", "A"))],
    ["items/q2.xml", encoder.encode(item("q2", "Capital of Italy?", "B"))],
  ]),
);

// Read the package and create the engine of its test. `createEngine` checks everything a session can reach first.
const pkg = readPackage(zip);
const document = pkg.document("test.xml");
if (document.kind !== "test") throw new Error("Expected a test.");
const engine = createEngine({
  kind: "test",
  test: document.test,
  base: "test.xml",
  resolvers: createPackageResolvers(pkg),
});

// The engine reads no clock: every step takes the time it happened, in epoch milliseconds. A refusal is data.
const apply = (state: DeliveryState, action: Action) => {
  const step = engine.apply(state, action);
  if (!step.ok) throw new Error(step.refusal.message);
  return step;
};
const started = engine.start({ seed: 7, at: 0 });
if (!started.ok) throw new Error(started.refusal.message);

// The candidate view holds what the candidate sees, and no answer key.
const view = engine.view(started.state, 0);
console.log(view.current?.title);
console.log(view.current?.interactions[0]?.choices.map(({ identifier }) => identifier).join(" "));
console.log(view.actions.join(" "));
// The JSON form of the view, as a server sends it to a client, holds no correct response.
console.log(JSON.stringify(writeView(view)).includes("qti-correct-response"));

const answered = apply(started.state, {
  type: "set-responses",
  item: { ref: "q1", instance: 1 },
  responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
  at: 1_000,
});
const moved = apply(answered.state, { type: "move", to: "next", at: 2_000 });
console.log(moved.events.map(({ type }) => type).join(" "));
const refused = engine.apply(moved.state, { type: "move", to: "previous", at: 2_500 });
console.log(refused.ok ? "accepted" : refused.refusal.reason);

const second = apply(moved.state, {
  type: "set-responses",
  item: { ref: "q2", instance: 1 },
  responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
  at: 3_000,
});
const ended = apply(second.state, { type: "end-test", at: 4_000 });
console.log(ended.state.status, JSON.stringify(ended.state.outcomes.get("TOTAL")));

// The report of the session, as a Results Reporting document.
const results = engine.results(ended.state);
console.log(results.itemResults.map(({ identifier, sessionStatus }) => `${identifier} ${sessionStatus}`).join(", "));
console.log(writeResults(results).match(/<outcomeVariable identifier="TOTAL".*?<\/outcomeVariable>/)?.[0]);
