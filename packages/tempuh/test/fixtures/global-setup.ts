import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve, sep } from "node:path";
import { loadSchemaSet, type SchemaSet, validateXmlFiles } from "@luthfanwakan/olah/node";
import type { TestProject } from "vitest/node";
import { requireSchemas } from "../../../../scripts/schemas.ts";
import { buildFrame, buildWorklet } from "../../scripts/build-static.ts";
import "./origins.ts";

const PACKAGE_FILES = resolve(import.meta.dirname, "pci");
const TEMPUH = resolve(import.meta.dirname, "../..");

/** The packages of the 1EdTech examples that `pnpm corpus` downloads, by the name the tests use. */
const EXAMPLES = resolve(import.meta.dirname, "../../../../.cache/corpus/qti-examples/qtiv3-examples/packaging");
const EXAMPLE_FILES: ReadonlyMap<string, string> = new Map([
  ["pci-simple", resolve(EXAMPLES, "pci-simple/src")],
  ["pci", resolve(EXAMPLES, "pci/src")],
]);
const CDN_FILES = resolve(import.meta.dirname, "cdn");
const CONTENT_FILES = resolve(import.meta.dirname, "content");
const ROOT = resolve(import.meta.dirname, "../../../..");

const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".json", "application/json"],
  [".woff2", "font/woff2"],
  [".wav", "audio/wav"],
  [".vtt", "text/vtt"],
]);

/** The frame of the static files with a script that keeps a policy from being set, as a browser without one would. */
const WITHOUT_POLICY = '<script>Object.defineProperty(HTMLMetaElement.prototype, "content", { set() {} });</script>';

type Handler = (path: string, response: ServerResponse, request: IncomingMessage) => Promise<void> | void;

/** The `xsi:schemaLocation` that makes olah validate an SSML document against the SSML 1.1 schema that it pins. */
const SSML_SCHEMA_HINT =
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.w3.org/2001/10/synthesis https://purl.imsglobal.org/spec/ssml/v1p1/schema/xsd/ssmlv1p1-core.xsd"';

/** Reads the body of a request as text. */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Serves a file below a directory, or 404 for a path that leaves it. */
async function serveFile(directory: string, path: string, response: ServerResponse, patch?: (text: string) => string) {
  const file = resolve(directory, `.${path}`);
  try {
    if (!file.startsWith(`${directory}${sep}`)) throw new Error("outside");
    const content = await readFile(file);
    response.setHeader("content-type", MEDIA_TYPES.get(extname(file)) ?? "application/octet-stream");
    response.end(patch ? patch(content.toString("utf8")) : content);
  } catch {
    response.statusCode = 404;
    response.end();
  }
}

/**
 * Starts a server on a free port that records the paths it is asked for, and shows them at `/__hits`. The browsers of a
 * run test at the same time, so a test looks for the paths with a token of its own.
 */
async function listen(handler: Handler): Promise<{ readonly server: Server; readonly origin: string }> {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/__hits") {
      response.setHeader("access-control-allow-origin", "*");
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(hits));
      return;
    }
    hits.push(path);
    response.setHeader("access-control-allow-origin", "*");
    // A handler that fails answers with the reason. An error that escaped here would reach Vitest as an unhandled rejection
    // of its own process, which cannot print it when a frame of the stack is in a file that Node loaded without Vite.
    Promise.resolve(handler(path, response, request)).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain");
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

const close = (server: Server): Promise<void> =>
  new Promise((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });

/**
 * Starts the servers of the browser tests and builds the frame's files for them; the servers stop when the tests end.
 * The asset origin serves the frame twice: under `/static/`, and under `/unrestricted/` with a script that stops the frame
 * from setting its policy. It serves MathJax and its fonts under `/mathjax/`, and validates the SSML that a test posts to
 * `/validate/ssml` against the SSML 1.1 schema, which needs `pnpm schemas` first, and answers with the issues as JSON,
 * or with status 500 and the reason when it cannot validate.
 * Package files for the content renderer are under `/content/<token>/`.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const built = await mkdtemp(join(tmpdir(), "tempuh-frame-"));
  // The directory that holds `mathjax` and `@mathjax` side by side, as npm lays them out.
  const mathjaxFiles = dirname(await realpath(resolve(TEMPUH, "node_modules/mathjax")));
  await buildFrame(join(built, "pci-frame"));
  await buildWorklet(join(built, "recorder-worklet.js"));
  let schemas: Promise<SchemaSet> | undefined;
  const asset = await listen(async (path, response, request) => {
    const [, area, rest = ""] = /^\/([^/]+)(\/.*)?$/u.exec(path) ?? [];
    if (area === "static" || area === "unrestricted") {
      if (rest === "/player.css") {
        await serveFile(TEMPUH, rest, response);
        return;
      }
      const patch =
        area === "unrestricted" && rest.endsWith("/frame.html")
          ? (html: string) => html.replace("<script", `${WITHOUT_POLICY}<script`)
          : undefined;
      await serveFile(built, rest, response, patch);
    } else if (area === "g") {
      await serveFile(PACKAGE_FILES, `/${rest.split("/").slice(2).join("/")}`, response);
    } else if (area === "c") {
      // /c/<token>/<example>/<path>: a file of an example package, as the asset gate would serve it.
      const [, , example = "", ...path] = rest.split("/");
      await serveFile(EXAMPLE_FILES.get(example) ?? "/nowhere", `/${path.join("/")}`, response);
    } else if (area === "content") {
      await serveFile(CONTENT_FILES, `/${rest.split("/").slice(2).join("/")}`, response);
    } else if (area === "validate" && request.method === "POST") {
      schemas ??= loadSchemaSet(requireSchemas(ROOT));
      const document = (await readBody(request)).replace("<speak ", `<speak ${SSML_SCHEMA_HINT} `);
      const issues = await validateXmlFiles(await schemas, [{ path: "request.ssml", content: document }]);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(issues.map(({ message }) => message)));
    } else if (area === "mathjax") {
      await serveFile(mathjaxFiles, rest.replace(/^\/(?!@)[^/]+/u, "/mathjax"), response);
    } else if (area !== "hang") {
      response.statusCode = 404;
      response.end();
    }
  });
  const other = await listen((path, response) => serveFile(CDN_FILES, path.replace(/^\/cdn\/[^/]+/u, ""), response));
  const stranger = await listen((_path, response) => {
    response.end("reached");
  });
  project.provide("fixtures", { asset: asset.origin, other: other.origin, stranger: stranger.origin });
  return async () => {
    await Promise.all([asset, other, stranger].map(({ server }) => close(server)));
    await schemas?.then((set) => set.close(), () => undefined);
    await rm(built, { recursive: true, force: true });
  };
}
