import { ASI_NAMESPACE } from "@assesskit/runtime/asi";
import type { DeliveryDefinition } from "@assesskit/runtime/delivery";
import { createEngine } from "@assesskit/runtime/delivery";
import { openPackage, packageResolvers, type QtiPackage } from "@assesskit/runtime/package";
import type { FileValue } from "@assesskit/runtime/values";
import {
  createAssetGate,
  createSessionHost,
  type Scheduler,
  type SessionSave,
  type SessionStore,
  type StepEvents,
  type StoredSession,
} from "../src/server/index.js";

const CP = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1";
const MATCH_CORRECT = "https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct";

/** A 1 by 1 PNG, the image the fixture items reference. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (character) => character.charCodeAt(0),
);

const item = (id: string, extra = "", body = "<p>Question</p>"): string => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${id}" title="Item ${id}" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>A</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  ${extra}
  <qti-item-body>
    ${body}
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1">
      <qti-prompt>Choose</qti-prompt>
      <qti-simple-choice identifier="A">Alpha</qti-simple-choice>
      <qti-simple-choice identifier="B">Beta</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
  <qti-response-processing template="${MATCH_CORRECT}"/>
</qti-assessment-item>`;

const PCI_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="q3" title="Item q3" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="PCI" cardinality="single" base-type="integer"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"><qti-default-value><qti-value>0</qti-value></qti-default-value></qti-outcome-declaration>
  <qti-stylesheet href="style.css" type="text/css"/>
  <qti-item-body>
    <qti-portable-custom-interaction response-identifier="PCI" custom-interaction-type-identifier="urn:test:pci" module="pci-module">
      <qti-interaction-modules primary-configuration="modules/pci/module_resolution.js" secondary-configuration="modules/pci/fallback.js">
        <qti-interaction-module id="pci-module" primary-path="modules/pci/main"/>
      </qti-interaction-modules>
      <qti-prompt>Press the button</qti-prompt>
      <qti-interaction-markup><div id="press" data-role="button">Press</div></qti-interaction-markup>
    </qti-portable-custom-interaction>
  </qti-item-body>
</qti-assessment-item>`;

/** The module of the fixture PCI: it depends on `./renderer`, which RequireJS resolves under the prefix of the gate. */
const PCI_MAIN = `define(["qtiCustomInteractionContext", "./renderer"], function (context, renderer) {
  context.register({
    typeIdentifier: "urn:test:pci",
    getInstance: function (dom, configuration, state) {
      var count = state ? JSON.parse(state).count : 0;
      var instance = {
        typeIdentifier: "urn:test:pci",
        getResponse: function () { return count === 0 ? undefined : { base: { integer: count } }; },
        getState: function () { return JSON.stringify({ count: count }); },
        oncompleted: function () {},
        checkValidity: function () { return count > 0; },
        reportValidity: function () { return count > 0; },
        setCustomValidity: function () {},
        getCustomValidity: function () { return ""; },
      };
      renderer.onPress(dom, function () {
        count += 1;
        dom.dispatchEvent(new CustomEvent("qti-interaction-changed", { bubbles: true, cancelable: true,
          detail: { interaction: instance, responseIdentifier: configuration.responseIdentifier, valid: true, value: instance.getResponse() } }));
      });
      var press = dom.querySelector("#press");
      var style = getComputedStyle(press);
      parent.postMessage({ probe: "instance", color: style.color, image: style.backgroundImage, state: state === undefined ? null : state }, "*");
      configuration.onready(instance, instance.getState());
      return instance;
    },
  });
});`;

const PCI_RENDERER = `define([], function () {
  return { onPress: function (dom, handler) { dom.addEventListener("click", function (event) { if (event.target.id === "press") handler(); }); } };
});`;

const test = (part: string, limits = "", control = ""): string => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="${ASI_NAMESPACE}" identifier="exam" title="Exam">
  <qti-outcome-declaration identifier="TOTAL" cardinality="single" base-type="float"/>
  <qti-test-part identifier="part" ${part}>
    <qti-rubric-block view="candidate"><qti-content-body><p>Read every question.</p></qti-content-body></qti-rubric-block>
    <qti-assessment-section identifier="section" title="Section" visible="true">
      <qti-assessment-item-ref identifier="q1" href="../items/q1/item.xml">${control}${limits}</qti-assessment-item-ref>
      <qti-assessment-item-ref identifier="q2" href="../items/q2/item.xml"/>
      <qti-assessment-item-ref identifier="q3" href="../items/q3/item.xml"/>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`;

const resource = (
  id: string,
  type: string,
  href: string,
  files: readonly string[] = [href],
  dependencies = "",
): string =>
  `<resource identifier="${id}" type="${type}" href="${href}">${files.map((file) => `<file href="${file}"/>`).join("")}${dependencies}</resource>`;

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="${CP}" identifier="exam-package">
  <metadata><schema>QTI Package</schema><schemaversion>3.0.0</schemaversion></metadata>
  <organizations/>
  <resources>
    ${resource("exam", "imsqti_test_xmlv3p0", "tests/exam.xml")}
    ${resource("q1", "imsqti_item_xmlv3p0", "items/q1/item.xml", ["items/q1/item.xml", "items/q1/images/map.png", "items/q1/style.css"])}
    ${resource("q2", "imsqti_item_xmlv3p0", "items/q2/item.xml")}
    ${resource("q3", "imsqti_item_xmlv3p0", "items/q3/item.xml")}
    ${resource("pci-modules", "webcontent", "modules/pci/main.js", ["modules/pci/main.js", "modules/pci/renderer.js", "modules/pci/module_resolution.js"])}
    ${resource("notes", "webcontent", "items/q1/notes.xml", ["items/q1/notes.xml"])}
  </resources>
</manifest>`;

const STYLE = ".note { color: #123456; }\n";

/** A file of the fixture package that is XML in the namespace of QTI data, though the manifest lists it as web content. */
export const HIDDEN_KEY_FILE = "items/q1/notes.xml";

/** A page of the package that a link of the content could open: it tells its opener that its script ran. */
export const HOSTILE_PAGE = '<!doctype html><title>Page</title><script>parent.postMessage("script-ran", "*")</script>';

/** The files of the fixture package: a test of three items in a nonlinear part, an image, a stylesheet and a key that hides as web content. */
export function examFiles(
  options: { readonly part?: string; readonly limits?: string; readonly control?: string } = {},
): Readonly<Record<string, string | Uint8Array>> {
  return {
    "imsmanifest.xml": MANIFEST,
    "tests/exam.xml": test(
      options.part ?? 'navigation-mode="nonlinear" submission-mode="individual"',
      options.limits,
      options.control,
    ),
    "items/q1/item.xml": item(
      "q1",
      '<qti-stylesheet href="style.css" type="text/css"/>',
      '<p>Look at <img src="images/map.png" alt="A map" width="10" height="10"/>.</p>',
    ),
    "items/q2/item.xml": item("q2"),
    "items/q3/item.xml": PCI_ITEM,
    "modules/pci/module_resolution.js": '{"waitSeconds": 7, "paths": {"pci-module": "modules/pci/main"}}',
    "modules/pci/main.js": PCI_MAIN,
    "modules/pci/renderer.js": PCI_RENDERER,
    "items/q3/style.css": "#press { background: url(images/dot.svg); color: #123456; }\n",
    "items/q3/images/dot.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
    "items/q1/images/map.png": PNG,
    "items/q1/style.css": STYLE,
    "items/q1/page.html": HOSTILE_PAGE,
    [HIDDEN_KEY_FILE]: `<?xml version="1.0"?><qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="hidden" title="Hidden" adaptive="false" time-dependent="false"/>`,
  };
}

/** The item q3 of the fixture as a portable custom interaction on a module that the fixtures serve. */
export function pciFiles(): Readonly<Record<string, string | Uint8Array>> {
  const files = { ...examFiles() };
  files["items/q3/item.xml"] = String(files["items/q3/item.xml"])
    .replace('module="pci-module"', 'module="simple"')
    .replace(
      'custom-interaction-type-identifier="urn:test:pci"',
      'custom-interaction-type-identifier="urn:test:simple"',
    )
    .replace(
      /<qti-interaction-modules[\s\S]*<\/qti-interaction-modules>/u,
      '<qti-interaction-modules><qti-interaction-module id="simple" primary-path="modules/simple"/></qti-interaction-modules>',
    )
    .replace(
      "<qti-interaction-markup><p>Tap</p></qti-interaction-markup>",
      '<qti-prompt>Press the button</qti-prompt><qti-interaction-markup><div id="press" data-role="button">Press</div></qti-interaction-markup>',
    );
  return files;
}

/** The correct response of the rated item of {@link ratedFiles}, which only a scorer may see. */
export const RATED_KEY = "hidden-key";

const RATED_ITEM = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="q2" title="Item q2" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string">
    <qti-correct-response><qti-value>${RATED_KEY}</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-item-body><p>Type the word <qti-text-entry-interaction response-identifier="RESPONSE"/></p></qti-item-body>
</qti-assessment-item>`;

/**
 * The files of the fixture where the second item has a correct response and a `SCORE` that a person gives. `body` is more
 * content for the end of the body of that item, such as a rubric block for the scorer.
 */
export function ratedFiles(body = ""): Readonly<Record<string, string | Uint8Array>> {
  return { ...examFiles(), "items/q2/item.xml": RATED_ITEM.replace("</qti-item-body>", `${body}</qti-item-body>`) };
}

/** A pronunciation lexicon (PLS) that says W3C as the words. */
const LEXICON =
  '<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0" alphabet="ipa" xml:lang="en"><lexeme><grapheme>W3C</grapheme><alias>World Wide Web Consortium</alias></lexeme></lexicon>';

/** The files of the fixture where the first item depends on a pronunciation lexicon and both items say W3C. */
export function lexiconFiles(lexicon = LEXICON): Readonly<Record<string, string | Uint8Array>> {
  const files = { ...examFiles() };
  files["imsmanifest.xml"] = String(files["imsmanifest.xml"])
    .replace(
      '<file href="items/q1/style.css"/></resource>',
      '<file href="items/q1/style.css"/><dependency identifierref="words"/></resource>',
    )
    .replace(
      "</resources>",
      '<resource identifier="words" type="pls" href="items/q1/words.pls"><file href="items/q1/words.pls"/></resource></resources>',
    );
  files["items/q1/words.pls"] = lexicon;
  files["items/q1/item.xml"] = String(files["items/q1/item.xml"]).replace("<p>Look at ", "<p>Look at the W3C and ");
  files["items/q2/item.xml"] = String(files["items/q2/item.xml"]).replace("<p>Question</p>", "<p>The W3C again</p>");
  return files;
}

/** Opens a package from files given as text or bytes. */
export function packageOf(files: Readonly<Record<string, string | Uint8Array>>): QtiPackage {
  const bytes = new Map(
    Object.entries(files).map(([path, content]) => [
      path,
      typeof content === "string" ? new TextEncoder().encode(content) : content,
    ]),
  );
  return openPackage({ paths: [...bytes.keys()].sort(), read: (path) => bytes.get(path) });
}

/** The delivery definition of the fixture test, as a host builds it from the package. */
export function examDefinition(pkg: QtiPackage = packageOf(examFiles())): DeliveryDefinition {
  const document = pkg.document("tests/exam.xml");
  if (document.kind !== "test") throw new Error("The fixture test is not a test.");
  return { kind: "test", test: document.test, base: "tests/exam.xml", resolvers: packageResolvers(pkg) };
}

/** A clock that a test moves. */
export interface FakeClock {
  /** The time. */
  now(): number;
  /** Moves the time by the given milliseconds. */
  advance(milliseconds: number): void;
}

/** A clock that starts at the given time and stands still until a test advances it. */
export function fakeClock(start = 1_700_000_000_000): FakeClock {
  let time = start;
  return {
    now: () => time,
    advance: (milliseconds) => {
      time += milliseconds;
    },
  };
}

/** A session store in memory that can lose the race to another writer. */
export interface MemoryStore extends SessionStore {
  /** The records by session. */
  readonly records: Map<string, StoredSession>;
  /** The saves that were accepted, in order. */
  readonly saves: SessionSave[];
  /** Makes the next saves fail as a version conflict, each time with a competing write that bumps the version. */
  conflictNext(times: number): void;
}

/** Creates a session store in memory with the atomic `create` and `save` of the interface. */
export function memoryStore(): MemoryStore {
  const records = new Map<string, StoredSession>();
  const saves: SessionSave[] = [];
  let conflicts = 0;
  return {
    records,
    saves,
    conflictNext: (times) => {
      conflicts = times;
    },
    create: async (session, record) => {
      if (records.has(session)) return false;
      records.set(session, { ...record, version: 0, seq: 0 });
      return true;
    },
    load: async (session) => records.get(session),
    save: async (session, record) => {
      const stored = records.get(session);
      if (stored === undefined) return false;
      if (conflicts > 0) {
        conflicts -= 1;
        records.set(session, { ...stored, version: stored.version + 1 });
        return false;
      }
      if (stored.version !== record.version) return false;
      const { action: _action, ...kept } = record;
      records.set(session, { ...kept, version: record.version + 1 });
      saves.push(record);
      return true;
    },
  };
}

/** A scheduler that records what it was asked, once for each pair. */
export interface RecordingScheduler extends Scheduler {
  /** The jobs, each `[session, at]` once. */
  readonly jobs: [string, number][];
}

/** Creates a scheduler that keeps the jobs of a queue that ignores a pair it already has. */
export function recordingScheduler(): RecordingScheduler {
  const jobs: [string, number][] = [];
  return {
    jobs,
    schedule: async (session, at) => {
      if (!jobs.some(([other, when]) => other === session && when === at)) jobs.push([session, at]);
    },
  };
}

/** A file store in memory. */
export function memoryFileStore(): {
  put(bytes: Uint8Array, mimeType: string, fileName?: string): Promise<FileValue>;
  read(file: FileValue): Promise<Uint8Array | undefined>;
  readonly bytes: Map<string, Uint8Array>;
} {
  const bytes = new Map<string, Uint8Array>();
  return {
    bytes,
    put: async (content, mimeType, fileName) => {
      const reference = `file-${bytes.size + 1}`;
      bytes.set(reference, content);
      return { reference, mimeType, ...(fileName === undefined ? {} : { fileName }) };
    },
    read: async (file) => bytes.get(file.reference),
  };
}

/** Generates the HMAC key that signs the tokens of a gate. */
export function gateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The origin of the gate in tests that do not load from it. */
export const EXAM_ORIGIN = "https://assets.example";

/** An exam host over the fixture package, with the stores and the clock in memory. */
export async function examHost(
  extra: Partial<Parameters<typeof createSessionHost>[0]> = {},
  files: Readonly<Record<string, string | Uint8Array>> = examFiles(),
  origin = EXAM_ORIGIN,
) {
  const pkg = packageOf(files);
  const engine = extra.engine ?? createEngine(examDefinition(pkg));
  const clock = fakeClock();
  const store = memoryStore();
  const scheduler = recordingScheduler();
  const fileStore = memoryFileStore();
  const gate = createAssetGate({ key: await gateKey(), origin, packages: async () => pkg, files: fileStore });
  const logged: StepEvents[] = [];
  const host = createSessionHost({
    engine,
    store,
    scheduler,
    clock,
    gate,
    packages: async () => pkg,
    forward: { log: (step) => void logged.push(step) },
    ...extra,
  });
  return { pkg, engine, clock, store, scheduler, gate, host, logged, fileStore };
}
