// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and JSON fields are those of their specifications.

import {
  type CatPort,
  type CreateSectionResponse,
  type CreateSessionResponse,
  type GetSectionResponse,
  isSessionEnd,
  type SectionData,
  type SubmitResultsResponse,
  writeResultsJson,
} from "@assesskit/runtime/cat";
import { DataError, ReadError, SecurityError } from "@assesskit/runtime/errors";
import type { QtiMetadata } from "@assesskit/runtime/metadata";
import { buildSingle } from "@assesskit/runtime/values";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CAT_SCOPES,
  type CatAuthorizer,
  type CatEngine,
  type CatEngines,
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
import { waitFor } from "./wait.js";

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
        name: "TokenEndpointError",
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

  it("sends the QTI metadata record of a section as the qtiMetadata object, with the lists that are empty left out", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const qtiMetadataRecord: QtiMetadata = {
      composite: false,
      interactionTypes: ["choiceInteraction", "textEntryInteraction"],
      feedbackType: "none",
      scoringModes: [],
      toolName: "Author",
    };
    await port.createSection(PREFIX, { ...sectionData, qtiMetadataRecord });
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({
      sectionConfiguration: "e30=",
      qtiUsagedata: "PD94",
      qtiMetadata: {
        composite: false,
        interactionType: ["choiceInteraction", "textEntryInteraction"],
        feedbackType: "none",
        toolName: "Author",
      },
    });
    expect(
      await rejection(port.createSection(PREFIX, { ...sectionData, qtiMetadataRecord: json('{"composite":1}') })),
    ).toMatch(/^The field composite must be a boolean/);
  });

  it("sends the glossary of a prior datum as glossaryURI", async () => {
    const service = fakeService(() => ({
      status: 201,
      body: { sessionIdentifier: "x", nextItems: { itemIdentifiers: ["i1"] } },
    }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await port.createSession(PREFIX, "sec1", {
      priorData: [
        { name: "level", value: "B2", glossaryUri: "https://example.org/glossary" },
        { name: "attempts", value: 3 },
      ],
    });
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({
      priorData: [
        { key: "level", value: "B2", glossaryURI: "https://example.org/glossary" },
        { key: "attempts", value: "3" },
      ],
    });
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
              value: buildSingle("float", 0.42),
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

  it.each(["__proto__", "prototype", "constructor"])(
    "refuses an answer of the engine with a property named %s at any depth, which its lenient schemas would drop unseen",
    async (name) => {
      const problem = `holds a property "${name}", a name that reaches the prototype.`;
      const answers = [
        `{"sessionIdentifier":"x","${name}":1}`,
        `{"sessionIdentifier":"x","nextItems":{"itemIdentifiers":["i"],"${name}":1}}`,
        `{"sessionIdentifier":"x","added":[{"deep":{"${name}":1}}]}`,
      ];
      for (const body of answers) {
        const port = onePort({
          fetch: fakeService(() => ({ status: 201, body })).fetch,
          endpoint: PREFIX,
          credentials: CREDENTIALS,
        });
        const error = await port.createSession(PREFIX, "sec1", {}).catch((caught: unknown) => caught);
        expect(error, body).toBeInstanceOf(DataError);
        expect((error as DataError).message).toBe(
          `The CAT engine at ${PREFIX}/sections/sec1/sessions answered with JSON that ${problem}`,
        );
      }
    },
  );

  it("still reads an answer that holds such a name only in a string or as a name's part, and other properties it leaves out", async () => {
    const service = fakeService(() => ({
      status: 201,
      body: '{"sessionIdentifier":"constructor","nextItems":{"itemIdentifiers":["__proto__"]},"constructors":1}',
    }));
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    expect(await port.createSession(PREFIX, "sec1", {})).toMatchObject({
      sessionIdentifier: "constructor",
      nextItems: { itemIdentifiers: ["__proto__"] },
    });
  });

  it("refuses an answer with more tokens of JSON than maxTokens before it parses it, and keeps no body in the error", async () => {
    const pool = (count: number) => ({
      section: { sectionConfiguration: "e30=" },
      items: { itemIdentifiers: Array(count).fill("i") },
    });
    // The answer is 18 tokens of braces, brackets, colons, a comma, keys and the configuration, and each identifier adds its
    // string and a comma, but for the first.
    const tokensOf = (count: number) => 17 + 2 * count;
    const service = fakeService((call) => ({ status: 200, body: pool(call.url.endsWith("big") ? 101 : 100) }));
    const port = createRestCatPort({
      fetch: service.fetch,
      engines: new Map([[PREFIX, { endpoint: PREFIX, credentials: CREDENTIALS }]]),
      maxTokens: tokensOf(100),
    });
    expect((await port.getSection(PREFIX, "fits")).items.itemIdentifiers).toHaveLength(100);
    const error = await port.getSection(PREFIX, "big").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      status: 200,
      body: "",
      message: `The CAT engine at ${PREFIX}/sections/big answered with more than ${tokensOf(100)} tokens of JSON, the limit of maxTokens.`,
    });
    const tight = createRestCatPort({
      fetch: service.fetch,
      engines: new Map([[PREFIX, { endpoint: PREFIX, credentials: CREDENTIALS }]]),
      maxTokens: 10,
    });
    await expect(tight.endSection(PREFIX, "sec1")).rejects.toThrow(
      `The token endpoint ${TOKEN_URL} answered with more than 10 tokens of JSON, the limit of maxTokens.`,
    );
    expect(() => createRestCatPort({ fetch: service.fetch, engines: new Map(), maxTokens: 1.5 })).toThrow(
      new DataError("The options object is invalid at maxTokens: expected a safe integer, found 1.5."),
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
    const refused = await badToken({ status: 400, body: "invalid_scope" });
    expect(refused).toBeInstanceOf(ServiceError);
    expect(refused).toMatchObject({ name: "TokenEndpointError", status: 400, body: "invalid_scope" });
    expect((refused as Error).message).toBe(`The token endpoint ${TOKEN_URL} answered with the status 400.`);
    expect((refused as Error).cause).toMatchObject({ name: "ServiceError", status: 400 });
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

  it("stops the request of a call whose signal aborts, and sends nothing for a signal that aborted already", async () => {
    const reason = new Error("The candidate left.");
    const service = fakeService();
    const idle = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await expect(idle.endSection(PREFIX, "sec1", { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(service.calls).toEqual([]);

    const controller = new AbortController();
    const sent: AbortSignal[] = [];
    let reached: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    const port = onePort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      // A fetch that never answers and ignores its signal: the wait of the call ends on the signal all the same.
      fetch: async (url, request) => {
        if (url === TOKEN_URL) return { ok: true, status: 200, text: async () => JSON.stringify(TOKEN.body) };
        sent.push(request.signal);
        reached();
        return new Promise(() => undefined);
      },
    });
    const pending = port.endSection(PREFIX, "sec1", { signal: controller.signal });
    await arrived;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(sent.map((signal) => [signal.aborted, signal.reason])).toEqual([[true, reason]]);
  });

  it("ends the wait of a call for a token when its signal aborts, and lets the token request go on for the other calls", async () => {
    const reason = new Error("The candidate left.");
    const tokenSignals: AbortSignal[] = [];
    const engineUrls: string[] = [];
    let issue: () => void = () => undefined;
    let asked: () => void = () => undefined;
    const tokenAsked = new Promise<void>((resolve) => (asked = resolve));
    const port = onePort({
      endpoint: PREFIX,
      credentials: CREDENTIALS,
      fetch: async (url, request) => {
        if (url === TOKEN_URL) {
          tokenSignals.push(request.signal);
          asked();
          await new Promise<void>((resolve) => (issue = resolve));
          return { ok: true, status: 200, text: async () => JSON.stringify(TOKEN.body) };
        }
        engineUrls.push(url);
        return { ok: true, status: 204, text: async () => "" };
      },
    });
    const controller = new AbortController();
    const first = port.endSection(PREFIX, "sec1", { signal: controller.signal });
    const second = port.endSection(PREFIX, "sec2");
    await tokenAsked;
    controller.abort(reason);
    await expect(first).rejects.toBe(reason);
    issue();
    await expect(second).resolves.toBeUndefined();
    expect(tokenSignals.map((signal) => signal.aborted)).toEqual([false]);
    expect(engineUrls).toEqual([`${PREFIX}/sections/sec2`]);
  });

  it("gives a function of engines the options of the call, and ends the wait for it on the signal", async () => {
    const reason = new Error("The candidate left.");
    const given: unknown[] = [];
    const port = createRestCatPort({
      fetch: fakeService().fetch,
      engines: (_reference, options) => {
        given.push(options);
        return new Promise<undefined>(() => undefined);
      },
    });
    const controller = new AbortController();
    const pending = port.getSection(PREFIX, "sec1", { signal: controller.signal });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(given).toEqual([{ signal: controller.signal }]);
  });

  it("refuses options of a call that are not an object with an AbortSignal", async () => {
    const port = onePort({ fetch: fakeService().fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await expect(port.endSection(PREFIX, "sec1", json("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
    await expect(port.endSection(PREFIX, "sec1", json('{"signal":5}'))).rejects.toThrow(
      new DataError("The option signal must be an AbortSignal, found 5."),
    );
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

  it("refuses an identifier that a URL takes as a step to another path, and sends nothing", async () => {
    const service = fakeService();
    const port = onePort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    for (const [call, step] of [
      [() => port.getSection(PREFIX, ".."), ".."],
      [() => port.endSection(PREFIX, "."), "."],
      [() => port.createSession(PREFIX, "..", {}), ".."],
      [() => port.submitResults(PREFIX, "sec1", "..", { assessmentResult: RESULT }), ".."],
      [() => port.endSession(PREFIX, "..", "s1"), ".."],
    ] as const) {
      expect(await rejection(call())).toBe(
        `The identifier "${step}" cannot be sent in the path of a URL, which takes it as a step to another path.`,
      );
    }
    expect(service.calls).toEqual([]);
    await port.endSection(PREFIX, "...");
    expect(engineCalls(service.calls).map(({ url }) => url)).toEqual([`${PREFIX}/sections/...`]);
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

  it("asks once for a new token when requests under way meet the 401 of a token that expired, and they share it", async () => {
    const service = tokenService();
    const reference = "https://a.example/ims/cat/v1p0";
    const port = createRestCatPort({
      fetch: service.send,
      engines: () => ({ endpoint: reference, credentials: CREDENTIALS }),
    });
    await port.endSection(reference, "s0");
    service.revoked.add("tok1");
    await Promise.all(["s1", "s2", "s3"].map((section) => port.endSection(reference, section)));
    expect(service.tokenRequests).toHaveLength(2);
    expect(service.engineRequests.map(({ authorization }) => authorization)).toEqual([
      "Bearer tok1",
      "Bearer tok1",
      "Bearer tok1",
      "Bearer tok1",
      "Bearer tok2",
      "Bearer tok2",
      "Bearer tok2",
    ]);
  });

  it("reads a Map of engines once, when the port is created, so that a secret that rotates needs the function", async () => {
    const reference = "https://a.example/ims/cat/v1p0";
    let secret = "first";
    const engine = (): CatEngine => ({ endpoint: reference, credentials: { ...CREDENTIALS, clientSecret: secret } });
    const basic = (password: string): string => `Basic ${btoa(`player:${password}`)}`;
    /** The credentials of the token requests when the secret changes and the engine revokes the token in between. */
    const sent = async (engines: CatEngines): Promise<(string | undefined)[]> => {
      secret = "first";
      const service = tokenService();
      const port = createRestCatPort({ fetch: service.send, engines });
      await port.endSection(reference, "s1");
      service.revoked.add("tok1");
      secret = "second";
      await port.endSection(reference, "s2");
      return service.tokenRequests.map(({ authorization }) => authorization);
    };
    expect(await sent(new Map([[reference, engine()]]))).toEqual([basic("first"), basic("first")]);
    expect(await sent(() => engine())).toEqual([basic("first"), basic("second")]);
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

  it("returns the qtiMetadata object of Get Section as the metadata record of the section data, and refuses what is not one", async () => {
    const answer = (section: unknown): Promise<unknown> =>
      onePort({
        fetch: fakeService(() => ({ status: 200, body: { items: { itemIdentifiers: ["i1"] }, section } })).fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      }).getSection(PREFIX, "sec1");
    expect(
      await answer({ sectionConfiguration: "e30=", qtiMetadata: { composite: false, scoringMode: ["human"] } }),
    ).toEqual({
      sectionData: {
        sectionConfiguration: "e30=",
        qtiMetadataRecord: { composite: false, interactionTypes: [], scoringModes: ["human"] },
      },
      items: { itemIdentifiers: ["i1"], stageLength: null },
    });
    expect(
      await rejection(answer({ sectionConfiguration: "e30=", qtiMetadata: { interactionType: ["nope"] } })),
    ).toMatch(/^The answer to Get Section is invalid at section\.qtiMetadata\.interactionType\[0\]/);
    expect(
      await rejection(answer({ sectionConfiguration: "e30=", qtiMetadata: { toolName: "x".repeat(257) } })),
    ).toMatch(/at section\.qtiMetadata\.toolName: expected at most 256 characters/);
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

  it("leaves out a property that the engine adds to a Get Section answer, at every level, and still refuses one in a request", async () => {
    const answer = (section: unknown): Promise<unknown> =>
      onePort({
        fetch: fakeService(() => ({ status: 200, body: { items: { itemIdentifiers: ["i1"] }, section, extra: 1 } }))
          .fetch,
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      }).getSection(PREFIX, "sec1");
    expect(
      await answer({
        sectionConfiguration: "e30=",
        added: true,
        qtiMetadata: {
          composite: false,
          added: true,
          portableCustomInteractionContext: { customTypeIdentifier: "urn:pci", added: true },
        },
      }),
    ).toEqual({
      sectionData: {
        sectionConfiguration: "e30=",
        qtiMetadataRecord: {
          composite: false,
          portableCustomInteractionContext: { customTypeIdentifier: "urn:pci" },
          interactionTypes: [],
          scoringModes: [],
        },
      },
      items: { itemIdentifiers: ["i1"], stageLength: null },
    });
    expect(await rejection(answer({ sectionConfiguration: "e30=", qtiMetadata: [] }))).toBe(
      "The answer to Get Section is invalid at section.qtiMetadata: expected an object, found an array.",
    );
    expect(
      await rejection(answer({ sectionConfiguration: "e30=", qtiMetadata: { portableCustomInteractionContext: [] } })),
    ).toBe(
      "The answer to Get Section is invalid at section.qtiMetadata.portableCustomInteractionContext: expected an object, found an array.",
    );
    expect(() => readSectionBody({ sectionConfiguration: "e30=", qtiMetadata: [] })).toThrow(
      new DataError("The request to Create Section is invalid at qtiMetadata: expected an object, found an array."),
    );
    expect(() =>
      readSectionBody({ sectionConfiguration: "e30=", qtiMetadata: { portableCustomInteractionContext: [] } }),
    ).toThrow(
      new DataError(
        "The request to Create Section is invalid at qtiMetadata.portableCustomInteractionContext: expected an object, found an array.",
      ),
    );
    expect(() => readSectionBody({ sectionConfiguration: "e30=", added: true })).toThrow(DataError);
    expect(() => readSectionBody({ sectionConfiguration: "e30=", qtiMetadata: { added: true } })).toThrow(DataError);
    expect(() =>
      readSectionBody({
        sectionConfiguration: "e30=",
        qtiMetadata: { portableCustomInteractionContext: { added: true } },
      }),
    ).toThrow(DataError);
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
  readonly options: unknown[];
  readonly calls: () => string[];
} {
  /** The arguments of each method before its options. */
  const ARITY: Readonly<Record<keyof CatPort, number>> = {
    createSection: 2,
    getSection: 2,
    createSession: 3,
    submitResults: 4,
    endSession: 3,
    endSection: 2,
  };
  const received: unknown[][] = [];
  const options: unknown[] = [];
  const recording =
    <Args extends unknown[], Result>(name: keyof CatPort, answer: (...args: Args) => Promise<Result>) =>
    (...args: Args): Promise<Result> => {
      received.push([name, ...args.slice(0, ARITY[name])]);
      options.push(args[ARITY[name]]);
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
    Object.assign(port, { [name]: recording(name as keyof CatPort, answer as never) });
  }
  return { port, received, options, calls: () => received.map(([name]) => String(name)) };
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

  const authorize: CatAuthorizer = (request) => request.headers.get("authorization") === "Bearer tok";

  const handlerOf = (port: CatPort, options: Partial<CatRestHandlerOptions> = {}) =>
    createCatRestHandler(port, { authorize: authorize, ...options });

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

  it.each(["__proto__", "prototype", "constructor"])(
    "answers 400 and calls no port for a body with a property named %s at any depth",
    async (name) => {
      const { port, calls } = stubPort();
      const handler = handlerOf(port);
      for (const body of [
        `{"sectionConfiguration":"e30=","${name}":1}`,
        `{"sectionConfiguration":"e30=","qtiMetadata":{"portableCustomInteractionContext":{"${name}":1}}}`,
      ]) {
        await expectFailure(
          await handler(requestOf("POST", "/sections", { body })),
          400,
          "invaliddata",
          `The body of the request holds a property "${name}", a name that reaches the prototype.`,
        );
      }
      expect(calls()).toEqual([]);
    },
  );

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

  it("answers 413 for a body with more tokens of JSON than the limit maxTokens, before it parses it", async () => {
    const { port, calls } = stubPort();
    // Five tokens: the braces, the name, the colon and the value; white space and the escaped quote count nothing.
    const exact = ' { "sectionConfiguration" : "x\\"y" } ';
    const handler = handlerOf(port, { maxTokens: 5 });
    expect((await handler(requestOf("POST", "/sections", { body: exact }))).status).toBe(201);
    const many = '{"sectionConfiguration":"x","qtiUsagedata":null}';
    await expectFailure(
      await handler(requestOf("POST", "/sections", { body: many })),
      413,
      "invaliddata",
      "The JSON of the request has more than 5 tokens, above the limit of the option maxTokens.",
    );
    // A run of a number counts once, and the count stops at the first token above the limit.
    await expectFailure(
      await handler(requestOf("POST", "/sections", { body: `[${"123,".repeat(1000)}1]` })),
      413,
      "invaliddata",
      /^The JSON of the request has more than 5 tokens/,
    );
    // Only the body within the limit reached the port.
    expect(calls()).toHaveLength(1);
    // The default is a million: a body of 2 MiB of empty objects is refused before the parse would build them.
    await expectFailure(
      await handlerOf(port)(requestOf("POST", "/sections", { body: `[${"{},".repeat(700_000)}{}]` })),
      413,
      "invaliddata",
      "The JSON of the request has more than 1000000 tokens, above the limit of the option maxTokens.",
    );
    for (const maxTokens of [0, -1, 1.5, json<number>("null"), json<number>('"big"')]) {
      expect(() => createCatRestHandler(port, { authorize, maxTokens }), String(maxTokens)).toThrow(
        /^The options object is invalid at maxTokens/,
      );
    }
  });

  it("answers 413 for a body above the limit maxBodyBytes without reading it to its end", async () => {
    const { port, calls } = stubPort();
    const exact = JSON.stringify({ sectionConfiguration: "x" });
    const handler = handlerOf(port, { maxBodyBytes: exact.length });
    const message = `The body of the request is larger than the limit maxBodyBytes of ${exact.length} bytes.`;
    await expectFailure(
      await handler(requestOf("POST", "/sections", { body: `${exact} ` })),
      413,
      "invaliddata",
      message,
    );

    // The declared length spares the read.
    const declared = requestOf("POST", "/sections", {
      body: exact,
      headers: { ...JSON_HEADERS, "content-length": String(exact.length + 1) },
    });
    await expectFailure(await handler(declared), 413, "invaliddata", message);
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
    await expectFailure(await handler(streamed), 413, "invaliddata", message);
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

  it("answers 400 with a fixed text when the port throws a ServiceError of status 400, and never shows its message", async () => {
    const { port } = stubPort({
      createSection: async () => {
        throw new ServiceError("secret detail at https://internal.example", 400, "body");
      },
    });
    const response = await handlerOf(port)(requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }));
    const body = await expectFailure(response, 400, "invaliddata", "The engine refused the request.");
    expect(JSON.stringify(body)).not.toContain("internal.example");
  });

  it("answers 500 for the errors of the data classes of the port, whose messages name the engine's own state or addresses", async () => {
    for (const error of [
      new DataError("The item bank at /srv/banks/a is invalid."),
      new ReadError("The usage data at /srv/usage.xml is not well-formed.", []),
      new SecurityError("The usage data has a DOCTYPE.", "doctype", 0),
      new DataError(
        'The prefix "https://gateway.example/ims/cat/v1p0" is not the engine "https://internal-engine.corp.example/ims/cat/v1p0".',
      ),
    ]) {
      const { port } = stubPort({
        createSection: async () => {
          throw error;
        },
      });
      const response = await handlerOf(port)(
        requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }),
      );
      const body = await expectFailure(
        response,
        500,
        "internal_server_error",
        "The engine failed to answer the request.",
      );
      expect(JSON.stringify(body)).not.toMatch(/srv|internal-engine|gateway\.example|DOCTYPE/);
    }
  });

  it("answers 500 for a 404 of the port on Create Section, which names no object", async () => {
    const unknown = async (): Promise<never> => {
      throw new ServiceError("The CAT engine answered POST with the status 404.", 404, "");
    };
    const { port } = stubPort({ createSection: unknown });
    await expectFailure(
      await handlerOf(port)(requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } })),
      500,
      "internal_server_error",
    );
  });

  it("passes the status of an engine that is busy, 429 and 503, with the code minor server_busy", async () => {
    for (const status of [429, 503]) {
      const { port } = stubPort({
        getSection: async () => {
          throw new ServiceError("The engine is busy.", status, "");
        },
      });
      const faults: unknown[] = [];
      const handler = handlerOf(port, { onError: (error) => faults.push(error) });
      await expectFailure(
        await handler(requestOf("GET", "/sections/sec1")),
        status,
        "server_busy",
        "The engine is busy; try again later.",
      );
      expect(faults).toEqual([]);
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
    // A ServiceError of another status than 400, 404, 429 and 503 is a failure of the engine, even a 401 or a 403 from the
    // engine behind a gateway, which the gateway's own credentials caused.
    for (const status of [401, 403, 409, 502]) {
      const upstream = async (): Promise<never> => {
        throw new ServiceError("The token endpoint refused.", status, "");
      };
      const { port: gateway } = stubPort({ getSection: upstream });
      await expectFailure(await handlerOf(gateway)(requestOf("GET", "/sections/sec1")), 500, "internal_server_error");
    }

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
    for (const decide of [() => false, async () => false]) {
      const handler = handlerOf(port, {
        authorize: (request, operation) => {
          seen.push([request.method, operation]);
          return decide();
        },
      });
      const request = requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" }, headers: JSON_HEADERS });
      const response = await handler(request);
      await expectFailure(response, 401, "unauthorisedrequest", "The request is not authorized.");
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(request.bodyUsed).toBe(false);
    }
    expect(calls()).toEqual([]);
    expect(seen).toHaveLength(2);
  });

  it("pulls nothing from the stream of the body of a request that authorize refuses", async () => {
    const { port, calls } = stubPort();
    for (const decision of [false, { denied: "invalid-token" }, { denied: "insufficient-scope" }] as const) {
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(source) {
            pulls += 1;
            source.close();
          },
        },
        { highWaterMark: 0 },
      );
      const request = new Request(`${PREFIX}/sections`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: stream,
        duplex: "half",
      } as RequestInit);
      const response = await handlerOf(port, { authorize: () => decision })(request);
      expect(response.status, JSON.stringify(decision)).toBeGreaterThanOrEqual(401);
      await flush();
      expect(pulls, JSON.stringify(decision)).toBe(0);
    }
    expect(calls()).toEqual([]);
  });

  it("answers 401 with error invalid_token when the request carries a token that is not valid", async () => {
    const { port, calls } = stubPort();
    const handler = handlerOf(port, { authorize: () => ({ denied: "invalid-token" }) });
    const request = requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } });
    const response = await handler(request);
    await expectFailure(response, 401, "unauthorisedrequest", "The token is not valid.");
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(request.bodyUsed).toBe(false);
    expect(calls()).toEqual([]);
  });

  it("answers 403 with the code minor forbidden and the scopes of the operation when the token lacks the scope", async () => {
    const { port, calls } = stubPort();
    const handler = handlerOf(port, { authorize: () => ({ denied: "insufficient-scope" }) });
    const requests: [Request, string][] = [
      [requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }), CAT_SCOPES.configure],
      [requestOf("GET", "/sections/sec1"), CAT_SCOPES.configure],
      [requestOf("POST", "/sections/sec1/sessions", { body: {} }), CAT_SCOPES.deliver],
      [requestOf("DELETE", "/sections/sec1/sessions/s1"), CAT_SCOPES.deliver],
    ];
    for (const [request, scope] of requests) {
      const response = await handler(request);
      await expectFailure(response, 403, "forbidden", "The token does not carry the scope of this operation.");
      expect(response.headers.get("www-authenticate")).toBe(
        `Bearer error="insufficient_scope", scope="${CAT_SCOPES.api} ${scope}"`,
      );
      expect(request.bodyUsed).toBe(false);
    }
    const custom = handlerOf(port, { authorize: () => ({ denied: "insufficient-scope", scopes: ["read", "write"] }) });
    const response = await custom(requestOf("GET", "/sections/sec1"));
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="insufficient_scope", scope="read write"');
    expect(calls()).toEqual([]);
  });

  it("answers 500 for a result of authorize that is not a decision, and calls no port", async () => {
    const { port, calls } = stubPort();
    const faults: unknown[] = [];
    for (const result of [
      json("null"),
      json('"yes"'),
      json("1"),
      json("{}"),
      json('{"port":{}}'),
      json('{"denied":"nope"}'),
      json('{"denied":"insufficient-scope","scopes":[]}'),
      json('{"denied":"insufficient-scope","scopes":["a b"]}'),
      json('{"denied":"insufficient-scope","scopes":["a\\"b"]}'),
      json('{"denied":"invalid-token","scopes":["a"]}'),
    ]) {
      const handler = handlerOf(port, { authorize: () => result as never, onError: (error) => faults.push(error) });
      await expectFailure(
        await handler(requestOf("GET", "/sections/sec1")),
        500,
        "internal_server_error",
        "The request could not be authorized.",
      );
    }
    expect(faults).toHaveLength(10);
    expect(faults.every((error) => error instanceof DataError)).toBe(true);
    expect(calls()).toEqual([]);
  });

  it("answers 500 and calls no port when the authorization itself fails", async () => {
    const { port, calls } = stubPort();
    for (const decide of [
      () => {
        throw new Error("identity provider down");
      },
      async () => {
        throw new Error("identity provider down");
      },
    ]) {
      const response = await handlerOf(port, { authorize: decide })(requestOf("GET", "/sections/sec1"));
      const body = await expectFailure(response, 500, "internal_server_error", "The request could not be authorized.");
      expect(JSON.stringify(body)).not.toContain("identity provider");
    }
    expect(calls()).toEqual([]);
  });

  it("answers 500 when authorize reads the body, which the handler then cannot read", async () => {
    const { port, calls } = stubPort();
    const faults: unknown[] = [];
    const handler = handlerOf(port, {
      authorize: async (request) => {
        await request.text();
        return true;
      },
      onError: (error) => faults.push(error),
    });
    const response = await handler(requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }));
    await expectFailure(response, 500, "internal_server_error", "The engine failed to answer the request.");
    expect(faults).toHaveLength(1);
    expect(calls()).toEqual([]);
  });

  it("serves a request with the port that authorize returns, and a true with the port of the handler", async () => {
    const own = stubPort();
    const callers = stubPort();
    const handler = handlerOf(own.port, {
      authorize: (request) => (request.headers.get("x-caller") === null ? true : { port: callers.port }),
    });
    await handler(requestOf("GET", "/sections/sec1"));
    await handler(requestOf("GET", "/sections/sec2", { headers: { ...JSON_HEADERS, "x-caller": "a" } }));
    expect(own.calls()).toEqual(["getSection"]);
    expect(callers.received).toEqual([["getSection", PREFIX, "sec2"]]);
  });

  it("keeps the clients of one root apart with the port of the caller, and a true reaches no section when the port of the handler refuses all", async () => {
    // The pattern of the guide: a shared engine, an owner check in the port of each caller, and a port of the handler that
    // refuses everything, so that a path that returns true by mistake reaches no section.
    const owners = new Map([["sec1", "a"]]);
    const unknown = (): ServiceError => new ServiceError("Not the owner.", 404, "");
    const shared = stubPort();
    const scoped = (client: string): CatPort => ({
      ...shared.port,
      async getSection(prefix, sectionIdentifier) {
        if (owners.get(sectionIdentifier) !== client) throw unknown();
        return shared.port.getSection(prefix, sectionIdentifier);
      },
      async endSection(prefix, sectionIdentifier) {
        if (owners.get(sectionIdentifier) !== client) throw unknown();
        return shared.port.endSection(prefix, sectionIdentifier);
      },
    });
    const refuseAll: CatPort = {
      createSection: async () => Promise.reject(unknown()),
      getSection: async () => Promise.reject(unknown()),
      createSession: async () => Promise.reject(unknown()),
      submitResults: async () => Promise.reject(unknown()),
      endSession: async () => Promise.reject(unknown()),
      endSection: async () => Promise.reject(unknown()),
    };
    const handler = createCatRestHandler(refuseAll, {
      authorize: (request) => {
        const client = request.headers.get("x-client");
        return client === "a" || client === "b" ? { port: scoped(client) } : true;
      },
    });
    const as = (client: string | undefined, method: string, path: string): Promise<Response> =>
      handler(
        requestOf(method, path, {
          headers: client === undefined ? JSON_HEADERS : { ...JSON_HEADERS, "x-client": client },
        }),
      );
    expect((await as("a", "GET", "/sections/sec1")).status).toBe(200);
    await expectFailure(await as("b", "GET", "/sections/sec1"), 404, "unknownobject", "Unknown Object");
    await expectFailure(await as("b", "DELETE", "/sections/sec1"), 404, "unknownobject", "Unknown Object");
    await expectFailure(await as(undefined, "GET", "/sections/sec1"), 404, "unknownobject", "Unknown Object");
    expect(shared.calls()).toEqual(["getSection"]);
  });

  it("tells the authentication the operation of each of the six requests", async () => {
    const { port } = stubPort();
    const operations: CatOperation[] = [];
    const handler = handlerOf(port, {
      authorize: (_request, operation) => {
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

  it("gives the port the signal of the request with each of the six calls, so that the port can stop its own work", async () => {
    const { port, options } = stubPort();
    const handler = handlerOf(port);
    const requests = [
      requestOf("POST", "/sections", { body: { sectionConfiguration: "e30=" } }),
      requestOf("GET", "/sections/sec1"),
      requestOf("POST", "/sections/sec1/sessions", { body: {} }),
      requestOf("POST", "/sections/sec1/sessions/s1/results", { body: RESULT_BODY }),
      requestOf("DELETE", "/sections/sec1/sessions/s1"),
      requestOf("DELETE", "/sections/sec1"),
    ];
    for (const request of requests) await handler(request);
    expect(options).toEqual(requests.map(({ signal }) => ({ signal })));
    expect(options.map((each) => (each as { readonly signal: AbortSignal }).signal)).toEqual(
      requests.map(({ signal }) => signal),
    );
  });

  it("tells onError the error, the request and the operation behind every answer of 500, from the four origins", async () => {
    const reports: [unknown, Request, CatOperation][] = [];
    const onError = (error: unknown, request: Request, operation: CatOperation): void => {
      reports.push([error, request, operation]);
    };
    const boom = new Error("The engine broke.");

    // The authorization step.
    const refused = handlerOf(stubPort().port, {
      authorize: () => {
        throw boom;
      },
      onError,
    });
    const first = requestOf("GET", "/sections/sec1");
    await refused(first);
    // The body: a stream that fails.
    const stream = new ReadableStream<Uint8Array>({
      pull(source) {
        source.error(boom);
      },
    });
    const second = new Request(`${PREFIX}/sections`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: stream,
      duplex: "half",
    } as RequestInit);
    await handlerOf(stubPort().port, { onError })(second);
    // The port.
    const third = requestOf("POST", "/sections/sec1/sessions", { body: {} });
    await handlerOf(
      stubPort({
        createSession: async () => {
          throw boom;
        },
      }).port,
      { onError },
    )(third);
    // The encoding of the answer of the port.
    const fourth = requestOf("GET", "/sections/sec1");
    await handlerOf(
      stubPort({ getSection: async () => json<GetSectionResponse>('{"sectionData":5,"items":{}}') }).port,
      {
        onError,
      },
    )(fourth);

    expect(reports.map(([error]) => error === boom)).toEqual([true, true, true, false]);
    expect(reports[3]?.[0]).toBeInstanceOf(DataError);
    expect(reports.map(([, request]) => request)).toEqual([first, second, third, fourth]);
    expect(reports.map(([, , operation]) => operation)).toEqual([
      "getSection",
      "createSection",
      "createSession",
      "getSection",
    ]);
  });

  it("tells onError nothing about a refusal of the caller", async () => {
    const faults: unknown[] = [];
    const onError = (error: unknown): void => void faults.push(error);
    const { port } = stubPort({
      getSection: async () => {
        throw new ServiceError("Unknown.", 404, "");
      },
      endSection: async () => {
        throw new ServiceError("Refused.", 400, "");
      },
      endSession: async () => {
        throw new ServiceError("Busy.", 503, "");
      },
    });
    const handler = handlerOf(port, { onError });
    await handler(requestOf("GET", "/sections/sec1"));
    await handler(requestOf("DELETE", "/sections/sec1"));
    await handler(requestOf("DELETE", "/sections/sec1/sessions/s1"));
    await handler(requestOf("POST", "/sections", { body: "not json" }));
    await handler(requestOf("POST", "/sections", { body: {} }));
    await handler(requestOf("GET", "/nowhere"));
    await handler(requestOf("PUT", "/sections"));
    await handler(requestOf("GET", "/sections/%E0%A4%A"));
    await handlerOf(port, { authorize: () => false, onError })(requestOf("GET", "/sections/sec1"));
    await handlerOf(port, { authorize: () => ({ denied: "invalid-token" }), onError })(
      requestOf("GET", "/sections/sec1"),
    );
    await handlerOf(port, { authorize: () => ({ denied: "insufficient-scope" }), onError })(
      requestOf("GET", "/sections/sec1"),
    );
    expect(faults).toEqual([]);
  });

  it("leaves the answer of 500 as it is, and leaves no unhandled rejection, when onError throws or rejects", async () => {
    const unhandled: unknown[] = [];
    const watch = (reason: unknown): void => void unhandled.push(reason);
    process.on("unhandledRejection", watch);
    try {
      const { port } = stubPort({
        getSection: async () => {
          throw new Error("The engine broke.");
        },
      });
      for (const onError of [
        (): void => {
          throw new Error("The log is full.");
        },
        (): void => void Promise.reject(new Error("The log is gone.")),
        (async () => {
          throw new Error("The log is gone.");
        }) as () => void,
      ]) {
        await expectFailure(
          await handlerOf(port, { onError })(requestOf("GET", "/sections/sec1")),
          500,
          "internal_server_error",
        );
      }
      await flush();
      await flush();
      expect(unhandled.length).toBe(1);
    } finally {
      process.off("unhandledRejection", watch);
    }
  });

  it("gives the port the prefix of the option, without trailing slashes, in place of the URL of the request", async () => {
    const { port, received } = stubPort();
    const handler = handlerOf(port, { prefix: "https://engine.example/ims/cat/v1p0///" });
    await handler(requestOf("GET", "/sections/sec1"));
    expect(received).toEqual([["getSection", "https://engine.example/ims/cat/v1p0", "sec1"]]);
  });

  it("serves at the root that the option names, and at an empty root, and nowhere else", async () => {
    const { port, received } = stubPort();
    const bare = handlerOf(port, { root: "" });
    expect((await bare(new Request("https://cat.example/sections/sec1", { headers: JSON_HEADERS }))).status).toBe(200);
    expect(received).toEqual([["getSection", "https://cat.example", "sec1"]]);
    await expectFailure(await bare(requestOf("GET", "/sections/sec1")), 404, "unknownobject");
    const nested = handlerOf(port, { root: "/gateway/cat" });
    expect(
      (await nested(new Request("https://cat.example/gateway/cat/sections/sec1", { headers: JSON_HEADERS }))).status,
    ).toBe(200);
    await expectFailure(await nested(requestOf("GET", "/sections/sec1")), 404, "unknownobject");
  });

  describe("an aborted request", () => {
    const reason = new Error("the client left");

    it("rejects with the reason and calls neither authentication nor port when it is aborted before the call", async () => {
      const { port, calls } = stubPort();
      let authentications = 0;
      const handler = handlerOf(port, {
        authorize: () => {
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
        authorize: () => new Promise<boolean>((resolve) => (release = resolve)),
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

    it("rejects with the reason when it is aborted during authorization, and then reads no body", async () => {
      const { port, calls } = stubPort();
      const controller = new AbortController();
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull() {
            pulls += 1;
          },
        },
        { highWaterMark: 0 },
      );
      let release: (decision: boolean) => void = () => undefined;
      const handler = handlerOf(port, { authorize: () => new Promise<boolean>((resolve) => (release = resolve)) });
      const request = new Request(`${PREFIX}/sections`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: stream,
        signal: controller.signal,
        duplex: "half",
      } as RequestInit);
      const pending = handler(request);
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      release(true);
      await flush();
      expect(pulls).toBe(0);
      expect(calls()).toEqual([]);
    });

    it("cancels the stream of the body when it is aborted after the first chunk, and does not call the port", async () => {
      const { port, calls } = stubPort();
      const controller = new AbortController();
      const cancelled: unknown[] = [];
      let sent = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(source) {
          if (sent) return;
          sent = true;
          source.enqueue(new TextEncoder().encode('{"sectionConfiguration":'));
        },
        cancel(why) {
          cancelled.push(why);
        },
      });
      const faults: unknown[] = [];
      const request = new Request(`${PREFIX}/sections`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: stream,
        signal: controller.signal,
        duplex: "half",
      } as RequestInit);
      const pending = handlerOf(port, { onError: (error) => faults.push(error) })(request);
      await waitFor(() => expect(sent).toBe(true));
      await flush();
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      await waitFor(() => expect(cancelled).toEqual([reason]));
      expect(calls()).toEqual([]);
      expect(faults).toEqual([]);
    });

    it("does not tell onError about a port that fails after the request was aborted", async () => {
      const controller = new AbortController();
      let fail: (error: Error) => void = () => undefined;
      let reached: () => void = () => undefined;
      const called = new Promise<void>((resolve) => (reached = resolve));
      const { port } = stubPort({
        createSession: () =>
          new Promise<CreateSessionResponse>((_resolve, reject) => {
            fail = reject;
            reached();
          }),
      });
      const faults: unknown[] = [];
      const pending = handlerOf(port, { onError: (error) => faults.push(error) })(
        requestOf("POST", "/sections/sec1/sessions", { body: {}, signal: controller.signal }),
      );
      await called;
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      fail(new Error("The engine broke after the client left."));
      await flush();
      expect(faults).toEqual([]);
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
      assessmentResult: writeResultsJson(result),
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
      [
        "createSection",
        PREFIX,
        {
          sectionConfiguration: "e30=",
          qtiUsagedata: "PD94",
          qtiMetadataRecord: { composite: false, interactionTypes: [], scoringModes: [] },
        },
      ],
      [
        "createSession",
        PREFIX,
        "sec1",
        {
          personalNeedsAndPreferences: PNP,
          demographics: DEMOGRAPHICS,
          priorData: [
            { name: "level", value: "B2", glossaryUri: "https://example.org/glossary" },
            { name: "attempts", value: "3" },
          ],
        },
      ],
      ["submitResults", PREFIX, "sec1", "s1", { assessmentResult: RESULT, sessionState: "st0" }],
    ]);
  });

  it("checks its port, options and request, as JavaScript or JSON passes them", async () => {
    const { port } = stubPort();
    const options = { authorize: authorize };
    expect(() => createCatRestHandler(json("null"), options)).toThrow(
      /^The port is invalid: expected an object with the functions createSection, getSection, createSession, submitResults, endSession and endSection/,
    );
    expect(() => createCatRestHandler({ ...port, endSection: json("5") }, options)).toThrow(DataError);
    expect(() => createCatRestHandler(port, json("null"))).toThrow(
      /^The options object is invalid: expected an object/,
    );
    expect(() => createCatRestHandler(port, {} as never)).toThrow(
      /^The options object is invalid: missing the property "authorize"/,
    );
    expect(() => createCatRestHandler(port, { authorize: json("5") })).toThrow(
      /^The options object is invalid at authorize: expected a function/,
    );
    for (const root of ["gateway", "/gateway/", json<string>("5")]) {
      expect(() => createCatRestHandler(port, { ...options, root }), String(root)).toThrow(
        /^The options object is invalid at root/,
      );
    }
    for (const prefix of ["http://cat.example/ims/cat/v1p0", "cat.example", "", json<string>("5")]) {
      expect(() => createCatRestHandler(port, { ...options, prefix }), String(prefix)).toThrow(
        /^The options object is invalid at prefix/,
      );
    }
    expect(() => createCatRestHandler(port, { ...options, onError: json("5") })).toThrow(
      /^The options object is invalid at onError: expected a function/,
    );
    for (const maxBodyBytes of [0, -1, 1.5, json<number>("null"), json<number>('"big"')]) {
      expect(() => createCatRestHandler(port, { ...options, maxBodyBytes }), String(maxBodyBytes)).toThrow(
        /^The options object is invalid at maxBodyBytes/,
      );
    }
    expect(() => createCatRestHandler(port, { ...options, speed: 1 } as never)).toThrow(/unexpected property/);
    expect(() => createCatRestHandler(port, { ...options, root: "/ims/cat/v1p0", maxBodyBytes: 1 })).not.toThrow();
    expect(() => createCatRestHandler(port, { ...options, root: "" })).not.toThrow();
    expect(() => createCatRestHandler(port, { ...options, prefix: "https://cat.example/ims/cat/v1p0/" })).not.toThrow();
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
          throw new ServiceError("The session state is not the last one.", 400, "");
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

  function connect(sharePnp = false, replacement?: CatPort) {
    const { port: engine, log } = replacement === undefined ? fakeEngine() : { port: replacement, log: [] };
    const tokens = { current: BEARER, issued: 0 };
    const handler = createCatRestHandler(engine, {
      authorize: (request) => request.headers.get("authorization") === `Bearer ${tokens.current}`,
    });
    const client = onePort({
      fetch: wire(handler, tokens),
      endpoint: ENDPOINT,
      credentials: CREDENTIALS,
      sharePnp,
    });
    return { client, log, tokens };
  }

  it("carries the metadata record of a section and the glossary of a prior datum both ways", async () => {
    const qtiMetadataRecord: QtiMetadata = {
      itemTemplate: true,
      interactionTypes: ["choiceInteraction"],
      portableCustomInteractionContext: { customTypeIdentifier: "graph", interactionKind: "plot" },
      feedbackType: "adaptive",
      scoringModes: ["human", "responseprocessing"],
      toolVendor: "Vendor",
    };
    const seen: unknown[] = [];
    const base = fakeEngine().port;
    const engine: CatPort = {
      ...base,
      async createSection(_prefix, data) {
        seen.push(data);
        return { sectionIdentifier: "sec1" };
      },
      async getSection() {
        return {
          sectionData: { sectionConfiguration: "e30=", qtiMetadataRecord },
          items: { itemIdentifiers: ["q1"] },
        };
      },
      async createSession(_prefix, _section, request) {
        seen.push(request);
        return { sessionIdentifier: "s1", nextItems: { itemIdentifiers: ["q1"], stageLength: 1 } };
      },
    };
    const { client } = connect(false, engine);
    await client.createSection(ENDPOINT, { sectionConfiguration: "e30=", qtiMetadataRecord });
    expect(await client.getSection(ENDPOINT, "sec1")).toEqual({
      sectionData: { sectionConfiguration: "e30=", qtiMetadataRecord },
      items: { itemIdentifiers: ["q1"], stageLength: null },
    });
    await client.createSession(ENDPOINT, "sec1", {
      priorData: [{ name: "level", value: "B2", glossaryUri: "https://example.org/glossary" }],
    });
    expect(seen).toEqual([
      { sectionConfiguration: "e30=", qtiMetadataRecord },
      { priorData: [{ name: "level", value: "B2", glossaryUri: "https://example.org/glossary" }] },
    ]);
  });

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
    const handler = createCatRestHandler(engine, { authorize: () => true });
    const client = onePort({ fetch: wire(handler, tokens), endpoint: ENDPOINT, credentials: CREDENTIALS });
    const session = await client.createSession(ENDPOINT, "sec1", {});
    expect(session.sessionIdentifier).toBe("s9");
    expect(isSessionEnd(session.nextItems)).toBe(true);
  });

  it("carries an unknown section or session as a ServiceError of status 404, and the engine's refusal as 400 with a fixed text", async () => {
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
    expect(JSON.parse(refused.body).imsx_description).toBe("The engine refused the request.");
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
    const rejecting = createCatRestHandler(fakeEngine().port, { authorize: () => false });
    const refused = onePort({ fetch: wire(rejecting, tokens), endpoint: ENDPOINT, credentials: CREDENTIALS });
    await expect(refused.getSection(ENDPOINT, "sec1")).rejects.toMatchObject({ name: "ServiceError", status: 401 });
    expect(tokens.issued).toBe(4);
  });

  it("does not ask for a new token when the handler answers 403, and reads it as a failure", async () => {
    const tokens = { current: BEARER, issued: 0 };
    const forbidding = createCatRestHandler(fakeEngine().port, { authorize: () => ({ denied: "insufficient-scope" }) });
    const lacking = onePort({ fetch: wire(forbidding, tokens), endpoint: ENDPOINT, credentials: CREDENTIALS });
    const error = await lacking.getSection(ENDPOINT, "sec1").then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ name: "ServiceError", status: 403 });
    expect(
      JSON.parse((error as ServiceError).body).imsx_codeMinor.imsx_codeMinorField[0].imsx_codeMinorFieldValue,
    ).toBe("forbidden");
    expect(tokens.issued).toBe(1);
  });

  describe("through a gateway", () => {
    const PUBLIC = "https://engine.example/ims/cat/v1p0";
    const INTERNAL = "https://internal-engine.corp.example/ims/cat/v1p0";
    const GATEWAY = "https://gateway.example/ims/cat/v1p0";
    const authorized: CatAuthorizer = (request) => request.headers.get("authorization") === `Bearer ${BEARER}`;

    /** A platform, a gateway over the client of an engine, and the engine; the gateway sets `prefix` unless a test says not. */
    function chain(prefix: string | undefined) {
      const tokens = { current: BEARER, issued: 0 };
      const { port: engine, log } = fakeEngine();
      const behind = createCatRestHandler(engine, { authorize: authorized });
      const upstream = createRestCatPort({
        fetch: wire(behind, tokens),
        engines: new Map([[PUBLIC, { endpoint: INTERNAL, credentials: CREDENTIALS }]]),
      });
      const faults: unknown[] = [];
      const gateway = createCatRestHandler(upstream, {
        authorize: authorized,
        ...(prefix === undefined ? {} : { prefix }),
        onError: (error) => faults.push(error),
      });
      const platform = createRestCatPort({
        fetch: wire(gateway, tokens),
        engines: new Map([[PUBLIC, { endpoint: GATEWAY, credentials: CREDENTIALS }]]),
      });
      return { platform, log, faults };
    }

    it("reaches an engine that the package names by its public reference, with the prefix set at the gateway", async () => {
      const { platform, log } = chain(PUBLIC);
      expect(await platform.createSection(PUBLIC, { sectionConfiguration: "e30=" })).toEqual({
        sectionIdentifier: "sec1",
      });
      expect((await platform.getSection(PUBLIC, "sec1")).items.itemIdentifiers).toEqual(["q1", "q2", "q3"]);
      expect(log.map(([name, prefix]) => [name, prefix])).toEqual([
        ["createSection", INTERNAL],
        ["getSection", INTERNAL],
      ]);
    });

    it.each([400, 404, 429, 503])(
      "answers 500 and tells onError when the token endpoint of the gateway answers %i, and never blames the caller",
      async (status) => {
        const tokens = { current: BEARER, issued: 0 };
        const { port: engine, log } = fakeEngine();
        const behind = wire(createCatRestHandler(engine, { authorize: authorized }), tokens);
        const upstream = createRestCatPort({
          fetch: async (url, request) =>
            url === TOKEN_URL
              ? { ok: false, status, text: async () => '{"error":"invalid_scope"}' }
              : behind(url, request),
          engines: new Map([[PUBLIC, { endpoint: INTERNAL, credentials: CREDENTIALS }]]),
        });
        const faults: unknown[] = [];
        const gateway = createCatRestHandler(upstream, {
          authorize: authorized,
          prefix: PUBLIC,
          onError: (error) => faults.push(error),
        });
        const platform = createRestCatPort({
          fetch: wire(gateway, tokens),
          engines: new Map([[PUBLIC, { endpoint: GATEWAY, credentials: CREDENTIALS }]]),
        });
        const calls = [
          () => platform.getSection(PUBLIC, "sec1"),
          () => platform.createSession(PUBLIC, "sec1", {}),
          () => platform.endSection(PUBLIC, "sec1"),
        ];
        for (const call of calls) {
          const error = await call().then(
            () => undefined,
            (reason: unknown) => reason,
          );
          expect(error).toMatchObject({ name: "ServiceError", status: 500 });
          expect((error as ServiceError).body).not.toMatch(/auth\.example|invalid_scope/);
        }
        expect(log).toEqual([]);
        expect(faults).toHaveLength(calls.length);
        for (const fault of faults) {
          expect(fault).toMatchObject({ name: "TokenEndpointError", status });
          expect((fault as Error).message).toBe(`The token endpoint ${TOKEN_URL} answered with the status ${status}.`);
        }
      },
    );

    it("answers 500 without an address when the gateway does not set the prefix, and tells onError why", async () => {
      const { platform, log, faults } = chain(undefined);
      const error = await platform.getSection(PUBLIC, "sec1").then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toMatchObject({ name: "ServiceError", status: 500 });
      expect((error as ServiceError).body).not.toMatch(/internal-engine|gateway/);
      expect(log).toEqual([]);
      expect(faults).toHaveLength(1);
      expect((faults[0] as Error).message).toMatch(/is not an engine that the host configured/);
    });
  });
});

describe("the exports", () => {
  it("are the REST port and its handler", async () => {
    expect(Object.keys(await import("../src/cat-rest/index.js")).sort()).toEqual([
      "CAT_SCOPES",
      "createCatRestHandler",
      "createRestCatPort",
      "listScopes",
    ]);
  });
});
