import { readClock } from "../clock.js";
import { type HttpRequest, type HttpResponse, jsonResponse } from "../http.js";
import type { PlatformOptions } from "./options.js";
import { type Access, openAccess } from "./tokens.js";

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/iu;

/** Builds the answer of a service to a request with a missing or unusable token (RFC 6750 §3). */
function refusal(status: 401 | 403, challenge: string, error: string): HttpResponse {
  return jsonResponse(status, { error }, { "www-authenticate": challenge });
}

/**
 * Reads the access token of a service request and checks it: the `Authorization` header holds a bearer token that this
 * platform issued, it has not expired, and it has one of the scopes the request needs.
 *
 * @param needed - The scopes that serve the request; one is enough.
 * @returns The access, or the answer to send when the token fails.
 */
export async function readAccess(
  request: HttpRequest,
  options: PlatformOptions,
  needed: readonly string[],
): Promise<Access | HttpResponse> {
  const header = request.headers.authorization;
  if (header === undefined) return refusal(401, "Bearer", "invalid_token");
  const token = BEARER.exec(header)?.[1];
  const access = token === undefined ? undefined : await openAccess(token, options.config.hintKey);
  if (access === undefined || Math.floor(readClock(options.clock) / 1000) >= access.exp) {
    return refusal(401, 'Bearer error="invalid_token"', "invalid_token");
  }
  if (!access.scopes.some((scope) => needed.includes(scope))) {
    return refusal(403, `Bearer error="insufficient_scope", scope="${needed.join(" ")}"`, "insufficient_scope");
  }
  return access;
}
