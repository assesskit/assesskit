import { describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { readClock } from "./clock.js";
import { checkHttpRequest, type HttpRequest, type HttpResponse, readForm, readQuery } from "./http.js";
import { checkLoginOptions, findRegistration, type LtiLoginOptions } from "./options.js";
import { putDataPage } from "./pages.js";
import { randomToken } from "./random.js";
import type { PlatformRegistration } from "./registration.js";
import type { LoginRecord } from "./store.js";

// Security Framework section 7.1.2 recommends 600 seconds for the lifetime of an authorization code. A login is the same kind of
// short-lived credential: the platform answers a request with `prompt=none` at once.
const LOGIN_TTL_SECONDS = 600;

/** Returns the name of the cookie that holds the `state` of a login on the cookie path. */
export function stateCookieName(state: string): string {
  // The prefix __Host- makes the browser accept the cookie only with Secure and Path=/, from the host that set it and not
  // from a sibling subdomain (RFC 6265bis section 4.1.3.2). A name per state allows several launches in one browser.
  return `__Host-lti_state_${state}`;
}

/** The parameters of a third-party initiated login (Security Framework section 5.1.1.1, LTI 1.3 Core section 4.1). */
interface LoginInitiation {
  readonly iss: string;
  readonly loginHint: string;
  readonly ltiMessageHint?: string;
  readonly clientId?: string;
  readonly storageTarget?: string;
}

/** Reads a parameter of the initiation that must be present, a non-empty string. */
function requiredParameter(parameters: ReadonlyMap<string, string>, name: string): string {
  const value = parameters.get(name);
  if (value === undefined || value === "") {
    throw new DataError(`The login initiation must have the parameter ${describe(name)}, found ${describe(value)}.`);
  }
  return value;
}

/** Reads a parameter of the initiation that may be absent; when present it is a non-empty string. */
function optionalParameter(parameters: ReadonlyMap<string, string>, name: string): string | undefined {
  return parameters.has(name) ? requiredParameter(parameters, name) : undefined;
}

/** Reads the parameters of the initiation from the query of a GET or the form of a POST: the platform may use either. */
function readInitiation(request: HttpRequest): LoginInitiation {
  if (request.method !== "GET" && request.method !== "POST") {
    throw new DataError(`A login initiation must be a GET or a POST request, found ${describe(request.method)}.`);
  }
  const parameters = request.method === "GET" ? readQuery(request) : readForm(request);
  requiredParameter(parameters, "target_link_uri");
  return {
    iss: requiredParameter(parameters, "iss"),
    loginHint: requiredParameter(parameters, "login_hint"),
    ltiMessageHint: optionalParameter(parameters, "lti_message_hint"),
    clientId: optionalParameter(parameters, "client_id"),
    storageTarget: optionalParameter(parameters, "lti_storage_target"),
  };
}

/** Builds the authentication request of Security Framework section 5.1.1.2. */
function authenticationRequest(
  registration: PlatformRegistration,
  initiation: LoginInitiation,
  state: string,
  nonce: string,
): string {
  const url = new URL(registration.authenticationUrl);
  const parameters: readonly (readonly [string, string])[] = [
    ["scope", "openid"],
    ["response_type", "id_token"],
    ["client_id", registration.clientId],
    ["redirect_uri", registration.redirectUri],
    ["login_hint", initiation.loginHint],
    ["state", state],
    ["response_mode", "form_post"],
    ["nonce", nonce],
    ["prompt", "none"],
  ];
  for (const [name, value] of parameters) url.searchParams.append(name, value);
  // LTI 1.3 Core section 4.1.1: the tool returns lti_message_hint unaltered.
  if (initiation.ltiMessageHint !== undefined) url.searchParams.append("lti_message_hint", initiation.ltiMessageHint);
  return url.href;
}

/**
 * Starts a launch: answers the platform's third-party initiated login with the authentication request (Security
 * Framework sections 5.1.1.1 and 5.1.1.2).
 *
 * @remarks
 * It creates a `state` and a single-use `nonce` and saves them in `options.store`. Where the `state` also lives depends
 * on the initiation:
 * - With `lti_storage_target`, the answer is a page that stores `state` and `nonce` in the platform's browser storage
 *   (`lti.put_data` of LTI Client Side OIDC 0.1) and then redirects to the authentication request. This works when the
 *   browser blocks third-party cookies, as it does in an iframe.
 * - Without it, the answer is a redirect to the authentication request that sets a `__Host-lti_state_<state>` cookie
 *   with `SameSite=None; Secure; HttpOnly`.
 *
 * @param request - The initiation: a GET with the parameters in the query, or a POST with them in a form.
 * @param options - The registrations and the store of the tool.
 * @returns A redirect or the page. The host sends it.
 * @throws `DataError` when the request is not an initiation: a required parameter is missing or repeated.
 * @throws `LtiError` (`platform-unknown`) when the tool has no registration for the platform.
 */
export async function ltiLogin(request: HttpRequest, options: LtiLoginOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  checkLoginOptions(options);
  const initiation = readInitiation(request);
  const registration = await findRegistration(options, initiation.iss, initiation.clientId);
  const state = randomToken();
  const nonce = randomToken();
  const record: LoginRecord = {
    nonce,
    issuer: registration.issuer,
    clientId: registration.clientId,
    storageTarget: initiation.storageTarget,
    expiresAt: readClock(options.clock) + LOGIN_TTL_SECONDS * 1000,
  };
  await options.store.put(state, record);
  const location = authenticationRequest(registration, initiation, state, nonce);
  if (initiation.storageTarget !== undefined) {
    return putDataPage({ frame: initiation.storageTarget, state, nonce, authenticationRequest: location });
  }
  return {
    status: 302,
    headers: {
      location,
      "set-cookie": `${stateCookieName(state)}=${state}; Max-Age=${LOGIN_TTL_SECONDS}; Path=/; Secure; HttpOnly; SameSite=None`,
      "cache-control": "no-store",
    },
    body: "",
  };
}
