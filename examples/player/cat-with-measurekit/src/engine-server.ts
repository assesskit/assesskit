// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers and OAuth parameters are those of their specifications.

import { ServiceError } from "@assesskit/player";
import { CAT_SCOPES, type CatAuthorizer, createCatRestHandler, scopesOf } from "@assesskit/player/cat-rest";
import type { CatPort } from "@assesskit/runtime/cat";
import { DataError, ReadError, SecurityError } from "@assesskit/runtime/errors";

const SCOPES: ReadonlySet<string> = new Set(Object.values(CAT_SCOPES));

/** The path of the token endpoint, beside the endpoints of the binding. */
export const TOKEN_PATH = "/oauth2/token";

/** The seconds a token lives, which the binding recommends (section 4.2). */
const DEFAULT_TOKEN_SECONDS = 3600;

/** Options of {@link engineServer}. */
export interface EngineServerOptions {
  /** The engine behind the endpoints of the binding: `measurekitCatPort`, `measurekitPanelPort` or any `CatPort`. */
  readonly engine: CatPort;
  /** Checks the client credentials of a token request. A host compares a hash of the secret in its database. */
  readonly verifyClient: (clientId: string, clientSecret: string) => boolean | Promise<boolean>;
  /** Returns a new token that cannot be guessed, such as the base64url text of 32 bytes from `crypto.getRandomValues`. */
  readonly newToken: () => string;
  /** Returns the current time in milliseconds since the epoch. */
  readonly now: () => number;
  /**
   * The seconds a token lives.
   *
   * @defaultValue `3600`
   */
  readonly tokenSeconds?: number;
}

/** A token that the server issued: the client it is for, what it enables and until when. */
interface Grant {
  readonly clientId: string;
  readonly scopes: ReadonlySet<string>;
  readonly expiresAt: number;
}

/** What an engine throws for an object that the caller does not own, or that does not exist. */
const unknownObject = (what: string): ServiceError => new ServiceError(`The ${what} is unknown.`, 404, "");

/**
 * Refuses every request, as an unknown object. It is the port of the handler, so that a path of `authorize` that returns
 * `true` by mistake reaches no section: only the port of a client serves.
 */
const REFUSING_PORT: CatPort = {
  createSection: () => Promise.reject(unknownObject("section")),
  getSection: () => Promise.reject(unknownObject("section")),
  createSession: () => Promise.reject(unknownObject("section")),
  submitResults: () => Promise.reject(unknownObject("session")),
  endSession: () => Promise.reject(unknownObject("session")),
  endSection: () => Promise.reject(unknownObject("section")),
};

/**
 * Returns the port of one client over the shared engine: it records who created each section and answers as an unknown
 * object, which also hides that it exists, for a section that another client created. What the caller sent wrong is a
 * `DataError`, `ReadError` or `SecurityError` of the engine; it becomes the refusal that the handler answers with 400.
 */
function portOf(engine: CatPort, clientId: string, owners: Map<string, string>): CatPort {
  const owned = (sectionIdentifier: string): void => {
    if (owners.get(sectionIdentifier) !== clientId) throw unknownObject("section");
  };
  const refusing = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof DataError || error instanceof ReadError || error instanceof SecurityError) {
        throw new ServiceError(error.message, 400, "");
      }
      throw error;
    }
  };
  return {
    createSection: (prefix, data) =>
      refusing(async () => {
        const answer = await engine.createSection(prefix, data);
        owners.set(answer.sectionIdentifier, clientId);
        return answer;
      }),
    getSection: (prefix, section) =>
      refusing(async () => {
        owned(section);
        return engine.getSection(prefix, section);
      }),
    createSession: (prefix, section, request) =>
      refusing(async () => {
        owned(section);
        return engine.createSession(prefix, section, request);
      }),
    submitResults: (prefix, section, session, request) =>
      refusing(async () => {
        owned(section);
        return engine.submitResults(prefix, section, session, request);
      }),
    endSession: (prefix, section, session) =>
      refusing(async () => {
        owned(section);
        return engine.endSession(prefix, section, session);
      }),
    endSection: (prefix, section) =>
      refusing(async () => {
        owned(section);
        return engine.endSection(prefix, section);
      }),
  };
}

/** Returns the client credentials of an HTTP Basic header, decoded as RFC 6749 section 2.3.1 encodes them. */
function basicCredentials(header: string | null): readonly [string, string] | undefined {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header ?? "");
  if (match?.[1] === undefined) return undefined;
  const decode = (part: string): string => decodeURIComponent(part.replaceAll("+", " "));
  // atob refuses text that is not base64 of a whole number of bytes, such as "a", and decodeURIComponent a bad escape.
  try {
    const [id, secret, ...rest] = atob(match[1]).split(":");
    if (id === undefined || secret === undefined || rest.length > 0) return undefined;
    return [decode(id), decode(secret)];
  } catch {
    return undefined;
  }
}

/** Returns the answer of the token endpoint to a request it refuses. */
function refusal(status: number, error: string, headers: Readonly<Record<string, string>> = {}): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/**
 * Returns a whole engine server: the token endpoint of the OAuth 2.0 client credentials grant, and the six endpoints of the
 * CAT binding over the engine, as one function from a `Request` to a `Response`.
 *
 * @remarks
 * The function runs on Node.js (see `listen`), Deno, Bun and Workers. The tokens live in memory, so this server is one
 * process; a host with several processes keeps them in a database, or signs them as JWTs, behind the same `authorize`.
 * A token that has expired is forgotten when the next token is issued.
 *
 * A request without a token answers 401, one with an unknown or expired token 401 with `invalid_token`, and one whose token
 * lacks the scope of its operation 403. Each client sees only the sections it created: `authorize` answers with the port of
 * the client, which asks the engine for nothing that another client owns, and the port of the handler refuses every request.
 *
 * @param options - The engine, the check of the clients, the source of tokens and the clock.
 * @returns The handler of the server.
 */
export function engineServer(options: EngineServerOptions): (request: Request) => Promise<Response> {
  const { engine, verifyClient, newToken, now, tokenSeconds = DEFAULT_TOKEN_SECONDS } = options;
  const grants = new Map<string, Grant>();

  const issue = async (request: Request): Promise<Response> => {
    const credentials = basicCredentials(request.headers.get("authorization"));
    if (credentials === undefined || !(await verifyClient(...credentials))) {
      return refusal(401, "invalid_client", { "WWW-Authenticate": "Basic" });
    }
    const form = new URLSearchParams(await request.text());
    if (form.get("grant_type") !== "client_credentials") return refusal(400, "unsupported_grant_type");
    const scopes = (form.get("scope") ?? "").split(" ").filter((scope) => scope !== "");
    if (scopes.length === 0 || scopes.some((scope) => !SCOPES.has(scope))) return refusal(400, "invalid_scope");
    const issued = now();
    for (const [expired, grant] of grants) if (grant.expiresAt <= issued) grants.delete(expired);
    const token = newToken();
    grants.set(token, { clientId: credentials[0], scopes: new Set(scopes), expiresAt: issued + tokenSeconds * 1000 });
    return Response.json(
      { access_token: token, token_type: "bearer", expires_in: tokenSeconds, scope: scopes.join(" ") },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  };

  const owners = new Map<string, string>();
  const authorize: CatAuthorizer = (request, operation) => {
    const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    if (token === undefined) return false;
    const grant = grants.get(token);
    if (grant === undefined || grant.expiresAt <= now()) return { denied: "invalid-token" };
    if (!scopesOf(operation).some((scope) => grant.scopes.has(scope))) return { denied: "insufficient-scope" };
    return { port: portOf(engine, grant.clientId, owners) };
  };

  const cat = createCatRestHandler(REFUSING_PORT, { authorize });
  return (request) =>
    request.method === "POST" && new URL(request.url).pathname === TOKEN_PATH ? issue(request) : cat(request);
}
