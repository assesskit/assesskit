// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers, OAuth parameters and JSON fields are those of their specifications.

import { readFileSync } from "node:fs";
import { DataError as OlahDataError } from "@luthfanwakan/olah";
import type { AdaptiveSelection } from "@luthfanwakan/olah/asi";
import { type CatPort, isSessionEnd, type SectionData } from "@luthfanwakan/olah/cat";
import { single } from "@luthfanwakan/olah/values";
import { describe, expect, it, vi } from "vitest";
import {
  type CatFetch,
  type CatFetchRequest,
  deployCatSections,
  type OAuthClientCredentials,
  restCatPort,
} from "../src/cat/index.js";
import { DataError, ServiceError } from "../src/index.js";
import {
  ASI,
  adaptiveSection,
  BANK,
  base64,
  DEPLOYABLE,
  FILES,
  IDS,
  itemRefs,
  PREFIX,
  packageOf,
  resultsOf,
  SETTINGS_REF,
  selectionXml,
  testXml,
  USAGE_REF,
  usageXml,
} from "./cat-fixture.js";

/** Parses JSON text, so that a test passes input as JavaScript or JSON delivers it. */
const json = <T = never>(text: string): T => JSON.parse(text);

/** Returns the message of the error a promise rejects with, after checking that it is a DataError of tempuh. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("The promise did not reject.");
}

/** A result with one answered item, and the same result in the JSON of the binding (§5.2.8, §5.3, §6.11). */
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
  clientId: "tempuh",
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

  it("[T101] asks the token endpoint for a bearer token with the client credentials of RFC 6749 §4.4", async () => {
    const service = fakeService(() => ({
      status: 200,
      body: { sectionData: {}, items: {}, section: { sectionConfiguration: "e30=" } },
    }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await port.getSection(PREFIX, "sec1");
    const [token, get] = service.calls;
    expect(token?.url).toBe(TOKEN_URL);
    expect(token?.request.method).toBe("POST");
    // The client identifier and secret are form-encoded before they are Basic credentials (RFC 6749 §2.3.1).
    expect(token?.request.headers).toEqual({
      Authorization: `Basic ${btoa("tempuh:secret%2F%2B")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    expect(token?.request.body).toBe(`grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`);
    expect(token?.request.redirect).toBe("error");
    expect(token?.request.signal).toBeInstanceOf(AbortSignal);
    expect(get?.request.headers).toEqual({ Authorization: "Bearer tok1", Accept: "application/json" });
  });

  it("[T101] creates a section: POST /sections with the configuration and usage data of SectionDType, and returns the identifier", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    expect(await port.createSection(PREFIX, sectionData)).toEqual({ sectionIdentifier: "sec1" });
    const [call] = engineCalls(service.calls);
    expect(call?.url).toBe(`${PREFIX}/sections`);
    expect(call?.request.method).toBe("POST");
    expect(call?.request.headers["Content-Type"]).toBe("application/json");
    // SectionDType (binding §5.2.1): qtiMetadata is one QTI metadata record, and the metadata file is not sent.
    expect(bodyOf(call)).toEqual({ sectionConfiguration: "e30=", qtiUsagedata: "PD94" });
  });

  it("[T101] sends a section without usage data as the configuration alone, never a shape the binding lacks", async () => {
    const service = fakeService(() => ({ status: 201, body: { sectionIdentifier: "sec1" } }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await port.createSection(PREFIX, { sectionConfiguration: "e30=", qtiMetadata: "bWV0YQ==" });
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({ sectionConfiguration: "e30=" });
  });

  it("[T101] gets a section: GET /sections/{id}, with the binding's section and items as section data and pool", async () => {
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

  it("[T101] creates a session: POST /sections/{id}/sessions without the PNP unless sharePnp, prior data as key and value", async () => {
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

  it("[T101] reads a Create Session answer without a stage as the end of the session, and needs the identifier", async () => {
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
      /^The sessionIdentifier of the answer to Create Session/,
    );
    // The stage is read by olah, whose errors pass through tempuh unchanged.
    const badStage = answer({ sessionIdentifier: "s1", nextItems: { itemIdentifiers: [1] } });
    await expect(badStage).rejects.toThrow(OlahDataError);
    await expect(badStage).rejects.toThrow(/^An item identifier of the nextItems/);
    expect(await rejection(answer({ sessionIdentifier: "s1", sessionState: 5 }))).toMatch(
      /^The sessionState of the answer/,
    );
  });

  it("[T101] submits results: POST .../results with the assessment result of the binding and the sessionState", async () => {
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

  it("[T101] reads an answer without next items and without a state as the end of the session", async () => {
    const service = fakeService(() => ({ status: 201, body: {} }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    const answered = await port.submitResults(PREFIX, "sec1", "s1", { assessmentResult: RESULT });
    expect(answered).toEqual({});
    expect(isSessionEnd(answered.nextItems)).toBe(true);
    expect(bodyOf(engineCalls(service.calls)[0])).toEqual({ assessmentResult: RESULT_JSON });
  });

  it("[T101] ends a session and a section: DELETE, with an answer without a body", async () => {
    const service = fakeService(() => ({ status: 204 }));
    const port = restCatPort({ fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS });
    await expect(port.endSession(PREFIX, "sec1", "s1")).resolves.toBeUndefined();
    await expect(port.endSection(PREFIX, "sec1")).resolves.toBeUndefined();
    expect(engineCalls(service.calls).map(({ url, request }) => `${request.method} ${url}`)).toEqual([
      `DELETE ${PREFIX}/sections/sec1/sessions/s1`,
      `DELETE ${PREFIX}/sections/sec1`,
    ]);
  });

  it("[T101] keeps the token for the requests that follow, and asks again after a 401, then repeats the request once", async () => {
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

  it("[T101] fails with a ServiceError that carries the status and the body of the answer", async () => {
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

  it("[T101] fails with a ServiceError for a 401 after the new token, for a body that is not JSON and for a bad token answer", async () => {
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

  it("[T101] asks for a token again after a failed token request, and passes on the error of fetch", async () => {
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

  it("[T101] aborts a request that takes longer than timeoutMs", async () => {
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

  it("[T101] sends nothing to another engine than the endpoint, and nothing over http", async () => {
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
      new DataError('The option endpoint must be an absolute https URL, found "http://cat.example/ims/cat/v1p0".'),
    );
    expect(() =>
      restCatPort({
        fetch: service.fetch,
        endpoint: PREFIX,
        credentials: { ...CREDENTIALS, tokenUrl: "http://auth.example/token" },
      }),
    ).toThrow(/^The tokenUrl of the credentials must be an absolute https URL/);
  });

  it("[T101] takes the global fetch as it is", () => {
    expect(() => restCatPort({ fetch, endpoint: PREFIX, credentials: CREDENTIALS })).not.toThrow();
  });

  it("[T101] checks its options and its requests", async () => {
    const service = fakeService();
    const options = { fetch: service.fetch, endpoint: PREFIX, credentials: CREDENTIALS };
    const port = restCatPort(options);
    expect(() => restCatPort(json("null"))).toThrow(new DataError("The options must be an object, found null."));
    expect(() => restCatPort({ ...options, fetch: json("5") })).toThrow(/^The option fetch must be a function/);
    expect(() => restCatPort({ ...options, endpoint: json("5") })).toThrow(/^The option endpoint must be a string/);
    expect(() => restCatPort({ ...options, credentials: json("null") })).toThrow(
      /^The option credentials must be an object/,
    );
    for (const property of ["clientId", "clientSecret", "scope"]) {
      expect(() => restCatPort({ ...options, credentials: { ...CREDENTIALS, [property]: "" } }), property).toThrow(
        new DataError(`The ${property} of the credentials must be a non-empty string, found "".`),
      );
    }
    expect(() => restCatPort({ ...options, credentials: { ...CREDENTIALS, extra: 1 } as never })).toThrow(DataError);
    expect(() => restCatPort({ ...options, timeoutMs: 0 })).toThrow(
      new DataError("The option timeoutMs must be a positive number, found 0."),
    );
    expect(() => restCatPort({ ...options, timeoutMs: json("null") })).toThrow(DataError);
    expect(() => restCatPort({ ...options, sharePnp: json('"yes"') })).toThrow(
      new DataError('The option sharePnp must be true or false, found "yes".'),
    );
    expect(() => restCatPort({ ...options, speed: 1 } as never)).toThrow(/^The options has the properties/);
    expect(await rejection(port.createSection(PREFIX, json('{"sectionConfiguration":5}')))).toMatch(
      /^The sectionConfiguration/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json("null")))).toMatch(
      /^The request to create a session must be an object/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json('{"priorData":{}}')))).toMatch(
      /^The priorData of the request must be an array/,
    );
    expect(await rejection(port.createSession(PREFIX, "sec1", json('{"demographics":5}')))).toMatch(
      /^The demographics of the request/,
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
      /^The sessionState of the request/,
    );
    expect(await rejection(port.getSection(json("5"), "sec1"))).toMatch(/^The prefix must be a string/);
    expect(service.calls).toEqual([]);
  });

  it("[T101] accepts the qtiMetadata object of Get Section, the binding's QTI metadata record, and does not return it as section data", async () => {
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
      'The qtiMetadata of the answer to Get Section must be an object, found "bWV0YQ==".',
    );
    expect(await rejection(answer({ qtiUsagedata: "PD94" }))).toMatch(/^The sectionConfiguration of the section data/);
    expect(await rejection(answer(json("null")))).toBe(
      "The section of the answer to Get Section must be an object, found null.",
    );
  });
});

/** A CAT engine that records Create Section and Get Section, and reports the pool it was told to. */
function recordingEngine(pool: (sectionIdentifier: string) => readonly string[] = () => IDS): {
  readonly port: CatPort;
  readonly calls: string[];
} {
  const calls: string[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("Deployment makes only Create Section and Get Section.");
  };
  const port: CatPort = {
    async createSection(prefix, data) {
      calls.push(`create ${prefix} ${JSON.stringify(data)}`);
      return { sectionIdentifier: `engine-${calls.length}` };
    },
    async getSection(prefix, sectionIdentifier) {
      calls.push(`get ${prefix} ${sectionIdentifier}`);
      return { sectionData: { sectionConfiguration: "" }, items: { itemIdentifiers: [...pool(sectionIdentifier)] } };
    },
    createSession: unused,
    submitResults: unused,
    endSession: unused,
    endSection: unused,
  };
  return { port, calls };
}

describe("deployCatSections", () => {
  it("[T102] creates the section of an adaptive selection from the files it references, and checks the pool", async () => {
    const engine = recordingEngine();
    const picked: AdaptiveSelection[] = [];
    const deployedSections = await deployCatSections(DEPLOYABLE, (selection) => {
      picked.push(selection);
      return engine.port;
    });
    const data = {
      sectionConfiguration: base64(FILES["cat/settings.json"]),
      qtiUsagedata: base64(FILES["cat/usage.xml"]),
    };
    expect(engine.calls).toEqual([`create ${PREFIX} ${JSON.stringify(data)}`, `get ${PREFIX} engine-1`]);
    expect(deployedSections).toEqual(new Map([["cat", { prefix: PREFIX, sectionIdentifier: "engine-1" }]]));
    expect(picked).toHaveLength(1);
    expect(picked[0]?.adaptiveEngineRef.href).toBe(PREFIX);
  });

  it("[T102] reads the files against the document that holds the section: a section in a document of its own", async () => {
    const pkg = packageOf({
      "test.xml": testXml('<qti-assessment-section-ref identifier="cat" href="sections/section-cat.xml"/>'),
      "sections/section-cat.xml": `<qti-assessment-section xmlns="${ASI}" identifier="cat" title="Adaptive" visible="true">${selectionXml(
        '<qti-adaptive-settings-ref identifier="settings" href="settings.json"/>',
        '<qti-usagedata-ref identifier="usage" href="../cat/usage.xml"/>',
      )}${itemRefs(IDS)}</qti-assessment-section>`,
      "sections/settings.json": '{"length":2}',
      "cat/usage.xml": usageXml(BANK),
    });
    const engine = recordingEngine();
    await deployCatSections(pkg, () => engine.port);
    expect(engine.calls[0]).toBe(
      `create ${PREFIX} ${JSON.stringify({ sectionConfiguration: base64('{"length":2}'), qtiUsagedata: base64(usageXml(BANK)) })}`,
    );
  });

  it("[T102] sends an empty settings file for a selection without qti-adaptive-settings-ref, and no usage data", async () => {
    const pkg = packageOf({ "test.xml": testXml(adaptiveSection(selectionXml("", ""), IDS)) });
    const engine = recordingEngine();
    await deployCatSections(pkg, () => engine.port);
    expect(engine.calls[0]).toBe(`create ${PREFIX} ${JSON.stringify({ sectionConfiguration: "" })}`);
  });

  it("[T102] deploys each adaptive section of each test, in document order, and nothing for a package without one", async () => {
    const second = `<qti-assessment-section identifier="cat2" title="Second" visible="true">${selectionXml(SETTINGS_REF, USAGE_REF)}${itemRefs(["x1", "x2"])}</qti-assessment-section>`;
    // Create Section is the first request of the engine, Get Section the second: the second section is engine-3.
    const engine = recordingEngine((section) => (section === "engine-3" ? ["x1", "x2"] : IDS));
    const deployedSections = await deployCatSections(
      packageOf({
        "test.xml": testXml(`${adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)}${second}`),
        ...FILES,
      }),
      () => engine.port,
    );
    expect([...deployedSections.keys()]).toEqual(["cat", "cat2"]);
    expect(deployedSections.get("cat2")?.sectionIdentifier).toBe("engine-3");
    const none = recordingEngine();
    const plain = packageOf({
      "test.xml": testXml(
        `<qti-assessment-section identifier="s" title="S" visible="true">${itemRefs(["f1"])}</qti-assessment-section>`,
      ),
    });
    expect(await deployCatSections(plain, () => none.port)).toEqual(new Map());
    expect(none.calls).toEqual([]);
  });

  it("[T102] fails when the pool of the engine and the item references disagree, and names the section at the engine", async () => {
    const engine = recordingEngine(() => [...IDS.slice(1), "stranger"]);
    const message = await rejection(deployCatSections(DEPLOYABLE, () => engine.port));
    expect(message).toMatch(
      /^The engine's section "engine-1" at "https:\/\/cat\.example\/ims\/cat\/v1p0" does not agree with the adaptive section "cat": /,
    );
    expect(message).toContain('lists the item "q1", which the item pool of the CAT engine does not contain');
    expect(message).toContain('contains the item "stranger", which the adaptive section "cat" does not list');
    expect(engine.calls).toHaveLength(2);
  });

  it("[T102] fails when a referenced file is not in the package, or two tests name a section alike", async () => {
    const missing = packageOf({
      "test.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      "cat/settings.json": "{}",
    });
    expect(await rejection(deployCatSections(missing, () => recordingEngine().port))).toBe(
      'The adaptive section "cat" references the usage data "cat/usage.xml", which is not a file of the package.',
    );
    const outside = packageOf({
      "test.xml": testXml(
        adaptiveSection(
          selectionXml('<qti-adaptive-settings-ref identifier="settings" href="../outside.json"/>', ""),
          IDS,
        ),
      ),
    });
    expect(await rejection(deployCatSections(outside, () => recordingEngine().port))).toMatch(
      /which is not a file of the package\.$/,
    );
    const twice = packageOf({
      "test.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      "test2.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      ...FILES,
    });
    expect(await rejection(deployCatSections(twice, () => recordingEngine().port))).toBe(
      'Two tests of the package have the adaptive section "cat"; the sections of the engine are named by it.',
    );
  });

  it("[T102] checks its arguments", async () => {
    await expect(deployCatSections(json("null"), () => recordingEngine().port)).rejects.toThrow(
      new DataError("The package must be an object, found null."),
    );
    await expect(deployCatSections(DEPLOYABLE, json("5"))).rejects.toThrow(
      new DataError("The port must be a function of an adaptive selection, found 5."),
    );
  });
});

describe("without takar", () => {
  /** The modules of takar that the ports over takar load. */
  const TAKAR_MODULES = ["@luthfanwakan/takar", "@luthfanwakan/takar/cat", "@luthfanwakan/takar/irt"];

  it("[T101] imports the REST port and the deployment without loading a module of takar, which only cat/takar needs", async () => {
    const loaded: string[] = [];
    vi.resetModules();
    for (const module of TAKAR_MODULES) {
      vi.doMock(module, () => {
        loaded.push(module);
        return {};
      });
    }
    try {
      expect(Object.keys(await import("../src/cat/index.js")).sort()).toEqual(["deployCatSections", "restCatPort"]);
      expect(loaded).toEqual([]);
      // The mocks work: the ports over takar do load it.
      await import("../src/cat/takar/index.js").catch(() => undefined);
      expect(loaded).not.toEqual([]);
    } finally {
      for (const module of TAKAR_MODULES) vi.doUnmock(module);
      vi.resetModules();
    }
  });

  it("[T101] lists takar as an optional peer dependency and not as a dependency", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(manifest.dependencies).not.toHaveProperty("@luthfanwakan/takar");
    expect(manifest.peerDependencies).toHaveProperty("@luthfanwakan/takar");
    expect(manifest.peerDependenciesMeta["@luthfanwakan/takar"]).toEqual({ optional: true });
  });
});
