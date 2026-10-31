// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and JSON fields are those of their specifications.

import { isSessionEnd, type SectionData } from "@assesskit/runtime/cat";
import { DataError } from "@assesskit/runtime/errors";
import { single } from "@assesskit/runtime/values";
import { describe, expect, it } from "vitest";
import {
  type CatFetch,
  type CatFetchRequest,
  type OAuthClientCredentials,
  type RestCatPortOptions,
  restCatPort,
} from "../src/cat-rest/index.js";
import { readSectionData } from "../src/cat-rest/internal.js";
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

describe("restCatPort", () => {
  const sectionData: SectionData = { sectionConfiguration: "e30=", qtiUsagedata: "PD94", qtiMetadata: "bWV0YQ==" };

  it("asks the token endpoint for a bearer token with the client credentials grant", async () => {
    const service = fakeService(() => ({
      status: 200,
      body: { sectionData: {}, items: {}, section: { sectionConfiguration: "e30=" } },
    }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
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
      const atToken = restCatPort({ fetch: redirect(TOKEN_URL, answer), endpoint: PREFIX, credentials: CREDENTIALS });
      await expect(atToken.getSection(PREFIX, "sec1")).rejects.toMatchObject({
        name: "ServiceError",
        status: answer.status,
        message: expect.stringContaining(`The token endpoint ${TOKEN_URL} answered with a redirect`),
      });
      const atEngine = restCatPort({
        fetch: redirect(`${PREFIX}/sections/sec1`, answer),
        endpoint: PREFIX,
        credentials: CREDENTIALS,
      });
      await expect(atEngine.getSection(PREFIX, "sec1")).rejects.toThrow(ServiceError);
    }
  });

  it("creates a section: POST /sections with the configuration and usage data of SectionDType, and returns the identifier", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
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
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
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
    const port = restCatPort({ fetch: service.fetch, endpoint: `${PREFIX}/`, credentials: CREDENTIALS });
    expect(await port.getSection(PREFIX, "sec 1")).toEqual({
      sectionData: { sectionConfiguration: "e30=", qtiUsagedata: "PD94" },
      items: { itemIdentifiers: ["i1", "i2"], stageLength: null },
    });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections/sec%201`);
    expect(call?.request.method).toBe("GET");
    expect(call?.request.body).toBeUndefined();
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
      const port = restCatPort({
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
      restCatPort({
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
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
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
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const answered = await port.submitResults(PREFIX, "sec1", "s1", { assessmentResult: RESULT });
    expect(answered).toEqual({});
    expect(isSessionEnd(answered.nextItems)).toBe(true);
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({ assessmentResult: RESULT_JSON });
  });

  it("ends a session and a section: DELETE, with an answer without a body", async () => {
    const service = fakeService(() => ({ status: 204 }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
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
    const port = restCatPort({
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
    const port = restCatPort({
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
    const denied = restCatPort({
      fetch: fakeService(() => ({ status: 401, body: {} })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    await expect(denied.endSection(PREFIX, "sec1")).rejects.toMatchObject({ status: 401 });
    const html = restCatPort({
      fetch: fakeService(() => ({ status: 200, body: "<html>" })).fetch,
      endpoint: PREFIX,
      credentials: CREDENTIALS,
    });
    await expect(html.getSection(PREFIX, "sec1")).rejects.toThrow(/answered with a body that is not JSON/);

    const badToken = async (reply: Reply): Promise<unknown> => {
      const calls: Call[] = [];
      const port = restCatPort({
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
    const port = restCatPort({
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
    const port = restCatPort({
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

  it("sends nothing to another engine than the endpoint, and nothing over http", async () => {
    const service = fakeService();
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const message = `The prefix "https://evil.example/ims/cat/v1p0" is not the engine "${PREFIX}" that this port serves; the port sends nothing to another engine.`;
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
    expect(() =>
      restCatPort({ fetch: service.fetch, endpoint: "http://cat.example/ims/cat/v1p0", credentials: CREDENTIALS }),
    ).toThrow(
      new DataError(
        'The options object is invalid at endpoint: expected an absolute https URL, found "http://cat.example/ims/cat/v1p0".',
      ),
    );
    expect(() =>
      restCatPort({
        fetch: service.fetch,
        endpoint: PREFIX,
        credentials: { ...CREDENTIALS, tokenUrl: "http://auth.example/token" },
      }),
    ).toThrow(/^The options object is invalid at credentials\.tokenUrl: expected an absolute https URL/);
  });

  it("takes the global fetch as it is", () => {
    expect(() => restCatPort({ fetch, endpoint: PREFIX, credentials: CREDENTIALS })).not.toThrow();
  });

  it("checks its options and its requests", async () => {
    const service = fakeService();
    const options = { fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS };
    const port = restCatPort(options);
    expect(() => restCatPort(json("null"))).toThrow(
      new DataError("The options object is invalid: expected an object, found null."),
    );
    expect(() => restCatPort({ ...options, fetch: json("5") })).toThrow(
      /^The options object is invalid at fetch: expected a function/,
    );
    expect(() => restCatPort({ ...options, endpoint: json("5") })).toThrow(
      /^The options object is invalid at endpoint: expected a string/,
    );
    expect(() => restCatPort({ ...options, credentials: json("null") })).toThrow(
      /^The options object is invalid at credentials: expected an object/,
    );
    for (const property of ["clientId", "clientSecret", "scope"]) {
      expect(() => restCatPort({ ...options, credentials: { ...CREDENTIALS, [property]: "" } }), property).toThrow(
        new DataError(
          `The options object is invalid at credentials.${property}: expected a length of at least 1, found 0.`,
        ),
      );
    }
    expect(() => restCatPort({ ...options, credentials: { ...CREDENTIALS, extra: 1 } as never })).toThrow(DataError);
    expect(() => restCatPort({ ...options, timeoutMs: 0 })).toThrow(
      new DataError("The options object is invalid at timeoutMs: expected a positive number, found 0."),
    );
    expect(() => restCatPort({ ...options, timeoutMs: json("null") })).toThrow(DataError);
    expect(() => restCatPort({ ...options, sharePnp: json('"yes"') })).toThrow(
      new DataError('The options object is invalid at sharePnp: expected true or false, found "yes".'),
    );
    expect(() => restCatPort({ ...options, speed: 1 } as never)).toThrow(
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
      restCatPort({
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
    fuzzJson((options) => restCatPort(options as RestCatPortOptions));
  });

  it("reads or refuses arbitrary JSON as section data with a DataError, and nothing else", () => {
    fuzzJson(readSectionData, [sectionData, { sectionConfiguration: "e30=" }]);
  });
});

describe("the exports", () => {
  it("are the REST port", async () => {
    expect(Object.keys(await import("../src/cat-rest/index.js")).sort()).toEqual(["restCatPort"]);
  });
});
