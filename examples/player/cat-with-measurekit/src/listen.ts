import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

/** A server that listens, and how to reach and stop it. */
export interface Listening {
  /** The base URL of the server, such as `http://127.0.0.1:8080`. */
  readonly url: string;
  /** Stops accepting connections and resolves when the open ones are done. */
  close(): Promise<void>;
}

/**
 * Serves a function from a `Request` to a `Response` on a port of this machine, with `node:http`. Deno, Bun and Workers
 * serve such a function themselves, so this adapter is for Node.js only; put TLS in front of it, because the binding
 * requires it.
 *
 * @param handler - Answers each request.
 * @param port - The port to listen on; 0 takes a free one.
 * @param host - The address to listen on.
 * @returns The server, once it listens.
 */
export function listen(
  handler: (request: Request) => Promise<Response>,
  port: number,
  host: string,
): Promise<Listening> {
  const server = createServer((incoming, outgoing) => {
    const abort = new AbortController();
    // The connection closing before the answer is sent is the client leaving: the handler ends its wait.
    outgoing.on("close", () => {
      if (!outgoing.writableFinished) abort.abort();
    });
    const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(`http://${incoming.headers.host ?? host}${incoming.url ?? "/"}`, {
      method: incoming.method ?? "GET",
      headers: Object.entries(incoming.headers).flatMap(([name, value]) =>
        value === undefined ? [] : [[name, Array.isArray(value) ? value.join(", ") : value] as [string, string]],
      ),
      signal: abort.signal,
      ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
    } as RequestInit);
    handler(request).then(
      (response) => {
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body === null) outgoing.end();
        else Readable.fromWeb(response.body as never).pipe(outgoing);
      },
      () => outgoing.destroy(),
    );
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const { port: bound } = server.address() as AddressInfo;
      resolve({
        url: `http://${host}:${bound}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)));
            server.closeAllConnections();
          }),
      });
    });
  });
}
