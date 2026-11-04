import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { BASELINE, type Engine } from "./engines.ts";

/** What a smoke case uses of a Playwright page; every release of `engines/` has it. */
interface SmokePage {
  /** Opens a URL. */
  goto(url: string): Promise<unknown>;
  /** Evaluates JavaScript in the page and returns the value, awaiting a promise. */
  evaluate(expression: string): Promise<unknown>;
  /** The keyboard of the page. */
  readonly keyboard: {
    /** Presses a key, such as `Enter` or `ArrowRight`, on the element that has the focus. */
    press(key: string): Promise<unknown>;
  };
}

/** The engine a case runs in. */
interface SmokeContext {
  readonly page: SmokePage;
  /** The name Playwright gives the engine. */
  readonly engine: Engine;
  /** What `browser.version()` says. */
  readonly version: string;
}

/** A check that runs in every pinned engine. A case throws when it fails. */
export interface SmokeCase {
  /** What the case shows. */
  readonly title: string;
  /** Runs the case. */
  run(context: SmokeContext): Promise<void>;
}

const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".map", "application/json"],
  [".woff2", "font/woff2"],
]);

/** The built package, which engines/<name>/ runs in: `playwright test` starts there. */
const DIST = resolve(process.cwd(), "../../../packages/player/dist");

/** The root of the package with its dependencies in one file, which `run-engines.ts` makes before the containers start. */
const ROOT_BUNDLE = resolve(process.cwd(), "../../.smoke/index.js");

/** The player with its dependencies in one file, which `run-engines.ts` makes before the containers start. */
const PLAYER_BUNDLE = resolve(process.cwd(), "../../.smoke/player.js");

/** The protocol with its dependencies in one file, which `run-engines.ts` makes with the bundle of the player. */
const PROTOCOL_BUNDLE = resolve(process.cwd(), "../../.smoke/protocol.js");

/** The directory that holds `mathjax` and `@mathjax` as npm lays them out, which the pages load MathJax from. */
const MATHJAX_FILES = dirname(realpathSync(resolve(process.cwd(), "../../../packages/player/node_modules/mathjax")));

/** The stylesheet of the player, which the package ships as it is. */
const PLAYER_CSS_FILE = resolve(process.cwd(), "../../../packages/player/player.css");

/** The module of the portable custom interaction that the page loads into the frame: it changes its response once and tries a request. */
const PCI_MODULE = `define(["qtiCustomInteractionContext"], function (context) {
  context.register({
    typeIdentifier: "urn:smoke:echo",
    getInstance: function (dom, configuration) {
      var instance = {
        getResponse: function () { return { base: { integer: 1 } }; },
        getState: function () { return "{}"; },
      };
      configuration.onready(instance, "{}");
      dom.dispatchEvent(new CustomEvent("qti-interaction-changed", { bubbles: true, detail: { interaction: instance } }));
      fetch("/pci/secret").then(
        function () { parent.postMessage({ probe: "fetch", result: "reached" }, "*"); },
        function () { parent.postMessage({ probe: "fetch", result: "blocked" }, "*"); },
      );
      return instance;
    },
  });
});`;

/** Returns the file that serves a path, or `undefined` when the server has none. */
function locate(path: string): string | undefined {
  if (path === "/player.css" || path === "/dist/player.css") return PLAYER_CSS_FILE;
  if (path === "/dist/index.js") return ROOT_BUNDLE;
  if (path === "/dist/player/index.js") return PLAYER_BUNDLE;
  if (path === "/dist/protocol/index.js") return PROTOCOL_BUNDLE;
  const within = (directory: string, relative: string): string | undefined => {
    const file = resolve(directory, `.${relative}`);
    return file.startsWith(`${directory}${sep}`) ? file : undefined;
  };
  if (path.startsWith("/dist/")) return within(DIST, path.slice("/dist".length));
  if (/^\/@?mathjax\//u.test(path)) return within(MATHJAX_FILES, path);
  return undefined;
}

/**
 * Serves `dist/` at `/dist/`, except that `/dist/index.js`, `/dist/player/index.js` and `/dist/protocol/index.js` are the bundles of
 * the root, the player and the protocol, which import the runtime; `player.css` at `/player.css`
 * and `/dist/player.css`; MathJax and its fonts at `/mathjax/` and `/@mathjax/`; the module of the interaction at
 * `/pci/echo.js`; and an empty page at `/`. Returns the URL of the page and a function that stops it.
 */
async function serve(): Promise<{ readonly url: string; readonly stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><title>the player</title>");
      return;
    }
    if (path === "/pci/echo.js") {
      response.setHeader("content-type", "text/javascript");
      response.end(PCI_MODULE);
      return;
    }
    const file = locate(path);
    if (file === undefined) {
      response.statusCode = 404;
      response.end();
      return;
    }
    readFile(file).then(
      (content) => {
        response.setHeader("content-type", MEDIA_TYPES.get(extname(file)) ?? "application/octet-stream");
        response.end(content);
      },
      () => {
        response.statusCode = 404;
        response.end();
      },
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    stop: () =>
      new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

/** The check of the shared modules, which runs in the page. */
const SHARED_MODULES = `(async () => {
  const { selectMessages } = await import("/dist/index.js");
  const { ID_MESSAGES } = await import("/dist/messages/id/index.js");
  const { checkActionEnvelope } = await import("/dist/protocol/index.js");
  checkActionEnvelope({ seq: 1, action: {} });
  let refused = "";
  try {
    checkActionEnvelope({ seq: 1, action: {}, session: "s1" });
  } catch (error) {
    refused = error.name;
  }
  return { rule: selectMessages("id-ID", { id: ID_MESSAGES }).toolRule, refused };
})()`;

/** The check of the stylesheet, which runs in the page: a content root that adopts it, as the player makes one. */
const PLAYER_CSS = `(async () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(await (await fetch("/player.css")).text());
  const host = document.createElement("div");
  host.setAttribute("data-ak-contrast", "high");
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [sheet];
  const choices = [1, 2, 3, 4, 5, 6].map((n) => "<qti-simple-choice>" + n + "</qti-simple-choice>").join("");
  root.innerHTML = "<div class='qti-layout-row'><div class='qti-layout-col6'>a</div><div class='qti-layout-col6'>b</div></div>" +
    "<input aria-label='x'><p class='qti-writing-mode-vertical-rl qti-text-orientation-upright'>y</p>" +
    "<qti-choice-interaction class='qti-choices-stacking-3 qti-orientation-horizontal'>" + choices + "</qti-choice-interaction>";
  document.body.append(host);
  const style = (selector) => getComputedStyle(root.querySelector(selector));
  return {
    contain: getComputedStyle(host).contain,
    color: getComputedStyle(host).color,
    columns: style(".qti-layout-row").gridTemplateColumns.split(" ").length,
    border: style("input").borderTopColor,
    writingMode: style("p").writingMode,
    textOrientation: style("p").textOrientation,
    stackedColumns: new Set([...root.querySelectorAll("qti-simple-choice")].map((choice) => choice.getBoundingClientRect().left)).size,
  };
})()`;

/** The check of the frame of a portable custom interaction, which runs in the page: it starts, answers, and reaches no network. */
const PCI_FRAME = `(async () => {
  const { mountPciFrame } = await import("/dist/player/index.js");
  const events = [];
  const probes = [];
  addEventListener("message", (event) => {
    if (event.data && event.data.probe) probes.push(event.data);
  });
  const frame = mountPciFrame(document.body, {
    staticUrl: location.origin + "/dist/",
    messages: { interactiveQuestion: "Interactive question" },
    language: "en",
    interaction: {
      kind: "portable-custom-interaction",
      responseIdentifier: "RESPONSE",
      customInteractionTypeIdentifier: "urn:smoke:echo",
      module: "echo",
      extensions: [],
    },
    configuration: { primary: { waitSeconds: 7, paths: new Map([["echo", "pci/echo"]]) } },
    assets: (path) => location.origin + "/" + path,
    prompt: null,
    markup: "<p>Echo</p>",
    stylesheets: [],
    status: "interacting",
    response: { value: null, declaration: { cardinality: "single", baseType: "integer" } },
    files: { read: async () => new Uint8Array(), upload: async () => { throw new Error("The page has no storage."); } },
    onEvent: (event) => events.push(event.type),
  });
  const until = async (done) => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  };
  await until(() => events.includes("changed") && probes.length > 0);
  await frame.destroy();
  return { events, sandbox: frame.element.getAttribute("sandbox"), probes: probes.map((probe) => probe.result) };
})()`;

/**
 * Mounts the tools of the player as the player lays them out, the item in a shadow root, with a rule, a standard
 * calculator, the line reader and answer masking, and focuses the button of the rule. It leaves the scene in `window.scene`.
 */
const MOUNT_TOOLS = `(async () => {
  const { mountTools } = await import("/dist/player/index.js");
  const { EN_MESSAGES } = await import("/dist/index.js");
  const host = document.createElement("div");
  const container = document.createElement("div");
  const stage = document.createElement("div");
  stage.style.cssText = "position: relative; width: 360px; min-height: 400px; font: 16px/24px sans-serif;";
  stage.innerHTML = '<p style="margin: 0; white-space: pre-line; line-height: 24px;">one\\ntwo\\nthree</p>' +
    '<qti-choice-interaction><qti-simple-choice><input type="radio"> Alpha</qti-simple-choice></qti-choice-interaction>';
  container.attachShadow({ mode: "open" }).append(stage);
  document.body.append(host, container);
  const tools = mountTools(host, { messages: EN_MESSAGES, language: "en", stage, assets: (path) => path, onSupport: () => undefined });
  tools.update({
    companion: {
      calculators: [{ calculatorType: { value: "standard" }, description: { value: "Standard" } }],
      rules: [{
        description: { value: "Ruler" },
        ruleSystem: { minimumLength: { value: 10 }, majorIncrement: { unit: "Centimeter", value: "1" } },
      }],
      protractors: [], digitalMaterials: [], physicalMaterials: [],
    },
    supports: [
      { name: "line-reader", state: "active", active: true },
      { name: "answer-masking", state: "active", active: true },
    ],
  });
  window.scene = { host, stage };
  const button = (name) => [...host.querySelectorAll(".ak-row > button")].find((each) => each.textContent === name);
  window.scene.button = button;
  button("Ruler").focus();
})()`;

/** What the keyboard did to the tools, as JSON: the focus, the rule's transform, the calculator's display, the line reader and the mask. */
const READ_TOOLS = `(() => {
  const { host, stage } = window.scene;
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  const rule = stage.querySelector('.ak-placed[aria-label="Ruler"]');
  const band = stage.querySelector("[role=slider]");
  const display = host.querySelector("output");
  return JSON.stringify({
    focused: active ? active.tagName + ":" + (active.getAttribute("aria-label") || active.textContent) : null,
    transform: rule ? rule.style.transform : null,
    display: display ? display.textContent : null,
    line: band ? band.getAttribute("aria-valuenow") + " of " + band.getAttribute("aria-valuemax") : null,
    masked: getComputedStyle(stage.querySelector("qti-simple-choice")).display === "none",
  });
})()`;

/** What {@link READ_TOOLS} reads. */
interface ToolsReading {
  readonly focused: string | null;
  readonly transform: string | null;
  readonly display: string | null;
  readonly line: string | null;
  readonly masked: boolean;
}

async function readTools(page: SmokePage): Promise<ToolsReading> {
  return JSON.parse(String(await page.evaluate(READ_TOOLS)));
}

/** Reads the horizontal offset of the transform of a placed tool, in CSS pixels. */
function offsetOf(transform: string | null): number {
  return Number(/translate\((-?[\d.]+)px/.exec(transform ?? "")?.[1]);
}

/** The check of the speech request, which runs in the page: SSML, data-ssml, a lexicon, suppression and a range. */
const SPEECH_REQUEST = `(async () => {
  const { buildSpeechRequest, readLexicon } = await import("/dist/player/index.js");
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<p>Read <span data-ssml='{\\"sub\\":{\\"alias\\":\\"World Wide Web\\"}}'>WWW</span> and " +
    "<span data-qti-suppress-tts='computer-read-aloud'>hidden</span> W3C.</p>";
  const sub = document.createElementNS("http://www.w3.org/2001/10/synthesis", "sub");
  sub.setAttribute("alias", "Froyd");
  sub.textContent = "Freud";
  root.firstElementChild.append(" ", sub);
  document.body.append(host);
  const lexicon = readLexicon("<lexicon xmlns='http://www.w3.org/2005/01/pronunciation-lexicon' version='1.0' alphabet='ipa' xml:lang='en'>" +
    "<lexeme><grapheme>W3C</grapheme><alias>World Wide Web Consortium</alias></lexeme></lexicon>");
  const range = document.createRange();
  range.selectNodeContents(root);
  const request = buildSpeechRequest(range, {
    settings: { readingType: "computer-read-aloud", restrictionTypes: [] },
    messages: { speechLink: "link", typingSpace: "space" },
    language: "en",
    lexicons: [lexicon],
  });
  return { text: request.text, lang: request.lang, keepsSub: request.ssml.includes("<sub alias=\\"World Wide Web\\">WWW</sub>") };
})()`;

/** The check of the supports, which runs in the page: the look, a card in place of the content, a popup, and the panel. */
const SUPPORTS = `(async () => {
  const { createContentRoot, mountContentSupports, mountSupportPanel, resolvePresentation, applyPresentation } = await import("/dist/player/index.js");
  const { EN_MESSAGES } = await import("/dist/index.js");
  const player = new CSSStyleSheet();
  player.replaceSync(await (await fetch("/player.css")).text());
  const host = document.createElement("div");
  document.body.append(host);
  const root = createContentRoot(host, {
    messages: EN_MESSAGES,
    assets: (path) => location.origin + "/g/" + path,
    fetch: async () => ({ ok: true, status: 200, text: async () => "" }),
    stylesheet: player,
  });
  const text = (value) => ({ kind: "text", value });
  const node = (kind, children, more) => Object.assign({ kind, children }, more);
  const card = (support, content) => ({
    kind: "card", support, cardEntries: [], fileHrefs: [],
    htmlContent: node("html-content", [node("p", [text(content)], {})], {}),
  });
  await root.show({
    body: { base: "items/q1/item.xml", nodes: [node("p", [text("Term")], { dataCatalogIdref: "term" })] },
    catalogs: [{ kind: "catalog", id: "term", cards: [card("glossary-on-screen", "A definition"), card("high-contrast", "Plain")] }],
  });
  const supports = [
    { name: "glossary-on-screen", state: "active", active: true },
    { name: "high-contrast", state: "option", active: true },
  ];
  mountContentSupports(root, { messages: EN_MESSAGES }).update(supports);
  applyPresentation(host, resolvePresentation(supports));
  const shadow = root.root;
  const paragraph = shadow.querySelector("p");
  shadow.querySelector(".ak-card-trigger").click();
  const popup = shadow.querySelector(".ak-popup");
  const inside = popup.getBoundingClientRect();
  const box = host.getBoundingClientRect();
  const opened = !popup.hidden && inside.left >= box.left - 1 && inside.right <= box.right + 1;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const chrome = document.createElement("div");
  document.body.append(chrome);
  const requests = [];
  mountSupportPanel(chrome, { messages: EN_MESSAGES, onSupport: (name, active) => requests.push(name + " " + active) })
    .update([{ name: "captions", state: "option", active: false }]);
  chrome.querySelector("button").click();
  return {
    replaced: paragraph.firstChild.textContent,
    opened,
    dismissed: popup.hidden,
    contrast: host.getAttribute("data-ak-contrast"),
    color: getComputedStyle(paragraph).color,
    requests,
  };
})()`;

/** The check of MathJax, which runs in the page: it loads from the host, typesets in a shadow root and gives braille. */
const MATHJAX = `(async () => {
  const { createMathTypesetter } = await import("/dist/player/index.js");
  const mathml = "http://www.w3.org/1998/Math/MathML";
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<p><math xmlns='" + mathml + "'><mfrac><mi>x</mi><mn>2</mn></mfrac></math></p>" +
    "<p id='elementary'><math xmlns='" + mathml + "'><mstack><mn>12</mn></mstack></math></p>";
  document.body.append(host);
  await createMathTypesetter(location.origin + "/mathjax/mml-chtml.js").typeset(root);
  const top = (selector) => root.querySelector(selector).getBoundingClientRect().top;
  const braille = root.querySelector("mjx-speech").getAttribute("aria-braillelabel");
  return {
    typeset: root.querySelectorAll("mjx-container").length,
    stacked: top("mjx-den") > top("mjx-num") + 4,
    elementary: root.querySelectorAll("#elementary math").length,
    adopted: root.adoptedStyleSheets.length,
    braille: /^[\\u2800-\\u28ff]+$/.test(braille),
  };
})()`;

/**
 * The check of the content root, which runs in the page: nodes become DOM with the URLs of the package, a stylesheet that is
 * hostile loses what it must, and modal feedback opens in the top layer.
 */
const CONTENT_ROOT = `(async () => {
  const { createContentRoot } = await import("/dist/player/index.js");
  const { EN_MESSAGES } = await import("/dist/index.js");
  const player = new CSSStyleSheet();
  player.replaceSync(await (await fetch("/player.css")).text());
  const host = document.createElement("div");
  document.body.append(host);
  const hostile = ".keep { color: rgb(1, 2, 3); } .picture { background-image: url(img/a.png); } " +
    ".outside { background-image: url(https://stranger.invalid/x.png); } :host { position: fixed; } " +
    "@import url(https://stranger.invalid/i.css); .hidden { background: var(--n, u\\\\72l(https://stranger.invalid/e.png)); }";
  const root = createContentRoot(host, {
    messages: EN_MESSAGES,
    assets: (path) => location.origin + "/g/" + path,
    fetch: async () => ({ ok: true, status: 200, text: async () => hostile }),
    stylesheet: player,
  });
  const text = (value) => ({ kind: "text", value });
  const node = (kind, children, more) => Object.assign({ kind, children }, more);
  await root.show({
    body: {
      base: "items/q1/item.xml",
      nodes: [
        node("p", [
          text("One "), node("em", [text("two")]), text(" "),
          node("a", [text("link")], { href: "files/a.pdf" }),
          node("img", [], { src: "img/a.png", alt: "A", width: "10" }),
          node("a", [text("away")], { href: "https://stranger.invalid/" }),
        ], { class: ["keep"], onclick: "alert(1)" }),
        node("p", [{ kind: "element", namespace: "http://www.w3.org/1998/Math/MathML", name: "math", attributes: [], children: [] }], {}),
      ],
    },
    stylesheets: ["style/hostile.css"],
  });
  const shadow = root.root;
  const query = (selector) => shadow.querySelector(selector);
  const rules = [...shadow.adoptedStyleSheets[1].cssRules].map((rule) => rule.cssText).join(" ");
  const closed = root.showFeedback([{ kind: "modal-feedback", title: "Title", contentBody: { children: [node("p", [text("Feedback")], {})] } }]);
  const dialog = shadow.querySelector("dialog");
  const modal = dialog.open && dialog.matches(":modal");
  dialog.close();
  await closed;
  return {
    tags: [...shadow.querySelectorAll(".ak-body *")].map((element) => element.localName),
    image: query("img").getAttribute("src"),
    width: query("img").getAttribute("width"),
    link: query("a").getAttribute("href"),
    rel: query("a").getAttribute("rel"),
    away: query("a:last-of-type").hasAttribute("href"),
    handler: query("p").hasAttribute("onclick"),
    math: query("math").namespaceURI,
    sheets: shadow.adoptedStyleSheets.length,
    keeps: rules.includes("rgb(1, 2, 3)") && getComputedStyle(query(".keep")).color === "rgb(1, 2, 3)",
    absolute: rules.includes(location.origin + "/g/style/img/a.png"),
    removes: !/stranger|:host|@import/.test(rules),
    hostKept: getComputedStyle(host).position !== "fixed" && getComputedStyle(host).contain === "layout paint",
    modal,
    removed: shadow.querySelector("dialog") === null,
  };
})()`;

/**
 * Mounts a choice, an order, a slider and a text entry with the renderers of the interactions, in a shadow root, and gives
 * them the descriptors that the runtime would. It collects the responses in `window.scene.responses`, and `window.scene.focus` focuses the
 * element that a selector finds in the root.
 */
const MOUNT_INTERACTIONS = `(async () => {
  const { createBodyRenderer, createInteractionRenderers, defineElements } = await import("/dist/player/index.js");
  const { EN_MESSAGES } = await import("/dist/index.js");
  const text = (value) => ({ kind: "text", value });
  const choice = (identifier, label) => ({ kind: "simple-choice", identifier, children: [text(label)] });
  const nodes = [
    { kind: "choice-interaction", responseIdentifier: "C", maxChoices: 2, simpleChoices: [choice("A", "Alpha"), choice("B", "Beta")] },
    { kind: "order-interaction", responseIdentifier: "O", simpleChoices: [choice("A", "Alpha"), choice("B", "Beta")] },
    { kind: "slider-interaction", responseIdentifier: "S", lowerBound: 0, upperBound: 10 },
    { kind: "p", children: [text("Type "), { kind: "text-entry-interaction", responseIdentifier: "T" }, text(".")] },
  ];
  const files = { upload: async () => { throw new Error("The page has no storage."); }, url: () => "" };
  const renderer = createBodyRenderer({
    messages: EN_MESSAGES,
    assets: (path) => path,
    interactions: createInteractionRenderers({ messages: EN_MESSAGES, files, staticUrl: location.origin + "/dist/", record: false }),
  });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(await (await fetch("/player.css")).text());
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [sheet];
  root.append(...renderer.nodes(nodes));
  document.body.append(host);
  const pair = (identifier, baseType, cardinality) => ({ cardinality, baseTypes: [baseType], identifier });
  const choices = [{ identifier: "A", fixed: false, showHide: "show" }, { identifier: "B", fixed: false, showHide: "show" }];
  const descriptors = new Map([
    ["C", { kind: "choice-interaction", responseIdentifier: "C", declaration: { cardinality: "multiple", baseType: "identifier" },
      bindings: [{ cardinality: "multiple", baseTypes: ["identifier"] }], choices, constraints: { maxChoices: 2 }, shuffle: false }],
    ["O", { kind: "order-interaction", responseIdentifier: "O", declaration: { cardinality: "ordered", baseType: "identifier" },
      bindings: [{ cardinality: "ordered", baseTypes: ["identifier"] }], choices, constraints: {}, shuffle: false }],
    ["S", { kind: "slider-interaction", responseIdentifier: "S", declaration: { cardinality: "single", baseType: "integer" },
      bindings: [{ cardinality: "single", baseTypes: ["integer"] }], choices: [], constraints: { lowerBound: 0, upperBound: 10, step: 1 }, shuffle: false }],
    ["T", { kind: "text-entry-interaction", responseIdentifier: "T", declaration: { cardinality: "single", baseType: "string" },
      bindings: [{ cardinality: "single", baseTypes: ["string"] }], choices: [], constraints: { base: 10 }, shuffle: false }],
  ]);
  const responses = [];
  root.addEventListener("ak-response", (event) => responses.push([event.detail.responseIdentifier, event.detail.value]));
  for (const element of root.querySelectorAll("*")) {
    const descriptor = descriptors.get(element.getAttribute("response-identifier"));
    if (descriptor) element.descriptor = descriptor;
  }
  window.scene = { responses, focus: (selector) => root.querySelector(selector).focus() };
})()`;

/**
 * Mounts a hotspot, a select point, a position object, a graphic gap match and a drawing with the renderers of the interactions,
 * in a shadow root, and gives them the descriptors that the runtime would. It collects the responses and the types of the pictures
 * that the drawing stored in `window.graphic`, and `window.graphic.focus` focuses the element that a selector finds in the root.
 */
const MOUNT_GRAPHIC = `(async () => {
  const { createBodyRenderer, createInteractionRenderers } = await import("/dist/player/index.js");
  const { EN_MESSAGES } = await import("/dist/index.js");
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 100;
  const picture = canvas.toDataURL("image/png");
  const object = (width, height) => ({ kind: "object", type: "image/png", data: picture, width, height, extensions: [], children: [] });
  const area = (kind, identifier, shape, coords, more) => Object.assign({ kind, identifier, shape, coords, extensions: [] }, more);
  const text = (value) => ({ kind: "text", value });
  const gap = (identifier) => ({ kind: "gap-text", identifier, matchMax: 1, extensions: [], children: [text(identifier)] });
  const nodes = [
    { kind: "hotspot-interaction", responseIdentifier: "H", maxChoices: 1, extensions: [], image: object("200", "100"), hotspotChoices: [
      area("hotspot-choice", "A", "circle", "40,50,20"), area("hotspot-choice", "B", "rect", "100,20,160,80"), area("hotspot-choice", "C", "poly", "10,10,60,10,35,40")] },
    { kind: "select-point-interaction", responseIdentifier: "S", maxChoices: 2, extensions: [], image: object("200", "100") },
    { kind: "position-object-stage", extensions: [], image: object("200", "100"), positionObjectInteractions: [
      { kind: "position-object-interaction", responseIdentifier: "P", maxChoices: 1, extensions: [], image: object("16", "16") }] },
    { kind: "graphic-gap-match-interaction", responseIdentifier: "G", extensions: [], image: object("200", "100"), choices: [gap("X")],
      associableHotspots: [area("associable-hotspot", "H1", "rect", "10,10,70,40", { matchMax: 1 })] },
    { kind: "drawing-interaction", responseIdentifier: "D", extensions: [], image: object("200", "100") },
  ];
  const uploads = [];
  const files = {
    upload: async (bytes, mimeType) => { uploads.push(mimeType); return { reference: "f" + uploads.length, mimeType }; },
    url: (file) => file.reference,
  };
  const renderer = createBodyRenderer({
    messages: EN_MESSAGES,
    assets: (path) => path,
    interactions: createInteractionRenderers({ messages: EN_MESSAGES, files, staticUrl: location.origin + "/dist/", record: false }),
  });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(await (await fetch("/player.css")).text());
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [sheet];
  root.append(...renderer.nodes(nodes));
  document.body.append(host);
  const choice = (identifier) => ({ identifier, fixed: false, showHide: "show" });
  const describe = (kind, responseIdentifier, cardinality, baseType, choices, constraints, matchSets) => ({
    kind, responseIdentifier, declaration: { cardinality, baseType }, bindings: [{ cardinality, baseTypes: [baseType] }],
    choices, constraints, shuffle: false, ...(matchSets ? { matchSets } : {}),
  });
  const descriptors = new Map([
    ["H", describe("hotspot-interaction", "H", "single", "identifier", [choice("A"), choice("B"), choice("C")], { maxChoices: 1 })],
    ["S", describe("select-point-interaction", "S", "multiple", "point", [], { maxChoices: 2 })],
    ["P", describe("position-object-interaction", "P", "single", "point", [], { maxChoices: 1 })],
    ["G", describe("graphic-gap-match-interaction", "G", "multiple", "directedPair", [choice("X"), choice("H1")], {}, [[choice("X")], [choice("H1")]])],
    ["D", describe("drawing-interaction", "D", "single", "file", [], {})],
  ]);
  const responses = [];
  root.addEventListener("ak-response", (event) => responses.push([event.detail.responseIdentifier, event.detail.value]));
  const elements = [];
  for (const element of root.querySelectorAll("*")) {
    const descriptor = descriptors.get(element.getAttribute("response-identifier"));
    if (descriptor) {
      element.descriptor = descriptor;
      elements.push(element);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  window.graphic = { root, elements, responses, uploads, focus: (selector) => root.querySelector(selector).focus() };
})()`;

/** What the keyboard did to the graphic interactions, as JSON: the responses they dispatched, the shapes, and the pictures stored. */
const READ_GRAPHIC = `(async () => {
  const { root, elements, responses, uploads } = window.graphic;
  await Promise.all(elements.map((element) => element.settled()));
  const [circle, rect] = [...root.querySelectorAll("qti-hotspot-choice")].map((area) => area.getBoundingClientRect());
  const stage = root.querySelector(".ak-layer").getBoundingClientRect();
  const inStage = (box) => [box.left - stage.left, box.top - stage.top, box.width, box.height].map(Math.round);
  return JSON.stringify({
    responses,
    uploads,
    // INFO section 7.9: a circle is its center and radius, a rectangle its corners, in the units of the 200 by 100 image.
    circle: inStage(circle),
    rect: inStage(rect),
    polygon: root.querySelectorAll('qti-hotspot-choice[data-shape="poly"] polygon').length,
  });
})()`;

/** What {@link READ_GRAPHIC} reads. */
interface GraphicReading {
  readonly responses: readonly [string, { readonly baseType: string }][];
  readonly uploads: readonly string[];
  readonly circle: readonly number[];
  readonly rect: readonly number[];
  readonly polygon: number;
}

/** The check of the worklet of the WAV recording, which runs in the page: the context loads it and makes a node of its processor. */
const RECORDER_WORKLET = `(async () => {
  const context = new AudioContext();
  await context.audioWorklet.addModule("/dist/recorder-worklet.js");
  const node = new AudioWorkletNode(context, "ak-recorder");
  await context.close();
  return node.numberOfOutputs;
})()`;

/** The cases of the smoke test of the pinned engines. */
export const SMOKE_CASES: readonly SmokeCase[] = [
  {
    title: "is the engine of the baseline",
    async run({ engine, version }) {
      assert(version.startsWith(BASELINE[engine]), `${engine} is ${version}, not ${BASELINE[engine]}`);
    },
  },
  {
    title: "loads the shared modules of the player and runs them",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        assert.deepEqual(await page.evaluate(SHARED_MODULES), { rule: "Penggaris", refused: "DataError" });
      } finally {
        await stop();
      }
    },
  },
  {
    title: "styles a content root with player.css",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        assert.deepEqual(await page.evaluate(PLAYER_CSS), {
          contain: "layout paint",
          color: "rgb(0, 0, 0)",
          columns: 12,
          border: "rgb(0, 0, 0)",
          writingMode: "vertical-rl",
          textOrientation: "upright",
          stackedColumns: 3,
        });
      } finally {
        await stop();
      }
    },
  },
  {
    title: "runs a portable custom interaction in a sandboxed frame that reaches no network",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        assert.deepEqual(await page.evaluate(PCI_FRAME), {
          events: ["ready", "changed", "completed"],
          sandbox: "allow-scripts",
          probes: ["blocked"],
        });
      } finally {
        await stop();
      }
    },
  },
  {
    title: "operates the rule, the calculator, the line reader and answer masking of the player by keyboard",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        await page.evaluate(MOUNT_TOOLS);
        // The profile has the line reader and answer masking on from the start.
        const start = await readTools(page);
        assert.equal(start.focused, "BUTTON:Ruler");
        // The text of the mask is lines too, and how it wraps depends on the engine.
        assert.match(String(start.line), /^1 of \d+$/);
        assert.equal(start.masked, true);
        await page.keyboard.press("Enter");
        const opened = await readTools(page);
        assert.equal(opened.focused, "DIV:Ruler");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("PageDown");
        const moved = await readTools(page);
        assert.match(String(opened.transform), /rotate\(0deg\)/);
        assert.match(String(moved.transform), /rotate\(5deg\)/);
        assert.equal(offsetOf(moved.transform) - offsetOf(opened.transform), 10);
        await page.evaluate(`window.scene.button("Standard calculator").focus()`);
        await page.keyboard.press("Enter");
        for (const key of ["1", "2", "*", "3", "Enter"]) await page.keyboard.press(key);
        assert.equal((await readTools(page)).display, "36");
        await page.evaluate(`window.scene.stage.querySelector("[role=slider]").focus()`);
        await page.keyboard.press("ArrowDown");
        assert.match(String((await readTools(page)).line), /^2 of \d+$/);
        await page.evaluate(`window.scene.stage.querySelector(".ak-mask button").focus()`);
        await page.keyboard.press("Enter");
        assert.equal((await readTools(page)).masked, false);
      } finally {
        await stop();
      }
    },
  },
  {
    title: "builds the speech request of a content root",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        assert.deepEqual(await page.evaluate(SPEECH_REQUEST), {
          text: "Read World Wide Web and World Wide Web Consortium. Froyd",
          lang: "en",
          keepsSub: true,
        });
      } finally {
        await stop();
      }
    },
  },
  {
    title: "applies the supports of a candidate: the look, a card in place of the content, a popup and the panel",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        assert.deepEqual(await page.evaluate(SUPPORTS), {
          replaced: "Plain",
          opened: true,
          dismissed: true,
          contrast: "high",
          color: "rgb(0, 0, 0)",
          requests: ["captions true"],
        });
      } finally {
        await stop();
      }
    },
  },
  {
    title: "typesets MathML with MathJax in a shadow root and leaves elementary math to the browser",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        assert.deepEqual(await page.evaluate(MATHJAX), {
          typeset: 1,
          stacked: true,
          elementary: 1,
          adopted: 1,
          braille: true,
        });
      } finally {
        await stop();
      }
    },
  },
  {
    title: "renders content in a content root, sanitizes its stylesheet and opens modal feedback in the top layer",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        assert.deepEqual(await page.evaluate(CONTENT_ROOT), {
          tags: ["p", "em", "a", "img", "a", "p", "math"],
          image: `${url}g/items/q1/img/a.png`,
          width: "10",
          link: `${url}g/items/q1/files/a.pdf`,
          rel: "noopener noreferrer",
          away: false,
          handler: false,
          math: "http://www.w3.org/1998/Math/MathML",
          sheets: 2,
          keeps: true,
          absolute: true,
          removes: true,
          hostKept: true,
          modal: true,
          removed: true,
        });
      } finally {
        await stop();
      }
    },
  },
  {
    title:
      "renders a choice, an order, a slider and a text entry, answers them by keyboard, and loads the recording worklet",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        await page.evaluate(MOUNT_INTERACTIONS);
        await page.evaluate(`window.scene.focus("qti-choice-interaction input")`);
        await page.keyboard.press("Space");
        await page.evaluate(`window.scene.focus("qti-order-interaction .ak-choices button")`);
        await page.keyboard.press("Enter");
        await page.evaluate(`window.scene.focus("qti-order-interaction button.ak-drop")`);
        await page.keyboard.press("Enter");
        await page.evaluate(`window.scene.focus("[role=slider]")`);
        await page.keyboard.press("End");
        await page.evaluate(`window.scene.focus("qti-text-entry-interaction input")`);
        await page.keyboard.press("o");
        await page.keyboard.press("k");
        assert.deepEqual(JSON.parse(String(await page.evaluate("JSON.stringify(window.scene.responses)"))), [
          ["C", { cardinality: "multiple", baseType: "identifier", values: ["A"] }],
          ["O", { cardinality: "ordered", baseType: "identifier", values: ["A"] }],
          ["S", { cardinality: "single", baseType: "integer", value: 10 }],
          ["T", { cardinality: "single", baseType: "string", value: "o" }],
          ["T", { cardinality: "single", baseType: "string", value: "ok" }],
        ]);
        assert.equal(await page.evaluate(RECORDER_WORKLET), 1);
      } finally {
        await stop();
      }
    },
  },
  {
    title: "answers the graphic interactions by keyboard and stores a drawing in the type of its image",
    async run({ page }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        await page.evaluate(MOUNT_GRAPHIC);
        await page.evaluate(`window.graphic.focus("qti-hotspot-choice:nth-of-type(2) > input")`);
        await page.keyboard.press(" ");
        await page.evaluate(`window.graphic.focus("qti-select-point-interaction .ak-surface")`);
        await page.keyboard.press("Enter");
        await page.evaluate(`window.graphic.focus("button.ak-pick")`);
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await page.evaluate(`window.graphic.focus("qti-graphic-gap-match-interaction button.ak-token")`);
        await page.keyboard.press(" ");
        await page.evaluate(`window.graphic.focus("qti-graphic-gap-match-interaction button.ak-drop")`);
        await page.keyboard.press(" ");
        await page.evaluate(`window.graphic.focus('button[data-tool="rectangle"]')`);
        await page.keyboard.press(" ");
        await page.evaluate(`window.graphic.focus("qti-drawing-interaction .ak-surface")`);
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        const reading: GraphicReading = JSON.parse(String(await page.evaluate(READ_GRAPHIC)));
        assert.deepEqual(reading.circle, [20, 30, 40, 40]);
        assert.deepEqual(reading.rect, [100, 20, 60, 60]);
        assert.equal(reading.polygon, 2);
        assert.deepEqual(
          reading.responses.map(([identifier]) => identifier),
          ["H", "S", "P", "G", "D"],
        );
        const answers = reading.responses.map(([, value]) => value);
        assert.deepEqual(answers.slice(0, 4), [
          { cardinality: "single", baseType: "identifier", value: "B" },
          { cardinality: "multiple", baseType: "point", values: [[100, 50]] },
          { cardinality: "single", baseType: "point", value: [100, 55] },
          { cardinality: "multiple", baseType: "directedPair", values: [["X", "H1"]] },
        ]);
        assert.equal(answers[4]?.baseType, "file");
        assert.deepEqual(reading.uploads, ["image/png"]);
      } finally {
        await stop();
      }
    },
  },
];
