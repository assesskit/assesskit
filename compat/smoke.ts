import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { BANNED_FEATURES, BASELINE, type Engine } from "./banned-features.ts";

/** What a smoke case uses of a Playwright page; every release of `engines/` has it. */
interface SmokePage {
  /** Opens a URL. */
  goto(url: string): Promise<unknown>;
  /** Evaluates JavaScript in the page and returns the value, awaiting a promise. */
  evaluate(expression: string): Promise<unknown>;
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
]);

/** The built package, which engines/<name>/ runs in: `playwright test` starts there. */
const DIST = resolve(process.cwd(), "../../../packages/tempuh/dist");

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

/** Serves `dist/` at `/dist/`, `player.css` at `/player.css` and `/dist/player.css`, the module of the interaction at `/pci/echo.js` and an empty page at `/`; returns the URL of the page and a function that stops it. */
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
    const isPlayerCss = path === "/player.css" || path === "/dist/player.css";
    const file = isPlayerCss ? PLAYER_CSS_FILE : resolve(DIST, `.${path.replace(/^\/dist/, "")}`);
    if (!(isPlayerCss || (path.startsWith("/dist/") && file.startsWith(`${DIST}${sep}`)))) {
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
    prompt: null,
    language: "en",
    stylesheets: [],
    markup: "<p>Echo</p>",
    modules: { baseUrl: location.origin + "/pci/", paths: new Map([["echo", [location.origin + "/pci/echo"]]]), load: ["echo"] },
    typeIdentifier: "urn:smoke:echo",
    responseIdentifier: "RESPONSE",
    status: "interacting",
    boundTo: { base: null },
    onEvent: (event) => events.push(event.type),
  });
  const until = async (done) => {
    for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  };
  await until(() => events.includes("changed") && probes.length > 0);
  await frame.destroy();
  return { events, sandbox: frame.element.getAttribute("sandbox"), probes: probes.map((probe) => probe.result) };
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
];
