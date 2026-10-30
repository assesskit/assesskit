import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { BANNED_FEATURES, BASELINE, type Engine } from "./banned-features.ts";

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
const DIST = resolve(process.cwd(), "../../../packages/tempuh/dist");

/** The player with its dependencies in one file, which `run-engines.ts` makes before the containers start. */
const PLAYER_BUNDLE = resolve(process.cwd(), "../../.smoke/player.js");

/** The directory that holds `mathjax` and `@mathjax` as npm lays them out, which the pages load MathJax from. */
const MATHJAX_FILES = dirname(realpathSync(resolve(process.cwd(), "../../../packages/tempuh/node_modules/mathjax")));

/** The stylesheet of the player, which the package ships as it is. */
const PLAYER_CSS_FILE = resolve(process.cwd(), "../../../packages/tempuh/player.css");

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
  if (path === "/dist/player/index.js") return PLAYER_BUNDLE;
  const within = (directory: string, relative: string): string | undefined => {
    const file = resolve(directory, `.${relative}`);
    return file.startsWith(`${directory}${sep}`) ? file : undefined;
  };
  if (path.startsWith("/dist/")) return within(DIST, path.slice("/dist".length));
  if (/^\/@?mathjax\//u.test(path)) return within(MATHJAX_FILES, path);
  return undefined;
}

/**
 * Serves `dist/` at `/dist/`, except that `/dist/player/index.js` is the bundle of the player; `player.css` at `/player.css`
 * and `/dist/player.css`; MathJax and its fonts at `/mathjax/` and `/@mathjax/`; the module of the interaction at
 * `/pci/echo.js`; and an empty page at `/`. Returns the URL of the page and a function that stops it.
 */
async function serve(): Promise<{ readonly url: string; readonly stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><title>tempuh</title>");
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
  const { checkActionEnvelope } = await import("/dist/protocol/index.js");
  checkActionEnvelope({ seq: 1, action: {} });
  let refused = "";
  try {
    checkActionEnvelope({ seq: 1, action: {}, session: "s1" });
  } catch (error) {
    refused = error.name;
  }
  return { rule: selectMessages("id-ID").toolRule, refused };
})()`;

/** The check of the stylesheet, which runs in the page: a content root that adopts it, as the player makes one. */
const PLAYER_CSS = `(async () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(await (await fetch("/player.css")).text());
  const host = document.createElement("div");
  host.setAttribute("data-tempuh-contrast", "high");
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
  const button = (name) => [...host.querySelectorAll(".tempuh-row > button")].find((each) => each.textContent === name);
  window.scene.button = button;
  button("Ruler").focus();
})()`;

/** What the keyboard did to the tools, as JSON: the focus, the rule's transform, the calculator's display, the line reader and the mask. */
const READ_TOOLS = `(() => {
  const { host, stage } = window.scene;
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
  const rule = stage.querySelector('.tempuh-placed[aria-label="Ruler"]');
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
  const { buildSpeechRequest, parseLexicon } = await import("/dist/player/index.js");
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<p>Read <span data-ssml='{\\"sub\\":{\\"alias\\":\\"World Wide Web\\"}}'>WWW</span> and " +
    "<span data-qti-suppress-tts='computer-read-aloud'>hidden</span> W3C.</p>";
  const sub = document.createElementNS("http://www.w3.org/2001/10/synthesis", "sub");
  sub.setAttribute("alias", "Froyd");
  sub.textContent = "Freud";
  root.firstElementChild.append(" ", sub);
  document.body.append(host);
  const lexicon = parseLexicon("<lexicon xmlns='http://www.w3.org/2005/01/pronunciation-lexicon' version='1.0' alphabet='ipa' xml:lang='en'>" +
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

/** The cases of the smoke test of the pinned engines. */
export const SMOKE_CASES: readonly SmokeCase[] = [
  {
    title: "is the engine of the baseline",
    async run({ engine, version }) {
      assert(version.startsWith(BASELINE[engine]), `${engine} is ${version}, not ${BASELINE[engine]}`);
    },
  },
  {
    title: "has and lacks the banned features as the table of AGENTS.md says",
    async run({ page, engine }) {
      const { url, stop } = await serve();
      try {
        await page.goto(url);
        for (const { feature, probes } of BANNED_FEATURES) {
          for (const { expression, absentIn } of probes) {
            assert.equal(await page.evaluate(expression), !absentIn.includes(engine), `${feature}: ${expression}`);
          }
        }
      } finally {
        await stop();
      }
    },
  },
  {
    title: "loads the shared modules of tempuh and runs them",
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
        await page.evaluate(`window.scene.stage.querySelector(".tempuh-mask button").focus()`);
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
];
