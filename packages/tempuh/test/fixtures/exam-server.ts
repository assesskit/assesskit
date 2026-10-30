import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createEngine } from "@luthfanwakan/olah/delivery";
import {
  createAssetGate,
  createSessionHost,
  type SessionHost,
  type SessionStore,
} from "../../src/server/index.ts";
import {
  examDefinition,
  examFiles,
  gateKey,
  memoryFileStore,
  memoryStore,
  packageOf,
  recordingScheduler,
} from "../exam-fixture.ts";

/** The exams the server runs, by the name a client asks for. `timed` has a limit of ten minutes on its first question. */
const EXAMS = {
  plain: examFiles(),
  timed: examFiles({ limits: '<qti-time-limits max-time="600"/>' }),
} as const;

type ExamName = keyof typeof EXAMS;

/** A server that runs session hosts over HTTP, as a deployment would: the host's authentication is two headers. */
export interface ExamServer {
  /** The origin it listens on. */
  readonly origin: string;
  /** Stops it. */
  close(): Promise<void>;
}

const isExam = (name: string): name is ExamName => Object.hasOwn(EXAMS, name);

/** Reads the body of a request. */
async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Starts the exam server of the end-to-end tests on a free port. The tests act as a candidate through `fetch`:
 *
 * | Route                                  | What it does                                                                |
 * | -------------------------------------- | --------------------------------------------------------------------------- |
 * | `POST /exam/start`, `view`, `handle`   | `SessionHost.start`, `view`, `handle`, for the caller of the headers         |
 * | `POST /exam/proctor`, `time`           | `SessionHost.proctor` and the `time` job of the scheduler, for `x-session`   |
 * | `GET /exam/jobs`                       | The jobs the scheduler was given for `x-session`                             |
 * | `POST /exam/conflicts?times=n`         | Makes the next `n` saves of `x-session` lose to a competing write            |
 * | `POST /exam/upload`, `/exam/file-url`  | `FileStore.put` and `AssetGate.signFile`                                     |
 * | `GET /g/<token>/…`, `GET /f/<token>/…` | `AssetGate.serve`                                                            |
 *
 * The headers `x-session` and `x-principal` stand for the host's authentication, `x-exam` names the exam (`plain` or
 * `timed`) at `start`, and `x-offset` is the number of milliseconds that the server's clock is ahead for that request.
 */
export async function startExamServer(): Promise<ExamServer> {
  const offset = new AsyncLocalStorage<number>();
  const clock = { now: () => Date.now() + (offset.getStore() ?? 0) };
  const base = memoryStore();
  const conflicts = new Map<string, number>();
  const store: SessionStore = {
    create: (session, record) => base.create(session, record),
    load: (session) => base.load(session),
    save: async (session, record) => {
      const left = conflicts.get(session) ?? 0;
      const stored = base.records.get(session);
      if (left > 0 && stored !== undefined) {
        conflicts.set(session, left - 1);
        base.records.set(session, { ...stored, version: stored.version + 1 });
        return false;
      }
      return base.save(session, record);
    },
  };
  const scheduled = recordingScheduler();
  const files = memoryFileStore();
  const exams = new Map<string, ExamName>();
  const packages = new Map(Object.entries(EXAMS).map(([name, content]) => [name, packageOf(content)]));
  const packageOfSession = async (session: string) => {
    const pkg = packages.get(exams.get(session) ?? "plain");
    if (pkg === undefined) throw new Error("The exam has no package.");
    return pkg;
  };

  let origin = "";
  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  origin = `http://127.0.0.1:${address.port}`;

  const gate = createAssetGate({ key: await gateKey(), origin, packages: packageOfSession, files });
  const hosts = new Map<ExamName, SessionHost>(
    (Object.keys(EXAMS) as ExamName[]).map((name) => {
      const pkg = packages.get(name);
      if (pkg === undefined) throw new Error("The exam has no package.");
      return [
        name,
        createSessionHost({
          engine: createEngine(examDefinition(pkg)),
          store,
          scheduler: scheduled,
          clock,
          gate,
          packages: packageOfSession,
        }),
      ];
    }),
  );

  const header = (request: IncomingMessage, name: string): string => {
    const value = request.headers[name];
    return typeof value === "string" ? value : "";
  };

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type,x-session,x-principal,x-exam,x-offset,x-mime");
    response.setHeader("access-control-expose-headers", "referrer-policy,x-content-type-options,content-type,content-security-policy");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", origin);
    const session = header(request, "x-session");
    const caller = { session, principal: header(request, "x-principal") };
    const exam = exams.get(session) ?? (isExam(header(request, "x-exam")) ? (header(request, "x-exam") as ExamName) : "plain");
    const host = hosts.get(exam);
    if (host === undefined) throw new Error("The exam has no host.");
    await offset.run(Number(header(request, "x-offset") || 0), async () => {
      try {
        const body = request.method === "POST" ? await readBody(request) : Buffer.alloc(0);
        const json = (): unknown => JSON.parse(body.toString("utf8"));
        const send = (status: number, value: unknown): void => {
          response.statusCode = status;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(value));
        };
        const path = url.pathname;
        if (path.startsWith("/g/") || path.startsWith("/f/")) {
          const served = await gate.serve({ path }, clock.now());
          response.statusCode = served.status;
          for (const [name, value] of Object.entries(served.headers)) response.setHeader(name, value);
          response.end(served.body === undefined ? undefined : Buffer.from(served.body));
        } else if (path === "/exam/start") {
          exams.set(session, exam);
          send(200, await host.start(caller, json() as never));
        } else if (path === "/exam/view") send(200, await host.view(caller));
        else if (path === "/exam/handle") send(200, await host.handle(caller, json()));
        else if (path === "/exam/proctor") send(200, { ok: (await host.proctor(session, json() as never)).ok });
        else if (path === "/exam/time") send(200, { ok: (await host.host(session, { type: "time" })).ok });
        else if (path === "/exam/jobs") send(200, scheduled.jobs.filter(([each]) => each === session));
        else if (path === "/exam/conflicts") {
          conflicts.set(session, Number(url.searchParams.get("times")));
          send(200, {});
        } else if (path === "/exam/upload") {
          send(200, await files.put(new Uint8Array(body), header(request, "x-mime")));
        } else if (path === "/exam/file-url") send(200, { url: await gate.signFile(session, json() as never, clock.now()) });
        else send(404, {});
      } catch (error) {
        const name = error instanceof Error ? error.name : "Error";
        const status = name === "AccessError" ? 403 : name === "DataError" ? 400 : name === "ServiceError" ? 409 : 500;
        response.statusCode = status;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ name, message: error instanceof Error ? error.message : String(error) }));
      }
    });
  }

  return {
    origin,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}
