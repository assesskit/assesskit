// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers and OAuth parameters are those of their specifications.

import { type CatAuthenticate, type CatOperation, createCatRestHandler } from "@assesskit/player/cat-rest";
import type { CatPort } from "@assesskit/runtime/cat";

/** The scope that enables every endpoint of the binding. */
const SCOPE_API = "https://purl.imsglobal.org/cat/v1p0/scope/api";
/** The scope that enables the management of sections. */
const SCOPE_CONFIGURE = "https://purl.imsglobal.org/cat/v1p0/scope/configure";
/** The scope that enables the management of sessions. */
const SCOPE_DELIVER = "https://purl.imsglobal.org/cat/v1p0/scope/deliver";

const SCOPES: ReadonlySet<string> = new Set([SCOPE_API, SCOPE_CONFIGURE, SCOPE_DELIVER]);

/** The scope, besides `api`, that enables each operation (the binding, section 4.3). */
const OPERATION_SCOPES: Readonly<Record<CatOperation, string>> = {
  createSection: SCOPE_CONFIGURE,
  getSection: SCOPE_CONFIGURE,
  endSection: SCOPE_CONFIGURE,
  createSession: SCOPE_DELIVER,
  submitResults: SCOPE_DELIVER,
  endSession: SCOPE_DELIVER,
};

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

/** A token that the server issued: what it enables and until when. */
interface Grant {
  readonly scopes: ReadonlySet<string>;
  readonly expiresAt: number;
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
 * process; a host with several processes keeps them in a database, or signs them as JWTs, behind the same `authenticate`.
 * A token that has expired is forgotten when the next token is issued.
 * A request whose token lacks the scope of its operation answers 401, because the binding defines no 403 for its endpoints.
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
    grants.set(token, { scopes: new Set(scopes), expiresAt: issued + tokenSeconds * 1000 });
    return Response.json(
      { access_token: token, token_type: "bearer", expires_in: tokenSeconds, scope: scopes.join(" ") },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  };

  const authenticate: CatAuthenticate = (request, operation) => {
    const token = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const grant = token === undefined ? undefined : grants.get(token);
    if (grant === undefined || grant.expiresAt <= now()) return false;
    return grant.scopes.has(SCOPE_API) || grant.scopes.has(OPERATION_SCOPES[operation]);
  };

  const cat = createCatRestHandler(engine, { authenticate });
  return (request) =>
    request.method === "POST" && new URL(request.url).pathname === TOKEN_PATH ? issue(request) : cat(request);
}
