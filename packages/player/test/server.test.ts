import type { CallOptions } from "@assesskit/runtime/checks";
import {
  createEngine,
  type DeliveryEventType,
  deserializeState,
  type HostAction,
  stamp,
} from "@assesskit/runtime/delivery";
import {
  CANDIDATE_ACTION_TYPES,
  type CandidateAction,
  type CandidateView,
  readView,
  writeCandidateAction,
  writeView,
} from "@assesskit/runtime/delivery/wire";
import { DataError, ServiceError } from "@assesskit/runtime/errors";
import { type PersonalNeedsProfile, PNP_NAMESPACE, readPnp } from "@assesskit/runtime/pnp";
import { buildSingle } from "@assesskit/runtime/values";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import assetGateGuide from "../../../docs/player/asset-gate.md?raw";
import serverGuide from "../../../docs/player/server.md?raw";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import { AccessError } from "../src/index.js";
import type { HostApplyOptions, ViewEnvelope } from "../src/protocol/index.js";
import { isOfficialResult } from "../src/protocol/internal.js";
import {
  type AssetGate,
  createAssetGate,
  createSessionHost,
  createToolScoreIntake,
  EXAM_CLIENT_ACTIONS,
  type SessionHost,
  type StepEvents,
  type ToolScore,
} from "../src/server/index.js";
import {
  collectAssetPrefixes,
  DEFAULT_TTL_SECONDS,
  DEFAULT_UPLOAD_TTL_SECONDS,
  MAX_SAVE_RETRIES,
} from "../src/server/internal.js";
import {
  abandonedFiles,
  abandonedToolFiles,
  adaptiveEngine,
  adaptiveFiles,
  reviewEngine,
  reviewFiles,
  reviewPort,
  type ScriptedPort,
  scriptedPort,
} from "./adaptive-fixture.js";
import {
  EXAM_ORIGIN,
  examDefinition,
  examFiles,
  examHost,
  gateKey,
  HIDDEN_KEY_FILE,
  lexiconFiles,
  memoryFileStore,
  memoryStore,
  packageOf,
  RATED_KEY,
  ratedFiles,
  recordingScheduler,
} from "./exam-fixture.js";
import { fuzzJson } from "./fuzz.js";
import { RUBRIC_WORD, rubricMarkup } from "./scoring-fixture.js";

const SECOND = 1000;

const json = (text: string): unknown => JSON.parse(text);

const DAY = 24 * 3600 * SECOND;
const ALICE = { session: "exam-1", principal: "alice" };
const BOB = { session: "exam-1", principal: "bob" };
const NOW = 1_700_000_000_000;

/** The envelope of a request: an action of the candidate in the runtime's JSON form, with its sequence number. */
const request = (seq: number, action: CandidateAction): unknown => ({ seq, action: writeCandidateAction(action) });
const Q1 = { ref: "q1", instance: 1 };
const answer = (identifier: string): CandidateAction => ({
  type: "set-responses",
  item: Q1,
  responses: new Map([["RESPONSE", buildSingle("identifier", identifier)]]),
});
const viewOf = (envelope: ViewEnvelope): CandidateView => readView(envelope.view);

describe("collectAssetPrefixes", () => {
  it("gives the content root the deepest directory that holds its document, image and stylesheet", async () => {
    const { host, pkg } = await examHost();
    const started = await host.start(ALICE, { seed: 1 });
    expect(Object.keys(started.assets)).toEqual(["items/q1/"]);
    expect(collectAssetPrefixes(viewOf(started), pkg)).toEqual(new Set(["items/q1/"]));
  });

  it("gives a portable custom interaction a prefix of its own, over its modules and module resolution files", async () => {
    const { host, pkg } = await examHost();
    await host.start(ALICE, { seed: 1 });
    const moved = await host.handle(ALICE, request(1, { type: "move", to: { ref: "q3", instance: 1 } }));
    expect(collectAssetPrefixes(viewOf(moved), pkg)).toEqual(new Set(["items/q3/", "modules/pci/"]));
    expect(Object.keys(moved.assets).sort()).toEqual(["items/q3/", "modules/pci/"]);
  });

  it("reads a module resolution file longer than its limit as one that is no module resolution file", async () => {
    const prefixesWith = async (text: string): Promise<ReadonlySet<string>> => {
      const { host, pkg } = await examHost({}, { ...examFiles(), "modules/pci/module_resolution.js": text });
      await host.start(ALICE, { seed: 1 });
      const moved = await host.handle(ALICE, request(1, { type: "move", to: { ref: "q3", instance: 1 } }));
      return collectAssetPrefixes(viewOf(moved), pkg);
    };
    const longer = `{"waitSeconds": 7, "paths": {"pci-module": "modules/pci/main"}}${" ".repeat(70_000)}`;
    expect(await prefixesWith(longer)).toEqual(await prefixesWith("not json"));
  });

  it("widens the prefix of the content root to the stylesheet of the test, after the end too", async () => {
    const files: Record<string, string | Uint8Array> = {
      ...examFiles(),
      "tests/styles/exam.css": "p { color: #123; }\n",
    };
    files["tests/exam.xml"] = String(files["tests/exam.xml"]).replace(
      '<qti-test-part identifier="part"',
      '<qti-stylesheet href="styles/exam.css" type="text/css"/><qti-test-part identifier="part"',
    );
    const { host, pkg } = await examHost({}, files);
    const started = await host.start(ALICE, { seed: 1 });
    expect(collectAssetPrefixes(viewOf(started), pkg)).toEqual(new Set([""]));
    await host.proctor(ALICE.session, { type: "end-test" });
    expect(collectAssetPrefixes(viewOf(await host.view(ALICE)), pkg)).toEqual(new Set(["tests/styles/"]));
  });

  it("gives no prefix to a view that shows no file", async () => {
    const { host, pkg } = await examHost();
    await host.start(ALICE, { seed: 1 });
    await host.proctor(ALICE.session, { type: "end-test" });
    expect(collectAssetPrefixes(viewOf(await host.view(ALICE)), pkg)).toEqual(new Set());
  });

  it("reads a srcset with more candidates than a call can take as arguments", async () => {
    const files = examFiles();
    const srcset = Array.from({ length: 200_000 }, () => "images/map.png 1x").join(", ");
    const item = String(files["items/q1/item.xml"]).replace(
      /<img [^>]*\/>/u,
      (img) => `<picture><source srcset="${srcset}" type="image/png"/>${img}</picture>`,
    );
    const { host, pkg } = await examHost({}, { ...files, "items/q1/item.xml": item });
    const started = await host.start(ALICE, { seed: 1 });
    expect(collectAssetPrefixes(viewOf(started), pkg)).toEqual(new Set(["items/q1/"]));
  });

  it("climbs to the directory that holds the files that the manifest lists for the resource", async () => {
    const files = examFiles();
    const manifest = String(files["imsmanifest.xml"]).replace(
      '<file href="items/q1/style.css"/>',
      '<file href="items/q1/style.css"/><file href="shared/font.woff2"/>',
    );
    const { host, pkg } = await examHost({}, { ...files, "imsmanifest.xml": manifest, "shared/font.woff2": "font" });
    const started = await host.start(ALICE, { seed: 1 });
    expect(collectAssetPrefixes(viewOf(started), pkg)).toEqual(new Set([""]));
  });
});

describe("a view request to handle", () => {
  const View = { type: "view" } as const;

  it("answers as view does, and applies and saves nothing", async () => {
    const { host, store } = await examHost();
    await host.start(ALICE, { seed: 1 });
    await host.handle(ALICE, request(1, { type: "move", to: "next" }));
    const saved = store.records.get(ALICE.session);
    const asked = await host.handle(ALICE, View);
    expect(asked).toEqual(await host.view(ALICE));
    expect(asked.seq).toBe(1);
    expect(viewOf(asked).current?.key.ref).toBe("q2");
    expect(store.records.get(ALICE.session)).toEqual(saved);
  });

  it("gives the view of a test that the proctor paused and then resumed, to a client that has no action", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 1 });
    await host.proctor(ALICE.session, { type: "suspend" });
    const paused = viewOf(await host.handle(ALICE, View));
    expect(paused.status).toBe("suspended");
    expect(paused.actions).toEqual([]);
    await host.proctor(ALICE.session, { type: "resume" });
    expect(viewOf(await host.handle(ALICE, View)).status).toBe("in-progress");
  });

  it("is refused for a session that is not bound to the caller, and for a request that holds more than the type", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 1 });
    await expect(host.handle({ session: ALICE.session, principal: "mallory" }, View)).rejects.toThrow(AccessError);
    await expect(host.handle(ALICE, JSON.parse('{"type":"view","seq":1}'))).rejects.toThrow(
      'A view request is invalid: unexpected property "seq".',
    );
  });

  it("finishes the CAT requests that wait first, as view does", async () => {
    const files = adaptiveFiles();
    const port = scriptedPort();
    const { host } = await examHost({ engine: adaptiveEngine(files), cat: port }, files);
    port.fail("createSession", 1);
    await expect(host.start(ALICE, { seed: 7 })).rejects.toThrow(ServiceError);
    expect(viewOf(await host.handle(ALICE, View)).current?.key).toEqual({ ref: "i1", instance: 1 });
  });
});

describe("the asset gate", () => {
  async function gateOf(files: Readonly<Record<string, string | Uint8Array>> = examFiles()) {
    const pkg = packageOf(files);
    const fileStore = memoryFileStore();
    const key = await gateKey();
    const gate = createAssetGate({ key, origin: EXAM_ORIGIN, packages: async () => pkg, files: fileStore });
    return { gate, pkg, fileStore, key };
  }
  /** The path of a file under a signed prefix, as a browser requests it. */
  const pathOf = (base: string, file: string): string => `${new URL(base).pathname}${file}`;
  const baseOf = async (gate: AssetGate, prefix: string): Promise<string> =>
    (await gate.sign("s1", [prefix], NOW))[prefix] ?? "";

  it("signs a prefix and serves the files under it with the headers of the gate", async () => {
    const { gate } = await gateOf();
    const base = await baseOf(gate, "items/q1/");
    expect(base).toMatch(/^https:\/\/assets\.example\/g\/[\w-]+\.[\w-]+\.[\w-]+\/$/u);
    const response = await gate.serve({ path: pathOf(base, "items/q1/images/map.png") }, NOW);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "image/png",
    });
    expect(response.body?.length).toBeGreaterThan(0);
  });

  it("serves a page, a drawing and a script of the package in a sandbox, so that a hostile package runs no script on the gate's origin", async () => {
    const hostile = "<script>parent.postMessage(document.cookie, '*')</script>";
    const { gate } = await gateOf({
      ...examFiles(),
      "items/q1/page.html": `<!doctype html>${hostile}`,
      "items/q1/page.htm": `<!doctype html>${hostile}`,
      "items/q1/drawing.svg": `<svg xmlns="http://www.w3.org/2000/svg">${hostile}</svg>`,
      "items/q1/pronunciation.pls": `<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0" alphabet="ipa" xml:lang="en"/>`,
      "items/q1/module.js": "export {};",
      "items/q1/note.txt": "A note.",
    });
    const base = await baseOf(gate, "items/q1/");
    for (const file of ["page.html", "page.htm", "drawing.svg", "pronunciation.pls", "module.js", "note.txt"]) {
      const response = await gate.serve({ path: pathOf(base, `items/q1/${file}`) }, NOW);
      expect(response.status, file).toBe(200);
      expect(response.headers["Content-Security-Policy"], file).toBe("sandbox");
    }
  });

  it("serves a PDF without the sandbox, which the viewer of Chromium refuses to show", async () => {
    const { gate } = await gateOf({ ...examFiles(), "items/q1/reading.pdf": "%PDF-1.7" });
    const response = await gate.serve({ path: pathOf(await baseOf(gate, "items/q1/"), "items/q1/reading.pdf") }, NOW);
    expect(response.status).toBe(200);
    expect(response.headers["Content-Security-Policy"]).toBeUndefined();
  });

  it("sends Referrer-Policy and nosniff with every status", async () => {
    const { gate } = await gateOf();
    const base = await baseOf(gate, "items/q1/");
    const answers = [
      await gate.serve({ path: pathOf(base, "items/q1/images/map.png") }, NOW),
      await gate.serve({ path: pathOf(base, "items/q1/images/none.png") }, NOW),
      await gate.serve({ path: pathOf(base, "items/q2/item.xml") }, NOW),
      await gate.serve({ path: "/elsewhere" }, NOW),
    ];
    expect(answers.map(({ status }) => status)).toEqual([200, 404, 403, 404]);
    for (const { headers } of answers) {
      expect(headers["Referrer-Policy"]).toBe("no-referrer");
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    }
  });

  it("refuses a path outside the prefix of the token, also when dots or percent-encoding lead out of it", async () => {
    const { gate } = await gateOf();
    const base = await baseOf(gate, "items/q1/");
    const paths = [
      "items/q2/item.xml",
      "items/q1/../q2/item.xml",
      "items/q1/../../imsmanifest.xml",
      "items/q1/%2e%2e/q2/item.xml",
      "items/q1/..%2F/..%2F/imsmanifest.xml",
      "items/q1x/images/map.png",
      "/items/q1/images/map.png",
      "../items/q1/images/map.png",
    ];
    for (const path of paths) expect((await gate.serve({ path: pathOf(base, path) }, NOW)).status, path).toBe(403);
  });

  it("refuses a token with a wrong MAC, another payload, or no MAC at all", async () => {
    const { gate } = await gateOf();
    const base = await baseOf(gate, "items/q1/");
    const [header = "", payload = "", mac = ""] = (new URL(base).pathname.split("/")[2] ?? "").split(".");
    const forged = Buffer.from(JSON.stringify({ session: "s2", prefix: "", exp: NOW + DAY })).toString("base64url");
    const wrong = mac.startsWith("A") ? `B${mac.slice(1)}` : `A${mac.slice(1)}`;
    const tokens = [
      `${header}.${payload}.${wrong}`,
      `${header}.${forged}.${mac}`,
      `${header}.${payload}`,
      `${header}.${payload}.${mac}.${mac}`,
      "..",
      `${header}.${payload}.`,
    ];
    for (const token of tokens) {
      const response = await gate.serve({ path: `/g/${token}/items/q1/images/map.png` }, NOW);
      expect(response.status, token).toBe(403);
    }
  });

  it("refuses a token signed with another key", async () => {
    const { gate } = await gateOf();
    const other = (await gateOf()).gate;
    const base = await baseOf(other, "items/q1/");
    expect((await gate.serve({ path: pathOf(base, "items/q1/images/map.png") }, NOW)).status).toBe(403);
  });

  it("refuses an expired token, an hour after it was signed by default", async () => {
    const { gate } = await gateOf();
    const path = pathOf(await baseOf(gate, "items/q1/"), "items/q1/images/map.png");
    expect((await gate.serve({ path }, NOW + DEFAULT_TTL_SECONDS * SECOND)).status).toBe(200);
    expect((await gate.serve({ path }, NOW + DEFAULT_TTL_SECONDS * SECOND + 1)).status).toBe(403);
  });

  it("never serves the manifest, the test or an item, even under a token for the whole package", async () => {
    const { gate } = await gateOf();
    const base = await baseOf(gate, "");
    for (const path of ["imsmanifest.xml", "tests/exam.xml", "items/q1/item.xml", "items/q2/item.xml"]) {
      expect((await gate.serve({ path: pathOf(base, path) }, NOW)).status, path).toBe(404);
    }
    expect((await gate.serve({ path: pathOf(base, "items/q1/style.css") }, NOW)).status).toBe(200);
  });

  it("never serves an XML file of QTI data that the manifest lists as web content or does not list", async () => {
    const asi = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
    const hidden: Readonly<Record<string, string>> = {
      prefixed: `<q:qti-assessment-item xmlns:q="${asi}" identifier="k"/>`,
      prolog: `<?xml version="1.0"?><!-- a comment > --><!DOCTYPE x [ <!ENTITY e "a>b"> ]><qti-assessment-item xmlns="${asi}"/>`,
      bracket: `<qti-assessment-item note=">" xmlns="${asi}" identifier="k"/>`,
      quotes: `<qti-assessment-item xmlns='${asi}'/>`,
      relativeLti: '<cartridge_basiclti_link xmlns="/xsd/imslticc_v1p0"/>',
      lti: '<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"/>',
      relativeAsi: '<qti-assessment-item xmlns="/xsd/imsqtiasi_v3p0"/>',
      packaging: '<manifest xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1"/>',
      results: '<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0"/>',
      usage: '<usageData xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0"/>',
      usage22: '<usageData xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v2p2"/>',
      metadata: '<qtiMetadata xmlns="http://www.imsglobal.org/xsd/imsqti_metadata_v3p0"/>',
      lom: '<lom xmlns="http://ltsc.ieee.org/xsd/LOM"/>',
      longComment: `<!--${"x".repeat(5000)}--><qti-assessment-item xmlns="${asi}"/>`,
      wrapped: `<html xmlns="http://www.w3.org/1999/xhtml"><body><qti-assessment-item xmlns="${asi}"/></body></html>`,
      noRoot: "<",
    };
    const utf16 = new TextEncoder().encode(`<qti-assessment-item xmlns="${asi}"/>`);
    const { gate } = await gateOf({
      ...examFiles(),
      // The same documents under names of web assets: an unlisted item saved as a page, a template as a vector image.
      ...Object.fromEntries(Object.entries(hidden).map(([name, text]) => [`items/q1/${name}.html`, text])),
      "items/q1/unlisted.svg": `<svg xmlns="http://www.w3.org/2000/svg"><qti-assessment-item xmlns="${asi}"/></svg>`,
      "items/q1/unlisted.xml": hidden.quotes ?? "",
      "items/q1/utf16.html": Uint8Array.from([0xff, 0xfe, ...[...utf16].flatMap((byte) => [byte, 0])]),
      "items/q1/utf16be.html": Uint8Array.from([0xfe, 0xff, ...[...utf16].flatMap((byte) => [0, byte])]),
      // UTF-16 without a byte order mark, which XML 1.0 Appendix F tells by the zero byte beside the first character.
      "items/q1/plain16le.txt": Uint8Array.from([...utf16].flatMap((byte) => [byte, 0])),
      "items/q1/plain16be.txt": Uint8Array.from([...utf16].flatMap((byte) => [0, byte])),
      // White space beyond the bytes that the sniff reads, in each encoding.
      "items/q1/spaces.html": `${" ".repeat(5000)}<qti-assessment-item xmlns="${asi}"/>`,
      "items/q1/bom8.txt": Uint8Array.from([
        0xef,
        0xbb,
        0xbf,
        ...new TextEncoder().encode(`${" ".repeat(5000)}<qti-assessment-item xmlns="${asi}"/>`),
      ]),
      "items/q1/lines.txt": `${"\r\n\t ".repeat(2000)}<qti-assessment-item xmlns="${asi}"/>`,
      "items/q1/spaces16.txt": Uint8Array.from([
        0xff,
        0xfe,
        ...[...new TextEncoder().encode(" ".repeat(5000))].flatMap((byte) => [byte, 0]),
        ...[...utf16].flatMap((byte) => [byte, 0]),
      ]),
    });
    const base = await baseOf(gate, "items/q1/");
    const names = [
      ...Object.keys(hidden).map((name) => `${name}.html`),
      "unlisted.svg",
      "unlisted.xml",
      "utf16.html",
      "utf16be.html",
      "plain16le.txt",
      "plain16be.txt",
      "spaces.html",
      "bom8.txt",
      "lines.txt",
      "spaces16.txt",
      HIDDEN_KEY_FILE.slice("items/q1/".length),
    ];
    for (const name of names) {
      expect((await gate.serve({ path: pathOf(base, `items/q1/${name}`) }, NOW)).status, name).toBe(404);
    }
  });

  it("serves web pages, vector images, scripts and data of the types a browser loads for content", async () => {
    const { gate } = await gateOf({
      ...examFiles(),
      "items/q1/page.html": '<!DOCTYPE html><html lang="en"><body>A note</body></html>',
      "items/q1/art.svg": '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      "items/q1/data.json": '{"points":[1,2]}',
      "items/q1/plain.txt": "no markup here",
      "items/q1/subtitles.vtt": "captions",
      "items/q1/lexicon.pls": "<lexicon/>",
      "items/q1/font.woff2": "font",
      "items/q1/UPPER.PNG": "png",
    });
    const base = await baseOf(gate, "items/q1/");
    const types: Record<string, string> = {};
    for (const name of [
      "page.html",
      "art.svg",
      "data.json",
      "plain.txt",
      "subtitles.vtt",
      "lexicon.pls",
      "font.woff2",
      "UPPER.PNG",
    ]) {
      const response = await gate.serve({ path: pathOf(base, `items/q1/${name}`) }, NOW);
      expect(response.status, name).toBe(200);
      types[name] = response.headers["Content-Type"] ?? "";
    }
    expect(types).toEqual({
      "page.html": "text/html; charset=utf-8",
      "art.svg": "image/svg+xml",
      "data.json": "application/json",
      "plain.txt": "text/plain; charset=utf-8",
      "subtitles.vtt": "text/vtt; charset=utf-8",
      "lexicon.pls": "application/pls+xml",
      "font.woff2": "font/woff2",
      "UPPER.PNG": "image/png",
    });
  });

  it("never serves a file of a type that is not a web asset: XML of any namespace, unknown extensions, none", async () => {
    const { gate } = await gateOf({
      ...examFiles(),
      "items/q1/notes.dat": '<notes xmlns="https://example.org/notes"><note>Hi</note></notes>',
      "items/q1/other.xml": '<notes xmlns="https://example.org/notes"/>',
      "items/q1/answers.bin": "A",
      "items/q1/answers": "A",
      "items/q1/.hidden": "A",
      "items/q1/dir.v2/answers": "A",
      "items/q1/ends.": "A",
    });
    const base = await baseOf(gate, "items/q1/");
    for (const name of ["notes.dat", "other.xml", "answers.bin", "answers", ".hidden", "dir.v2/answers", "ends."]) {
      expect((await gate.serve({ path: pathOf(base, `items/q1/${name}`) }, NOW)).status, name).toBe(404);
    }
  });

  /** The manifest of the fixture with resources and files added, as a package that lists more than the fixture does. */
  const listing = (resources: string, itemFiles = ""): string =>
    String(examFiles()["imsmanifest.xml"])
      .replace('<file href="items/q1/style.css"/>', `<file href="items/q1/style.css"/>${itemFiles}`)
      .replace("</resources>", `${resources}</resources>`);

  it("never serves a file that the manifest lists for an item unless it is a web asset", async () => {
    const files = ["parts/stem.xml", "parts/stem", "parts/stem.dat", "parts/hint.html", "parts/photo.png"];
    const { gate } = await gateOf({
      ...examFiles(),
      "imsmanifest.xml": listing("", files.map((file) => `<file href="items/q1/${file}"/>`).join("")),
      "items/q1/parts/stem.xml": "<stem/>",
      "items/q1/parts/stem": "<stem/>",
      "items/q1/parts/stem.dat": "<stem/>",
      "items/q1/parts/hint.html": "<p>A hint</p>",
      "items/q1/parts/photo.png": "png",
    });
    const base = await baseOf(gate, "items/q1/");
    const statuses = await Promise.all(
      files.map(async (file) => (await gate.serve({ path: pathOf(base, `items/q1/${file}`) }, NOW)).status),
    );
    expect(statuses).toEqual([404, 404, 404, 200, 200]);
  });

  it("never serves a fragment that an item or a test includes, whatever its name, namespace or whether it is listed", async () => {
    const xi = 'xmlns:xi="http://www.w3.org/2001/XInclude"';
    const include = (href: string): string => `<xi:include ${xi} href="${href}"/>`;
    const items = String(examFiles()["items/q1/item.xml"]).replace(
      "<qti-item-body>",
      `<qti-item-body>${include("parts/stem.html")}`,
    );
    const exam = String(examFiles()["tests/exam.xml"]).replace(
      "<qti-assessment-section ",
      `${include("../parts/section.html")}<qti-assessment-section `,
    );
    const { gate } = await gateOf({
      ...examFiles(),
      "items/q1/item.xml": items,
      "tests/exam.xml": exam,
      // A fragment with no namespace and a name of a web page, which neither the manifest nor the sniff would know.
      "items/q1/parts/stem.html": `<div ${xi}>The key is B.${include("deeper.html")}</div>`,
      "items/q1/parts/deeper.html": "<div>Also hidden</div>",
      "items/q1/parts/photo.png": "png",
      "parts/section.html": `<div ${xi}>${include("fragments/rubric.css")}</div>`,
      "parts/fragments/rubric.css": "scorer only",
    });
    const base = await baseOf(gate, "");
    const status = async (path: string): Promise<number> =>
      (await gate.serve({ path: pathOf(base, path) }, NOW)).status;
    expect(await status("items/q1/parts/stem.html")).toBe(404);
    expect(await status("items/q1/parts/deeper.html")).toBe(404);
    expect(await status("parts/section.html")).toBe(404);
    expect(await status("parts/fragments/rubric.css")).toBe(404);
    expect(await status("items/q1/parts/photo.png")).toBe(200);
    expect(await status("items/q1/style.css")).toBe(200);
  });

  it("never serves the template or the response processing that the manifest lists as a resource, whatever the name", async () => {
    const resources = [
      '<resource identifier="rp1" type="imsqti_rptemplate_xmlv3p0" href="templates/custom.xml"><file href="templates/custom.xml"/></resource>',
      '<resource identifier="rp2" type="imsqti_resprocessing_xmlv3p0" href="templates/shared.html"><file href="templates/shared.html"/></resource>',
      '<resource identifier="rp3" type="imsqti_fragment_xmlv3p0" href="fragments/part.txt"/>',
      '<resource identifier="rp4" type="imsqti_outcomes_xmlv3p0"><file href="fragments/outcomes.json"/></resource>',
      '<resource identifier="ud" type="qtiusagedata/xml" href="usage/data.json"/>',
      '<resource identifier="lti" type="imsbasiclti_xmlv1p3" href="links/tool.txt"/>',
      '<resource identifier="ctl" type="controlfile" href="control/settings.js"/>',
    ].join("");
    const { gate } = await gateOf({
      ...examFiles(),
      "imsmanifest.xml": listing(resources),
      "templates/custom.xml": "<responseProcessing/>",
      "templates/shared.html": "<responseProcessing/>",
      "fragments/part.txt": "a part",
      "fragments/outcomes.json": "{}",
      "usage/data.json": "{}",
      "links/tool.txt": "link",
      "control/settings.js": "settings",
    });
    const base = await baseOf(gate, "");
    for (const path of [
      "templates/custom.xml",
      "templates/shared.html",
      "fragments/part.txt",
      "fragments/outcomes.json",
      "usage/data.json",
      "links/tool.txt",
      "control/settings.js",
    ]) {
      expect((await gate.serve({ path: pathOf(base, path) }, NOW)).status, path).toBe(404);
    }
  });

  it("never serves the files that qti-adaptive-selection refers to", async () => {
    const adaptive = String(examFiles()["tests/exam.xml"]).replace(
      "</qti-assessment-section>",
      `<qti-adaptive-selection>
         <qti-adaptive-engine-ref identifier="engine" href="https://cat.example/engine"/>
         <qti-adaptive-settings-ref identifier="settings" href="../cat/settings.json"/>
       </qti-adaptive-selection></qti-assessment-section>`,
    );
    const { gate, pkg } = await gateOf({ ...examFiles(), "tests/exam.xml": adaptive, "cat/settings.json": '{"k":1}' });
    expect(pkg.paths).toContain("cat/settings.json");
    const base = await baseOf(gate, "");
    expect((await gate.serve({ path: pathOf(base, "cat/settings.json") }, NOW)).status).toBe(404);
    expect((await gate.serve({ path: pathOf(base, "items/q1/style.css") }, NOW)).status).toBe(200);
  });

  it("refuses to sign a prefix that is not a directory", async () => {
    const { gate } = await gateOf();
    for (const prefix of ["imsmanifest.xml", "items/q1", "items//", "../", "items/./", "a\\b/"]) {
      await expect(gate.sign("s1", [prefix], NOW), prefix).rejects.toThrow(DataError);
    }
  });

  it("signs the URL of a file of the candidate, and serves it for five minutes in a sandbox", async () => {
    const { gate, fileStore } = await gateOf();
    const file = await fileStore.put(new TextEncoder().encode("RIFF"), "audio/wav", { fileName: "answer.wav" });
    const url = await gate.signFile("s1", file, NOW);
    expect(url).toMatch(/^https:\/\/assets\.example\/f\/[\w-]+\.[\w-]+\.[\w-]+\/file-1$/u);
    const path = new URL(url).pathname;
    const response = await gate.serve({ path }, NOW);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      "Content-Type": "audio/wav",
      "Content-Security-Policy": "sandbox",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    expect(new TextDecoder().decode(response.body)).toBe("RIFF");
    expect((await gate.serve({ path }, NOW + DEFAULT_UPLOAD_TTL_SECONDS * SECOND)).status).toBe(200);
    expect((await gate.serve({ path }, NOW + DEFAULT_UPLOAD_TTL_SECONDS * SECOND + 1)).status).toBe(403);
  });

  it("refuses a file token for another file, and a token of the other kind", async () => {
    const { gate, fileStore } = await gateOf();
    const file = await fileStore.put(new Uint8Array([1]), "image/png");
    const token = new URL(await gate.signFile("s1", file, NOW)).pathname.split("/")[2] ?? "";
    expect((await gate.serve({ path: `/f/${token}/file-2` }, NOW)).status).toBe(403);
    expect((await gate.serve({ path: `/f/${token}/file-1/extra` }, NOW)).status).toBe(403);
    expect((await gate.serve({ path: `/f/${token}/%E0%A4%A` }, NOW)).status).toBe(403);
    expect((await gate.serve({ path: `/g/${token}/items/q1/images/map.png` }, NOW)).status).toBe(403);
    const packageToken = new URL(await baseOf(gate, "")).pathname.split("/")[2] ?? "";
    expect((await gate.serve({ path: `/f/${packageToken}/file-1` }, NOW)).status).toBe(403);
  });

  describe("with a signal", () => {
    const reason = new Error("The caller left.");

    /** A gate whose package and file store record the options they get, and whose store can hang. */
    async function recording(hang = false) {
      const pkg = packageOf(examFiles());
      const received: { readonly where: string; readonly signal: AbortSignal | undefined }[] = [];
      const files = {
        put: async () => ({ reference: "file-1", mimeType: "audio/wav" }),
        read: (_file: unknown, options?: { readonly signal?: AbortSignal }) => {
          received.push({ where: "files.read", signal: options?.signal });
          return hang ? new Promise<undefined>(() => undefined) : Promise.resolve(new Uint8Array([1]));
        },
      };
      const gate = createAssetGate({
        key: await gateKey(),
        origin: EXAM_ORIGIN,
        packages: async (_session, options) => {
          received.push({ where: "packages", signal: options?.signal });
          return pkg;
        },
        files,
      });
      return { gate, received };
    }

    it("passes the signal of serve to the package and to the file store", async () => {
      const { gate, received } = await recording();
      const controller = new AbortController();
      const base = await baseOf(gate, "items/q1/");
      const served = await gate.serve({ path: pathOf(base, "items/q1/images/map.png") }, NOW, {
        signal: controller.signal,
      });
      expect(served.status).toBe(200);
      const url = await gate.signFile("s1", { reference: "file-1", mimeType: "audio/wav" }, NOW);
      await gate.serve({ path: new URL(url).pathname }, NOW, { signal: controller.signal });
      expect(received).toEqual([
        { where: "packages", signal: controller.signal },
        { where: "files.read", signal: controller.signal },
      ]);
    });

    it("ends the wait of serve at the abort, though the file store never answers", async () => {
      const { gate } = await recording(true);
      const url = await gate.signFile("s1", { reference: "file-1", mimeType: "audio/wav" }, NOW);
      const controller = new AbortController();
      const waiting = gate.serve({ path: new URL(url).pathname }, NOW, { signal: controller.signal });
      const rejected = expect(waiting).rejects.toBe(reason);
      controller.abort(reason);
      await rejected;
    });

    it("rejects sign, signFile and serve with the reason when the signal has aborted, and asks for nothing", async () => {
      const { gate, received } = await recording();
      const options = { signal: AbortSignal.abort(reason) };
      await expect(gate.sign("s1", [""], NOW, options)).rejects.toBe(reason);
      await expect(gate.signFile("s1", { reference: "f", mimeType: "x/y" }, NOW, options)).rejects.toBe(reason);
      await expect(gate.serve({ path: "/g/t/x.png" }, NOW, options)).rejects.toBe(reason);
      expect(received).toEqual([]);
    });

    it("refuses options of another type", async () => {
      const { gate } = await recording();
      await expect(gate.sign("s1", [""], NOW, JSON.parse("5"))).rejects.toThrow(DataError);
      await expect(gate.serve({ path: "/x" }, NOW, JSON.parse('{"signal":1}'))).rejects.toThrow(DataError);
    });
  });

  it("refuses to sign a file whose reference is . or .., which a URL takes as a step out of the token", async () => {
    const { gate } = await gateOf();
    for (const reference of [".", ".."]) {
      await expect(gate.signFile("s1", { reference, mimeType: "image/png" }, NOW), reference).rejects.toThrow(
        new DataError(
          `The reference of the file cannot be "${reference}", which the path of a URL takes as a step to another path.`,
        ),
      );
    }
    for (const reference of ["...", "%2e%2e", "../x", "a/.."]) {
      const path = new URL(await gate.signFile("s1", { reference, mimeType: "image/png" }, NOW)).pathname;
      expect(decodeURIComponent(path.split("/")[3] ?? ""), reference).toBe(reference);
    }
  });

  it("answers 404 for a file that the store no longer has", async () => {
    const { gate } = await gateOf();
    const gone = await gate.signFile("s1", { reference: "gone", mimeType: "image/png" }, NOW);
    expect((await gate.serve({ path: new URL(gone).pathname }, NOW)).status).toBe(404);
  });

  it("checks its options and arguments", async () => {
    const { key, pkg, fileStore, gate } = await gateOf();
    const good = { key, origin: EXAM_ORIGIN, packages: async () => pkg, files: fileStore };
    const make = (changes: Record<string, unknown>): unknown => createAssetGate({ ...good, ...changes });
    expect(() => createAssetGate(JSON.parse("null"))).toThrow(DataError);
    expect(() => make({ origin: "http://assets.example" })).toThrow("an absolute https URL");
    for (const origin of ["http://127.0.0.1:5000", "http://localhost:8080", "http://[::1]:3000"]) {
      expect(() => make({ origin }), origin).not.toThrow();
    }
    // `http` is for loopback only: a name that merely starts or ends like one, another address of 127.0.0.0/8, the
    // unspecified address and a user name that looks like a host are not.
    const lookalikes = [
      "http://localhost.example",
      "http://127.0.0.1.example",
      "http://127.0.0.2",
      "http://0.0.0.0",
      "http://[::2]",
      "http://localhost.",
      "http://localhost@assets.example",
      "http://assets.example#localhost",
      "http://assets.example:80",
      "ftp://localhost",
      "http://",
    ];
    for (const origin of lookalikes) expect(() => make({ origin }), origin).toThrow(DataError);
    expect(() => make({ origin: "https://assets.example/path" })).toThrow("an origin without a path");
    expect(() => make({ key: "secret" })).toThrow("HMAC key");
    expect(() => make({ ttlSeconds: 0 })).toThrow(
      "The options object is invalid at ttlSeconds: expected a value of at least 1, found 0.",
    );
    expect(() => make({ uploadTtlSeconds: null })).toThrow(
      "The options object is invalid at uploadTtlSeconds: expected a number, found null.",
    );
    expect(() => make({ packages: null })).toThrow(
      "The options object is invalid at packages: expected a function, found null.",
    );
    expect(() => make({ files: {} })).toThrow(
      "The options object is invalid at files: expected an object with the functions put and read, found an object.",
    );
    expect(() => make({ extra: 1 })).toThrow('The options object is invalid: unexpected property "extra".');
    await expect(gate.sign(JSON.parse("5"), [], NOW)).rejects.toThrow("The session must be a string");
    await expect(gate.sign("s1", JSON.parse('["a/"]'), -1)).rejects.toThrow("The time now");
    await expect(gate.signFile("s1", JSON.parse('{"reference":1}'), NOW)).rejects.toThrow("The reference of the file");
    await expect(gate.serve(JSON.parse("null"), NOW)).rejects.toThrow("The request must be an object");
    await expect(gate.serve({ path: JSON.parse("5") }, NOW)).rejects.toThrow("The path of the request");
  });
});

describe("the client-action policy", () => {
  it("allows every action of the candidate but suspend and resume in an exam", () => {
    const every: Readonly<Record<CandidateAction["type"], true>> = {
      "set-responses": true,
      submit: true,
      "end-attempt": true,
      "next-attempt": true,
      skip: true,
      review: true,
      solution: true,
      comment: true,
      mark: true,
      move: true,
      support: true,
      "support-settings": true,
      "end-part": true,
      "end-test": true,
      suspend: true,
      resume: true,
    };
    expect([...CANDIDATE_ACTION_TYPES].sort()).toEqual(Object.keys(every).sort());
    expect(EXAM_CLIENT_ACTIONS).toEqual(
      CANDIDATE_ACTION_TYPES.filter((type) => type !== "suspend" && type !== "resume"),
    );
  });
});

describe("createSessionHost", () => {
  it("starts a session bound to the caller, and answers with the first view, the assets and the documents", async () => {
    const { host, store, scheduler, logged } = await examHost();
    const started = await host.start(ALICE, { seed: 7 });
    expect(started.seq).toBe(0);
    const view = viewOf(started);
    expect(view.status).toBe("in-progress");
    expect(view.current?.key).toEqual(Q1);
    expect(view.rubric.length).toBeGreaterThan(0);
    expect(started.documents).toEqual({ test: "tests/exam.xml", item: "items/q1/item.xml", stimuli: [], lexicons: [] });
    expect(Object.entries(started.assets)).toEqual([
      ["items/q1/", expect.stringMatching(/^https:\/\/assets\.example\/g\//u)],
    ]);
    expect(store.records.get("exam-1")).toMatchObject({ principal: "alice", version: 0, seq: 0 });
    expect(scheduler.jobs).toEqual([]);
    expect(logged.map(({ step }) => step)).toEqual(["start"]);
  });

  it("keeps the seed and the answer keys out of the envelope", async () => {
    const { host } = await examHost();
    const text = JSON.stringify(await host.start(ALICE, { seed: 987_654_321 }));
    expect(text).not.toContain("987654321");
    expect(text).not.toContain("correct");
    expect(text).not.toContain("match_correct");
  });

  it("names the pronunciation lexicons that the item presented depends on, and none for an item that depends on none", async () => {
    const { host } = await examHost({}, lexiconFiles());
    const started = await host.start(ALICE, { seed: 7 });
    expect(started.documents?.lexicons).toEqual(["items/q1/words.pls"]);
    const moved = await host.handle(ALICE, request(1, { type: "move", to: { ref: "q2", instance: 1 } }));
    expect(moved.documents?.lexicons).toEqual([]);
  });

  it("serves a lexicon under the prefix of the item, as a file of web content", async () => {
    const { host, gate } = await examHost({}, lexiconFiles());
    const started = await host.start(ALICE, { seed: 7 });
    const base = started.assets["items/q1/"] ?? "";
    const response = await gate.serve({ path: new URL(`${base}items/q1/words.pls`).pathname }, 0);
    expect(response.status).toBe(200);
    expect(response.headers["Content-Type"]).toBe("application/pls+xml");
  });

  it("answers an action with the view that the engine gives, and keeps the principal that started the session", async () => {
    const { host, engine, clock, store } = await examHost();
    await host.start(ALICE, { seed: 7 });
    clock.advance(5 * SECOND);
    const reply = await host.handle(ALICE, request(1, answer("A")));
    expect(reply.seq).toBe(1);
    expect(reply.refusal).toBeUndefined();
    expect(viewOf(reply).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
    const stored = store.records.get("exam-1");
    expect(stored).toMatchObject({ principal: "alice", version: 1, seq: 1 });
    const state = deserializeState(stored?.state ?? "");
    expect(viewOf(reply).actions).toEqual(engine.view(state, clock.now()).actions.filter((type) => type !== "suspend"));
  });

  it("puts a refusal of the engine in the envelope, and leaves the state as it was", async () => {
    const { host, store } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const before = store.records.get("exam-1")?.state;
    const reply = await host.handle(ALICE, request(1, { type: "submit", item: { ref: "q2", instance: 1 } }));
    expect(reply.refusal?.reason).toBe("not-current");
    expect(store.records.get("exam-1")?.state).toBe(before);
    expect(store.records.get("exam-1")?.seq).toBe(1);
  });

  it("gives 403 to a caller that is not the principal of the session, and to a session that does not exist", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const attempts = [
      host.handle(BOB, request(1, answer("B"))),
      host.check(BOB),
      host.view(BOB),
      host.handle({ session: "other", principal: "alice" }, request(1, answer("B"))),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({ name: "AccessError", reason: "not-bound" });
    }
    await expect(host.check(ALICE)).resolves.toBeUndefined();
  });

  it("never starts a session twice, and never binds it to another principal", async () => {
    const { host, store } = await examHost();
    await host.start(ALICE, { seed: 7 });
    await host.handle(ALICE, request(1, answer("A")));
    const before = store.records.get("exam-1");
    for (const caller of [ALICE, BOB]) {
      await expect(host.start(caller, { seed: 8 })).rejects.toMatchObject({
        name: "AccessError",
        reason: "session-exists",
      });
    }
    expect(store.records.get("exam-1")).toEqual(before);
    await expect(host.check(BOB)).rejects.toThrow(AccessError);
  });

  it("reports two starts that race as session-exists for the one that loses", async () => {
    const { host } = await examHost();
    const results = await Promise.allSettled([host.start(ALICE, { seed: 1 }), host.start(BOB, { seed: 2 })]);
    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = results.find((result) => result.status === "rejected");
    expect(lost?.status === "rejected" && lost.reason).toMatchObject({ reason: "session-exists" });
  });

  it("refuses the actions of the host from a client, whatever their form", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const actions = [
      { type: "time" },
      { type: "supply-scores", request: "r", value: null, scorer: "human" },
      { type: "cat-response", request: "r", response: { ended: true } },
    ];
    for (const action of actions) {
      await expect(host.handle(ALICE, { seq: 1, action })).rejects.toMatchObject({ name: "DataError" });
    }
    await expect(host.handle(ALICE, { seq: 1, action: { type: "move", to: "next", at: 5 } })).rejects.toMatchObject({
      name: "DataError",
    });
  });

  it("refuses an action that is larger than the limits", async () => {
    const { host } = await examHost({ limits: { maxActionSize: 50 } });
    await host.start(ALICE, { seed: 7 });
    await expect(host.handle(ALICE, request(1, answer("A".repeat(100))))).rejects.toThrow("maxActionSize of 50");
  });

  it("answers a repeated sequence number with the stored answer and changes nothing", async () => {
    const { host, store, logged, clock } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const first = await host.handle(ALICE, request(1, answer("A")));
    const saves = store.saves.length;
    const steps = logged.length;
    clock.advance(10 * SECOND);
    const again = await host.handle(ALICE, request(1, answer("B")));
    expect(again.view).toEqual(first.view);
    expect(again.seq).toBe(1);
    expect(store.saves).toHaveLength(saves);
    expect(logged).toHaveLength(steps);
    expect(viewOf(again).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
  });

  it("renews the tokens of a repeated answer", async () => {
    const { host, clock, gate } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const first = await host.handle(ALICE, request(1, answer("A")));
    clock.advance(2 * DAY);
    const again = await host.handle(ALICE, request(1, answer("A")));
    expect(Object.keys(again.assets)).toEqual(Object.keys(first.assets));
    const stale = new URL(first.assets["items/q1/"] ?? "").pathname;
    const fresh = new URL(again.assets["items/q1/"] ?? "").pathname;
    expect((await gate.serve({ path: `${stale}items/q1/images/map.png` }, clock.now())).status).toBe(403);
    expect((await gate.serve({ path: `${fresh}items/q1/images/map.png` }, clock.now())).status).toBe(200);
  });

  it("refuses a stale sequence number", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 7 });
    await host.handle(ALICE, request(1, answer("A")));
    await host.handle(ALICE, request(2, answer("B")));
    await expect(host.handle(ALICE, request(1, answer("A")))).rejects.toThrow(
      new DataError("The sequence number 1 is stale: the latest request answered has 2."),
    );
  });

  it("applies a request once when it is delivered twice at the same time", async () => {
    const { host, store } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const [first, second] = await Promise.all([
      host.handle(ALICE, request(1, answer("A"))),
      host.handle(ALICE, request(1, answer("A"))),
    ]);
    expect(first.view).toEqual(second.view);
    expect(store.saves).toHaveLength(1);
  });

  it("refuses suspend and resume from a client in an exam, and takes them out of the actions of the view", async () => {
    const { host, store } = await examHost();
    const started = await host.start(ALICE, { seed: 7 });
    expect(viewOf(started).actions).not.toContain("suspend");
    expect(viewOf(started).actions).toContain("move");
    const before = store.records.get("exam-1");
    await expect(host.handle(ALICE, request(1, { type: "suspend" }))).rejects.toThrow(
      /^A client may not send the action "suspend" in this session; the actions it may send are "set-responses"/u,
    );
    await expect(host.handle(ALICE, request(1, { type: "resume" }))).rejects.toThrow(DataError);
    expect(store.records.get("exam-1")).toEqual(before);
  });

  it("lets the host allow suspend and resume for a client, as practice does", async () => {
    const { host } = await examHost({ clientActions: CANDIDATE_ACTION_TYPES });
    const started = await host.start(ALICE, { seed: 7 });
    expect(viewOf(started).actions).toContain("suspend");
    const suspended = await host.handle(ALICE, request(1, { type: "suspend" }));
    expect(viewOf(suspended).status).toBe("suspended");
    expect(viewOf(suspended).actions).toEqual(["resume"]);
    const resumed = await host.handle(ALICE, request(2, { type: "resume" }));
    expect(viewOf(resumed).status).toBe("in-progress");
  });

  it("lets a candidate whose profile has breaks suspend and resume in an exam, and keeps every response", async () => {
    const profile = (breaks: boolean): PersonalNeedsProfile => {
      const read = readPnp(
        `<access-for-all-pnp xmlns="${PNP_NAMESPACE}"><environment><breaks>${breaks}</breaks></environment></access-for-all-pnp>`,
      );
      if (!("supports" in read)) throw new Error("The fixture profile must be one profile.");
      return read;
    };
    const { host, clock } = await examHost();
    const started = await host.start(ALICE, { seed: 7, pnp: profile(true) });
    expect(viewOf(started).actions).toContain("suspend");
    await host.handle(ALICE, request(1, answer("A")));
    clock.advance(4_000);
    const suspended = await host.handle(ALICE, request(2, { type: "suspend" }));
    expect(viewOf(suspended).status).toBe("suspended");
    expect(viewOf(suspended).actions).toEqual(["resume"]);
    clock.advance(600_000);
    const resumed = await host.handle(ALICE, request(3, { type: "resume" }));
    expect(viewOf(resumed).status).toBe("in-progress");
    expect(viewOf(resumed).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
    const without = await examHost();
    const plain = await without.host.start(ALICE, { seed: 7, pnp: profile(false) });
    expect(viewOf(plain).actions).not.toContain("suspend");
    await expect(without.host.handle(ALICE, request(1, { type: "suspend" }))).rejects.toThrow(DataError);
  });

  it("lets a client mark an item for review in an exam, keeps the mark in the stored session, and shows it again after a reload", async () => {
    const { host, store } = await examHost();
    const started = await host.start(ALICE, { seed: 7 });
    expect(viewOf(started).actions).toContain("mark");
    const marked = await host.handle(ALICE, request(1, { type: "mark", item: Q1, marked: true }));
    expect(marked.refusal).toBeUndefined();
    const marks = (view: CandidateView): string[] =>
      view.navigation.flatMap((entry) => (entry.kind === "item" && entry.marked ? [entry.key.ref] : []));
    expect(marks(viewOf(marked))).toEqual(["q1"]);
    expect(deserializeState(store.records.get("exam-1")?.state ?? "").items.map(({ marked }) => marked)).toEqual([
      true,
    ]);
    expect(marks(viewOf(await host.view(ALICE)))).toEqual(["q1"]);
    const refused = await host.handle(
      ALICE,
      request(2, { type: "mark", item: { ref: "q2", instance: 1 }, marked: true }),
    );
    expect(refused.refusal?.reason).toBe("unknown-item");
  });

  it("refuses a mark of a client that the policy does not allow it", async () => {
    const { host } = await examHost({ clientActions: ["set-responses", "move"] });
    const started = await host.start(ALICE, { seed: 7 });
    expect(viewOf(started).actions).not.toContain("mark");
    await expect(host.handle(ALICE, request(1, { type: "mark", item: Q1, marked: true }))).rejects.toThrow(DataError);
  });

  it("lets the proctor suspend and resume, and the candidate then sees the break and cannot end it", async () => {
    const { host, logged, store } = await examHost();
    await host.start(ALICE, { seed: 7 });
    await host.handle(ALICE, request(1, answer("A")));
    const suspended = await host.proctor(ALICE.session, { type: "suspend" });
    expect(suspended.refusal).toBeUndefined();
    const during = await host.handle(ALICE, request(2, answer("B")));
    expect(during.refusal?.reason).toBe("suspended");
    expect(viewOf(during).status).toBe("suspended");
    expect(viewOf(during).actions).toEqual([]);
    expect(viewOf(await host.view(ALICE)).status).toBe("suspended");
    await expect(host.handle(ALICE, request(3, { type: "resume" }))).rejects.toThrow(DataError);
    expect((await host.proctor(ALICE.session, { type: "resume" })).refusal).toBeUndefined();
    const after = await host.handle(ALICE, request(3, answer("B")));
    expect(after.refusal).toBeUndefined();
    expect(viewOf(after).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "B"));
    // The refused request saved a version without events, so the log has no step for it.
    expect(logged.map(({ step }) => step)).toEqual(["start", 1, 2, 4, 5]);
    expect(store.records.get("exam-1")?.version).toBe(5);
  });

  it("answers a proctor action that the engine refuses with the step, and saves nothing", async () => {
    const { host, store } = await examHost();
    await host.start(ALICE, { seed: 7 });
    await host.proctor(ALICE.session, { type: "end-test" });
    const version = store.records.get("exam-1")?.version;
    const suspended = await host.proctor(ALICE.session, { type: "suspend" });
    expect(suspended.events).toEqual([]);
    expect(suspended.refusal?.reason).toBe("ended");
    expect(store.records.get("exam-1")?.version).toBe(version);
    await expect(host.proctor("nobody", { type: "suspend" })).rejects.toThrow(DataError);
    await expect(host.proctor(ALICE.session, JSON.parse('{"type":"move"}'))).rejects.toThrow(
      /^The type of a proctor action must be "suspend", "resume", "end-part" or "end-test"/u,
    );
  });

  it("handles the request again when another request saved first, and applies it once", async () => {
    const { host, store, logged } = await examHost();
    await host.start(ALICE, { seed: 7 });
    store.conflictNext(MAX_SAVE_RETRIES);
    const reply = await host.handle(ALICE, request(1, answer("A")));
    expect(viewOf(reply).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
    expect(store.saves).toHaveLength(1);
    expect(store.records.get("exam-1")).toMatchObject({ version: MAX_SAVE_RETRIES + 1, seq: 1 });
    expect(logged.filter(({ events }) => events.some(({ type }) => type === "responses-set"))).toHaveLength(1);
  });

  it("fails with a ServiceError of 409 when the conflicts outlast the retries", async () => {
    const { host, store } = await examHost();
    await host.start(ALICE, { seed: 7 });
    store.conflictNext(MAX_SAVE_RETRIES + 1);
    await expect(host.handle(ALICE, request(1, answer("A")))).rejects.toMatchObject({
      name: "ServiceError",
      status: 409,
    });
    expect(store.saves).toEqual([]);
  });

  it("schedules the maximum times of the new state before it saves, and a job of the scheduler applies the time-out", async () => {
    const limits = '<qti-time-limits max-time="600"/>';
    const { host, scheduler, clock, store } = await examHost({}, examFiles({ limits }));
    const start = clock.now();
    await host.start(ALICE, { seed: 7 });
    expect(scheduler.jobs).toEqual([["exam-1", start + 600 * SECOND]]);
    clock.advance(300 * SECOND);
    await host.handle(ALICE, request(1, answer("A")));
    expect(scheduler.jobs).toHaveLength(1);
    clock.advance(301 * SECOND);
    const timedOut = await host.session(ALICE.session).apply({ type: "time" });
    expect(timedOut.refusal).toBeUndefined();
    expect(timedOut.events.map(({ type }) => type)).toContain("time-out");
    const late = await host.handle(ALICE, request(2, answer("B")));
    expect(late.refusal?.reason).toBe("time-over");
    expect(store.records.get("exam-1")?.version).toBe(3);
  });

  it("runs a test with no maximum time without a scheduler", async () => {
    const { host, store } = await examHost({ scheduler: undefined });
    await host.start(ALICE, { seed: 7 });
    await host.handle(ALICE, request(1, answer("A")));
    expect(store.records.get("exam-1")?.version).toBe(1);
  });

  it("refuses a test with a maximum time without a scheduler before any session starts, wherever the test has it", async () => {
    const refusal = new DataError(
      "The test of the option engine has a maximum time, which the session host cannot schedule without the option scheduler: pass a Scheduler, so that a session ends when its time passes.",
    );
    const limits = '<qti-time-limits max-time="600"/>';
    await expect(examHost({ scheduler: undefined }, examFiles({ limits }))).rejects.toThrow(refusal);
    // A maximum time that starts only at the second item counts too: a candidate never meets the refusal halfway.
    const files = { ...examFiles() };
    files["tests/exam.xml"] = String(files["tests/exam.xml"]).replace(
      '<qti-assessment-item-ref identifier="q2" href="../items/q2/item.xml"/>',
      `<qti-assessment-item-ref identifier="q2" href="../items/q2/item.xml">${limits}</qti-assessment-item-ref>`,
    );
    await expect(examHost({ scheduler: undefined }, files)).rejects.toThrow(refusal);
    await expect(examHost({}, files)).resolves.toBeDefined();
  });

  it("loses no time-out when the scheduler fails: nothing is saved and the request can be sent again", async () => {
    const limits = '<qti-time-limits max-time="600"/>';
    let failing = true;
    const scheduler = {
      schedule: async () => {
        if (failing) throw new ServiceError("The queue is down.", 503, "");
      },
    };
    const { host, store } = await examHost({ scheduler }, examFiles({ limits }));
    await expect(host.start(ALICE, { seed: 7 })).rejects.toThrow(ServiceError);
    expect(store.records.size).toBe(0);
    failing = false;
    await expect(host.start(ALICE, { seed: 7 })).resolves.toBeDefined();
  });

  it("does not schedule a job twice for one time, and does not fail when a job finds nothing to apply", async () => {
    const limits = '<qti-time-limits max-time="600"/>';
    const { host, scheduler, clock } = await examHost({}, examFiles({ limits }));
    await host.start(ALICE, { seed: 7 });
    await host.handle(ALICE, request(1, answer("A")));
    await host.handle(ALICE, request(2, answer("B")));
    expect(scheduler.jobs).toHaveLength(1);
    const early = await host.session(ALICE.session).apply({ type: "time" });
    expect(early).toEqual({ events: [] });
    clock.advance(601 * SECOND);
    await host.session(ALICE.session).apply({ type: "time" });
    const again = await host.session(ALICE.session).apply({ type: "time" });
    expect(again).toEqual({ events: [] });
  });

  it("absorbs a time-out whose job came late: the next action applies the deadline first", async () => {
    const limits = '<qti-time-limits max-time="600"/>';
    const { host, clock } = await examHost({}, examFiles({ limits }));
    await host.start(ALICE, { seed: 7 });
    clock.advance(700 * SECOND);
    const reply = await host.handle(ALICE, request(1, answer("A")));
    expect(reply.refusal?.reason).toBe("time-over");
    const first = viewOf(reply).navigation.find((entry) => entry.kind === "item" && entry.key.ref === "q1");
    expect(first?.kind === "item" && first.status).toBe("closed");
  });

  it("reads the stored state for the pending work, which takes a passed deadline only when a time action arrives", async () => {
    const essay = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="q1" title="Item q1" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`;
    const limits = '<qti-time-limits max-time="600"/>';
    const { host, clock } = await examHost({}, { ...examFiles({ limits }), "items/q1/item.xml": essay });
    await host.start(ALICE, { seed: 7 });
    const written = new Map([["RESPONSE", buildSingle("string", "An essay.")]]);
    await host.handle(ALICE, request(1, { type: "set-responses", item: Q1, responses: written }));
    clock.advance(700 * SECOND);
    const session = host.session(ALICE.session);
    expect((await session.pending()).scoring).toEqual([]);
    await session.apply({ type: "time" });
    expect((await session.pending()).scoring.map(({ id }) => id)).toEqual(["item:q1:1:SCORE"]);
  });

  it("restores a session from the store in a host with no memory of it", async () => {
    const first = await examHost();
    await first.host.start(ALICE, { seed: 7 });
    await first.host.handle(ALICE, request(1, answer("A")));
    const second = createSessionHost({
      engine: createEngine(examDefinition(first.pkg)),
      store: first.store,
      scheduler: recordingScheduler(),
      clock: first.clock,
      gate: first.gate,
      packages: async () => first.pkg,
    });
    const restored = await second.view(ALICE);
    expect(restored.seq).toBe(1);
    expect(viewOf(restored).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
    const next = await second.handle(ALICE, request(restored.seq + 1, { type: "move", to: "next" }));
    expect(viewOf(next).current?.key).toEqual({ ref: "q2", instance: 1 });
  });

  it("returns the results of a session marked official, and a copy of them is not", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 7 });
    await host.handle(ALICE, request(1, answer("A")));
    await host.handle(ALICE, request(2, { type: "submit", item: Q1 }));
    await host.proctor(ALICE.session, { type: "end-test" });
    const result = await host.session(ALICE.session).results();
    expect(isOfficialResult(result)).toBe(true);
    expect(isOfficialResult({ ...result })).toBe(false);
    expect(isOfficialResult(structuredClone(result))).toBe(false);
    expect(result.itemResults.map(({ identifier }) => identifier)).toContain("q1");
  });

  it("hands the pending work and the view of a rater to the host only", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 7 });
    expect(await host.session(ALICE.session).pending()).toEqual({ scoring: [], cat: [] });
    await expect(host.session(ALICE.session).scorerView("none")).rejects.toMatchObject({ name: "DataError" });
    await expect(host.session("nobody").pending()).rejects.toThrow(DataError);
  });

  it("numbers the steps of the log by the version of the record they saved", async () => {
    const { host, logged } = await examHost();
    await host.start(ALICE, { seed: 7 });
    await host.handle(ALICE, request(1, answer("A")));
    await host.handle(ALICE, request(2, { type: "submit", item: Q1 }));
    expect(logged.map(({ session, step }) => [session, step])).toEqual([
      ["exam-1", "start"],
      ["exam-1", 1],
      ["exam-1", 2],
    ]);
  });

  it("gives the score of a supply-scores action to the log with its step, and the rater only when the host names one", async () => {
    const essay = `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="q2" title="Item q2" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="string"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float" external-scored="human"/>
  <qti-item-body><qti-extended-text-interaction response-identifier="RESPONSE"/></qti-item-body>
</qti-assessment-item>`;
    const { host, logged } = await examHost({}, { ...examFiles(), "items/q2/item.xml": essay });
    await host.start(ALICE, { seed: 7 });
    const q2 = { ref: "q2", instance: 1 };
    await host.handle(ALICE, request(1, { type: "move", to: q2 }));
    await host.handle(
      ALICE,
      request(2, {
        type: "set-responses",
        item: q2,
        responses: new Map([["RESPONSE", buildSingle("string", "An essay.")]]),
      }),
    );
    await host.handle(ALICE, request(3, { type: "submit", item: q2 }));
    const [pending] = (await host.session(ALICE.session).pending()).scoring;
    expect(pending?.id).toBe("item:q2:1:SCORE");
    expect(logged.filter(({ supplied }) => supplied !== undefined)).toEqual([]);
    const session = host.session(ALICE.session);
    const value = buildSingle("float", 3);
    const supply = { type: "supply-scores", request: pending?.id ?? "", value, scorer: "human" } as const;

    const bare = await session.apply(supply);
    expect(bare.refusal).toBeUndefined();
    const supplied = logged.at(-1);
    expect(supplied?.supplied).toStrictEqual({ value, scorer: "human" });
    expect(supplied?.events.map(({ type }) => type)).toContain("scores-applied");

    const named = await session.apply({ ...supply, value: buildSingle("float", 4) }, { scoredBy: "rater-17" });
    expect(named.events.map(({ type }) => type)).toContain("scores-replaced");
    expect(logged.at(-1)?.supplied).toStrictEqual({
      value: buildSingle("float", 4),
      scorer: "human",
      scoredBy: "rater-17",
    });
    await expect(session.apply(supply, { scoredBy: "" })).rejects.toThrow(
      new DataError('The option scoredBy must be a non-empty string, found "".'),
    );
  });

  it("calls the log for no step without events, and for no repeated request", async () => {
    const { host, logged } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const answered = await host.handle(ALICE, request(1, answer("A")));
    const forwarded = logged.length;
    expect(await host.session(ALICE.session).apply({ type: "time" })).toEqual({ events: [] });
    expect(await host.handle(ALICE, request(1, answer("A")))).toEqual({
      ...answered,
      assets: expect.anything(),
    });
    expect(logged).toHaveLength(forwarded);
  });

  it("waits for the log before the call returns, and keeps the step saved when the log rejects", async () => {
    const order: string[] = [];
    let failing = false;
    const onStep = async ({ step }: StepEvents): Promise<void> => {
      order.push(`log ${step}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failing) throw new Error("disk full");
      order.push(`logged ${step}`);
    };
    const { host } = await examHost({ onStep });
    await host.start(ALICE, { seed: 7 });
    expect(order).toEqual(["log start", "logged start"]);
    failing = true;
    await expect(host.handle(ALICE, request(1, answer("A")))).rejects.toThrow("disk full");
    failing = false;
    // The step is saved: the same request replays the stored answer, and nothing repeats the step.
    const before = order.length;
    const replayed = await host.handle(ALICE, request(1, answer("A")));
    expect(order).toHaveLength(before);
    expect(viewOf(replayed).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
    expect(viewOf(await host.view(ALICE)).current?.responses.get("RESPONSE")).toEqual(buildSingle("identifier", "A"));
  });

  it("rejects an onStep that is not a function", async () => {
    const good = await examHost();
    const options = {
      engine: good.engine,
      store: good.store,
      scheduler: good.scheduler,
      clock: good.clock,
      gate: good.gate,
      packages: async () => good.pkg,
    };
    for (const onStep of [json("{}"), json('"console"'), json("null"), json('{"log":null}')]) {
      expect(() => createSessionHost({ ...options, onStep } as never), JSON.stringify(onStep)).toThrow(DataError);
    }
    expect(() => createSessionHost({ ...options, forward: { log: () => undefined } } as never)).toThrow(
      'The options object is invalid: unexpected property "forward".',
    );
  });

  it("keeps the correct responses of a rated item out of every envelope, and gives them to the rater", async () => {
    const { host } = await examHost({}, ratedFiles());
    const q2 = { ref: "q2", instance: 1 };
    const replies = [await host.start(ALICE, { seed: 7 })];
    replies.push(await host.handle(ALICE, request(1, { type: "move", to: q2 })));
    const guess = new Map([["RESPONSE", buildSingle("string", "A guess")]]);
    replies.push(await host.handle(ALICE, request(2, { type: "set-responses", item: q2, responses: guess })));
    replies.push(await host.handle(ALICE, request(3, { type: "submit", item: q2 })));
    replies.push(await host.view(ALICE));
    for (const reply of replies) expect(JSON.stringify(reply)).not.toContain(RATED_KEY);
    const [pending] = (await host.session(ALICE.session).pending()).scoring;
    const view = await host.session(ALICE.session).scorerView(pending?.id ?? "");
    expect(view.items[0]?.correctResponses.get("RESPONSE")).toEqual(buildSingle("string", RATED_KEY));
  });

  it("keeps the scoring rubric of a rated item out of every envelope, and gives it to the rater", async () => {
    const { host } = await examHost({}, ratedFiles(rubricMarkup("SCORE")));
    const q2 = { ref: "q2", instance: 1 };
    const replies = [await host.start(ALICE, { seed: 7 })];
    replies.push(await host.handle(ALICE, request(1, { type: "move", to: q2 })));
    const guess = new Map([["RESPONSE", buildSingle("string", "A guess")]]);
    replies.push(await host.handle(ALICE, request(2, { type: "set-responses", item: q2, responses: guess })));
    replies.push(await host.handle(ALICE, request(3, { type: "submit", item: q2 })));
    replies.push(await host.view(ALICE));
    for (const reply of replies) {
      expect(JSON.stringify(reply)).not.toContain(RUBRIC_WORD);
      expect(JSON.stringify(reply)).not.toContain("Clear order.");
    }
    const [pending] = (await host.session(ALICE.session).pending()).scoring;
    const view = await host.session(ALICE.session).scorerView(pending?.id ?? "");
    expect(view.scoringRubric?.criteria[0]?.description).toContain(RUBRIC_WORD);
  });

  it("refuses a session identifier that is not a non-empty string, and a session that does not exist", async () => {
    const { host } = await examHost();
    for (const text of ["null", '""', "5"]) {
      expect(() => host.session(json(text) as never), text).toThrow(DataError);
    }
    const nobody = host.session("nobody");
    await expect(nobody.apply({ type: "time" })).rejects.toThrow(DataError);
    await expect(nobody.results()).rejects.toThrow(DataError);
    await expect(nobody.scorerView("r")).rejects.toThrow(DataError);
  });

  it("checks the options of a call", async () => {
    const { host } = await examHost();
    await host.start(ALICE, { seed: 7 });
    const options = (text: string): { readonly signal?: never } => JSON.parse(text);
    const calls = [
      (given: ReturnType<typeof options>) => host.check(ALICE, given),
      (given: ReturnType<typeof options>) => host.view(ALICE, given),
      (given: ReturnType<typeof options>) => host.handle(ALICE, request(1, answer("A")), given),
      (given: ReturnType<typeof options>) => host.proctor(ALICE.session, { type: "suspend" }, given),
      (given: ReturnType<typeof options>) => host.session(ALICE.session).apply({ type: "time" }, given),
      (given: ReturnType<typeof options>) => host.session(ALICE.session).pending(given),
      (given: ReturnType<typeof options>) => host.session(ALICE.session).scorerView("r", given),
      (given: ReturnType<typeof options>) => host.session(ALICE.session).results(given),
    ];
    for (const call of calls) {
      await expect(call(options("null"))).rejects.toThrow(new DataError("The options must be an object, found null."));
      await expect(call(options('{"signal":5}'))).rejects.toThrow(
        new DataError("The option signal must be an AbortSignal, found 5."),
      );
    }
    await expect(host.start(ALICE, JSON.parse('{"seed":1,"signal":5}'))).rejects.toThrow(
      new DataError("The option signal must be an AbortSignal, found 5."),
    );
    await expect(host.session(ALICE.session).apply({ type: "time" }, JSON.parse('{"scoredBy":5}'))).rejects.toThrow(
      new DataError("The option scoredBy must be a non-empty string, found 5."),
    );
  });

  it("checks its options and arguments", async () => {
    const good = await examHost();
    const options = {
      engine: good.engine,
      store: good.store,
      scheduler: good.scheduler,
      clock: good.clock,
      gate: good.gate,
      packages: async () => good.pkg,
    };
    const make = (changes: Record<string, unknown>): unknown => createSessionHost({ ...options, ...changes });
    expect(() => createSessionHost(JSON.parse("null"))).toThrow(
      "The options object is invalid: expected an object, found null.",
    );
    expect(() => make({ engine: {} })).toThrow(
      "The options object is invalid at engine: expected an object with the functions start, apply, view, deadlines, pending, scorerView and results, found an object.",
    );
    expect(() => make({ store: null })).toThrow(
      "The options object is invalid at store: expected an object with the functions create, load and save, found null.",
    );
    expect(() => make({ scheduler: { schedule: 1 } })).toThrow(
      "The options object is invalid at scheduler: expected an object with the function schedule, found an object.",
    );
    expect(() => make({ clock: {} })).toThrow("The function now of the option clock");
    expect(() => make({ clock: null })).toThrow("The option clock");
    expect(() => make({ engine: { ...good.engine, hasMaximumTime: "yes" } })).toThrow(
      new DataError('The property hasMaximumTime of the option engine must be a boolean, found "yes".'),
    );
    expect(make({ clock: undefined, scheduler: undefined })).toBeDefined();
    expect(() => make({ gate: {} })).toThrow(
      "The options object is invalid at gate: expected an object with the function sign, found an object.",
    );
    expect(() => make({ packages: null })).toThrow(
      "The options object is invalid at packages: expected a function, found null.",
    );
    expect(() => make({ clientActions: ["suspend", "fly"] })).toThrow(
      'A type of the option clientActions must be "set-responses"',
    );
    expect(() => make({ clientActions: "move" })).toThrow("The option clientActions must be an array");
    expect(() => make({ limits: 5 })).toThrow("The options object is invalid at limits: expected an object, found 5.");
    expect(() => make({ other: 1 })).toThrow('The options object is invalid: unexpected property "other".');
    await expect(good.host.start(JSON.parse('{"session":"s"}'), { seed: 1 })).rejects.toThrow(
      'The caller is invalid: missing the property "principal".',
    );
    await expect(good.host.start(ALICE, JSON.parse("null"))).rejects.toThrow("The options of start must be an object");
    await expect(good.host.handle(ALICE, JSON.parse('{"seq":1}'))).rejects.toThrow(
      'An action envelope is invalid: missing the property "action".',
    );
    await expect(good.host.handle(JSON.parse("null"), { seq: 1, action: {} })).rejects.toThrow(
      "The caller is invalid: expected an object, found null.",
    );
    await expect(good.host.session(ALICE.session).apply(JSON.parse('{"type":"move"}'))).rejects.toThrow(
      "The type of a host action",
    );
    expect(() => good.host.session(JSON.parse("5"))).toThrow("The session must be a non-empty string, found 5.");
  });

  it("reads or refuses arbitrary JSON as options with a DataError, and nothing else", () => {
    fuzzJson((options) => createSessionHost(options as never));
    fuzzJson((options) => createAssetGate(options as never));
  });
});

describe("the default clock of the session host", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps the steps with SYSTEM_CLOCK, the time of the machine, when the host passes no clock", async () => {
    const now = Date.UTC(2026, 10, 4, 8);
    vi.useFakeTimers({ now, toFake: ["Date"] });
    const { host, store } = await examHost({ clock: undefined });
    await host.start(ALICE, { seed: 7 });
    expect(deserializeState(store.records.get("exam-1")?.state ?? "").at).toBe(now);
  });
});

describe("the option maxIdleMs of the session host", () => {
  const Hour = 3600 * SECOND;
  const timed = (): ReturnType<typeof examFiles> => examFiles({ limits: '<qti-time-limits max-time="600"/>' });
  const practice = { clientActions: CANDIDATE_ACTION_TYPES };
  const typesOf = (step: StepEvents | undefined): string[] => step?.events.map(({ type }) => type) ?? [];

  it("throws at creation when the client may not suspend, as in an exam by default, and names what to do", async () => {
    await expect(examHost({ maxIdleMs: Hour })).rejects.toThrow(
      /^The option maxIdleMs counts a long gap as a suspension.*Add "suspend" to clientActions/u,
    );
    await expect(examHost({ maxIdleMs: Hour, clientActions: EXAM_CLIENT_ACTIONS })).rejects.toThrow(DataError);
    await expect(examHost({ maxIdleMs: Hour, ...practice })).resolves.toBeDefined();
    await expect(examHost({ ...practice })).resolves.toBeDefined();
  });

  it("checks the option", async () => {
    const options = (text: string): Parameters<typeof examHost>[0] => JSON.parse(text);
    await expect(examHost(options('{"maxIdleMs":0}'))).rejects.toThrow(
      "The option maxIdleMs must be a positive integer, found 0.",
    );
    await expect(examHost(options('{"maxIdleMs":"5"}'))).rejects.toThrow(
      'The option maxIdleMs must be a positive integer, found "5".',
    );
    await expect(examHost(options('{"maxIdleMs":null}'))).rejects.toThrow(
      "The option maxIdleMs must be a positive integer, found null.",
    );
    await expect(examHost(options('{"maxIdleMs":2.5}'))).rejects.toThrow(
      "The option maxIdleMs must be a positive integer, found 2.5.",
    );
  });

  it("counts a gap above it as suspended for a request, saves once and logs the events of the three in order", async () => {
    const without = await examHost(practice, timed());
    await without.host.start(ALICE, { seed: 7 });
    without.clock.advance(3 * DAY);
    expect((await without.host.handle(ALICE, request(1, answer("A")))).refusal?.reason).toBe("time-over");

    const { host, clock, store, logged } = await examHost({ ...practice, maxIdleMs: Hour }, timed());
    await host.start(ALICE, { seed: 7 });
    clock.advance(3 * DAY);
    const reply = await host.handle(ALICE, request(1, answer("A")));
    expect(reply.refusal).toBeUndefined();
    expect(store.saves).toHaveLength(1);
    expect(logged).toHaveLength(2);
    expect(typesOf(logged.at(-1)).slice(0, 3)).toEqual(["suspended", "resumed", "presented"]);
    expect(viewOf(reply).timers.map(({ remaining }) => remaining)).toEqual([600 * SECOND]);
  });

  it("gives the results that an explicit suspension gives", async () => {
    const explicit = await examHost(practice, timed());
    await explicit.host.start(ALICE, { seed: 7 });
    await explicit.host.handle(ALICE, request(1, { type: "suspend" }));
    explicit.clock.advance(3 * DAY);
    await explicit.host.handle(ALICE, request(2, { type: "resume" }));
    await explicit.host.handle(ALICE, request(3, answer("A")));
    const expected = await explicit.host.session(ALICE.session).results();

    const { host, clock } = await examHost({ ...practice, maxIdleMs: Hour }, timed());
    await host.start(ALICE, { seed: 7 });
    clock.advance(3 * DAY);
    await host.handle(ALICE, request(1, answer("A")));
    expect(await host.session(ALICE.session).results()).toEqual(expected);
  });

  it("drops the time action of the job of the scheduler that finds a gap: nothing is saved or scheduled, and the next request closes the gap", async () => {
    const { host, clock, store, scheduler } = await examHost({ ...practice, maxIdleMs: Hour }, timed());
    await host.start(ALICE, { seed: 7 });
    const jobs = scheduler.jobs.length;
    clock.advance(3 * DAY);
    expect(await host.session(ALICE.session).apply({ type: "time" })).toEqual({ events: [] });
    expect(store.saves).toHaveLength(0);
    expect(scheduler.jobs).toHaveLength(jobs);

    const reply = await host.handle(ALICE, request(1, answer("A")));
    expect(reply.refusal).toBeUndefined();
    expect(scheduler.jobs).toHaveLength(jobs + 1);
    expect(scheduler.jobs.at(-1)?.[1]).toBe(clock.now() + 600 * SECOND);
  });

  it("closes the gap once when the request is handled again after another request saved first", async () => {
    const { host, clock, store, logged } = await examHost({ ...practice, maxIdleMs: Hour }, timed());
    await host.start(ALICE, { seed: 7 });
    clock.advance(3 * DAY);
    store.conflictNext(1);
    const reply = await host.handle(ALICE, request(1, answer("A")));
    expect(reply.refusal).toBeUndefined();
    expect(logged).toHaveLength(2);
    expect(typesOf(logged.at(-1)).filter((type) => type === "suspended")).toHaveLength(1);
    expect(typesOf(logged.at(-1)).slice(0, 2)).toEqual(["suspended", "resumed"]);
  });

  it("applies the time action of the job when the gap is no longer than it", async () => {
    const { host, clock, store } = await examHost({ ...practice, maxIdleMs: Hour }, timed());
    await host.start(ALICE, { seed: 7 });
    clock.advance(600 * SECOND);
    const step = await host.session(ALICE.session).apply({ type: "time" });
    expect(step.events.map(({ type }) => type)[0]).toBe("time-out");
    expect(store.saves).toHaveLength(1);
  });

  it("closes the gap for the proctor, and for a suspended session closes none", async () => {
    const { host, clock, logged } = await examHost({ ...practice, maxIdleMs: Hour }, timed());
    await host.start(ALICE, { seed: 7 });
    clock.advance(3 * DAY);
    await host.proctor(ALICE.session, { type: "suspend" });
    expect(typesOf(logged.at(-1)).slice(0, 3)).toEqual(["suspended", "resumed", "presented"]);
    expect(typesOf(logged.at(-1)).at(-1)).toBe("suspended");
    clock.advance(3 * DAY);
    await host.proctor(ALICE.session, { type: "resume" });
    expect(typesOf(logged.at(-1))).toEqual(["resumed", "presented"]);
  });

  it("changes nothing for a host that leaves it out, however long the gap", async () => {
    const { host, clock, logged } = await examHost({}, timed());
    await host.start(ALICE, { seed: 7 });
    clock.advance(3 * DAY);
    const reply = await host.handle(ALICE, request(1, { type: "move", to: "next" }));
    expect(reply.refusal).toBeUndefined();
    expect(typesOf(logged.at(-1))[0]).toBe("time-out");
  });
});

describe("the signals of the session host", () => {
  const reason = new Error("The caller left.");
  type Received = Record<"load" | "create" | "save" | "schedule" | "packages", (CallOptions | undefined)[]>;

  /** A session host whose store, scheduler and package source record the options they get. */
  async function observed(extra: Partial<Parameters<typeof createSessionHost>[0]> = {}, files = examFiles()) {
    const base = memoryStore();
    const queue = recordingScheduler();
    const pkg = packageOf(files);
    const received: Received = { load: [], create: [], save: [], schedule: [], packages: [] };
    const setup = await examHost(
      {
        store: {
          create: async (session, record, options) => {
            received.create.push(options);
            return base.create(session, record);
          },
          load: async (session, options) => {
            received.load.push(options);
            return base.load(session);
          },
          save: async (session, record, options) => {
            received.save.push(options);
            return base.save(session, record);
          },
        },
        scheduler: {
          schedule: async (session, at, options) => {
            received.schedule.push(options);
            return queue.schedule(session, at);
          },
        },
        packages: async (_session, options) => {
          received.packages.push(options);
          return pkg;
        },
        ...extra,
      },
      files,
    );
    const counts = () => Object.values(received).map((each) => each.length);
    return { ...setup, received, counts };
  }

  it("passes the signal of a call to the store, the scheduler and the package source", async () => {
    const limits = '<qti-time-limits max-time="600"/>';
    const { host, received } = await observed({}, examFiles({ limits }));
    const signal = new AbortController().signal;
    await host.start(ALICE, { seed: 7, signal });
    for (const method of ["load", "create", "schedule", "packages"] as const) {
      expect(
        received[method].map((each) => each?.signal),
        method,
      ).toEqual([signal]);
    }
    await host.handle(ALICE, request(1, answer("A")), { signal });
    await host.view(ALICE, { signal });
    await host.proctor(ALICE.session, { type: "suspend" }, { signal });
    await host.session(ALICE.session).apply({ type: "time" }, { signal });
    await host.session(ALICE.session).pending({ signal });
    for (const method of ["load", "save", "schedule", "packages"] as const) {
      expect(received[method].length, method).toBeGreaterThan(0);
      expect(
        received[method].every((each) => each?.signal === signal),
        method,
      ).toBe(true);
    }
  });

  it("stops a call whose signal aborted before its load, and applies nothing", async () => {
    const { host, counts } = await observed();
    await host.start(ALICE, { seed: 7 });
    const before = counts();
    const signal = { signal: AbortSignal.abort(reason) };
    const session = host.session(ALICE.session);
    const calls = [
      host.start({ session: "other", principal: "bob" }, { seed: 7, ...signal }),
      host.check(ALICE, signal),
      host.view(ALICE, signal),
      host.handle(ALICE, request(1, answer("A")), signal),
      host.proctor(ALICE.session, { type: "suspend" }, signal),
      session.apply({ type: "time" }, signal),
      session.pending(signal),
      session.scorerView("r", signal),
      session.results(signal),
    ];
    for (const call of calls) await expect(call).rejects.toBe(reason);
    expect(counts()).toEqual(before);
  });

  it("stops between the retries of a save, and applies nothing", async () => {
    const controller = new AbortController();
    const base = memoryStore();
    let saves = 0;
    const { host } = await examHost({
      store: {
        create: base.create,
        load: base.load,
        save: async () => {
          saves += 1;
          controller.abort(reason);
          return false;
        },
      },
    });
    await host.start(ALICE, { seed: 7 });
    await expect(host.handle(ALICE, request(1, answer("A")), { signal: controller.signal })).rejects.toBe(reason);
    expect(saves).toBe(1);
    expect(base.records.get("exam-1")?.version).toBe(0);
  });

  it("ignores an abort that comes after the save: the step stays saved and its events are forwarded", async () => {
    const controller = new AbortController();
    const logged: StepEvents[] = [];
    const base = memoryStore();
    const { host } = await examHost({
      store: {
        create: base.create,
        load: base.load,
        save: async (session, record, options) => {
          const saved = await base.save(session, record, options);
          controller.abort(reason);
          return saved;
        },
      },
      onStep: (step) => void logged.push(step),
    });
    await host.start(ALICE, { seed: 7 });
    const reply = await host.handle(ALICE, request(1, answer("A")), { signal: controller.signal });
    expect(reply.refusal).toBeUndefined();
    expect(logged.map(({ step }) => step)).toEqual(["start", 1]);
    expect(base.records.get("exam-1")?.version).toBe(1);
  });
});

describe("the option cat of the session host", () => {
  const item = (ref: string) => ({ ref, instance: 1 });
  const choose = (ref: string): CandidateAction => ({
    type: "set-responses",
    item: item(ref),
    responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
  });

  /** A session host over the adaptive test, whose CAT engine is behind the port. */
  async function adaptiveHost(port: ScriptedPort, limits = "", extra: Parameters<typeof examHost>[0] = {}) {
    const files = adaptiveFiles(limits);
    return examHost({ engine: adaptiveEngine(files), cat: port, ...extra }, files);
  }

  /** Answers the two items of the first stage, and sends the requests of the client in order. */
  function candidate(host: Awaited<ReturnType<typeof adaptiveHost>>["host"]) {
    let seq = 0;
    return (action: CandidateAction) => {
      seq += 1;
      return host.handle(ALICE, request(seq, action));
    };
  }

  async function finishStage(send: ReturnType<typeof candidate>): Promise<ViewEnvelope> {
    await send(choose("i1"));
    await send({ type: "submit", item: item("i1") });
    await send({ type: "move", to: "next" });
    await send(choose("i2"));
    return send({ type: "submit", item: item("i2") });
  }

  it("answers Create Session within start, and presents the first item", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    const first = await host.start(ALICE, { seed: 7 });
    expect(port.calls).toEqual(["createSession"]);
    expect(viewOf(first).current?.key).toEqual(item("i1"));
  });

  it("sends Submit Results when the candidate finishes a stage, and answers with the view after it", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    await host.start(ALICE, { seed: 7 });
    const last = await finishStage(candidate(host));
    expect(port.calls).toEqual(["createSession", "submitResults"]);
    expect((await host.session(ALICE.session).pending()).cat).toEqual([]);
    const moved = await host.handle(ALICE, request(6, { type: "move", to: "next" }));
    expect(moved.refusal).toBeUndefined();
    expect(viewOf(moved).current?.key).toEqual(item("i3"));
    expect(last.refusal).toBeUndefined();
  });

  it("sends Submit Results and End Session when a time-out ends an adaptive section", async () => {
    const port = scriptedPort();
    const { host, clock } = await adaptiveHost(port, '<qti-time-limits max-time="600"/>');
    await host.start(ALICE, { seed: 7 });
    clock.advance(601 * SECOND);
    const step = await host.session(ALICE.session).apply({ type: "time" });
    expect(step.refusal).toBeUndefined();
    expect(step.catFailure).toBeUndefined();
    expect(port.calls).toEqual(["createSession", "submitResults", "endSession"]);
  });

  it("sends Submit Results and End Session when the proctor ends the test", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    await host.start(ALICE, { seed: 7 });
    const step = await host.proctor(ALICE.session, { type: "end-test" });
    expect(step.catFailure).toBeUndefined();
    expect(port.calls).toEqual(["createSession", "submitResults", "endSession"]);
  });

  it("answers the requests of a step that the proctor saved while the loop of a reload read the state before it", async () => {
    const port = scriptedPort();
    const base = memoryStore();
    let loads = -1;
    let reach: () => void = () => undefined;
    let release: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    const { host } = await adaptiveHost(port, "", {
      store: {
        create: base.create,
        save: base.save,
        // The second load after the reload began is the read of the loop: it gets the old record, and its reply waits.
        load: async (session, options) => {
          const record = await base.load(session, options);
          if (loads >= 0) loads += 1;
          if (loads === 2) {
            reach();
            await held;
          }
          return record;
        },
      },
    });
    await host.start(ALICE, { seed: 7 });
    loads = 0;
    const reload = host.view(ALICE);
    await reached;
    const step = await host.proctor(ALICE.session, { type: "end-test" });
    expect(step.catFailure).toBeUndefined();
    release();
    expect(viewOf(await reload).status).toBe("ended");
    expect((await host.session(ALICE.session).pending()).cat).toEqual([]);
    expect(port.calls).toEqual(["createSession", "submitResults", "endSession"]);
  });

  it("answers a repeated request with the view after the CAT answer, and keeps its refusal", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    port.fail("createSession", 2);
    await expect(host.start(ALICE, { seed: 7 })).rejects.toThrow(ServiceError);
    await expect(host.handle(ALICE, request(1, choose("i1")))).rejects.toThrow(ServiceError);
    const again = await host.handle(ALICE, request(1, choose("i1")));
    expect(again.refusal?.reason).toBe("awaiting-cat");
    expect(viewOf(again).current?.key).toEqual(item("i1"));
  });

  it("sends the CAT request of a request once, and gets the same view when the request is sent again", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    await host.start(ALICE, { seed: 7 });
    const send = candidate(host);
    await send(choose("i1"));
    await send({ type: "submit", item: item("i1") });
    await send({ type: "move", to: "next" });
    await send(choose("i2"));
    const last = await send({ type: "submit", item: item("i2") });
    const again = await host.handle(ALICE, request(5, { type: "submit", item: item("i2") }));
    expect(port.calls).toEqual(["createSession", "submitResults"]);
    expect(viewOf(again)).toEqual(viewOf(last));
  });

  it("answers a request first when the CAT engine failed before it, and then applies it", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    await host.start(ALICE, { seed: 7 });
    const send = candidate(host);
    await send(choose("i1"));
    await send({ type: "submit", item: item("i1") });
    await send({ type: "move", to: "next" });
    await send(choose("i2"));
    port.fail("submitResults");
    const failed = await send({ type: "submit", item: item("i2") });
    expect(failed.refusal).toBeUndefined();
    expect((await host.session(ALICE.session).pending()).cat).toHaveLength(1);
    const moved = await send({ type: "move", to: "next" });
    expect(moved.refusal).toBeUndefined();
    expect(viewOf(moved).current?.key).toEqual(item("i3"));
    expect(port.calls).toEqual(["createSession", "submitResults", "submitResults"]);
  });

  it("applies the step and reports the failure when End Session fails after the proctor ended the test", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    await host.start(ALICE, { seed: 7 });
    port.fail("endSession");
    const step = await host.proctor(ALICE.session, { type: "end-test" });
    expect(step.refusal).toBeUndefined();
    expect(step.events.length).toBeGreaterThan(0);
    expect(step.catFailure).toMatchObject({ message: "The CAT engine is down." });
    expect(step.catFailure?.request).not.toBe("");
    expect(viewOf(await host.view(ALICE)).status).toBe("ended");
  });

  it("keeps the step of a cat-response saved and reports a log that rejects as catFailure, which the next call finishes", async () => {
    const port = scriptedPort();
    let failing = true;
    const steps: (number | "start")[] = [];
    const onStep = ({ step }: StepEvents): void => {
      steps.push(step);
      // The step that the host's own action made is step 2; the loop's first cat-response is step 3.
      if (failing && step === 3) throw new Error("disk full");
    };
    const { host } = await adaptiveHost(port, "", { onStep });
    await host.start(ALICE, { seed: 7 });
    const step = await host.proctor(ALICE.session, { type: "end-test" });
    expect(step.refusal).toBeUndefined();
    expect(step.catFailure).toMatchObject({ message: "disk full" });
    expect(port.calls).toEqual(["createSession", "submitResults"]);
    // The answer of Submit Results is saved and the request that followed it waits, so nothing was lost or repeated.
    expect((await host.session(ALICE.session).pending()).cat).toHaveLength(1);
    failing = false;
    const finished = await host.session(ALICE.session).apply({ type: "time" });
    expect(finished.catFailure).toBeUndefined();
    expect(port.calls).toEqual(["createSession", "submitResults", "endSession"]);
    expect(steps.filter((each) => each === 3)).toHaveLength(1);
    expect((await host.session(ALICE.session).pending()).cat).toEqual([]);
  });

  it("applies the time action and reports the failure when End Session fails after a time-out", async () => {
    const port = scriptedPort();
    const { host, clock } = await adaptiveHost(port, '<qti-time-limits max-time="600"/>');
    await host.start(ALICE, { seed: 7 });
    port.fail("endSession");
    clock.advance(601 * SECOND);
    const step = await host.session(ALICE.session).apply({ type: "time" });
    expect(step.events.map(({ type }) => type)).toContain("time-out");
    expect(step.catFailure).toMatchObject({ message: "The CAT engine is down." });
  });

  it("rejects start when Create Session fails and no item is presented, keeps the session, and answers the view", async () => {
    const port = scriptedPort();
    const { host, store } = await adaptiveHost(port);
    port.fail("createSession");
    await expect(host.start(ALICE, { seed: 7 })).rejects.toThrow(ServiceError);
    expect(store.records.has("exam-1")).toBe(true);
    expect(viewOf(await host.view(ALICE)).current?.key).toEqual(item("i1"));
    expect(port.calls).toEqual(["createSession", "createSession"]);
  });

  describe("while End Session fails for a section that the candidate left", () => {
    const b1 = item("b1");

    /** A session whose candidate ended the first part and went on to the rated item, and whose End Session fails. */
    async function abandoned() {
      const port = scriptedPort();
      const files = abandonedFiles();
      const setup = await examHost({ engine: adaptiveEngine(files), cat: port }, files);
      await setup.host.start(ALICE, { seed: 7 });
      port.fail("endSession", 100);
      const moved = await setup.host.handle(ALICE, request(1, { type: "end-part" }));
      return { ...setup, port, moved, session: setup.host.session(ALICE.session) };
    }

    it("answers the candidate who goes on, and saves what the candidate enters", async () => {
      const { host, port, moved, session, store } = await abandoned();
      expect(moved.refusal).toBeUndefined();
      expect(viewOf(moved).current?.key).toEqual(b1);
      expect((await session.pending()).cat.map(({ kind }) => kind)).toEqual(["end-session"]);
      const draft = new Map([["RESPONSE", buildSingle("string", "A draft.")]]);
      const saved = await host.handle(ALICE, request(2, { type: "set-responses", item: b1, responses: draft }));
      expect(saved.refusal).toBeUndefined();
      expect(viewOf(saved).current?.responses.get("RESPONSE")).toEqual(buildSingle("string", "A draft."));
      expect(store.records.get("exam-1")?.seq).toBe(2);
      expect(port.calls.filter((call) => call === "endSession").length).toBeGreaterThan(1);
    });

    it("applies the action of the proctor and the time job, and reports the failure of each", async () => {
      const { host, session } = await abandoned();
      const suspended = await host.proctor(ALICE.session, { type: "suspend" });
      expect(suspended.refusal).toBeUndefined();
      expect(suspended.events.length).toBeGreaterThan(0);
      expect(suspended.catFailure).toMatchObject({ message: "The CAT engine is down." });
      expect((await host.proctor(ALICE.session, { type: "resume" })).catFailure).toBeDefined();
      expect(await session.apply({ type: "time" })).toMatchObject({
        events: [],
        catFailure: { message: "The CAT engine is down." },
      });
      const ended = await host.proctor(ALICE.session, { type: "end-test" });
      expect(ended.refusal).toBeUndefined();
      expect(viewOf(await host.view(ALICE)).status).toBe("ended");
    });

    it("applies the score that a rater supplies, and reports the failure", async () => {
      const { host, session } = await abandoned();
      const text = new Map([["RESPONSE", buildSingle("string", "An essay.")]]);
      await host.handle(ALICE, request(2, { type: "set-responses", item: b1, responses: text }));
      await host.handle(ALICE, request(3, { type: "submit", item: b1 }));
      const [pending] = (await session.pending()).scoring;
      expect(pending?.id).toBe("item:b1:1:SCORE");
      const step = await session.apply({
        type: "supply-scores",
        request: pending?.id ?? "",
        value: buildSingle("float", 5),
        scorer: "human",
      });
      expect(step.refusal).toBeUndefined();
      expect(step.events.map(({ type }) => type)).toContain("scores-applied");
      expect(step.catFailure).toMatchObject({ message: "The CAT engine is down." });
      expect((await session.pending()).scoring).toEqual([]);
      expect((await session.results()).itemResults.find(({ identifier }) => identifier === "b1")?.sessionStatus).toBe(
        "final",
      );
    });

    describe("and the item that is left is a link to a tool", () => {
      const scores = () => {
        const kept = new Map<string, ToolScore>();
        return {
          kept,
          keep: async (_session: string, item: { ref: string }, next: ToolScore) => {
            kept.set(item.ref, next);
            return true;
          },
          latest: async (_session: string, item: { ref: string }) => kept.get(item.ref),
        };
      };
      const final: ToolScore = { scoreGiven: 7, scoreMaximum: 10, final: true, timestampMs: 1_700_000_000_000 };

      async function leftForTool() {
        const port = scriptedPort();
        const files = abandonedToolFiles();
        const setup = await examHost({ engine: adaptiveEngine(files), cat: port }, files);
        await setup.host.start(ALICE, { seed: 7 });
        port.fail("endSession", 100);
        const moved = await setup.host.handle(ALICE, request(1, { type: "end-part" }));
        expect(viewOf(moved).current?.lti?.title).toBe("Drawing tool");
        const store = scores();
        const intake = createToolScoreIntake({ host: setup.host, scores: store });
        return { ...setup, port, store, intake, session: setup.host.session(ALICE.session) };
      }

      it("supplies the score that the tool gives, keeps it, and does not fail the call of the tool", async () => {
        const { host, port, store, intake, session } = await leftForTool();
        await host.handle(ALICE, request(2, { type: "submit", item: b1 }));
        expect((await session.pending()).scoring.map(({ id }) => id)).toEqual([
          "item:b1:1:SCORE",
          "item:b1:1:MAXSCORE",
        ]);
        await expect(intake.onScore(ALICE.session, b1, final)).resolves.toBeUndefined();
        expect(store.kept.get("b1")).toEqual(final);
        expect((await session.pending()).scoring).toEqual([]);
        // The score is in the session although the CAT engine is down, and the request to the engine still waits.
        expect((await session.pending()).cat.map(({ kind }) => kind)).toEqual(["end-session"]);
        const total = (await session.results()).itemResults.find(({ identifier }) => identifier === "b1");
        expect(total?.sessionStatus).toBe("final");
        port.fail("endSession", 0);
        await host.view(ALICE);
        expect((await session.pending()).cat).toEqual([]);
      });

      it("supplies a score that the tool gave before the item asked for it, when a step makes the requests, though the engine is down", async () => {
        const { host, store, intake, session, logged } = await leftForTool();
        // The item has no requests yet: the intake keeps the score and supplies nothing.
        await intake.onScore(ALICE.session, b1, final);
        expect(store.kept.size).toBe(1);
        expect((await session.pending()).scoring).toEqual([]);
        await host.handle(ALICE, request(2, { type: "submit", item: b1 }));
        const made = logged.find(({ events }) => events.some(({ type }) => type === "scoring-requested"));
        expect(made).toBeDefined();
        expect((await session.pending()).scoring).toHaveLength(2);
        await expect(intake.settle(made as StepEvents)).resolves.toBeUndefined();
        expect((await session.pending()).scoring).toEqual([]);
        // Settling again, as a retried job would, applies nothing more.
        const steps = logged.length;
        await intake.settle(made as StepEvents);
        expect(logged).toHaveLength(steps);
      });
    });

    it("answers a reload with the view as it is, and finishes the request when the CAT engine answers again", async () => {
      const { host, port, session } = await abandoned();
      expect(viewOf(await host.view(ALICE)).current?.key).toEqual(b1);
      port.fail("endSession", 0);
      await host.view(ALICE);
      expect((await session.pending()).cat).toEqual([]);
    });
  });

  it("finishes when onStep calls apply from inside a step of the answer loop", async () => {
    const port = scriptedPort();
    const applied: unknown[] = [];
    const hosts: { current?: SessionHost } = {};
    const onStep = async (step: StepEvents): Promise<void> => {
      if (step.step === 1) applied.push(await hosts.current?.session(ALICE.session).apply({ type: "time" }));
    };
    const { host } = await adaptiveHost(port, "", { onStep });
    hosts.current = host;
    await host.start(ALICE, { seed: 7 });
    expect(port.calls).toEqual(["createSession"]);
    expect(applied).toEqual([{ events: [] }]);
  });

  it("makes no request of the port for a caller that is not bound to the session", async () => {
    const port = scriptedPort();
    const { host } = await adaptiveHost(port);
    await host.start(ALICE, { seed: 7 });
    const before = port.calls.length;
    const bob = { session: ALICE.session, principal: "bob" };
    await expect(host.view(bob)).rejects.toThrow(AccessError);
    await expect(host.handle(bob, request(1, answer("A")))).rejects.toThrow(AccessError);
    expect(port.calls).toHaveLength(before);
  });
});

describe("a review step with a cap on changes", () => {
  /** The wrapper of the recipe in the guide of the server, as the guide has it. */
  const recipe = /const UNSUBMITTED[\s\S]*?^\}\);$/m.exec(serverGuide)?.[0];
  if (recipe === undefined) throw new Error("The guide of the server has no recipe of a review step.");
  const withReview = new Function(`${recipe}\nreturn withReview;`)() as (
    engine: ReturnType<typeof reviewEngine>,
    sections: readonly { refs: ReadonlySet<string>; length: number; maxChanges: number }[],
  ) => ReturnType<typeof reviewEngine>;
  const sections = [
    { refs: new Set(["a1", "a2", "a3"]), length: 2, maxChanges: 1 },
    { refs: new Set(["b1", "b2", "b3"]), length: 2, maxChanges: 1 },
  ];

  /** A session host, started, over the exam of two adaptive sections, with its wrapper counting the actions that reach the engine. */
  async function reviewHost() {
    const files = reviewFiles();
    const port = reviewPort();
    const engine = reviewEngine(files);
    const wrapped = withReview(engine, sections);
    const seen: CandidateAction["type"][] = [];
    const counting = {
      ...wrapped,
      apply: (state: Parameters<typeof wrapped.apply>[0], action: Parameters<typeof wrapped.apply>[1]) => {
        seen.push(action.type as CandidateAction["type"]);
        return wrapped.apply(state, action);
      },
    };
    const { host } = await examHost({ engine: counting, cat: port }, files);
    const first = await host.start(ALICE, { seed: 7 });
    let seq = 0;
    return {
      port,
      seen,
      host,
      first,
      send: async (action: CandidateAction) => {
        seq += 1;
        return host.handle(ALICE, request(seq, action));
      },
      repeat: async (sequence: number, action: CandidateAction) => host.handle(ALICE, request(sequence, action)),
    };
  }

  const key = (ref: string) => ({ ref, instance: 1 });
  const choose = (ref: string): CandidateAction => ({
    type: "set-responses",
    item: key(ref),
    responses: new Map([["RESPONSE", buildSingle("identifier", "A")]]),
  });
  const submit = (ref: string): CandidateAction => ({ type: "submit", item: key(ref) });
  const edit = (ref: string): CandidateAction => ({ type: "next-attempt", item: key(ref) });
  const next: CandidateAction = { type: "move", to: "next" };
  const previous: CandidateAction = { type: "move", to: "previous" };

  /** Answers and submits the two items of the first section, each before it moves on. */
  async function finishFirstSection(send: Awaited<ReturnType<typeof reviewHost>>["send"]): Promise<void> {
    await send(choose("a1"));
    await send(submit("a1"));
    await send(next);
    await send(choose("a2"));
    await send(submit("a2"));
  }

  it("keeps the candidate going forward, one answer at a time, until the section is finished", async () => {
    const { first, send } = await reviewHost();
    expect(viewOf(first).current?.key).toEqual(key("a1"));
    expect((await send(next)).refusal?.reason).toBe("skipping-not-allowed");
    expect((await send(edit("a1"))).refusal?.reason).toBe("linear-backward");
    await send(choose("a1"));
    await send(submit("a1"));
    expect(viewOf(await send(next)).current?.key).toEqual(key("a2"));
    for (const action of [previous, edit("a2"), { type: "move", to: key("a1") } as const]) {
      expect((await send(action)).refusal?.reason, JSON.stringify(action)).toBe("linear-backward");
    }
    await send(choose("a2"));
    expect((await send(submit("a2"))).refusal).toBeUndefined();
  });

  it("opens the review after the last answer, spends a change when an answer is opened, and refuses the one after the cap", async () => {
    const { send } = await reviewHost();
    await finishFirstSection(send);
    expect(viewOf(await send(previous)).current?.key).toEqual(key("a1"));
    expect((await send(edit("a1"))).refusal).toBeUndefined();
    await send(choose("a1"));
    await send(submit("a1"));
    expect(viewOf(await send(next)).current?.key).toEqual(key("a2"));
    expect((await send(edit("a2"))).refusal).toEqual({
      reason: "attempts-exhausted",
      message: "No change is left.",
    });
  });

  it("lets the candidate leave an edit open, go to another answer and come back to it", async () => {
    const { send } = await reviewHost();
    await finishFirstSection(send);
    await send(previous);
    await send(edit("a1"));
    expect(viewOf(await send(next)).current?.key).toEqual(key("a2"));
    const back = viewOf(await send(previous));
    expect(back.current?.key).toEqual(key("a1"));
    expect(back.current?.status).toBe("interacting");
    expect((await send(submit("a1"))).refusal).toBeUndefined();
  });

  it("starts the second section closed, with a cap of its own, and shuts the first behind it", async () => {
    const { send, port } = await reviewHost();
    await finishFirstSection(send);
    await send(previous);
    await send(edit("a1"));
    await send(submit("a1"));
    expect(viewOf(await send(next)).current?.key).toEqual(key("a2"));
    expect(viewOf(await send(next)).current?.key).toEqual(key("b1"));
    expect(port.calls).toContain("createSession");
    expect((await send(previous)).refusal?.reason).toBe("linear-backward");
    expect((await send(edit("b1"))).refusal?.reason).toBe("linear-backward");
    await send(choose("b1"));
    await send(submit("b1"));
    await send(next);
    await send(choose("b2"));
    await send(submit("b2"));
    await send(previous);
    expect((await send(edit("b1"))).refusal).toBeUndefined();
  });

  it("passes the actions it has no rule for: answering, a comment the engine refuses, the clock and the end of the part", async () => {
    const { send, host } = await reviewHost();
    expect((await send(choose("a1"))).refusal).toBeUndefined();
    expect((await send(submit("a1"))).refusal).toBeUndefined();
    expect((await send({ type: "comment", item: key("a1"), text: "Hm." })).refusal?.reason).toBe("comment-not-allowed");
    expect((await host.session(ALICE.session).apply({ type: "time" })).refusal).toBeUndefined();
    expect((await send({ type: "end-part" })).refusal).toBeUndefined();
  });

  it("answers a repeated request with the stored answer, without calling the wrapper again", async () => {
    const { send, repeat, seen } = await reviewHost();
    await send(choose("a1"));
    const refused = await send(next);
    expect(refused.refusal?.reason).toBe("skipping-not-allowed");
    const calls = seen.length;
    const again = await repeat(2, next);
    expect(again.refusal).toEqual(refused.refusal);
    expect(again.seq).toBe(refused.seq);
    expect(seen).toHaveLength(calls);
  });
});

describe("createToolScoreIntake", () => {
  const Item = { ref: "draw", instance: 1 };
  const Open = ["item:draw:1:SCORE", "item:draw:1:MAXSCORE"];
  const At = Date.parse("2026-10-30T12:00:00.000Z");
  const score = (change: Partial<ToolScore> = {}): ToolScore => ({
    scoreGiven: 6,
    scoreMaximum: 10,
    final: true,
    timestampMs: At,
    ...change,
  });
  const later = (seconds: number, change: Partial<ToolScore> = {}): ToolScore =>
    score({ timestampMs: At + seconds * SECOND, ...change });

  /** A call of `apply` that the intake made, with the options it passed. */
  interface Call {
    readonly session: string;
    readonly action: HostAction;
    readonly options: HostApplyOptions | undefined;
  }

  /** A store that keeps by the time of the score as the contract says, and a host that answers the requests it still has open. */
  function intake(open: readonly string[] = Open) {
    const kept = new Map<string, ToolScore>();
    const calls: Call[] = [];
    const reads: string[] = [];
    const answered = new Set<string>();
    const refusal: { reason?: string } = {};
    const rejects: { apply: ((call: Call) => Error | undefined) | undefined; keep: Error | undefined } = {
      apply: undefined,
      keep: undefined,
    };
    const made = createToolScoreIntake({
      host: {
        session: (session) => ({
          apply: async (action, options) => {
            const call = { session, action, options };
            calls.push(call);
            if (action.type !== "supply-scores") throw new Error("Not a supply.");
            const failure = rejects.apply?.(call);
            if (failure !== undefined) throw failure;
            if (refusal.reason !== undefined) {
              return { events: [], refusal: { reason: refusal.reason, message: "no" } } as never;
            }
            if (!open.includes(action.request)) {
              return { events: [], refusal: { reason: "unknown-request", message: "none" } } as never;
            }
            answered.add(action.request);
            return { events: [] };
          },
          pending: async () => {
            reads.push(session);
            return { scoring: open.filter((id) => !answered.has(id)).map((id) => ({ id })) as never, cat: [] };
          },
        }),
      },
      scores: {
        keep: async (session, item, next) => {
          if (rejects.keep !== undefined) throw rejects.keep;
          const key = `${session} ${item.ref} ${item.instance}`;
          const before = kept.get(key);
          if (before !== undefined && before.timestampMs > next.timestampMs) return false;
          kept.set(key, next);
          return true;
        },
        latest: async (session, item) => kept.get(`${session} ${item.ref} ${item.instance}`),
      },
      scoredBy: async (session) => `tool-${session}`,
    });
    return { ...made, kept, calls, reads, refusal, rejects, answered };
  }
  const supplied = (calls: readonly Call[]): [string, unknown][] =>
    calls.map(({ action }) =>
      action.type === "supply-scores"
        ? [action.request, action.value === null ? null : (action.value as { value: unknown }).value]
        : ["", null],
    );
  const step = (...types: readonly DeliveryEventType[]): StepEvents => ({
    session: "s1",
    step: 3,
    events: types.map((type) => ({ type, at: 1, item: Item, detail: "item:draw:1:SCORE" })),
  });

  it("supplies a final score as floats to the SCORE and MAXSCORE of the item, scored by an external machine", async () => {
    const { onScore, calls } = intake();
    await onScore("s1", Item, score());
    expect(supplied(calls)).toEqual([
      ["item:draw:1:SCORE", 6],
      ["item:draw:1:MAXSCORE", 10],
    ]);
    expect(calls.map(({ action, options }) => [action.type === "supply-scores" && action.scorer, options])).toEqual([
      ["externalMachine", { scoredBy: "tool-s1" }],
      ["externalMachine", { scoredBy: "tool-s1" }],
    ]);
    expect(calls[0]?.action).toMatchObject({ value: buildSingle("float", 6) });
  });

  it("supplies NULL for a part the score does not have", async () => {
    const { onScore, calls } = intake();
    await onScore("s1", Item, score({ scoreGiven: undefined, scoreMaximum: undefined }));
    expect(supplied(calls)).toEqual([
      ["item:draw:1:SCORE", null],
      ["item:draw:1:MAXSCORE", null],
    ]);
  });

  it("keeps a score that is not final and supplies nothing", async () => {
    const { onScore, calls, kept } = intake();
    await onScore("s1", Item, later(1, { final: false }));
    expect(calls).toEqual([]);
    expect(kept.get("s1 draw 1")?.final).toBe(false);
  });

  it("ignores a score that is earlier than the kept one", async () => {
    const { onScore, calls, kept } = intake();
    await onScore("s1", Item, later(10, { scoreGiven: 6 }));
    await onScore("s1", Item, later(5, { scoreGiven: 9 }));
    expect(supplied(calls).filter(([request]) => request === "item:draw:1:SCORE")).toEqual([["item:draw:1:SCORE", 6]]);
    expect(kept.get("s1 draw 1")?.scoreGiven).toBe(6);
  });

  it("supplies a later final score again, which replaces the values of the first", async () => {
    const { onScore, calls } = intake();
    await onScore("s1", Item, later(1, { scoreGiven: 6 }));
    await onScore("s1", Item, later(2, { scoreGiven: 9 }));
    expect(supplied(calls).filter(([request]) => request === "item:draw:1:SCORE")).toEqual([
      ["item:draw:1:SCORE", 6],
      ["item:draw:1:SCORE", 9],
    ]);
  });

  it("finishes a supply that failed halfway when the tool retries at the same time", async () => {
    const { onScore, calls, rejects, kept } = intake();
    let failures = 1;
    rejects.apply = ({ action }) =>
      action.type === "supply-scores" && action.request.endsWith("MAXSCORE") && failures-- > 0
        ? new Error("The save failed.")
        : undefined;
    await expect(onScore("s1", Item, score())).rejects.toThrow("The save failed.");
    expect(kept.get("s1 draw 1")).toEqual(score());
    await onScore("s1", Item, score());
    // The retry supplies both outcomes: SCORE again replaces its own value, and MAXSCORE is supplied for the first time.
    expect(supplied(calls).map(([request]) => request)).toEqual([
      "item:draw:1:SCORE",
      "item:draw:1:MAXSCORE",
      "item:draw:1:SCORE",
      "item:draw:1:MAXSCORE",
    ]);
  });

  it("keeps a score when the session host rejects, and supplies it at a later time too", async () => {
    const { onScore, calls, rejects, kept } = intake();
    rejects.apply = () => new Error("The host is down.");
    await expect(onScore("s1", Item, later(1))).rejects.toThrow("The host is down.");
    expect(kept.get("s1 draw 1")).toEqual(later(1));
    rejects.apply = undefined;
    await onScore("s1", Item, later(2, { scoreGiven: 7 }));
    expect(supplied(calls).slice(1)).toEqual([
      ["item:draw:1:SCORE", 7],
      ["item:draw:1:MAXSCORE", 10],
    ]);
  });

  it("stores nothing and applies nothing when the store rejects, and leaves the retry to the tool", async () => {
    const { onScore, calls, rejects, kept } = intake();
    rejects.keep = new Error("The store is down.");
    await expect(onScore("s1", Item, score())).rejects.toThrow("The store is down.");
    expect(kept.size).toBe(0);
    expect(calls).toEqual([]);
    rejects.keep = undefined;
    await onScore("s1", Item, score());
    expect(calls).toHaveLength(2);
  });

  it("keeps the score when scoredBy rejects, before any action is applied, and a retry supplies it", async () => {
    const calls: unknown[] = [];
    const kept = new Map<string, ToolScore>();
    let failing = true;
    const made = createToolScoreIntake({
      host: {
        session: () => ({
          apply: async (action) => {
            calls.push(action);
            return { events: [] };
          },
          pending: async () => ({ scoring: [], cat: [] }),
        }),
      },
      scores: {
        keep: async (session, _item, next) => {
          kept.set(session, next);
          return true;
        },
        latest: async (session) => kept.get(session),
      },
      scoredBy: async () => {
        if (failing) throw new Error("Nobody to name.");
        return "tool";
      },
    });
    await expect(made.onScore("s1", Item, score())).rejects.toThrow("Nobody to name.");
    expect(calls).toEqual([]);
    expect(kept.get("s1")).toEqual(score());
    failing = false;
    await made.onScore("s1", Item, score());
    expect(calls).toHaveLength(2);
  });

  it("gives the signal of the call to the store, to scoredBy and to every action", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const made = createToolScoreIntake({
      host: {
        session: () => ({
          apply: async (_action, options) => {
            seen.push(options?.signal);
            return { events: [] };
          },
          pending: async () => ({ scoring: [], cat: [] }),
        }),
      },
      scores: {
        keep: async (_session, _item, _next, options) => {
          seen.push(options?.signal);
          return true;
        },
        latest: async () => undefined,
      },
      scoredBy: async (_session, _item, options) => {
        seen.push(options?.signal);
        return "tool";
      },
    });
    const { signal } = new AbortController();
    await made.onScore("s1", Item, score(), { signal });
    expect(seen).toEqual([signal, signal, signal, signal]);
    await expect(made.onScore("s1", Item, score(), json('{"signal":5}') as never)).rejects.toThrow(
      new DataError("The option signal must be an AbortSignal, found 5."),
    );
  });

  it("stops before the save when the call is aborted, and applies nothing", async () => {
    const aborted = new AbortController();
    const calls: unknown[] = [];
    const made = createToolScoreIntake({
      host: {
        session: () => ({
          apply: async (action, options) => {
            options?.signal?.throwIfAborted();
            calls.push(action);
            return { events: [] };
          },
          pending: async () => ({ scoring: [], cat: [] }),
        }),
      },
      scores: {
        keep: async (_session, _item, _next, options) => {
          options?.signal?.throwIfAborted();
          return true;
        },
        latest: async () => undefined,
      },
    });
    aborted.abort(new Error("Gone."));
    await expect(made.onScore("s1", Item, score(), { signal: aborted.signal })).rejects.toThrow("Gone.");
    expect(calls).toEqual([]);
  });

  it("keeps a final score for a session that has made no request yet, and supplies it when a step makes them", async () => {
    const early = intake([]);
    await early.onScore("s1", Item, score());
    expect(early.kept.size).toBe(1);
    // The session knew neither request: the first answer ends the supply.
    expect(early.calls).toHaveLength(1);
    const ready = intake();
    ready.kept.set("s1 draw 1", score());
    await ready.settle(step("scoring-requested", "scoring-requested"));
    expect(supplied(ready.calls)).toEqual([
      ["item:draw:1:SCORE", 6],
      ["item:draw:1:MAXSCORE", 10],
    ]);
    // The same step with nothing kept calls nothing.
    await early.settle(step("moved"));
    expect(early.calls).toHaveLength(1);
  });

  it("supplies the requests that are open and no others, so that a repeated settle makes no step", async () => {
    const { settle, calls, kept, reads, answered } = intake();
    kept.set("s1 draw 1", score());
    await settle(step("scoring-requested"));
    expect(calls).toHaveLength(2);
    await settle(step("scoring-requested"));
    await settle(step("scoring-requested"));
    expect(calls).toHaveLength(2);
    expect(reads).toEqual(["s1", "s1", "s1"]);
    expect([...answered]).toEqual(Open);
  });

  it("supplies only the request of an item that is still open when the other was answered", async () => {
    const { settle, calls, kept, answered } = intake();
    answered.add("item:draw:1:SCORE");
    kept.set("s1 draw 1", score());
    await settle(step("scoring-requested"));
    expect(supplied(calls)).toEqual([["item:draw:1:MAXSCORE", 10]]);
  });

  it("reads the pending work once for a step, and not at all when no kept score is final", async () => {
    const { settle, kept, reads } = intake();
    await settle(step("scoring-requested"));
    kept.set("s1 draw 1", score({ final: false }));
    await settle(step("scoring-requested"));
    expect(reads).toEqual([]);
    kept.set("s1 draw 1", score());
    kept.set("s1 other 2", score());
    await settle({
      session: "s1",
      step: 5,
      events: [
        { type: "scoring-requested", at: 1, item: Item },
        { type: "scoring-requested", at: 1, item: { ref: "other", instance: 2 } },
      ],
    });
    expect(reads).toEqual(["s1"]);
  });

  it("settles only for steps that made scoring requests, and only for items with a kept final score", async () => {
    const { settle, calls, kept } = intake();
    await settle(step("moved", "scores-applied", "attempt-ended"));
    await settle(step("scoring-requested"));
    expect(calls).toEqual([]);
    kept.set("s1 draw 1", score({ final: false }));
    await settle(step("scoring-requested"));
    expect(calls).toEqual([]);
    await settle({
      session: "s1",
      step: 4,
      events: [{ type: "scoring-requested", at: 1, scope: "exam", detail: "test:TOTAL" }],
    });
    expect(calls).toEqual([]);
  });

  it("fails as the step sink it runs in when the session host rejects, and the kept score stays", async () => {
    const { settle, kept, rejects, calls } = intake();
    kept.set("s1 draw 1", score());
    rejects.apply = () => new Error("The host is down.");
    await expect(settle(step("scoring-requested"))).rejects.toThrow("The host is down.");
    expect(kept.get("s1 draw 1")).toEqual(score());
    rejects.apply = undefined;
    await settle(step("scoring-requested"));
    expect(supplied(calls).slice(1)).toEqual([
      ["item:draw:1:SCORE", 6],
      ["item:draw:1:MAXSCORE", 10],
    ]);
  });

  it("leaves a catFailure of the step alone, since the store holds the score", async () => {
    const calls: unknown[] = [];
    const made = createToolScoreIntake({
      host: {
        session: () => ({
          apply: async (action) => {
            calls.push(action);
            return { events: [], catFailure: { request: "cat:1", message: "The CAT engine is down." } };
          },
          pending: async () => ({ scoring: [], cat: [] }),
        }),
      },
      scores: { keep: async () => true, latest: async () => undefined },
    });
    await made.onScore("s1", Item, score());
    expect(calls).toHaveLength(2);
  });

  it("throws DataError when the session refuses the score for a reason other than a request it does not have", async () => {
    const { onScore, refusal } = intake();
    refusal.reason = "score-type-mismatch";
    await expect(onScore("s1", Item, score())).rejects.toThrow(
      new DataError('The session "s1" refused the score of the tool for item:draw:1:SCORE: no'),
    );
  });

  it("leaves the scorer out of the action when the host names none", async () => {
    const calls: unknown[][] = [];
    const bare = createToolScoreIntake({
      host: {
        session: () => ({
          apply: async (...args) => {
            calls.push(args);
            return { events: [] };
          },
          pending: async () => ({ scoring: [], cat: [] }),
        }),
      },
      scores: { keep: async () => true, latest: async () => undefined },
    });
    await bare.onScore("s1", Item, score());
    expect(calls.map(([, options]) => options)).toEqual([{}, {}]);
  });

  it("throws DataError for options of other types", () => {
    const good = {
      host: {
        session: () => ({ apply: async () => ({ events: [] }), pending: async () => ({ scoring: [], cat: [] }) }),
      },
      scores: { keep: async () => true, latest: async () => undefined },
    };
    const make = (change: Record<string, unknown>): unknown => createToolScoreIntake({ ...good, ...change } as never);
    expect(() => make({ host: json("null") })).toThrow(new DataError("The option host must be an object, found null."));
    expect(() => make({ host: {} })).toThrow(
      new DataError("The function session of the option host must be a function, found undefined."),
    );
    expect(() => make({ scores: json("5") })).toThrow(new DataError("The option scores must be an object, found 5."));
    expect(() => make({ scores: { keep: async () => true } })).toThrow(
      new DataError("The function latest of the option scores must be a function, found undefined."),
    );
    expect(() => make({ scoredBy: json("1") })).toThrow(
      new DataError("The option scoredBy must be a function, found 1."),
    );
    expect(() => createToolScoreIntake(json("null") as never)).toThrow(
      new DataError("The options must be an object, found null."),
    );
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const modules = {
      "@assesskit/player/server": await import("../src/server/index.js"),
      "@assesskit/runtime/delivery": await import("@assesskit/runtime/delivery"),
      "@assesskit/runtime/package": await import("@assesskit/runtime/package"),
      "@assesskit/runtime/values": await import("@assesskit/runtime/values"),
    };
    expect(await runGuideSamples(serverGuide, modules)).toBeGreaterThan(0);
    expect(await runGuideSamples(assetGateGuide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  const Actions: readonly CandidateAction[] = [
    answer("A"),
    answer("B"),
    { type: "move", to: "next" },
    { type: "move", to: "previous" },
    { type: "move", to: { ref: "q3", instance: 1 } },
    { type: "skip", item: Q1 },
    { type: "submit", item: Q1 },
    { type: "comment", item: Q1, text: "A comment." },
    { type: "end-part" },
    { type: "end-test" },
    { type: "submit", item: { ref: "q9", instance: 1 } },
  ];
  const actions = fc.array(fc.constantFrom(...Actions), { maxLength: 7 });

  it("returns the view that the engine gives for the same actions, through writeView and readView", async () => {
    await fc.assert(
      fc.asyncProperty(actions, async (list) => {
        const { host, clock, engine } = await examHost();
        await host.start(ALICE, { seed: 3 });
        const started = engine.start({ seed: 3, at: clock.now() });
        if (!started.ok) throw new Error("The fixture test starts.");
        let state = started.state;
        let seq = 0;
        for (const action of list) {
          seq += 1;
          clock.advance(SECOND);
          const reply = await host.handle(ALICE, request(seq, action));
          const step = engine.apply(state, stamp(state, action, clock.now()));
          if (step.ok) state = step.state;
          const expected = engine.view(state, clock.now());
          const allowed = { ...expected, actions: expected.actions.filter((type) => type !== "suspend") };
          expect(viewOf(reply)).toEqual(readView(writeView(allowed)));
        }
      }),
      { numRuns: 25 },
    );
  });

  it("changes nothing when a request is repeated, whatever the actions before it", async () => {
    await fc.assert(
      fc.asyncProperty(actions, async (list) => {
        const { host, store, logged } = await examHost();
        await host.start(ALICE, { seed: 3 });
        let seq = 0;
        let last: ViewEnvelope | undefined;
        for (const action of list) {
          seq += 1;
          last = await host.handle(ALICE, request(seq, action));
        }
        if (last === undefined) return;
        const record = store.records.get("exam-1");
        const steps = logged.length;
        const again = await host.handle(ALICE, request(seq, { type: "end-test" }));
        expect(again.view).toEqual(last.view);
        expect(again.refusal).toEqual(last.refusal);
        expect(store.records.get("exam-1")).toEqual(record);
        expect(logged).toHaveLength(steps);
      }),
      { numRuns: 25 },
    );
  });

  it("converges when competing writes come first, up to the retries, and fails with 409 beyond them", async () => {
    await fc.assert(
      fc.asyncProperty(actions, fc.integer({ min: 0, max: MAX_SAVE_RETRIES + 2 }), async (list, conflicts) => {
        const free = await examHost();
        const raced = await examHost();
        await free.host.start(ALICE, { seed: 3 });
        await raced.host.start(ALICE, { seed: 3 });
        let seq = 0;
        for (const action of list) {
          seq += 1;
          await free.host.handle(ALICE, request(seq, action));
          await raced.host.handle(ALICE, request(seq, action));
        }
        const next = request(seq + 1, { type: "move", to: "next" });
        const expected = await free.host.handle(ALICE, next);
        raced.store.conflictNext(conflicts);
        if (conflicts > MAX_SAVE_RETRIES) {
          await expect(raced.host.handle(ALICE, next)).rejects.toMatchObject({ name: "ServiceError", status: 409 });
        } else {
          expect((await raced.host.handle(ALICE, next)).view).toEqual(expected.view);
        }
      }),
      { numRuns: 20 },
    );
  });

  it("gives the log each saved step once, in the order of the versions that the steps saved", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (answers) => {
        const { host, logged } = await examHost();
        await host.start(ALICE, { seed: 7 });
        for (let seq = 1; seq <= answers; seq += 1) await host.handle(ALICE, request(seq, answer("A")));
        expect(logged.map(({ step }) => step)).toEqual(["start", ...Array.from({ length: answers }, (_, i) => i + 1)]);
      }),
      { numRuns: 15 },
    );
  });
});
