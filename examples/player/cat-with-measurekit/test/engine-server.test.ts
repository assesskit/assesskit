// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers and OAuth parameters are those of their specifications.

import { ServiceError } from "@assesskit/player";
import { type OAuthClientCredentials, restCatPort } from "@assesskit/player/cat-rest";
import { describe, expect, it } from "vitest";
import { administer, answersEasyItems, fetchFrom } from "../scenario.ts";
import { DEMO_CREDENTIALS, demoServer } from "../src/demo-server.ts";
import { engineServer, TOKEN_PATH } from "../src/engine-server.ts";
import { listen } from "../src/listen.ts";
import { measurekitCatPort } from "../src/measurekit-cat-port.ts";
import { memoryStore } from "../src/memory-store.ts";
import { base64, PREFIX, sectionDataOf } from "./fixture.ts";

const API = "https://purl.imsglobal.org/cat/v1p0/scope/api";
const CONFIGURE = "https://purl.imsglobal.org/cat/v1p0/scope/configure";
const DELIVER = "https://purl.imsglobal.org/cat/v1p0/scope/deliver";
const ORIGIN = "https://cat.example";
const BANK = [{ id: "q1", b: 0 }];
const SECTION = sectionDataOf({ length: 1 }, BANK);

/** A server whose clock a test moves and whose tokens count up, so that a run is the same every time. */
function fixture() {
  const clock = { now: 0 };
  let issued = 0;
  const server = engineServer({
    engine: measurekitCatPort({ sections: memoryStore(), seeds: () => 7 }),
    verifyClient: async (id, secret) => id === "tool" && secret === "secret/+",
    newToken: () => {
      issued += 1;
      return `token-${issued}`;
    },
    now: () => clock.now,
  });
  return { server, clock };
}

const basic = (id: string, secret: string): string =>
  `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret).replaceAll("%20", "+")}`)}`;

/** Asks the token endpoint of a server for a token with the scopes, as client "tool". */
async function tokenFor(
  server: (request: Request) => Promise<Response>,
  scope: string,
  authorization = basic("tool", "secret/+"),
  grantType = "client_credentials",
): Promise<Response> {
  return server(
    new Request(`${ORIGIN}${TOKEN_PATH}`, {
      method: "POST",
      headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: grantType, scope }).toString(),
    }),
  );
}

const call = (
  server: (request: Request) => Promise<Response>,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> =>
  server(
    new Request(`${PREFIX}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

describe("the token endpoint", () => {
  it("refuses a client whose credentials are wrong or missing", async () => {
    const { server } = fixture();
    for (const authorization of [basic("tool", "wrong"), basic("other", "secret/+"), "Basic !!!", "Bearer x", ""]) {
      const response = await tokenFor(server, API, authorization);
      expect([response.status, await response.json()], authorization).toEqual([401, { error: "invalid_client" }]);
      expect(response.headers.get("www-authenticate")).toBe("Basic");
    }
  });

  it("refuses another grant than client credentials and a scope that the server does not know", async () => {
    const { server } = fixture();
    const grant = await tokenFor(server, API, basic("tool", "secret/+"), "password");
    expect([grant.status, await grant.json()]).toEqual([400, { error: "unsupported_grant_type" }]);
    for (const scope of ["", "admin", `${API} admin`]) {
      const response = await tokenFor(server, scope);
      expect([response.status, await response.json()], scope).toEqual([400, { error: "invalid_scope" }]);
    }
  });

  it("issues a bearer token that expires in an hour, and no cache keeps it", async () => {
    const { server } = fixture();
    const response = await tokenFor(server, `${CONFIGURE} ${DELIVER}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      access_token: "token-1",
      token_type: "bearer",
      expires_in: 3600,
      scope: `${CONFIGURE} ${DELIVER}`,
    });
  });
});

describe("the endpoints of the binding", () => {
  it("answers 401 to a request without a token, with an unknown token, and with an expired one", async () => {
    const { server, clock } = fixture();
    const missing = await server(new Request(`${PREFIX}/sections/x`));
    expect(missing.status).toBe(401);
    expect((await call(server, "token-9", "GET", "/sections/x")).status).toBe(401);
    await tokenFor(server, API);
    expect((await call(server, "token-1", "GET", "/sections/x")).status).toBe(404);
    clock.now = 3600 * 1000;
    expect((await call(server, "token-1", "GET", "/sections/x")).status).toBe(401);
  });

  it("lets a token do the operations of its scope, and only those, unless it has the api scope", async () => {
    const { server } = fixture();
    await tokenFor(server, CONFIGURE);
    await tokenFor(server, DELIVER);
    await tokenFor(server, API);
    const body = { sectionConfiguration: base64(JSON.stringify({ length: 1 })), qtiUsagedata: SECTION.qtiUsagedata };
    expect((await call(server, "token-2", "POST", "/sections", body)).status).toBe(401);
    const created = await call(server, "token-1", "POST", "/sections", body);
    expect(created.status).toBe(201);
    const { sectionIdentifier } = (await created.json()) as { sectionIdentifier: string };
    expect((await call(server, "token-1", "POST", `/sections/${sectionIdentifier}/sessions`, {})).status).toBe(401);
    const session = await call(server, "token-2", "POST", `/sections/${sectionIdentifier}/sessions`, {});
    expect(session.status).toBe(201);
    expect((await call(server, "token-2", "DELETE", `/sections/${sectionIdentifier}`)).status).toBe(401);
    expect((await call(server, "token-3", "DELETE", `/sections/${sectionIdentifier}`)).status).toBe(204);
  });

  it("answers 404 to a section that the engine does not have", async () => {
    const { server } = fixture();
    await tokenFor(server, API);
    const response = await call(server, "token-1", "POST", "/sections/nope/sessions", {});
    expect(response.status).toBe(404);
    const body = (await response.json()) as { imsx_description: string };
    expect(body.imsx_description).toBe("Unknown Object");
  });
});

describe("the client of the player against the engine server", () => {
  it("runs the scenario over the binding and presents the items that the engine alone presents", async () => {
    const alone = measurekitCatPort({ sections: memoryStore(), seeds: () => 42 });
    const client = restCatPort({ fetch: fetchFrom(demoServer()), endpoint: PREFIX, credentials: DEMO_CREDENTIALS });
    // The demonstration server draws its seeds from the system, so the order of equal items may differ; the set may not.
    const served = await administer(client, answersEasyItems);
    expect(served).toHaveLength(3);
    expect(new Set(served).size).toBe(3);
    expect(await administer(alone, answersEasyItems)).toEqual(["q3", "q5", "q4"]);
  });

  it("presents the same items as the engine alone when the seeds are the same", async () => {
    const seeds = () => 42;
    const alone = measurekitCatPort({ sections: memoryStore(), seeds });
    const server = engineServer({
      engine: measurekitCatPort({ sections: memoryStore(), seeds }),
      verifyClient: (id, secret) => id === DEMO_CREDENTIALS.clientId && secret === DEMO_CREDENTIALS.clientSecret,
      newToken: () => "token",
      now: () => 0,
    });
    const client = restCatPort({ fetch: fetchFrom(server), endpoint: PREFIX, credentials: DEMO_CREDENTIALS });
    expect(await administer(client, answersEasyItems)).toEqual(await administer(alone, answersEasyItems));
  });

  it("reports an unknown section as a ServiceError of status 404, and a client with a wrong secret as 401", async () => {
    const client = restCatPort({ fetch: fetchFrom(demoServer()), endpoint: PREFIX, credentials: DEMO_CREDENTIALS });
    await expect(client.getSection(PREFIX, "nope")).rejects.toMatchObject({ name: "ServiceError", status: 404 });
    const wrong: OAuthClientCredentials = { ...DEMO_CREDENTIALS, clientSecret: "wrong" };
    const refused = restCatPort({ fetch: fetchFrom(demoServer()), endpoint: PREFIX, credentials: wrong });
    await expect(refused.getSection(PREFIX, "x")).rejects.toBeInstanceOf(ServiceError);
    await expect(refused.getSection(PREFIX, "x")).rejects.toMatchObject({ status: 401 });
  });
});

describe("listen", () => {
  it("serves the engine server over a socket, request bodies included", async () => {
    const { server } = fixture();
    const listening = await listen(server, 0, "127.0.0.1");
    try {
      const token = await fetch(`${listening.url}${TOKEN_PATH}`, {
        method: "POST",
        headers: { authorization: basic("tool", "secret/+"), "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: API }),
      });
      expect(token.status).toBe(200);
      const { access_token: accessToken } = (await token.json()) as { access_token: string };
      const authorization = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
      const created = await fetch(`${listening.url}/ims/cat/v1p0/sections`, {
        method: "POST",
        headers: authorization,
        body: JSON.stringify({
          sectionConfiguration: SECTION.sectionConfiguration,
          qtiUsagedata: SECTION.qtiUsagedata,
        }),
      });
      expect(created.status).toBe(201);
      const { sectionIdentifier } = (await created.json()) as { sectionIdentifier: string };
      const got = await fetch(`${listening.url}/ims/cat/v1p0/sections/${sectionIdentifier}`, {
        headers: authorization,
      });
      expect(got.status).toBe(200);
      const ended = await fetch(`${listening.url}/ims/cat/v1p0/sections/${sectionIdentifier}`, {
        method: "DELETE",
        headers: authorization,
      });
      expect([ended.status, await ended.text()]).toEqual([204, ""]);
      const refused = await fetch(`${listening.url}/ims/cat/v1p0/sections/${sectionIdentifier}`);
      expect(refused.status).toBe(401);
    } finally {
      await listening.close();
    }
  });
});
