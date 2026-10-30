import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import type { TestProject } from "vitest/node";
import { buildFrame } from "../../scripts/build-frame.ts";
import "./origins.ts";

const PACKAGE_FILES = resolve(import.meta.dirname, "pci");
const TEMPUH = resolve(import.meta.dirname, "../..");
const CDN_FILES = resolve(import.meta.dirname, "cdn");

const MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
]);

/** The frame of the static files with a script that keeps a policy from being set, as a browser without one would. */
const WITHOUT_POLICY = '<script>Object.defineProperty(HTMLMetaElement.prototype, "content", { set() {} });</script>';

type Handler = (path: string, response: ServerResponse) => Promise<void> | void;

/** Serves a file below a directory, or 404 for a path that leaves it. */
async function serveFile(directory: string, path: string, response: ServerResponse, patch?: (text: string) => string) {
  const file = resolve(directory, `.${path}`);
  try {
    if (!file.startsWith(`${directory}${sep}`)) throw new Error("outside");
    const content = await readFile(file, "utf8");
    response.setHeader("content-type", MEDIA_TYPES.get(extname(file)) ?? "application/octet-stream");
    response.end(patch ? patch(content) : content);
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
    void handler(path, response);
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
 * from setting its policy.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const built = await mkdtemp(join(tmpdir(), "tempuh-frame-"));
  await buildFrame(join(built, "pci-frame"));
  const asset = await listen(async (path, response) => {
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
    await rm(built, { recursive: true, force: true });
  };
}
