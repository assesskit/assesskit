import { describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import { AccessError, LtiError } from "../../errors.js";
import { checkCaller } from "../../protocol/index.js";
import { checkHttpRequest, type HttpRequest, type HttpResponse, readClock, readForm, readQuery } from "../internal.js";
import { issueIdToken } from "./id-token.js";
import { checkAuthorizeOptions, checkRequestOrigin, findClient, type PlatformAuthorizeOptions } from "./options.js";
import { autoPostPage } from "./page.js";
import { type Hint, openHint, openLoginHint } from "./tokens.js";

/** Reads the parameters of the authentication request: the tool may send it as a GET or as a form POST (OpenID Connect Core section 3.1.2.1). */
function readParameters(request: HttpRequest): ReadonlyMap<string, string> {
  if (request.method === "GET") return readQuery(request);
  if (request.method === "POST") return readForm(request);
  throw new DataError(`An authentication request must be a GET or a POST request, found ${describe(request.method)}.`);
}

/** Checks the parameters that have one value (Security Framework section 5.1.1.2). */
function checkFixed(parameters: ReadonlyMap<string, string>): void {
  const fixed: readonly (readonly [string, string, string])[] = [
    ["scope", "openid", "scope-invalid"],
    ["response_type", "id_token", "response-type-invalid"],
    ["response_mode", "form_post", "response-mode-invalid"],
    ["prompt", "none", "prompt-invalid"],
  ];
  for (const [name, expected, reason] of fixed) {
    if (parameters.get(name) !== expected) {
      throw new LtiError(
        `The parameter ${describe(name)} of the authentication request must be ${describe(expected)}, found ${describe(parameters.get(name))}.`,
        reason,
      );
    }
  }
}

/** Reads a parameter that the tool must send and that carries no meaning of its own, such as `state` and `nonce`. */
function requiredValue(parameters: ReadonlyMap<string, string>, name: string, reason: string): string {
  const value = parameters.get(name);
  if (value === undefined || value === "") {
    throw new LtiError(`The authentication request must have the parameter ${describe(name)}.`, reason);
  }
  return value;
}

/**
 * Opens the hint of the request and checks that it binds this request: it is valid, not expired, for this client, and
 * names the principal that `login_hint` names, and the caller whose cookie arrived when there is one.
 */
async function bindHint(
  parameters: ReadonlyMap<string, string>,
  clientId: string,
  options: PlatformAuthorizeOptions,
): Promise<Hint> {
  const token = parameters.get("lti_message_hint");
  if (token === undefined || token === "") {
    throw new AccessError("The authentication request must carry the lti_message_hint of the login.", "hint-missing");
  }
  const hint = await openHint(token, options.config.hintKey);
  if (Math.floor(readClock(options.clock) / 1000) >= hint.exp) {
    throw new AccessError("The lti_message_hint has expired.", "hint-expired");
  }
  if (hint.client !== clientId) {
    throw new AccessError("The lti_message_hint was issued for another tool.", "client-mismatch");
  }
  const loginHint = parameters.get("login_hint");
  if (loginHint === undefined || (await openLoginHint(loginHint, options.config.hintKey)) !== hint.principal) {
    throw new AccessError("The login_hint does not name the principal of the lti_message_hint.", "principal-mismatch");
  }
  const { caller } = options;
  if (caller !== undefined) {
    checkCaller(caller);
    if (caller.session !== hint.session || caller.principal !== hint.principal) {
      throw new AccessError(
        "The caller is not the session and the principal of the lti_message_hint.",
        "caller-mismatch",
      );
    }
  }
  return hint;
}

/**
 * Answers the tool's authentication request (Security Framework sections 5.1.1.2 and 5.1.1.3) with the page that posts the
 * `id_token` to its redirect URI.
 *
 * @remarks
 * The request is bound to the `lti_message_hint` that `ltiPlatformLogin` made, and not to a cookie: it is a navigation,
 * often a cross-site POST inside the cross-site frame of the tool, where browsers may withhold the host's session cookie
 * . The checks, in order: the request is for the platform's origin; `scope=openid`, `response_type=id_token`,
 * `response_mode=form_post` and `prompt=none`; `client_id` is a tool of the platform and `redirect_uri` one of its redirect
 * URIs; `nonce` and `state` are present; the hint is valid, unexpired, for this tool, names the principal of `login_hint`
 * and, when `options.caller` is given, the caller; and `options.once` has not seen the hint before, so that it is single-use.
 *
 * @param request - The authentication request, as a GET or a form POST.
 * @param options - The platform and its tools, and the single-use check of hints.
 * @returns The page, which the host sends.
 * @throws `AccessError` (`wrong-origin`, `hint-missing`, `hint-invalid`, `hint-expired`, `client-mismatch`,
 * `principal-mismatch`, `caller-mismatch`, `hint-used`) when the request is not bound to a launch that the platform made.
 * @throws `LtiError` (`scope-invalid`, `response-type-invalid`, `response-mode-invalid`, `prompt-invalid`,
 * `client-unknown`, `redirect-uri-mismatch`, `nonce-missing`, `state-missing`) when the request breaks the protocol.
 * @throws `DataError` when the request is not a GET or a POST of a query or a form, or an option has the wrong type.
 */
export async function ltiPlatformAuthorize(
  request: HttpRequest,
  options: PlatformAuthorizeOptions,
): Promise<HttpResponse> {
  checkHttpRequest(request);
  checkAuthorizeOptions(options);
  checkRequestOrigin(request, options.config);
  const parameters = readParameters(request);
  checkFixed(parameters);
  const clientId = requiredValue(parameters, "client_id", "client-unknown");
  const registration = await findClient(options.client, clientId);
  const redirectUri = parameters.get("redirect_uri");
  if (redirectUri === undefined || !registration.redirectUris.includes(redirectUri)) {
    throw new LtiError(
      `The redirect_uri must be one of the redirect URIs of the tool, found ${describe(redirectUri)}.`,
      "redirect-uri-mismatch",
    );
  }
  const nonce = requiredValue(parameters, "nonce", "nonce-missing");
  const state = requiredValue(parameters, "state", "state-missing");
  const hint = await bindHint(parameters, clientId, options);
  if (!(await options.once(`hint:${hint.jti}`, hint.exp * 1000))) {
    throw new AccessError("The lti_message_hint has been used.", "hint-used");
  }
  const idToken = await issueIdToken(hint, registration, nonce, options);
  return autoPostPage({ redirectUri, idToken, state, playerOrigin: options.config.playerOrigin });
}
