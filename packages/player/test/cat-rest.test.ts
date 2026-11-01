// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and JSON fields are those of their specifications.

import {
  assessmentResultToJson,
  type CatPort,
  type CreateSectionResponse,
  type CreateSessionResponse,
  type GetSectionResponse,
  isSessionEnd,
  type SectionData,
  type SubmitResultsResponse,
} from "@assesskit/runtime/cat";
import { DataError, ReadError, SecurityError } from "@assesskit/runtime/errors";
import { single } from "@assesskit/runtime/values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CatAuthenticate,
  type CatEngine,
  type CatFetch,
  type CatFetchRequest,
  type CatOperation,
  type CatRestHandlerOptions,
  createCatRestHandler,
  createRestCatPort,
  type OAuthClientCredentials,
  type RestCatPortOptions,
} from "../src/cat-rest/index.js";
import { readCreateSessionBody, readResultsBody, readSectionBody, readSectionData } from "../src/cat-rest/internal.js";
import { ServiceError } from "../src/index.js";
import { base64, json, PREFIX, rejection, resultsOf } from "./cat-fixture.js";
import { fuzzJson } from "./fuzz.js";

/** A result with one answered item, and the same result in the JSON of the binding (sections 5.2.8 and 5.3, section 6.11). */
const RESULT = resultsOf(new Map([["i1", 1]]));
const RESULT_JSON = {
  context: { sessionIdentifiers: [] },
  itemResult: [
    {
      identifier: "i1",
      sequenceIndex: 1,
      datestamp: "2026-10-30T10:00:00",
      sessionStatus: "final",
      responseVariables: [],
      templateVariables: [],
      outcomeVariables: [{ identifier: "SCORE", cardinality: "single", baseType: "float", value: [{ value: "1" }] }],
    },
  ],
};

/** A request that the fake service received. */
interface Call {
  readonly url: string;
  readonly request: CatFetchRequest;
}

/** What the fake service answers: a status and the JSON of the body, or text, or none. */
interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

const DEMOGRAPHICS = base64("demographics");
const PNP = base64("pnp");
const TOKEN_URL = "https://auth.example/oauth2/token";
const SCOPE = "https://purl.imsglobal.org/cat/v1p0/scope/api";
const CREDENTIALS: OAuthClientCredentials = {
  tokenUrl: TOKEN_URL,
  clientId: "player",
  clientSecret: "secret/+",
  scope: SCOPE,
};
const TOKEN: Reply = {
  status: 200,
  body: { access_token: "tok1", token_type: "Bearer", expires_in: 3600, scope: SCOPE },
};

/** A service that records its requests, answers the token endpoint itself and leaves the rest to `reply`. */
function fakeService(reply: (call: Call, calls: readonly Call[]) => Reply = () => ({ status: 200, body: {} })): {
  readonly fetch: CatFetch;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    async fetch(url, request) {
      const call = { url, request };
      calls.push(call);
      const { status, body } = url === TOKEN_URL ? TOKEN : reply(call, calls);
      const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
      return { ok: status >= 200 && status < 300, status, text: async () => text };
    },
  };
}

/** The requests that went to the engine, without the token requests. */
const engineCalls = (calls: readonly Call[]): Call[] => calls.filter(({ url }) => url !== TOKEN_URL);

const bodyOf = (call: Call | undefined): unknown => JSON.parse(call?.request.body ?? "null");

/** The options of a port for the one engine whose reference is its endpoint, which is the usual case. */
interface OneEngine {
  readonly fetch: CatFetch;
  readonly endpoint: string;
  readonly credentials: OAuthClientCredentials;
  readonly timeoutMs?: number;
  readonly sharePnp?: boolean;
}

/** Returns a port for one engine that a package names by its endpoint. */
function onePort({ fetch: send, endpoint, credentials, timeoutMs, sharePnp }: OneEngine): CatPort {
  return createRestCatPort({
    fetch: send,
    engines: new Map([[endpoint, { endpoint, credentials, ...(sharePnp === undefined ? {} : { sharePnp }) }]]),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe("createRestCatPort", () => {
  const sectionData: SectionData = { sectionConfiguration: "e30=", qtiUsagedata: "PD94", qtiMetadata: "bWV0YQ==" };

  it("asks the token endpoint for a bearer token with the client credentials grant", async () => {
    const service = fakeService(() => ({
      status: 200,
      body: { sectionData: {}, items: {}, section: { sectionConfiguration: "e30=" } },
    }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await port.getSection(PREFIX, "sec1");
    const [token, get] = service.calls;
    expect(token?.url).toBe(TOKEN_URL);
    expect(token?.request.method).toBe("POST");
    // The client identifier and secret are form-encoded before they are Basic credentials (RFC 6749 section 2.3.1).
    expect(token?.request.headers).toEqual({
      Authorization: `Basic ${btoa("player:secret%2F%2B")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    expect(token?.request.body).toBe(`grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`);
    expect(token?.request.redirect).toBe("manual");
    expect(get?.request.redirect).toBe("manual");
    expect(token?.request.signal).toBeInstanceOf(AbortSignal);
    expect(get?.request.headers).toEqual({ Authorization: "Bearer tok1", Accept: "application/json" });
  });

  it("refuses a redirect of the token endpoint and of the engine, whether the runtime returns the 3xx answer or an opaque redirect", async () => {
    const redirect = (url: string, answer: { status: number; type?: string }): CatFetch => {
      const service = fakeService(() => ({ status: 200, body: {} }));
      return async (target, request) => {
        if (target !== url) return service.fetch(target, request);
        return { ok: false, text: async () => "must not be read", ...answer };
      };
    };
    const answers = [{ status: 302 }, { status: 307 }, { status: 0, type: "opaqueredirect" }];
    for (const answer of answers) {
      const atToken = onePort({
        fetch: redirect(TOKEN_URL, answer),
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      });
      await expect(atToken.getSection(PREFIX, "sec1")).rejects.toMatchObject({
        name: "ServiceError",
        status: answer.status,
        message: expect.stringContaining(`The token endpoint ${TOKEN_URL} answered with a redirect`),
      });
      const atEngine = onePort({
        fetch: redirect(`${PREFIX}/sections/sec1`, answer),
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      });
      await expect(atEngine.getSection(PREFIX, "sec1")).rejects.toThrow(ServiceError);
    }
  });

  it("creates a section: POST /sections with the configuration and usage data of SectionDType, and returns the identifier", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    expect(await port.createSection(PREFIX, sectionData)).toEqual({ sectionIdentifier: "sec1" });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections`);
    expect(call?.request.method).toBe("POST");
    expect(call?.request.headers["Content-Type"]).toBe("application/json");
    // SectionDType (binding section 5.2.1): qtiMetadata is one QTI metadata record, and the metadata file is not sent.
    expect(bodyOf(call)).toEqual({ sectionConfiguration: "e30=", qtiUsagedata: "PD94" });
  });

  it("sends a section without usage data as the configuration alone, never a shape the binding lacks", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await port.createSection(PREFIX, { sectionConfiguration: "e30=", qtiMetadata: "bWV0YQ==" });
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({ sectionConfiguration: "e30=" });
  });

  it("gets a section: GET /sections/{id}, with the binding's section and items as section data and pool", async () => {
    const service = fakeService(() => ({
      status: 200,
      body: {
        items: { itemIdentifiers: ["i1", "i2"] },
        section: { sectionConfiguration: "e30=", qtiUsagedata: "PD94" },
      },
    }));
    const port = onePort({ fetch: service.fetch, endpoint: `${PREFIX}/`, credentials: CREDENTIALS });
    expect(await port.getSection(PREFIX, "sec 1")).toEqual({
      sectionData: { sectionConfiguration: "e30=", qtiUsagedata: "PD94" },
      items: { itemIdentifiers: ["i1", "i2"], stageLength: null },
    });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections/sec%201`);
    expect(call?.request.method).toBe("GET");
    expect(call?.request.body).toBeUndefined();
  });

  it("reads a Get Section answer without items as an empty pool, because the binding's item set cannot be empty", async () => {
    const service = fakeService(() => ({ status: 200, body: { section: { sectionConfiguration: "e30=" } } }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    expect(await port.getSection(PREFIX, "sec1")).toEqual({
      sectionData: { sectionConfiguration: "e30=" },
      items: { itemIdentifiers: [], stageLength: 0 },
    });
  });

  it("creates a session: POST /sections/{id}/sessions without the PNP unless sharePnp, prior data as key and value", async () => {
    const reply: Reply = {
      status: 201,
      body: {
        sessionIdentifier: "s1",
        nextItems: { itemIdentifiers: ["i1", "i2"], stageLength: 2 },
        sessionState: "st0",
      },
    };
    const request = {
      personalNeedsAndPreferences: PNP,
      demographics: DEMOGRAPHICS,
      priorData: [
        { name: "level", value: "B2" },
        { name: "attempts", value: 3 },
        { name: "tags", value: ["a", "b"] },
      ],
    };
    const priorData = [
      { key: "level", value: "B2" },
      { key: "attempts", value: "3" },
      { key: "tags", value: '["a","b"]' },
    ];
    for (const sharePnp of [undefined, false, true]) {
      const service = fakeService(() => reply);
      const port = onePort({
        fetch: service.fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
        ...(sharePnp === undefined ? {} : { sharePnp }),
      });
      expect(await port.createSession(PREFIX, "sec1", request)).toEqual({
        sessionIdentifier: "s1",
        nextItems: { itemIdentifiers: ["i1", "i2"], stageLength: 2 },
        sessionState: "st0",
      });
      const [call] = engineCalls(service.calls);
      expect(call?.url).toBe(`${PREFIX}/sections/sec1/sessions`);
      expect(bodyOf(call), String(sharePnp)).toEqual({
        ...(sharePnp === true ? { personalNeedsAndPreferences: PNP } : {}),
        demographics: DEMOGRAPHICS,
        priorData,
      });
    }
  });

  it("reads a Create Session answer without a stage as the end of the session, and needs the identifier", async () => {
    const answer = (body: unknown): Promise<unknown> =>
      onePort({
        fetch: fakeService(() => ({ status: 201, body })).fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      }).createSession(PREFIX, "sec1", {});
    expect(await answer({ sessionIdentifier: "s1" })).toEqual({
      sessionIdentifier: "s1",
      nextItems: { itemIdentifiers: [], stageLength: 0 },
    });
    expect(await rejection(answer({ nextItems: { itemIdentifiers: ["i1"] } }))).toMatch(
      /^The answer to Create Session is invalid: missing the property "sessionIdentifier"/,
    );
    // The stage is read by the runtime, whose errors pass through the player unchanged.
    const badStage = answer({ sessionIdentifier: "s1", nextItems: { itemIdentifiers: [1] } });
    await expect(badStage).rejects.toThrow(DataError);
    await expect(badStage).rejects.toThrow(
      /^The nextItems of the answer to Create Session is invalid at itemIdentifiers\[0\]: expected a string/,
    );
    expect(await rejection(answer({ sessionIdentifier: "s1", sessionState: 5 }))).toMatch(
      /^The answer to Create Session is invalid at sessionState: expected a string, found 5/,
    );
  });

  it("submits results: POST .../results with the assessment result of the binding and the sessionState", async () => {
    const service = fakeService(() => ({
      status: 201,
      body: {
        nextItems: { itemIdentifiers: ["i3"], stageLength: 1 },
        sessionState: "st2",
        assessmentResult: {
          testResult: {
            identifier: "test1",
            datestamp: "2026-10-30T10:06:00",
            outcomeVariables: [
              { identifier: "THETA", cardinality: "single", baseType: "float", value: [{ value: "0.42" }] },
            ],
          },
        },
      },
    }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const answered = await port.submitResults(PREFIX, "sec1", "s1", { assessmentResult: RESULT, sessionState: "st1" });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections/sec1/sessions/s1/results`);
    expect(call?.request.method).toBe("POST");
    expect(bodyOf(call)).toEqual({ assessmentResult: RESULT_JSON, sessionState: "st1" });
    expect(answered).toEqual({
      nextItems: { itemIdentifiers: ["i3"], stageLength: 1 },
      sessionState: "st2",
      assessmentResult: {
        context: { sessionIdentifiers: [] },
        testResult: {
          identifier: "test1",
          datestamp: "2026-10-30T10:06:00",
          variables: [
            {
              kind: "outcome",
              identifier: "THETA",
              cardinality: "single",
              baseType: "float",
              value: single("float", 0.42),
            },
          ],
          supports: [],
        },
        itemResults: [],
      },
    });
  });

  it("reads an answer without next items and without a state as the end of the session", async () => {
    const service = fakeService(() => ({ status: 201, body: {} }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const answered = await port.submitResults(PREFIX, "sec1", "s1", { assessmentResult: RESULT });
    expect(answered).toEqual({});
    expect(isSessionEnd(answered.nextItems)).toBe(true);
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({ assessmentResult: RESULT_JSON });
  });

  it("ends a session and a section: DELETE, with an answer without a body", async () => {
    const service = fakeService(() => ({ status: 204 }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await expect(port.endSession(PREFIX, "sec1", "s1")).resolves.toBeUndefined();
    await expect(port.endSection(PREFIX, "sec1")).resolves.toBeUndefined();
    expect(engineCalls(service.calls).map(({ url, request }) => `${request.method} ${url}`)).toEqual([
      `DELETE ${PREFIX}/sections/sec1/sessions/s1`,
      `DELETE ${PREFIX}/sections/sec1`,
    ]);
  });

  it("keeps the token for the requests that follow, and asks again after a 401, then repeats the request once", async () => {
    let issued = 0;
    let expired = false;
    const calls: Call[] = [];
    const respond = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      text: async () => JSON.stringify(body),
    });
    const port = onePort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      async fetch(url, request) {
        calls.push({ url, request });
        if (url === TOKEN_URL) {
          issued += 1;
          return respond(200, { access_token: `tok${issued}`, token_type: "bearer" });
        }
        return expired && request.headers.Authorization === "Bearer tok1"
          ? respond(401, { imsx_codeMajor: "failure", imsx_severity: "error" })
          : respond(201, { sectionIdentifier: "sec1" });
      },
    });
    await port.createSection(PREFIX, sectionData);
    await port.createSection(PREFIX, sectionData);
    expect(issued).toBe(1);
    // The token has expired: the engine answers 401, and the request goes out again with a new token.
    expired = true;
    await port.createSection(PREFIX, sectionData);
    expect(issued).toBe(2);
    expect(
      engineCalls(calls)
        .slice(-2)
        .map(({ request }) => request.headers.Authorization),
    ).toEqual(["Bearer tok1", "Bearer tok2"]);
  });

  it("fails with a ServiceError that carries the status and the body of the answer", async () => {
    const status = { imsx_codeMajor: "failure", imsx_severity: "error", imsx_description: "Unknown Object" };
    const port = onePort({
      fetch: fakeService(() => ({ status: 404, body: status })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    const error = await port.getSection(PREFIX, "nope").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 404, body: JSON.stringify(status) });
    expect((error as ServiceError).message).toBe(
      `The CAT engine at ${PREFIX}/sections/nope answered GET with the status 404.`,
    );
  });

  it("fails with a ServiceError for a 401 after the new token, for a body that is not JSON and for a bad token answer", async () => {
    const denied = onePort({
      fetch: fakeService(() => ({ status: 401, body: {} })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    await expect(denied.endSection(PREFIX, "sec1")).rejects.toMatchObject({ status: 401 });
    const html = onePort({
      fetch: fakeService(() => ({ status: 200, body: "<html>" })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    await expect(html.getSection(PREFIX, "sec1")).rejects.toThrow(/answered with a body that is not JSON/);

    const badToken = async (reply: Reply): Promise<unknown> => {
      const calls: Call[] = [];
      const port = onePort({
        endpoint: PREFIX,
        credentials: CREDENTIALS,
        async fetch(url, request) {
          calls.push({ url, request });
          const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
          return { ok: reply.status < 300, status: reply.status, text: async () => text };
        },
      });
      return port.endSection(PREFIX, "sec1").catch((caught: unknown) => caught);
    };
    expect(await badToken({ status: 500, body: "oops" })).toMatchObject({ status: 500, body: "oops" });
    expect(await badToken({ status: 200, body: { token_type: "bearer" } })).toBeInstanceOf(ServiceError);
    expect(await badToken({ status: 200, body: { access_token: "t", token_type: "mac" } })).toBeInstanceOf(
      ServiceError,
    );
    expect(await badToken({ status: 200, body: "{" })).toBeInstanceOf(ServiceError);
    expect(await badToken({ status: 200, body: "[]" })).toBeInstanceOf(DataError);
  });

  it("asks for a token again after a failed token request, and passes on the error of fetch", async () => {
    let attempts = 0;
    const port = onePort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      async fetch(url) {
        if (url === TOKEN_URL) {
          attempts += 1;
          if (attempts === 1) throw new TypeError("network down");
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ access_token: "t", token_type: "bearer" }),
          };
        }
        return { ok: true, status: 204, text: async () => "" };
      },
    });
    await expect(port.endSection(PREFIX, "sec1")).rejects.toThrow(new TypeError("network down"));
    await expect(port.endSection(PREFIX, "sec1")).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("aborts a request that takes longer than timeoutMs", async () => {
    const port = onePort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      timeoutMs: 20,
      fetch: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    });
    await expect(port.endSection(PREFIX, "sec1")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("sends nothing to a reference that the host did not configure, and nothing over http", async () => {
    const service = fakeService();
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const message =
      'The reference "https://evil.example/ims/cat/v1p0" is not an engine that the host configured; the port sends nothing to another engine.';
    for (const call of [
      () => port.createSection("https://evil.example/ims/cat/v1p0", sectionData),
      () => port.getSection("https://evil.example/ims/cat/v1p0", "sec1"),
      () => port.createSession("https://evil.example/ims/cat/v1p0", "sec1", {}),
      () => port.submitResults("https://evil.example/ims/cat/v1p0", "sec1", "s1", { assessmentResult: RESULT }),
      () => port.endSession("https://evil.example/ims/cat/v1p0", "sec1", "s1"),
      () => port.endSection("https://evil.example/ims/cat/v1p0", "sec1"),
    ]) {
      expect(await rejection(call())).toBe(message);
    }
    expect(service.calls).toEqual([]);
    const engine = { endpoint: PREFIX, credentials: CREDENTIALS };
    expect(() =>
      createRestCatPort({
        fetch: service.fetch,
        engines: new Map([[PREFIX, { ...engine, endpoint: "http://cat.example/ims/cat/v1p0" }]]),
      }),
    ).toThrow(
      new DataError(
        `The engine of the reference "${PREFIX}" is invalid at endpoint: expected an absolute https URL, found "http://cat.example/ims/cat/v1p0".`,
      ),
    );
    expect(() =>
      createRestCatPort({
        fetch: service.fetch,
        engines: new Map([
          [PREFIX, { ...engine, credentials: { ...CREDENTIALS, tokenUrl: "http://auth.example/token" } }],
        ]),
      }),
    ).toThrow(/^The engine of the reference .* is invalid at credentials\.tokenUrl: expected an absolute https URL/);
  });

  it("takes the global fetch as it is", () => {
    expect(() => onePort({ fetch, endpoint: PREFIX, credentials: CREDENTIALS })).not.toThrow();
  });

  it("serves the engine that a package names at another address than the platform reaches, as a gateway does", async () => {
    const service = fakeService(() => ({ status: 200, body: { sectionIdentifier: "sec1" } }));
    const reference = "https://engine.example/ims/cat/v1p0";
    const upstream = "https://gateway.internal/engines/a/ims/cat/v1p0";
    const port = createRestCatPort({
      fetch: service.fetch,
      engines: new Map([[`${reference}/`, { endpoint: `${upstream}/`, credentials: CREDENTIALS }]]),
    });
    expect(await port.createSection(reference, sectionData)).toEqual({ sectionIdentifier: "sec1" });
    expect(await port.createSection(`${reference}//`, sectionData)).toEqual({ sectionIdentifier: "sec1" });
    expect(engineCalls(service.calls).map(({ url }) => url)).toEqual([`${upstream}/sections`, `${upstream}/sections`]);
    expect(await rejection(port.createSection(upstream, sectionData))).toMatch(
      /is not an engine that the host configured/,
    );
  });

  it("asks a function for the engine of a reference, and refuses when it answers nothing or something malformed", async () => {
    const service = fakeService(() => ({ status: 200, body: { sectionIdentifier: "sec1" } }));
    const asked: string[] = [];
    const port = createRestCatPort({
      fetch: service.fetch,
      engines: async (reference) => {
        asked.push(reference);
        if (reference === "https://known.example/ims/cat/v1p0") return { endpoint: PREFIX, credentials: CREDENTIALS };
        if (reference === "https://broken.example/ims/cat/v1p0") return json("5");
        return undefined;
      },
    });
    expect(await port.createSection("https://known.example/ims/cat/v1p0/", sectionData)).toEqual({
      sectionIdentifier: "sec1",
    });
    expect(asked).toEqual(["https://known.example/ims/cat/v1p0"]);
    expect(await rejection(port.createSection("https://other.example/ims/cat/v1p0", sectionData))).toMatch(
      /is not an engine that the host configured/,
    );
    expect(await rejection(port.createSection("https://broken.example/ims/cat/v1p0", sectionData))).toMatch(
      /^The engine of the reference "https:\/\/broken\.example\/ims\/cat\/v1p0" is invalid: expected an object/,
    );
    expect(engineCalls(service.calls)).toHaveLength(1);
    const failing = createRestCatPort({
      fetch: service.fetch,
      engines: () => {
        throw new Error("The registry is down.");
      },
    });
    await expect(failing.getSection(PREFIX, "sec1")).rejects.toThrow("The registry is down.");
  });

  /** A fetch that issues numbered tokens, refuses the revoked ones with 401, and records the token requests and the calls. */
  function tokenService() {
    const tokenRequests: { readonly url: string; readonly authorization: string | undefined }[] = [];
    const engineRequests: { readonly url: string; readonly authorization: string | undefined }[] = [];
    const revoked = new Set<string>();
    let issued = 0;
    const send: CatFetch = async (url, request) => {
      if (url.startsWith("https://auth.")) {
        tokenRequests.push({ url, authorization: request.headers.Authorization });
        const body = JSON.stringify({ access_token: `tok${++issued}`, token_type: "bearer" });
        return { ok: true, status: 200, text: async () => body };
      }
      engineRequests.push({ url, authorization: request.headers.Authorization });
      const refused = revoked.has(request.headers.Authorization?.slice("Bearer ".length) ?? "");
      return { ok: !refused, status: refused ? 401 : 200, text: async () => "{}" };
    };
    return { send, tokenRequests, engineRequests, revoked };
  }

  it("keeps the token of each engine apart", async () => {
    const service = tokenService();
    const engine = (name: string): CatEngine => ({
      endpoint: `https://${name}.example/ims/cat/v1p0`,
      credentials: { ...CREDENTIALS, tokenUrl: `https://auth.${name}.example/token`, clientId: name },
    });
    const port = createRestCatPort({
      fetch: service.send,
      engines: new Map([
        ["https://a.example/ims/cat/v1p0", engine("a")],
        ["https://b.example/ims/cat/v1p0", engine("b")],
      ]),
    });
    await port.endSection("https://a.example/ims/cat/v1p0", "s1");
    await port.endSection("https://b.example/ims/cat/v1p0", "s1");
    await port.endSection("https://a.example/ims/cat/v1p0", "s2");
    expect(service.tokenRequests.map(({ url }) => url)).toEqual([
      "https://auth.a.example/token",
      "https://auth.b.example/token",
    ]);
    expect(service.engineRequests.map(({ authorization }) => authorization)).toEqual([
      "Bearer tok1",
      "Bearer tok2",
      "Bearer tok1",
    ]);
  });

  it("asks for a new token with the credentials that the host holds when the engine answers 401", async () => {
    const service = tokenService();
    let secret = "first";
    const reference = "https://a.example/ims/cat/v1p0";
    const port = createRestCatPort({
      fetch: service.send,
      engines: () => ({ endpoint: reference, credentials: { ...CREDENTIALS, clientSecret: secret } }),
    });
    await port.endSection(reference, "s1");
    service.revoked.add("tok1");
    secret = "second";
    await port.endSection(reference, "s2");
    const basic = (client: string, password: string): string => `Basic ${btoa(`${client}:${password}`)}`;
    expect(service.tokenRequests.map(({ authorization }) => authorization)).toEqual([
      basic("player", "first"),
      basic("player", "second"),
    ]);
    expect(service.engineRequests.map(({ authorization }) => authorization)).toEqual([
      "Bearer tok1",
      "Bearer tok1",
      "Bearer tok2",
    ]);
  });

  it("sends the personal needs and preferences only to the engines that are set to receive them", async () => {
    const service = fakeService(() => ({
      status: 201,
      body: { sessionIdentifier: "x", nextItems: { itemIdentifiers: ["i1"] } },
    }));
    const shared = "https://shared.example/ims/cat/v1p0";
    const kept = "https://kept.example/ims/cat/v1p0";
    const port = createRestCatPort({
      fetch: service.fetch,
      engines: new Map([
        [shared, { endpoint: shared, credentials: CREDENTIALS, sharePnp: true }],
        [kept, { endpoint: kept, credentials: CREDENTIALS }],
      ]),
    });
    await port.createSession(shared, "sec1", { personalNeedsAndPreferences: PNP });
    await port.createSession(kept, "sec1", { personalNeedsAndPreferences: PNP });
    const [first, second] = engineCalls(service.calls);
    expect(bodyOf(first)).toEqual({ personalNeedsAndPreferences: PNP });
    expect(bodyOf(second)).toEqual({});
  });

  it("checks its options and its requests", async () => {
    const service = fakeService();
    const engine = { endpoint: PREFIX, credentials: CREDENTIALS };
    const options = { fetch: service.fetch, engines: new Map([[PREFIX, engine]]) };
    const port = createRestCatPort(options);
    expect(() => createRestCatPort(json("null"))).toThrow(
      new DataError("The options object is invalid: expected an object, found null."),
    );
    expect(() => createRestCatPort({ ...options, fetch: json("5") })).toThrow(
      /^The options object is invalid at fetch: expected a function/,
    );
    expect(() => createRestCatPort({ ...options, engines: json("5") })).toThrow(
      /^The options object is invalid at engines: /,
    );
    expect(() => createRestCatPort({ ...options, engines: json("{}") })).toThrow(
      /^The options object is invalid at engines: /,
    );
    const one =
      (value: unknown): (() => unknown) =>
      () =>
        createRestCatPort({ ...options, engines: new Map([[PREFIX, value as typeof engine]]) });
    expect(one(json("null"))).toThrow(/^The engine of the reference .* is invalid: expected an object/);
    expect(one({ ...engine, endpoint: json("5") })).toThrow(/is invalid at endpoint: expected a string/);
    expect(one({ ...engine, credentials: json("null") })).toThrow(/is invalid at credentials: expected an object/);
    for (const property of ["clientId", "clientSecret", "scope"]) {
      expect(one({ ...engine, credentials: { ...CREDENTIALS, [property]: "" } }), property).toThrow(
        new DataError(
          `The engine of the reference "${PREFIX}" is invalid at credentials.${property}: expected a length of at least 1, found 0.`,
        ),
      );
    }
    expect(one({ ...engine, credentials: { ...CREDENTIALS, extra: 1 } })).toThrow(DataError);
    expect(one({ ...engine, sharePnp: json('"yes"') })).toThrow(
      /is invalid at sharePnp: expected true or false, found "yes"/,
    );
    expect(one({ ...engine, speed: 1 })).toThrow(/unexpected property "speed"/);
    expect(() => createRestCatPort({ ...options, engines: new Map([["", engine]]) })).toThrow(
      /^A reference of the option engines must be a non-empty string/,
    );
    expect(() =>
      createRestCatPort({
        ...options,
        engines: new Map([
          [PREFIX, engine],
          [`${PREFIX}/`, engine],
        ]),
      }),
    ).toThrow(/has the reference .* twice/);
    expect(() => createRestCatPort({ ...options, timeoutMs: 0 })).toThrow(
      new DataError("The options object is invalid at timeoutMs: expected a positive number, found 0."),
    );
    expect(() => createRestCatPort({ ...options, timeoutMs: json("null") })).toThrow(DataError);
    expect(() => createRestCatPort({ ...options, speed: 1 } as never)).toThrow(
      /^The options object is invalid: unexpected property "speed"/,
    );
    expect(await rejection(port.createSection(PREFIX, json('{"sectionConfiguration":5}')))).toMatch(
      /^The section data is invalid at /,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json("null")))).toMatch(
      /^The request to create a session is invalid: expected an object/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json('{"priorData":{}}')))).toMatch(
      /^The request to create a session is invalid at priorData: expected an array, found an object/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json('{"demographics":5}')))).toMatch(
      /^The request to create a session is invalid at demographics: expected a string, found 5/,
    );
    expect(
      await rejection(port.createSession(PREFIX, "sec1", { priorData: [{ name: "x", value: undefined }] })),
    ).toMatch(/^The value of the prior data "x" must be JSON/);
    expect(await rejection(port.createSession(PREFIX, "", {}))).toMatch(
      /^The section identifier must be a non-empty string/,
    );
    expect(await rejection(port.submitResults(PREFIX, "sec1", "", { assessmentResult: RESULT }))).toMatch(
      /^The session identifier must be a non-empty string/,
    );
    expect(await rejection(port.submitResults(PREFIX, "sec1", "s1", json('{"sessionState":5}')))).toMatch(
      /^The request to submit results is invalid at sessionState: expected a string, found 5/,
    );
    expect(await rejection(port.getSection(json("5"), "sec1"))).toMatch(/^The prefix must be a string/);
    expect(service.calls).toEqual([]);
  });

  it("accepts the qtiMetadata object of Get Section, the binding's QTI metadata record, and does not return it as section data", async () => {
    const answer = (section: unknown): Promise<unknown> =>
      onePort({
        fetch: fakeService(() => ({ status: 200, body: { items: { itemIdentifiers: ["i1"] }, section } })).fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      }).getSection(PREFIX, "sec1");
    expect(
      await answer({ sectionConfiguration: "e30=", qtiMetadata: { composite: false, scoringMode: ["human"] } }),
    ).toEqual({
      sectionData: { sectionConfiguration: "e30=" },
      items: { itemIdentifiers: ["i1"], stageLength: null },
    });
    expect(await rejection(answer({ sectionConfiguration: "e30=", qtiMetadata: "bWV0YQ==" }))).toBe(
      'The answer to Get Section is invalid at section.qtiMetadata: expected an object, found "bWV0YQ==".',
    );
    expect(await rejection(answer({ qtiUsagedata: "PD94" }))).toMatch(
      /^The answer to Get Section is invalid at section: missing the property "sectionConfiguration"/,
    );
    expect(await rejection(answer(json("null")))).toBe(
      "The answer to Get Section is invalid at section: expected an object, found null.",
    );
  });

  it("reads or refuses arbitrary JSON as options with a DataError, and nothing else", () => {
    fuzzJson((options) => createRestCatPort(options as RestCatPortOptions));
  });

  it("reads or refuses arbitrary JSON as section data with a DataError, and nothing else", () => {
    fuzzJson(readSectionData, [sectionData, { sectionConfiguration: "e30=" }]);
  });
});

/** A port whose six requests record their calls and answer validly, unless a test replaces them. */
function stubPort(replace: Partial<CatPort> = {}): {
  readonly port: CatPort;
  readonly received: unknown[][];
  readonly calls: () => string[];
} {
  const received: unknown[][] = [];
  const recording =
    <Args extends unknown[], Result>(name: string, answer: (...args: Args) => Promise<Result>) =>
    (...args: Args): Promise<Result> => {
      received.push([name, ...args]);
      return answer(...args);
    };
  const port: CatPort = {
    createSection: recording("createSection", async () => ({ sectionIdentifier: "sec1" })),
    getSection: recording("getSection", async () => ({
      sectionData: { sectionConfiguration: "e30=" },
      items: { itemIdentifiers: ["q1"] },
    })),
    createSession: recording("createSession", async () => ({
      sessionIdentifier: "s1",
      nextItems: { itemIdentifiers: ["q1"], stageLength: 1 },
    })),
    submitResults: recording("submitResults", async () => ({ nextItems: null })),
    endSession: recording("endSession", async () => undefined),
    endSection: recording("endSection", async () => undefined),
  };
  for (const [name, answer] of Object.entries(replace)) {
    Object.assign(port, { [name]: recording(name, answer as never) });
  }
  return { port, received, calls: () => received.map(([name]) => String(name)) };
}

describe("createCatRestHandler", () => {
  const AUTHORIZATION = { authorization: "Bearer tok" };
  const JSON_HEADERS = { ...AUTHORIZATION, "content-type": "application/json" };
  const RESULT_BODY = { assessmentResult: RESULT_JSON };

  /** The imsx status information of an answer that failed, with the code minor of its first field. */
  interface Status {
    readonly imsx_codeMajor: string;
    readonly imsx_severity: string;
    readonly imsx_description: string;
    readonly imsx_codeMinor?: {
      readonly imsx_codeMinorField: readonly { readonly imsx_codeMinorFieldValue: string }[];
    };
  }

  /** Lets the pending work of the event loop run, so that a test sees that nothing more happens. */
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  const authorize: CatAuthenticate = (request) => request.headers.get("authorization") === "Bearer tok";

  const handlerOf = (port: CatPort, options: Partial<CatRestHandlerOptions> = {}) =>
    createCatRestHandler(port, { authenticate: authorize, ...options });

  /** A request to the engine at `PREFIX`; a body that is not text is sent as JSON. */
  function requestOf(
    method: string,
    path: string,
    { body, headers = JSON_HEADERS, signal }: { body?: unknown; headers?: HeadersInit; signal?: AbortSignal } = {},
  ): Request {
    return new Request(`${PREFIX}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  }

  const statusOf = async (response: Response): Promise<Status> => JSON.parse(await response.text());

  /** Checks an answer that fails: its status, the code minor of the binding and, when given, the description. */
  async function expectFailure(
    response: Response,
    status: number,
    minor: string | undefined,
    description?: string | RegExp,
  ): Promise<Status> {
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await statusOf(response);
    expect(body.imsx_severity).toBe("error");
    expect(body.imsx_codeMajor).toBe(minor === undefined ? "unsupported" : "failure");
    expect(body.imsx_codeMinor?.imsx_codeMinorField.map((field) => field.imsx_codeMinorFieldValue)).toEqual(
      minor === undefined ? undefined : [minor],
    );
    if (typeof description === "string") expect(body.imsx_description).toBe(description);
    else if (description !== undefined) expect(body.imsx_description).toMatch(description);
    return body;
  }

  it("answers 400 and calls no port for a body that is not JSON, empty, not UTF-8, or of another type", async () => {
    const { port, calls } = stubPort();
    const handler = handlerOf(port);
    for (const [path, body] of [
      ["/sections", "{"],
      ["/sections", ""],
      ["/sections/sec1/sessions", "not json"],
      ["/sections/sec1/sessions/s1/results", "[1,"],
    ] as const) {
      await expectFailure(
        await handler(requestOf("POST", path, { body })),
        400,
        "invaliddata",
        /^The body of the request is not JSON/,
      );
    }
    const latin1 = new Request(`${PREFIX}/sections`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: new Uint8Array([0x7b, 0xff, 0x7d]),
    });
    await expectFailure(await handler(latin1), 400, "invaliddata", "The body of the request is not valid UTF-8.");
    const wrongType = `The request must have the content type application/json, found `;
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded"]) {
      const headers = { ...AUTHORIZATION, "content-type": contentType };
      const request = requestOf("POST", "/sections", { body: '{"sectionConfiguration":"e30="}', headers });
      await expectFailure(await handler(request), 400, "invaliddata", `${wrongType}${contentType}.`);
    }
    const untyped = new Request(`${PREFIX}/sections`, {
      method: "POST",
      headers: AUTHORIZATION,
      body: new TextEncoder().encode('{"sectionConfiguration":"e30="}'),
    });
    await expectFailure(await handler(untyped), 400, "invaliddata", `${wrongType}none.`);
    expect(calls()).toEqual([]);
  });

  it("accepts the content type with a charset and in any case", async () => {
    const { port, calls } = stubPort();
    const headers = { ...AUTHORIZATION, "content-type": "Application/JSON; charset=utf-8" };
    const response = await handlerOf(port)(
      requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" }, headers }),
    );
    expect(response.status).toBe(201);
    expect(calls()).toEqual(["createSection"]);
  });

  it("answers 400 with the path of the first problem when a body does not match its schema, and calls no port", async () => {
    const { port, calls } = stubPort();
    const handler = handlerOf(port);
    const cases: readonly (readonly [path: string, body: unknown, message: RegExp])[] = [
      ["/sections", {}, /^The request to Create Section is invalid: missing the property "sectionConfiguration"/],
      ["/sections", { sectionConfiguration: 5 }, /invalid at sectionConfiguration: expected a string, found 5/],
      [
        "/sections",
        { sectionConfiguration: "e30=", extra: 1 },
        /^The request to Create Section is invalid: unexpected property "extra"/,
      ],
      ["/sections", { sectionConfiguration: "e30=", qtiMetadata: "bWV0YQ==" }, /at qtiMetadata: expected an object/],
      ["/sections/sec1/sessions", { demographics: 5 }, /^The request to Create Session is invalid at demographics/],
      ["/sections/sec1/sessions", { priorData: [{ key: "k" }] }, /at priorData\[0\]: missing the property "value"/],
      ["/sections/sec1/sessions", [], /^The request to Create Session is invalid/],
      ["/sections/sec1/sessions", null, /^The request to Create Session is invalid/],
      ["/sections/sec1/sessions/s1/results", {}, /^The request to Submit Results is invalid: missing the property/],
      [
        "/sections/sec1/sessions/s1/results",
        { assessmentResult: 5 },
        /^The assessmentResult is invalid: expected an object, found 5/,
      ],
      ["/sections/sec1/sessions/s1/results", { ...RESULT_BODY, sessionState: 5 }, /at sessionState: expected a string/],
    ];
    for (const [path, body, message] of cases) {
      await expectFailure(await handler(requestOf("POST", path, { body })), 400, "invaliddata", message);
    }
    expect(calls()).toEqual([]);
  });

  it("answers 400 for a body above the limit without reading it to its end", async () => {
    const { port, calls } = stubPort();
    const exact = JSON.stringify({ sectionConfiguration: "x" });
    const handler = handlerOf(port, { maxBodyBytes: exact.length });
    const message = `The body of the request is larger than the limit of ${exact.length} bytes.`;
    await expectFailure(
      await handler(requestOf("POST", "/sections", { body: `${exact} ` })),
      400,
      "invaliddata",
      message,
    );

    // The declared length spares the read.
    const declared = requestOf("POST", "/sections", {
      body: exact,
      headers: { ...JSON_HEADERS, "content-length": String(exact.length + 1) },
    });
    await expectFailure(await handler(declared), 400, "invaliddata", message);
    expect(declared.bodyUsed).toBe(false);

    // A body that declares no length is counted as it arrives, and the source is cancelled at the first byte above.
    let sent = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(exact);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamed = new Request(`${PREFIX}/sections`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expectFailure(await handler(streamed), 400, "invaliddata", message);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(10);
    expect(calls()).toEqual([]);

    expect((await handler(requestOf("POST", "/sections", { body: exact }))).status).toBe(201);
  });

  it("answers 404 with the statement Unknown Object when the port throws a ServiceError of status 404", async () => {
    const unknown = async (): Promise<never> => {
      throw new ServiceError("The CAT engine at https://internal.example/x answered GET with the status 404.", 404, "");
    };
    const { port, calls } = stubPort({
      getSection: unknown,
      createSession: unknown,
      submitResults: unknown,
      endSession: unknown,
      endSection: unknown,
    });
    const handler = handlerOf(port);
    const requests = [
      requestOf("GET", "/sections/nope"),
      requestOf("POST", "/sections/nope/sessions", { body: {} }),
      requestOf("POST", "/sections/sec1/sessions/nope/results", { body: RESULT_BODY }),
      requestOf("DELETE", "/sections/sec1/sessions/nope"),
      requestOf("DELETE", "/sections/nope"),
    ];
    for (const request of requests) {
      const body = await expectFailure(await handler(request), 404, "unknownobject", "Unknown Object");
      expect(JSON.stringify(body)).not.toContain("internal.example");
    }
    expect(calls()).toHaveLength(5);
  });

  it("answers 400 when the port refuses the data of a request, with the message of a DataError and without that of a ServiceError", async () => {
    const refuse = (error: Error) => async (): Promise<never> => {
      throw error;
    };
    for (const [error, description] of [
      [
        new DataError("The settings of the section must have a length."),
        "The settings of the section must have a length.",
      ],
      [new ReadError("The usage data is not well-formed.", []), "The usage data is not well-formed."],
      [new SecurityError("The usage data has a DOCTYPE.", "doctype", 0), "The usage data has a DOCTYPE."],
      [new ServiceError("secret detail", 400, "body"), "The engine refused the request."],
    ] as const) {
      const { port } = stubPort({ createSection: refuse(error) });
      const response = await handlerOf(port)(
        requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }),
      );
      await expectFailure(response, 400, "invaliddata", description);
    }
  });

  it("answers 500 without the message when the port throws anything else, or answers with a value the binding cannot carry", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("database password is hunter2");
    };
    const { port: throwing } = stubPort({
      createSection: boom,
      getSection: boom,
      createSession: boom,
      submitResults: boom,
      endSession: boom,
      endSection: boom,
    });
    const handler = handlerOf(throwing);
    const requests = [
      requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }),
      requestOf("GET", "/sections/sec1"),
      requestOf("POST", "/sections/sec1/sessions", { body: {} }),
      requestOf("POST", "/sections/sec1/sessions/s1/results", { body: RESULT_BODY }),
      requestOf("DELETE", "/sections/sec1/sessions/s1"),
      requestOf("DELETE", "/sections/sec1"),
    ];
    for (const request of requests) {
      const body = await expectFailure(
        await handler(request),
        500,
        "internal_server_error",
        "The engine failed to answer the request.",
      );
      expect(JSON.stringify(body)).not.toContain("hunter2");
    }
    // A ServiceError of another status than 400 and 404 is a failure of the engine, even a 401 from the engine behind a gateway.
    const upstream = async (): Promise<never> => {
      throw new ServiceError("The token endpoint refused.", 401, "");
    };
    const { port: gateway } = stubPort({ getSection: upstream });
    await expectFailure(await handlerOf(gateway)(requestOf("GET", "/sections/sec1")), 500, "internal_server_error");

    const garbage = {
      createSection: async () => json<CreateSectionResponse>('{"sectionIdentifier":""}'),
      getSection: async () => json<GetSectionResponse>('{"sectionData":{"sectionConfiguration":5},"items":{}}'),
      createSession: async () => json<CreateSessionResponse>('{"sessionIdentifier":"s1"}'),
      submitResults: async () => json<SubmitResultsResponse>('{"nextItems":{"itemIdentifiers":[1]}}'),
    };
    const { port: invalid } = stubPort(garbage);
    for (const request of requests.slice(0, 4)) {
      await expectFailure(await handlerOf(invalid)(request), 500, "internal_server_error");
    }
  });

  it("answers 401 with a challenge and calls neither the port nor reads the body when the request is not authorized", async () => {
    const { port, calls } = stubPort();
    const seen: [string, CatOperation][] = [];
    for (const authenticate of [
      () => false,
      async () => false,
      // Only true authorizes: a truthy value that is not a boolean does not.
      () => json<boolean>('"yes"'),
      async () => json<boolean>("1"),
    ]) {
      const handler = handlerOf(port, {
        authenticate: (request, operation) => {
          seen.push([request.method, operation]);
          return authenticate();
        },
      });
      const request = requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" }, headers: JSON_HEADERS });
      const response = await handler(request);
      await expectFailure(response, 401, "unauthorisedrequest", "The request is not authorized.");
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(request.bodyUsed).toBe(false);
    }
    expect(calls()).toEqual([]);
    expect(seen).toHaveLength(4);
  });

  it("answers 500 and calls no port when the authentication itself fails", async () => {
    const { port, calls } = stubPort();
    for (const authenticate of [
      () => {
        throw new Error("identity provider down");
      },
      async () => {
        throw new Error("identity provider down");
      },
    ]) {
      const response = await handlerOf(port, { authenticate })(requestOf("GET", "/sections/sec1"));
      const body = await expectFailure(response, 500, "internal_server_error", "The request could not be authorized.");
      expect(JSON.stringify(body)).not.toContain("identity provider");
    }
    expect(calls()).toEqual([]);
  });

  it("tells the authentication the operation of each of the six requests", async () => {
    const { port } = stubPort();
    const operations: CatOperation[] = [];
    const handler = handlerOf(port, {
      authenticate: (_request, operation) => {
        operations.push(operation);
        return true;
      },
    });
    await handler(requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }));
    await handler(requestOf("GET", "/sections/sec1"));
    await handler(requestOf("POST", "/sections/sec1/sessions", { body: {} }));
    await handler(requestOf("POST", "/sections/sec1/sessions/s1/results", { body: RESULT_BODY }));
    await handler(requestOf("DELETE", "/sections/sec1/sessions/s1"));
    await handler(requestOf("DELETE", "/sections/sec1"));
    expect(operations).toEqual([
      "createSection",
      "getSection",
      "createSession",
      "submitResults",
      "endSession",
      "endSection",
    ]);
  });

  describe("an aborted request", () => {
    const reason = new Error("the client left");

    it("rejects with the reason and calls neither authentication nor port when it is aborted before the call", async () => {
      const { port, calls } = stubPort();
      let authentications = 0;
      const handler = handlerOf(port, {
        authenticate: () => {
          authentications += 1;
          return true;
        },
      });
      await expect(handler(requestOf("GET", "/sections/sec1", { signal: AbortSignal.abort(reason) }))).rejects.toBe(
        reason,
      );
      expect(authentications).toBe(0);
      expect(calls()).toEqual([]);
    });

    it("rejects with the reason when it is aborted during authentication, and then does not call the port", async () => {
      const { port, calls } = stubPort();
      const controller = new AbortController();
      let release: (authorized: boolean) => void = () => undefined;
      const handler = handlerOf(port, {
        authenticate: () => new Promise<boolean>((resolve) => (release = resolve)),
      });
      const pending = handler(requestOf("GET", "/sections/sec1", { signal: controller.signal }));
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      release(true);
      await flush();
      expect(calls()).toEqual([]);
    });

    it("rejects with the reason when it is aborted while the body arrives, and then does not call the port", async () => {
      const { port, calls } = stubPort();
      const controller = new AbortController();
      let finish: () => void = () => undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(source) {
          finish = () => {
            source.enqueue(new TextEncoder().encode('{"sectionConfiguration":"e30="}'));
            source.close();
          };
        },
      });
      const request = new Request(`${PREFIX}/sections`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: stream,
        signal: controller.signal,
        duplex: "half",
      } as RequestInit);
      const pending = handlerOf(port)(request);
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      finish();
      await flush();
      expect(calls()).toEqual([]);
    });

    it("rejects with the reason as soon as it is aborted during the call of the port, which runs on", async () => {
      const controller = new AbortController();
      let answer: (value: CreateSessionResponse) => void = () => undefined;
      let reached: () => void = () => undefined;
      const called = new Promise<void>((resolve) => (reached = resolve));
      const { port } = stubPort({
        createSession: () =>
          new Promise<CreateSessionResponse>((resolve) => {
            answer = resolve;
            reached();
          }),
      });
      const pending = handlerOf(port)(
        requestOf("POST", "/sections/sec1/sessions", { body: {}, signal: controller.signal }),
      );
      await called;
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      // The answer of the port that comes later is dropped, and nothing fails.
      answer({ sessionIdentifier: "s1", nextItems: { itemIdentifiers: ["q1"] } });
      await flush();
    });
  });

  it("answers 404 for a path that is no endpoint, and 405 with the allowed methods for a method that is not one", async () => {
    const { port, calls } = stubPort();
    const handler = handlerOf(port);
    for (const path of [
      "/",
      "/sections/",
      "/sections/sec1/sessions/s1/results/more",
      "/sections//sessions",
      "/sections/sec1/sessions//results",
      "/sessions",
      "/sections/sec1/results",
    ]) {
      await expectFailure(
        await handler(requestOf("GET", path)),
        404,
        "unknownobject",
        "Unknown Object: the path is not an endpoint of the CAT binding.",
      );
    }
    const elsewhere = new Request("https://cat.example/other/sections", { method: "POST", headers: JSON_HEADERS });
    await expectFailure(await handler(elsewhere), 404, "unknownobject");
    const prefixOnly = new Request("https://cat.example/ims/cat/v1p0sections", { method: "POST" });
    await expectFailure(await handler(prefixOnly), 404, "unknownobject");

    for (const [method, path, allow] of [
      ["GET", "/sections", "POST"],
      ["PUT", "/sections/sec1", "GET, DELETE"],
      ["POST", "/sections/sec1", "GET, DELETE"],
      ["GET", "/sections/sec1/sessions", "POST"],
      ["POST", "/sections/sec1/sessions/s1", "DELETE"],
      ["GET", "/sections/sec1/sessions/s1/results", "POST"],
      ["PATCH", "/sections/sec1/sessions/s1/results", "POST"],
      ["OPTIONS", "/sections", "POST"],
    ] as const) {
      const response = await handler(requestOf(method, path));
      await expectFailure(response, 405, undefined, "The method is not allowed for this endpoint.");
      expect(response.headers.get("allow"), `${method} ${path}`).toBe(allow);
    }
    expect(calls()).toEqual([]);
  });

  it("answers 400 for an identifier that is not valid percent-encoding", async () => {
    const { port, calls } = stubPort();
    const response = await handlerOf(port)(requestOf("GET", "/sections/%E0%A4%A"));
    await expectFailure(
      response,
      400,
      "invaliddata",
      "The path holds an identifier that is not valid percent-encoding.",
    );
    expect(calls()).toEqual([]);
  });

  it("decodes identifiers and passes the URL prefix of the request, with the origin and the root", async () => {
    const { port, received } = stubPort();
    const handler = handlerOf(port, { root: "/gateway/cat" });
    await handler(new Request("http://localhost:8080/gateway/cat/sections/sec%201", { headers: AUTHORIZATION }));
    await handler(
      new Request("http://localhost:8080/gateway/cat/sections/a%2Fb/sessions/%C3%A9/results", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(RESULT_BODY),
      }),
    );
    // Identifiers are data: a name that is special to an object is only a name.
    await handler(
      new Request("http://localhost:8080/gateway/cat/sections/__proto__/sessions/constructor", {
        method: "DELETE",
        headers: AUTHORIZATION,
      }),
    );
    const prefix = "http://localhost:8080/gateway/cat";
    expect(
      received.map(([name, ...rest]) => [name, ...rest.slice(0, 3).filter((arg) => typeof arg === "string")]),
    ).toEqual([
      ["getSection", prefix, "sec 1"],
      ["submitResults", prefix, "a/b", "é"],
      ["endSession", prefix, "__proto__", "constructor"],
    ]);
    await expectFailure(await handler(requestOf("GET", "/sections/sec1")), 404, "unknownobject");
  });

  it("answers the statuses of the binding with a JSON body that is never cached", async () => {
    const result = resultsOf(new Map([["q1", 1]]));
    const { port } = stubPort({
      submitResults: async () => ({
        nextItems: { itemIdentifiers: ["q2"], stageLength: 1 },
        assessmentResult: result,
        sessionState: "st1",
      }),
    });
    const handler = handlerOf(port);
    const created = await handler(requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }));
    expect([created.status, await created.json()]).toEqual([201, { sectionIdentifier: "sec1" }]);
    const got = await handler(requestOf("GET", "/sections/sec1"));
    expect([got.status, await got.json()]).toEqual([
      200,
      { section: { sectionConfiguration: "e30=" }, items: { itemIdentifiers: ["q1"] } },
    ]);
    const session = await handler(requestOf("POST", "/sections/sec1/sessions", { body: {} }));
    expect([session.status, await session.json()]).toEqual([
      201,
      { sessionIdentifier: "s1", nextItems: { itemIdentifiers: ["q1"], stageLength: 1 } },
    ]);
    const submitted = await handler(requestOf("POST", "/sections/sec1/sessions/s1/results", { body: RESULT_BODY }));
    expect(submitted.status).toBe(201);
    expect(await submitted.json()).toEqual({
      nextItems: { itemIdentifiers: ["q2"], stageLength: 1 },
      assessmentResult: assessmentResultToJson(result),
      sessionState: "st1",
    });
    for (const request of [requestOf("DELETE", "/sections/sec1/sessions/s1"), requestOf("DELETE", "/sections/sec1")]) {
      const ended = await handler(request);
      expect([ended.status, await ended.text()]).toEqual([204, ""]);
      expect(ended.headers.get("cache-control")).toBe("no-store");
    }
    for (const response of [created, got, session, submitted]) {
      expect(response.headers.get("content-type")).toMatch(/^application\/json/);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("ends a session by sending no stage, and an empty pool by sending no items", async () => {
    const ends: readonly CreateSessionResponse["nextItems"][] = [
      { itemIdentifiers: [], stageLength: 0 },
      { itemIdentifiers: null, stageLength: null },
      {},
    ];
    for (const nextItems of ends) {
      const { port } = stubPort({
        createSession: async () => ({ sessionIdentifier: "s1", nextItems, sessionState: "st" }),
        submitResults: async () => ({ nextItems, sessionState: "st" }),
        getSection: async () => ({ sectionData: { sectionConfiguration: "e30=" }, items: nextItems }),
      });
      const handler = handlerOf(port);
      const session = await handler(requestOf("POST", "/sections/sec1/sessions", { body: {} }));
      expect(await session.json()).toEqual({ sessionIdentifier: "s1", sessionState: "st" });
      const submitted = await handler(requestOf("POST", "/sections/sec1/sessions/s1/results", { body: RESULT_BODY }));
      expect(await submitted.json()).toEqual({ sessionState: "st" });
      const got = await handler(requestOf("GET", "/sections/sec1"));
      expect(await got.json()).toEqual({ section: { sectionConfiguration: "e30=" } });
    }
    const { port } = stubPort({ submitResults: async () => ({ nextItems: null }) });
    const submitted = await handlerOf(port)(
      requestOf("POST", "/sections/sec1/sessions/s1/results", { body: RESULT_BODY }),
    );
    expect(await submitted.json()).toEqual({});
  });

  it("reads the section, the candidate and the results into the model that the port takes", async () => {
    const { port, received } = stubPort();
    const handler = handlerOf(port);
    await handler(
      requestOf("POST", "/sections", {
        // The metadata record of the binding is checked and dropped: the model's metadata is a file.
        body: { sectionConfiguration: "e30=", qtiUsagedata: "PD94", qtiMetadata: { composite: false } },
      }),
    );
    await handler(
      requestOf("POST", "/sections/sec1/sessions", {
        body: {
          personalNeedsAndPreferences: PNP,
          demographics: DEMOGRAPHICS,
          priorData: [
            { key: "level", value: "B2", glossaryURI: "https://example.org/glossary" },
            { key: "attempts", value: "3" },
          ],
        },
      }),
    );
    await handler(
      requestOf("POST", "/sections/sec1/sessions/s1/results", { body: { ...RESULT_BODY, sessionState: "st0" } }),
    );
    expect(received).toEqual([
      ["createSection", PREFIX, { sectionConfiguration: "e30=", qtiUsagedata: "PD94" }],
      [
        "createSession",
        PREFIX,
        "sec1",
        {
          personalNeedsAndPreferences: PNP,
          demographics: DEMOGRAPHICS,
          priorData: [
            { name: "level", value: "B2" },
            { name: "attempts", value: "3" },
          ],
        },
      ],
      ["submitResults", PREFIX, "sec1", "s1", { assessmentResult: RESULT, sessionState: "st0" }],
    ]);
  });

  it("checks its port, options and request, as JavaScript or JSON passes them", async () => {
    const { port } = stubPort();
    const options = { authenticate: authorize };
    expect(() => createCatRestHandler(json("null"), options)).toThrow(
      /^The port is invalid: expected an object with the functions createSection, getSection, createSession, submitResults, endSession and endSection/,
    );
    expect(() => createCatRestHandler({ ...port, endSection: json("5") }, options)).toThrow(DataError);
    expect(() => createCatRestHandler(port, json("null"))).toThrow(
      /^The options object is invalid: expected an object/,
    );
    expect(() => createCatRestHandler(port, {} as never)).toThrow(
      /^The options object is invalid: missing the property "authenticate"/,
    );
    expect(() => createCatRestHandler(port, { authenticate: json("5") })).toThrow(
      /^The options object is invalid at authenticate: expected a function/,
    );
    for (const root of ["gateway", "/gateway/", "", json<string>("5")]) {
      expect(() => createCatRestHandler(port, { ...options, root }), String(root)).toThrow(
        /^The options object is invalid at root/,
      );
    }
    for (const maxBodyBytes of [0, -1, 1.5, json<number>("null"), json<number>('"big"')]) {
      expect(() => createCatRestHandler(port, { ...options, maxBodyBytes }), String(maxBodyBytes)).toThrow(
        /^The options object is invalid at maxBodyBytes/,
      );
    }
    expect(() => createCatRestHandler(port, { ...options, speed: 1 } as never)).toThrow(/unexpected property/);
    expect(() => createCatRestHandler(port, { ...options, root: "/ims/cat/v1p0", maxBodyBytes: 1 })).not.toThrow();
    await expect(createCatRestHandler(port, options)(json("null"))).rejects.toThrow(
      /^The request is invalid: expected a Request/,
    );
    await expect(createCatRestHandler(port, options)(json('{"url":"https://cat.example"}'))).rejects.toThrow(DataError);
  });

  it("reads or refuses arbitrary JSON as a body with a DataError, and nothing else", () => {
    const section = { sectionConfiguration: "e30=", qtiUsagedata: "PD94", qtiMetadata: { composite: false } };
    fuzzJson(readSectionBody, [section, { sectionConfiguration: "e30=" }]);
    const session = {
      personalNeedsAndPreferences: PNP,
      demographics: DEMOGRAPHICS,
      priorData: [{ key: "level", value: "B2", glossaryURI: "https://example.org/g" }],
    };
    fuzzJson(readCreateSessionBody, [session, {}]);
    fuzzJson(readResultsBody, [RESULT_BODY, { ...RESULT_BODY, sessionState: "st0" }]);
  });

  it("answers any JSON body with a status of the binding, and throws nothing", async () => {
    const { port } = stubPort();
    const handler = handlerOf(port);
    const bodies = fc.jsonValue();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("/sections", "/sections/sec1/sessions", "/sections/sec1/sessions/s1/results"),
        bodies,
        async (path, body) => {
          const response = await handler(requestOf("POST", path, { body }));
          expect([201, 400]).toContain(response.status);
          const text = await response.text();
          if (response.status === 400) expect(JSON.parse(text).imsx_codeMajor).toBe("failure");
        },
      ),
      { seed: 20_261_031, numRuns: 200 },
    );
  });
});

describe("createRestCatPort against createCatRestHandler", () => {
  const ENDPOINT = PREFIX;
  const BEARER = "tok";

  /** The engine behind the handler: it keeps what it was sent and answers like an engine with a pool of three items. */
  function fakeEngine(): { readonly port: CatPort; readonly log: unknown[][] } {
    const log: unknown[][] = [];
    const missing = (what: string): ServiceError => new ServiceError(`The ${what} is unknown.`, 404, "");
    let submissions = 0;
    const port: CatPort = {
      async createSection(prefix, data) {
        log.push(["createSection", prefix, data]);
        return { sectionIdentifier: "sec1" };
      },
      async getSection(prefix, sectionIdentifier) {
        log.push(["getSection", prefix, sectionIdentifier]);
        if (sectionIdentifier !== "sec1") throw missing("section");
        return {
          sectionData: { sectionConfiguration: "e30=", qtiUsagedata: "PD94" },
          items: { itemIdentifiers: ["q1", "q2", "q3"] },
        };
      },
      async createSession(prefix, sectionIdentifier, request) {
        log.push(["createSession", prefix, sectionIdentifier, request]);
        if (sectionIdentifier !== "sec1") throw missing("section");
        return {
          sessionIdentifier: "s1",
          nextItems: { itemIdentifiers: ["q1", "q2"], stageLength: 2 },
          sessionState: "state-0",
        };
      },
      async submitResults(prefix, sectionIdentifier, sessionIdentifier, request) {
        log.push(["submitResults", prefix, sectionIdentifier, sessionIdentifier, request]);
        if (sessionIdentifier !== "s1") throw missing("session");
        if (request.sessionState !== `state-${submissions}`)
          throw new DataError("The session state is not the last one.");
        submissions += 1;
        return submissions === 1
          ? {
              nextItems: { itemIdentifiers: ["q3"], stageLength: 1 },
              assessmentResult: resultsOf(new Map([["theta", 0.42]])),
              sessionState: "state-1",
            }
          : { nextItems: { itemIdentifiers: [], stageLength: 0 }, sessionState: "state-2" };
      },
      async endSession(prefix, sectionIdentifier, sessionIdentifier) {
        log.push(["endSession", prefix, sectionIdentifier, sessionIdentifier]);
        if (sessionIdentifier !== "s1") throw missing("session");
      },
      async endSection(prefix, sectionIdentifier) {
        log.push(["endSection", prefix, sectionIdentifier]);
        if (sectionIdentifier !== "sec1") throw missing("section");
      },
    };
    return { port, log };
  }

  /** A `fetch` that hands every request to the handler, with a token endpoint that issues the current token. */
  function wire(
    handler: (request: Request) => Promise<Response>,
    tokens: { current: string; issued: number },
  ): CatFetch {
    return async (url, request) => {
      if (url === TOKEN_URL) {
        tokens.issued += 1;
        const body = { access_token: tokens.current, token_type: "bearer", expires_in: 3600, scope: SCOPE };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      }
      const response = await handler(
        new Request(url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          signal: request.signal,
        }),
      );
      return { ok: response.ok, status: response.status, text: () => response.text() };
    };
  }

  function connect(sharePnp = false) {
    const { port: engine, log } = fakeEngine();
    const tokens = { current: BEARER, issued: 0 };
    const handler = createCatRestHandler(engine, {
      authenticate: (request) => request.headers.get("authorization") === `Bearer ${tokens.current}`,
    });
    const client = onePort({
      fetch: wire(handler, tokens),
      endpoint: ENDPOINT,
      credentials: CREDENTIALS,
      sharePnp,
    });
    return { client, log, tokens };
  }

  it("carries every one of the six requests, and the engine receives what the client sent", async () => {
    const { client, log } = connect(true);
    const sectionData = { sectionConfiguration: "e30=", qtiUsagedata: "PD94", qtiMetadata: "bWV0YQ==" };

    expect(await client.createSection(ENDPOINT, sectionData)).toEqual({ sectionIdentifier: "sec1" });
    expect(await client.getSection(ENDPOINT, "sec1")).toEqual({
      sectionData: { sectionConfiguration: "e30=", qtiUsagedata: "PD94" },
      items: { itemIdentifiers: ["q1", "q2", "q3"], stageLength: null },
    });
    const request = {
      personalNeedsAndPreferences: PNP,
      demographics: DEMOGRAPHICS,
      priorData: [
        { name: "level", value: "B2" },
        { name: "attempts", value: 3 },
      ],
    };
    const session = await client.createSession(ENDPOINT, "sec1", request);
    expect(session).toEqual({
      sessionIdentifier: "s1",
      nextItems: { itemIdentifiers: ["q1", "q2"], stageLength: 2 },
      sessionState: "state-0",
    });

    const first = await client.submitResults(ENDPOINT, "sec1", "s1", {
      assessmentResult: resultsOf(
        new Map([
          ["q1", 1],
          ["q2", 0],
        ]),
      ),
      sessionState: "state-0",
    });
    expect(first.nextItems).toEqual({ itemIdentifiers: ["q3"], stageLength: 1 });
    expect(first.sessionState).toBe("state-1");
    expect(first.assessmentResult).toEqual(resultsOf(new Map([["theta", 0.42]])));
    const last = await client.submitResults(ENDPOINT, "sec1", "s1", {
      assessmentResult: resultsOf(new Map([["q3", 1]])),
      sessionState: "state-1",
    });
    expect(isSessionEnd(last.nextItems)).toBe(true);
    expect(last.sessionState).toBe("state-2");

    await expect(client.endSession(ENDPOINT, "sec1", "s1")).resolves.toBeUndefined();
    await expect(client.endSection(ENDPOINT, "sec1")).resolves.toBeUndefined();

    expect(log).toEqual([
      // The metadata file has no field in the binding, so only the other two files reach the engine.
      ["createSection", ENDPOINT, { sectionConfiguration: "e30=", qtiUsagedata: "PD94" }],
      ["getSection", ENDPOINT, "sec1"],
      // The prior data are text in the binding: a value that is not text arrives as its JSON.
      [
        "createSession",
        ENDPOINT,
        "sec1",
        {
          personalNeedsAndPreferences: PNP,
          demographics: DEMOGRAPHICS,
          priorData: [
            { name: "level", value: "B2" },
            { name: "attempts", value: "3" },
          ],
        },
      ],
      [
        "submitResults",
        ENDPOINT,
        "sec1",
        "s1",
        {
          assessmentResult: resultsOf(
            new Map([
              ["q1", 1],
              ["q2", 0],
            ]),
          ),
          sessionState: "state-0",
        },
      ],
      [
        "submitResults",
        ENDPOINT,
        "sec1",
        "s1",
        { assessmentResult: resultsOf(new Map([["q3", 1]])), sessionState: "state-1" },
      ],
      ["endSession", ENDPOINT, "sec1", "s1"],
      ["endSection", ENDPOINT, "sec1"],
    ]);
  });

  it("keeps the personal needs and preferences from the engine unless the client shares them", async () => {
    const { client, log } = connect();
    await client.createSession(ENDPOINT, "sec1", { personalNeedsAndPreferences: PNP, demographics: DEMOGRAPHICS });
    expect(log).toEqual([["createSession", ENDPOINT, "sec1", { demographics: DEMOGRAPHICS }]]);
  });

  it("carries a session that the engine ends in the first answer", async () => {
    const { port: engine } = stubPort({
      createSession: async () => ({ sessionIdentifier: "s9", nextItems: { itemIdentifiers: [], stageLength: 0 } }),
    });
    const tokens = { current: BEARER, issued: 0 };
    const handler = createCatRestHandler(engine, { authenticate: () => true });
    const client = onePort({ fetch: wire(handler, tokens), endpoint: ENDPOINT, credentials: CREDENTIALS });
    const session = await client.createSession(ENDPOINT, "sec1", {});
    expect(session.sessionIdentifier).toBe("s9");
    expect(isSessionEnd(session.nextItems)).toBe(true);
  });

  it("carries an unknown section or session as a ServiceError of status 404, and the engine's refusal as 400", async () => {
    const { client } = connect();
    const failure = async (promise: Promise<unknown>): Promise<ServiceError> => {
      const error = await promise.then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(ServiceError);
      return error as ServiceError;
    };
    for (const call of [
      client.getSection(ENDPOINT, "nope"),
      client.createSession(ENDPOINT, "nope", {}),
      client.submitResults(ENDPOINT, "sec1", "nope", { assessmentResult: RESULT }),
      client.endSession(ENDPOINT, "sec1", "nope"),
      client.endSection(ENDPOINT, "nope"),
    ]) {
      const error = await failure(call);
      expect(error.status).toBe(404);
      expect(JSON.parse(error.body).imsx_codeMinor.imsx_codeMinorField[0].imsx_codeMinorFieldValue).toBe(
        "unknownobject",
      );
    }
    const refused = await failure(
      client.submitResults(ENDPOINT, "sec1", "s1", { assessmentResult: RESULT, sessionState: "stale" }),
    );
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body).imsx_description).toBe("The session state is not the last one.");
  });

  it("asks the token endpoint again after the handler answers 401, and repeats the request once", async () => {
    const { client, log, tokens } = connect();
    await client.getSection(ENDPOINT, "sec1");
    expect(tokens.issued).toBe(1);
    tokens.current = "tok-rotated";
    await client.getSection(ENDPOINT, "sec1");
    expect(tokens.issued).toBe(2);
    expect(log.map(([name]) => name)).toEqual(["getSection", "getSection"]);

    // A client whose token the server never accepts gets the 401 as a ServiceError after one repeat.
    const rejecting = createCatRestHandler(fakeEngine().port, { authenticate: () => false });
    const refused = onePort({ fetch: wire(rejecting, tokens), endpoint: ENDPOINT, credentials: CREDENTIALS });
    await expect(refused.getSection(ENDPOINT, "sec1")).rejects.toMatchObject({ name: "ServiceError", status: 401 });
    expect(tokens.issued).toBe(4);
  });
});

describe("the exports", () => {
  it("are the REST port and its handler", async () => {
    expect(Object.keys(await import("../src/cat-rest/index.js")).sort()).toEqual([
      "createCatRestHandler",
      "createRestCatPort",
    ]);
  });
});
