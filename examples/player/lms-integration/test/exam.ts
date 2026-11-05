import {
  createAssetGate,
  createSessionHost,
  type SessionHost,
  type SessionStore,
  type StepSink,
  type StoredSession,
} from "@assesskit/player/server";
import { ASI_NAMESPACE } from "@assesskit/runtime/asi";
import { createEngine } from "@assesskit/runtime/delivery";
import { createPackageResolvers, openPackage, type QtiPackage } from "@assesskit/runtime/package";
import type { Clock } from "@interopkit/core";

const CP = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1";

/** The launch URL of the tool in the link of the exam. */
const DRAW_LAUNCH_URL = "https://tool.example.com/lti/tools/drawing";

/** The origin of the asset gate, which these tests do not load from. */
const ASSET_ORIGIN = "https://assets.example";

const ESSAY = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="essay" title="Essay" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`;

const LINK = `<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
    xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0" xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0">
  <blti:title>Drawing tool</blti:title>
  <blti:custom><lticm:property name="exam">tryout-1</lticm:property></blti:custom>
  <blti:secure_launch_url>${DRAW_LAUNCH_URL}</blti:secure_launch_url>
</cartridge_basiclti_link>`;

/**
 * The files of a package that delivers an essay, which a person scores, and a link to a drawing tool, which the tool scores.
 * The test sums the `SCORE` of its items; with `maximum` it also declares `MAXSCORE`, the highest possible total.
 */
export function examFiles(options: { readonly maximum?: number } = {}): Readonly<Record<string, string>> {
  const maximum =
    options.maximum === undefined
      ? ""
      : `<qti-outcome-declaration identifier="MAXSCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>${options.maximum}</qti-value></qti-default-value></qti-outcome-declaration>`;
  return {
    "imsmanifest.xml": `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="${CP}" identifier="exam-package">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    <resource identifier="exam" type="imsqti_test_xmlv3p0" href="tests/exam.xml"><file href="tests/exam.xml"/></resource>
    <resource identifier="essay" type="imsqti_item_xmlv3p0" href="items/essay.xml"><file href="items/essay.xml"/></resource>
    <resource identifier="draw" type="imsbasiclti_xmlv1p3" href="lti/draw.xml"><file href="lti/draw.xml"/></resource>
  </resources>
</manifest>`,
    "tests/exam.xml": `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="exam" title="Exam">
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  ${maximum}
  <qti-test-part identifier="part" navigation-mode="nonlinear" submission-mode="individual">
    <qti-assessment-section identifier="section" title="Section" visible="true">
      <qti-assessment-item-ref identifier="essay" href="../items/essay.xml"/>
      <qti-assessment-item-ref identifier="draw" href="../lti/draw.xml"/>
    </qti-assessment-section>
  </qti-test-part>
  <qti-outcome-processing>
    <qti-set-outcome-value identifier="SCORE"><qti-sum><qti-test-variables variable-identifier="SCORE"/></qti-sum></qti-set-outcome-value>
  </qti-outcome-processing>
</qti-assessment-test>`,
    "items/essay.xml": ESSAY,
    "lti/draw.xml": LINK,
  };
}

/** Opens the package of the exam from its files. */
export function packageOf(files: Readonly<Record<string, string>>): QtiPackage {
  const bytes = new Map(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));
  return openPackage({ paths: [...bytes.keys()].sort(), read: (path) => bytes.get(path) });
}

/** A session store in memory with the atomic `create` and `save` of the interface. */
function memoryStore(): SessionStore {
  const records = new Map<string, StoredSession>();
  return {
    create: async (session, record) => {
      if (records.has(session)) return false;
      records.set(session, { ...record, version: 0, seq: 0 });
      return true;
    },
    load: async (session) => records.get(session),
    save: async (session, { action: _action, ...record }) => {
      const stored = records.get(session);
      if (stored === undefined || stored.version !== record.version) return false;
      records.set(session, { ...record, version: record.version + 1 });
      return true;
    },
  };
}

/**
 * A session host over the exam, with every store in memory. The scheduler holds no jobs because no test here waits for a time-out.
 *
 * @param pkg - The package of the exam.
 * @param clock - The time of the server.
 * @param onStep - The host's log, which receives the events of each step.
 */
export async function sessionHostOver(pkg: QtiPackage, clock: Clock, onStep: StepSink): Promise<SessionHost> {
  const document = pkg.document("tests/exam.xml");
  if (document.kind !== "test") throw new Error("The exam is not a test.");
  const engine = createEngine({
    kind: "test",
    test: document.test,
    base: "tests/exam.xml",
    resolvers: createPackageResolvers(pkg),
  });
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const packages = async (): Promise<QtiPackage> => pkg;
  const gate = createAssetGate({
    key,
    origin: ASSET_ORIGIN,
    packages,
    files: { put: async () => ({ reference: "none", mimeType: "text/plain" }), read: async () => undefined },
    clock,
  });
  return createSessionHost({
    engine,
    store: memoryStore(),
    scheduler: { schedule: async () => undefined },
    clock,
    gate,
    packages,
    onStep,
  });
}
