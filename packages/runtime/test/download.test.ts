import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DownloadStatusError, downloadBytes, downloadFile, downloadText, withRetries } from "../src/cli/internal.js";

let server: Server;
let base = "";
let directory = "";
/** How many requests each path got. */
const requests = new Map<string, number>();

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "runtime-download-"));
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    const count = (requests.get(path) ?? 0) + 1;
    requests.set(path, count);
    if (path === "/stall") {
      response.writeHead(200);
      // The answer and one byte, then nothing: the connection stays open. The clock of a stall starts with the answer, so the
      // time the request takes to arrive never counts, and each try reaches the server.
      response.write("a");
    } else if (path === "/silent") {
      // No answer at all: the connection stays open.
    } else if (path === "/flaky" && count === 1) {
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
  rmSync(directory, { recursive: true, force: true });
});

describe("the downloads of the command line and the scripts", () => {
  it("aborts a download whose body stalls once the answer began, and tries it again a bounded number of times", async () => {
    await expect(downloadBytes(`${base}/stall`, { stallMs: 100, tries: 2, retryMs: 1 })).rejects.toThrow("No byte");
    expect(requests.get("/stall")).toBe(2);
  });

  it("aborts a request that the server does not answer in time", async () => {
    await expect(downloadBytes(`${base}/silent`, { answerMs: 100, tries: 1 })).rejects.toThrow("did not answer");
  });

  it("tries again after a status that may pass and a dropped connection, and returns what then arrives", async () => {
    expect(await downloadText(`${base}/flaky`, { retryMs: 1 })).toBe("body of /flaky, */*");
    expect(await downloadText(`${base}/reset`, { retryMs: 1, headers: { accept: "text/plain" } })).toBe(
      "body of /reset, text/plain",
    );
  });

  it("throws a status that will not change at once, naming the address and the status", async () => {
    const error = await downloadBytes(`${base}/missing`, { retryMs: 1 }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(DownloadStatusError);
    expect((error as Error).message).toBe(`Downloading ${base}/missing failed: HTTP 404.`);
    expect(requests.get("/missing")).toBe(1);
  });

  it("returns the bytes of a successful answer and writes them to a file", async () => {
    expect(new TextDecoder().decode(await downloadBytes(`${base}/x`))).toBe("body of /x, */*");
    const file = join(directory, "file");
    await downloadFile(`${base}/file`, file, { retryMs: 1 });
    expect(readFileSync(file, "utf8")).toBe("body of /file, */*");
  });

  it("downloads with the function it is given in place of the global fetch", async () => {
    const asked: string[] = [];
    const fetchUrl: typeof fetch = async (input) => {
      asked.push(String(input));
      return new Response("served");
    };
    expect(await downloadText("https://example.test/a", { fetch: fetchUrl })).toBe("served");
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
    await expect(
      withRetries(failing, { tries: 2, retryMs: 1, onRetry: (message) => told.push(message) }),
    ).rejects.toThrow("fetch failed");
    expect(told).toEqual(["fetch failed: ECONNREFUSED Trying again (2 of 2)."]);
  });

  it("does not try again a status below 500 other than 408 and 429, and does try again those", async () => {
    for (const [status, tried] of [
      [400, 1],
      [403, 1],
      [404, 1],
      [408, 2],
      [429, 2],
      [500, 2],
      [503, 2],
    ] as const) {
      let calls = 0;
      const answer: typeof fetch = async () => {
        calls += 1;
        return new Response("", { status });
      };
      await expect(downloadBytes("https://example.test/s", { fetch: answer, tries: 2, retryMs: 1 })).rejects.toThrow(
        `HTTP ${status}.`,
      );
      expect(calls, `status ${status}`).toBe(tried);
    }
  });
});
