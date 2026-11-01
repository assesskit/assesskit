import { ASI_NAMESPACE } from "@assesskit/runtime/asi";
import type { CatSessionPort } from "@assesskit/runtime/cat";
import { createEngine, type DeliveryDefinition, type Engine } from "@assesskit/runtime/delivery";
import { examDefinition, packageOf } from "./exam-fixture.js";

const CP = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1";

/** The identifiers of the items of the pool. */
const POOL = ["i1", "i2", "i3", "i4"] as const;

const item = (id: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${id}" title="Item ${id}" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>A</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1">
      <qti-simple-choice identifier="A">Alpha</qti-simple-choice>
      <qti-simple-choice identifier="B">Beta</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct"/>
</qti-assessment-item>`;

/** The files of a test of one adaptive section `A` over a pool of four items, with the limits of the section if given. */
export function adaptiveFiles(limits = ""): Readonly<Record<string, string>> {
  const refs = POOL.map((id) => `<qti-assessment-item-ref identifier="${id}" href="../items/${id}.xml"/>`).join("");
  const resources = POOL.map(
    (id) =>
      `<resource identifier="${id}" type="imsqti_item_xmlv3p0" href="items/${id}.xml"><file href="items/${id}.xml"/></resource>`,
  ).join("");
  return {
    "imsmanifest.xml": `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="${CP}" identifier="adaptive-package">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    <resource identifier="exam" type="imsqti_test_xmlv3p0" href="tests/exam.xml"><file href="tests/exam.xml"/></resource>
    ${resources}
  </resources>
</manifest>`,
    "tests/exam.xml": `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="exam" title="Exam">
  <qti-test-part identifier="part" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="A" title="A" visible="true">
      ${limits}
      <qti-adaptive-selection><qti-adaptive-engine-ref identifier="engine" href="https://cat.example/api"/><qti-adaptive-settings-ref identifier="settings" href="settings.json"/></qti-adaptive-selection>
      ${refs}
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`,
    ...Object.fromEntries(POOL.map((id) => [`items/${id}.xml`, item(id)])),
  };
}

/** An item that a person scores, in the part that follows the adaptive section. */
const RATED = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="b1" title="Item b1" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`;

/**
 * The files of a test whose adaptive section `A` is followed by a second part with a section `B` of one item that a person
 * scores, so that a candidate can leave `A` for `B` by ending the first part before the CAT engine ended the session.
 */
export function abandonedFiles(): Readonly<Record<string, string>> {
  const files = adaptiveFiles();
  const test = (files["tests/exam.xml"] ?? "").replace(
    "</qti-test-part>",
    '</qti-test-part><qti-test-part identifier="second" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="B" title="B" visible="true"><qti-assessment-item-ref identifier="b1" href="../items/b1.xml"/></qti-assessment-section></qti-test-part>',
  );
  const manifest = (files["imsmanifest.xml"] ?? "").replace(
    "</resources>",
    '<resource identifier="b1" type="imsqti_item_xmlv3p0" href="items/b1.xml"><file href="items/b1.xml"/></resource></resources>',
  );
  return { ...files, "tests/exam.xml": test, "imsmanifest.xml": manifest, "items/b1.xml": RATED };
}

const LINK = `<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
    xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0">
  <blti:title>Drawing tool</blti:title>
  <blti:secure_launch_url>https://tool.example.com/lti/tools/drawing</blti:secure_launch_url>
</cartridge_basiclti_link>`;

/** The files of {@link abandonedFiles} with a link to a tool, which scores itself, in place of the item that a person scores. */
export function abandonedToolFiles(): Readonly<Record<string, string>> {
  const { "items/b1.xml": _essay, ...files } = abandonedFiles();
  return {
    ...files,
    "imsmanifest.xml": (files["imsmanifest.xml"] ?? "").replace(
      '<resource identifier="b1" type="imsqti_item_xmlv3p0" href="items/b1.xml"><file href="items/b1.xml"/></resource>',
      '<resource identifier="b1" type="imsbasiclti_xmlv1p3" href="lti/b1.xml"><file href="lti/b1.xml"/></resource>',
    ),
    "tests/exam.xml": (files["tests/exam.xml"] ?? "").replace("../items/b1.xml", "../lti/b1.xml"),
    "lti/b1.xml": LINK,
  };
}

/** The definition of the adaptive test, whose section `A` has a CAT engine behind the port. */
export function adaptiveDefinition(files: Readonly<Record<string, string>>): DeliveryDefinition {
  const definition = examDefinition(packageOf(files));
  if (definition.kind !== "test") throw new Error("The fixture is a test.");
  return {
    ...definition,
    catSections: new Map([["A", { prefix: "https://cat.example/api", sectionIdentifier: "section-1" }]]),
  };
}

/** The engine of the adaptive test. */
export function adaptiveEngine(files: Readonly<Record<string, string>>): Engine {
  return createEngine(adaptiveDefinition(files));
}

type Method = "createSession" | "submitResults" | "endSession";

/** A port that answers from a script, records its calls and can be made to fail. It has the three methods of a session and no deployment of sections. */
export interface ScriptedPort extends CatSessionPort {
  /** The methods that were called, in order. */
  readonly calls: Method[];
  /** Makes the next calls of a method reject. */
  fail(method: Method, times?: number): void;
  /** Makes the next call of a method wait until the returned function is called. */
  hold(method: Method): () => void;
}

/** A port whose Create Session returns the first stage, whose Submit Results returns the stages in turn and then ends. */
export function scriptedPort(
  stages: readonly (readonly string[])[] = [["i3"]],
  first: readonly string[] = ["i1", "i2"],
): ScriptedPort {
  const calls: Method[] = [];
  const failures = new Map<Method, number>();
  const holds = new Map<Method, Promise<void>>();
  let step = 0;
  const call = async (method: Method): Promise<void> => {
    calls.push(method);
    await holds.get(method);
    holds.delete(method);
    const left = failures.get(method) ?? 0;
    if (left > 0) {
      failures.set(method, left - 1);
      throw new Error("The CAT engine is down.");
    }
  };
  return {
    calls,
    fail: (method, times = 1) => void failures.set(method, times),
    hold: (method) => {
      let release: () => void = () => undefined;
      holds.set(method, new Promise<void>((resolve) => (release = resolve)));
      return release;
    },
    createSession: async () => {
      await call("createSession");
      return { sessionIdentifier: "session-1", nextItems: { itemIdentifiers: [...first], stageLength: first.length } };
    },
    submitResults: async () => {
      await call("submitResults");
      const next = stages[step++];
      return next === undefined
        ? { nextItems: null }
        : { nextItems: { itemIdentifiers: [...next], stageLength: next.length } };
    },
    endSession: async () => call("endSession"),
  };
}

/** The items of the pools of the two adaptive sections of {@link reviewFiles}: the first stage of each gives two of three. */
const REVIEW_POOLS = { A: ["a1", "a2", "a3"], B: ["b1", "b2", "b3"] } as const;

/**
 * The files of a test whose only part is nonlinear, with individual submission and two attempts for each item, and two
 * adaptive sections `A` and `B` of three items each, for the recipe of a review step with a cap on changes.
 */
export function reviewFiles(): Readonly<Record<string, string>> {
  const section = (id: keyof typeof REVIEW_POOLS): string =>
    `<qti-assessment-section identifier="${id}" title="${id}" visible="true">
      <qti-adaptive-selection><qti-adaptive-engine-ref identifier="engine" href="https://cat.example/api"/><qti-adaptive-settings-ref identifier="settings" href="settings.json"/></qti-adaptive-selection>
      ${REVIEW_POOLS[id].map((ref) => `<qti-assessment-item-ref identifier="${ref}" href="../items/${ref}.xml"/>`).join("")}
    </qti-assessment-section>`;
  const pool = [...REVIEW_POOLS.A, ...REVIEW_POOLS.B];
  return {
    "imsmanifest.xml": `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="${CP}" identifier="review-package">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    <resource identifier="exam" type="imsqti_test_xmlv3p0" href="tests/exam.xml"><file href="tests/exam.xml"/></resource>
    ${pool.map((id) => `<resource identifier="${id}" type="imsqti_item_xmlv3p0" href="items/${id}.xml"><file href="items/${id}.xml"/></resource>`).join("")}
  </resources>
</manifest>`,
    "tests/exam.xml": `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="exam" title="Exam">
  <qti-test-part identifier="part" navigation-mode="nonlinear" submission-mode="individual">
    <qti-item-session-control max-attempts="2"/>
    ${section("A")}${section("B")}
  </qti-test-part>
</qti-assessment-test>`,
    ...Object.fromEntries(pool.map((id) => [`items/${id}.xml`, item(id)])),
  };
}

/** The engine of {@link reviewFiles}, whose two adaptive sections have a CAT engine behind the port. */
export function reviewEngine(files: Readonly<Record<string, string>>): Engine {
  const definition = examDefinition(packageOf(files));
  if (definition.kind !== "test") throw new Error("The fixture is a test.");
  return createEngine({
    ...definition,
    catSections: new Map([
      ["A", { prefix: "https://cat.example/api", sectionIdentifier: "section-a" }],
      ["B", { prefix: "https://cat.example/api", sectionIdentifier: "section-b" }],
    ]),
  });
}

/** A port for {@link reviewFiles}: Create Session gives the first two items of the pool of the section, and Submit Results ends the session. */
export function reviewPort(): ScriptedPort {
  const port = scriptedPort([], []);
  return {
    ...port,
    createSession: async (prefix, section, request) => {
      await port.createSession(prefix, section, request);
      const items = section === "section-a" ? REVIEW_POOLS.A : REVIEW_POOLS.B;
      return {
        sessionIdentifier: `session-${section}`,
        nextItems: { itemIdentifiers: items.slice(0, 2), stageLength: 2 },
      };
    },
  };
}
