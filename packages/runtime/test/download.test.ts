import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DownloadStatusError, downloadBytes, withRetries } from "../src/cli/internal.js";

const text = async (bytes: Promise<Uint8Array>) => new TextDecoder().decode(await bytes);

let server: Server;
let base = "";
/** How many requests each path got. */
const requests = new Map<string, number>();

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    const count = (requests.get(path) ?? 0) + 1;
    requests.set(path, count);
    if (path === "/flaky" && count === 1) {
      response.writeHead(503).end("busy");
    } else if (path === "/missing") {
      response.writeHead(404).end("no");
    } else if (path === "/reset" && count === 1) {
      request.socket.destroy();
    } else {
      response.writeHead(200, { "content-type": "text/plain" }).end(`body of ${path}, ${request.headers.accept ?? ""}`);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the downloads of the command line and the scripts", () => {
  it("aborts a download whose body stalls once the answer began, and tries it again three times in all", async () => {
    vi.useFakeTimers();
    let calls = 0;
    // The answer and one byte, then nothing: the body never ends. The clock of a stall starts with the answer.
    const stalled: typeof fetch = async (_, init) => {
      calls += 1;
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([97]));
          // A real body fails when its request is aborted.
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return new Response(body);
    };
    const failed = expect(downloadBytes("https://example.test/stall", { fetch: stalled, retryMs: 1 })).rejects.toThrow(
      "No byte of https://example.test/stall arrived for 30000 ms.",
    );
    await vi.runAllTimersAsync();
    await failed;
    expect(calls).toBe(3);
  });

  it("aborts a request that the server does not answer in time", async () => {
    vi.useFakeTimers();
    const silent: typeof fetch = (_, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const failed = expect(downloadBytes("https://example.test/silent", { fetch: silent, retryMs: 1 })).rejects.toThrow(
      "https://example.test/silent did not answer in 30000 ms.",
    );
    await vi.runAllTimersAsync();
    await failed;
  });

  it("tries again after a status that may pass and a dropped connection, and returns what then arrives", async () => {
    expect(await text(downloadBytes(`${base}/flaky`, { retryMs: 1 }))).toBe("body of /flaky, */*");
    expect(await text(downloadBytes(`${base}/reset`, { retryMs: 1, headers: { accept: "text/plain" } }))).toBe(
      "body of /reset, text/plain",
    );
  });

  it("throws a status that will not change at once, naming the address and the status", async () => {
    const error = await downloadBytes(`${base}/missing`, { retryMs: 1 }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(DownloadStatusError);
    expect((error as Error).message).toBe(`Downloading ${base}/missing failed: HTTP 404.`);
    expect(requests.get("/missing")).toBe(1);
  });

  it("returns the bytes of a successful answer", async () => {
    expect(await text(downloadBytes(`${base}/x`))).toBe("body of /x, */*");
  });

  it("downloads with the function it is given in place of the global fetch", async () => {
    const asked: string[] = [];
    const fetchUrl: typeof fetch = async (input) => {
      asked.push(String(input));
      return new Response("served");
    };
    expect(await text(downloadBytes("https://example.test/a", { fetch: fetchUrl }))).toBe("served");
    expect(asked).toEqual(["https://example.test/a"]);
  });

  it("tells of each retry with the number of the next try, and returns what a run gives once it succeeds", async () => {
    let tries = 0;
    const told: string[] = [];
    const run = async () => {
      tries += 1;
      if (tries < 3) throw new Error(`Reset ${tries}.`);
      return "done";
    };
    expect(await withRetries(run, { retryMs: 1, onRetry: (message) => told.push(message) })).toBe("done");
    expect(told).toEqual(["Reset 1. Trying again (2 of 3).", "Reset 2. Trying again (3 of 3)."]);
  });

  it("throws the last failure after the tries, and carries the cause of a failure in the sentence it tells", async () => {
    const told: string[] = [];
    const failing = () => Promise.reject(new Error("fetch failed", { cause: new Error("ECONNREFUSED") }));
    await expect(withRetries(failing, { retryMs: 1, onRetry: (message) => told.push(message) })).rejects.toThrow(
      "fetch failed",
    );
    expect(told).toEqual([
      "fetch failed: ECONNREFUSED Trying again (2 of 3).",
      "fetch failed: ECONNREFUSED Trying again (3 of 3).",
    ]);
  });

  it("does not try again a status below 500 other than 408 and 429, and does try again those", async () => {
    for (const [status, tried] of [
      [400, 1],
      [403, 1],
      [404, 1],
      [408, 3],
      [429, 3],
      [500, 3],
      [503, 3],
    ] as const) {
      let calls = 0;
      const answer: typeof fetch = async () => {
        calls += 1;
        return new Response("", { status });
      };
      await expect(downloadBytes("https://example.test/s", { fetch: answer, retryMs: 1 })).rejects.toThrow(
        `HTTP ${status}.`,
      );
      expect(calls, `status ${status}`).toBe(tried);
    }
  });
});
