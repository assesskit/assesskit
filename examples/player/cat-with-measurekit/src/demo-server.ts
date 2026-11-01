import type { OAuthClientCredentials } from "@assesskit/player/cat-rest";
import { engineServer } from "./engine-server.ts";
import { measurekitCatPort } from "./measurekit-cat-port.ts";
import { memoryStore } from "./memory-store.ts";

/** The one client of the demonstration server. A host keeps its clients, with hashed secrets, in its own database. */
export const DEMO_CREDENTIALS: OAuthClientCredentials = {
  tokenUrl: "https://cat.example/oauth2/token",
  clientId: "demo",
  clientSecret: "demo-secret",
  scope: "https://purl.imsglobal.org/cat/v1p0/scope/api",
};

/** The base64url text of 32 random bytes, which cannot be guessed. */
function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/**
 * Returns the demonstration server: the engine of measurekit over a section store in memory, behind the token endpoint and
 * the endpoints of the binding, for the client {@link DEMO_CREDENTIALS}.
 */
export function demoServer(): (request: Request) => Promise<Response> {
  const engine = measurekitCatPort({
    sections: memoryStore(),
    seeds: () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0,
  });
  return engineServer({
    engine,
    verifyClient: (id, secret) => id === DEMO_CREDENTIALS.clientId && secret === DEMO_CREDENTIALS.clientSecret,
    newToken,
    now: () => Date.now(),
  });
}
