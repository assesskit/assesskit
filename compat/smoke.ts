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
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".map", "application/json"],
]);

/** The built package, which engines/<name>/ runs in: `playwright test` starts there. */
const DIST = resolve(process.cwd(), "../../../packages/tempuh/dist");

/** Serves `dist/` at `/dist/` and an empty page at `/`; returns the URL of the page and a function that stops it. */
async function serve(): Promise<{ readonly url: string; readonly stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") {
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><title>tempuh</title>");
      return;
    }
    const file = resolve(DIST, `.${path.replace(/^\/dist/, "")}`);
    if (!(path.startsWith("/dist/") && file.startsWith(`${DIST}${sep}`))) {
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
];
