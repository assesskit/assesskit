import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
const FILES = resolve(import.meta.dirname, "lti");

/** The origins of the servers of the LTI browser tests. */
export interface LtiOrigins {
  /** The origin that serves the storage page of the platform. */
  readonly platform: string;
  /** The origin of a tool that reports what it did. */
  readonly tool: string;
  /** The origin of a second tool. */
  readonly other: string;
}

/** A request that a server received, with the time. */
export interface Hit {
  readonly path: string;
  readonly at: number;
}

declare module "vitest" {
  interface ProvidedContext {
    lti: LtiOrigins;
  }
}

/** What a handler answers: the status, the headers and the body. */
interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A server that records the paths it is asked for, and shows them at `/__hits`. */
async function listen(
  handler: (path: string, query: URLSearchParams) => Promise<Answer>,
): Promise<{ server: Server; origin: string }> {
  const hits: Hit[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.setHeader("access-control-allow-origin", "*");
    if (url.pathname === "/__hits") {
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(hits));
      return;
    }
    handler(url.pathname, url.searchParams).then(
      ({ status, headers, body }) => {
        // The time is the time the page was served, so that a slow page is recorded after it was complete.
        hits.push({ path: url.pathname, at: Date.now() });
        response.statusCode = status;
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
        response.end(body);
      },
      (error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : String(error));
      },
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

const wait = (milliseconds: number): Promise<void> => new Promise((done) => setTimeout(done, milliseconds));

/**
 * Starts the servers of the LTI browser tests: the platform serves its storage page at `/storage?player=<origin>`, which
 * only that player may frame and, with `delay=<ms>`, after a wait; the two tool origins serve `/tool.html` and `/tool.js`
 * and answer `/report/...` with nothing, so that their hits show what the tool did.
 */
export async function startLtiServers(): Promise<{ origins: LtiOrigins; close: () => Promise<void> }> {
  const platform = await listen(async (path, query): Promise<Answer> => {
    if (path !== "/storage") return { status: 404, headers: {}, body: "" };
    await wait(Number(query.get("delay") ?? 0));
    return {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy": `frame-ancestors ${query.get("player") ?? "'none'"}`,
      },
      body: await readFile(resolve(FILES, "storage.html"), "utf8"),
    };
  });
  const tool = async (path: string): Promise<Answer> => {
    if (path.startsWith("/report/")) return { status: 204, headers: {}, body: "" };
    const name = path === "/tool.html" ? "tool.html" : path === "/tool.js" ? "tool.js" : undefined;
    if (name === undefined) return { status: 404, headers: {}, body: "" };
    const type = name.endsWith(".js") ? "text/javascript" : "text/html";
    return { status: 200, headers: { "content-type": type }, body: await readFile(resolve(FILES, name), "utf8") };
  };
  const first = await listen(tool);
  const second = await listen(tool);
  const close = (server: Server): Promise<void> =>
    new Promise((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  return {
    origins: { platform: platform.origin, tool: first.origin, other: second.origin },
    close: async () => {
      await Promise.all([platform.server, first.server, second.server].map(close));
    },
  };
}
