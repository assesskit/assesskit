import { DataError } from "@assesskit/runtime/errors";
import { describe } from "../checks.js";
import { LtiError } from "../errors.js";
import { readClock } from "./clock.js";
import { checkHttpRequest, type HttpRequest, type HttpResponse, readCookie, readForm } from "./http.js";
import { verifyIdToken } from "./id-token.js";
import { readLaunch } from "./launch-claims.js";
import type { LtiLaunch } from "./launch-model.js";
import { stateCookieName } from "./login.js";
import { checkLaunchOptions, findRegistration, type LtiLaunchOptions } from "./options.js";
import { getDataPage, STORED_NONCE, STORED_STATE } from "./pages.js";
import type { PlatformRegistration } from "./registration.js";
import { checkLoginRecord, type LoginRecord } from "./store.js";

// The states that ltiLogin creates are base64url; anything else is not one, and is not looked up in the store.
const STATE_FORMAT = /^[A-Za-z0-9_-]{1,64}$/u;

/** Reads a parameter of the launch that must be present, a non-empty string. */
function requiredField(form: ReadonlyMap<string, string>, name: string): string {
  const value = form.get(name);
  if (value === undefined || value === "") {
    throw new DataError(`The launch must have the form parameter ${describe(name)}, found ${describe(value)}.`);
  }
  return value;
}

/** Loads the record of the login that a launch answers. */
async function loadLogin(state: string, options: LtiLaunchOptions): Promise<LoginRecord> {
  const record = STATE_FORMAT.test(state) ? await options.store.get(state) : undefined;
  if (record === undefined) {
    throw new LtiError("The launch answers no login that the tool started, or one it has finished.", "state-unknown");
  }
  checkLoginRecord(record);
  if (readClock(options.clock) >= record.expiresAt) {
    throw new LtiError("The login that the launch answers has expired.", "state-expired");
  }
  return record;
}

/** Checks that the browser of the launch is the browser of the login, as the cookie recorded it (Security Framework sections 5.1.1.4 and 7.3.1). */
function checkStateCookie(request: HttpRequest, state: string): void {
  if (readCookie(request, stateCookieName(state)) !== state) {
    throw new LtiError(
      "The state cookie of the login is missing or differs from the state of the launch.",
      "state-cookie",
    );
  }
}

/** Returns whether a post is the verification page's: it returns values fetched from the platform's storage. */
function isVerification(form: ReadonlyMap<string, string>): boolean {
  return form.has(STORED_STATE) || form.has(STORED_NONCE);
}

/**
 * Checks the post of the verification page on the client-side storage path: it comes from the tool's own page, and the
 * values it fetched from the platform's storage are the login's.
 */
function checkVerification(
  request: HttpRequest,
  form: ReadonlyMap<string, string>,
  state: string,
  record: LoginRecord,
  registration: PlatformRegistration,
): void {
  // Without cookies nothing else ties the post to the browser that logged in: a cross-site form could post a token that the
  // attacker obtained, with values of its own choosing (login CSRF, Security Framework section 7.3.1). The tool's own page is
  // same-origin.
  const origin = new URL(registration.redirectUri).origin;
  if (request.headers.origin !== origin) {
    throw new LtiError(
      `The verification of a launch must be posted from ${describe(origin)}, found ${describe(request.headers.origin)}.`,
      "origin-mismatch",
    );
  }
  if (form.get(STORED_STATE) !== state || form.get(STORED_NONCE) !== record.nonce) {
    throw new LtiError(
      "The state and the nonce in the platform's storage are not those of the login.",
      "storage-mismatch",
    );
  }
}

/**
 * Completes a launch: validates the `id_token` that the platform posts to the redirect URI and returns the launch.
 *
 * @remarks
 * The checks, in order: the form has no `oauth_consumer_key` (an LTI 1.0 to 1.2 launch) and has `id_token` and `state`;
 * `state` names a login that the tool started and has not finished; the browser is the one that logged in (the state cookie, or the platform's storage); the signature, the
 * issuer, the audience, the authorized party and the times (Security Framework section 5.1.3); the `nonce` equals the login's;
 * the LTI claims (LTI 1.3 Core section 5.3, Deep Linking 2.0 section 4.4). The login is then deleted, so a launch completes once.
 *
 * On the client-side storage path the platform's post is answered with a verification page and no launch; the page posts
 * again to the same URL, and that second request completes the launch. The host routes both to this function.
 *
 * LTI 1.0 to 1.2 launches are not supported.
 *
 * @param request - The POST of the platform, or of the verification page.
 * @param options - The registrations and the store of the tool, and its `fetch` and clock.
 * @returns The launch, or the verification page, which the host sends.
 * @throws `DataError` when the request is not a POST of a form with `id_token` and `state`.
 * @throws `LtiError` with the reason of the failed check: `legacy-launch`, `state-unknown`, `state-expired`,
 * `state-reused`, `state-cookie`, `origin-mismatch`, `storage-mismatch`, `platform-unknown`, `token-malformed`,
 * `algorithm-unsupported`, `key-unknown`, `signature-invalid`, `issuer-mismatch`, `audience-mismatch`,
 * `authorized-party-mismatch`, `token-expired`, `issued-in-future`, `nonce-mismatch`, `message-type-unsupported`,
 * `version-unsupported`, `deployment-unknown`, `claim-missing` or `claim-invalid`.
 * @throws `ServiceError` when the platform's key set cannot be fetched.
 */
export async function ltiLaunch(request: HttpRequest, options: LtiLaunchOptions): Promise<LtiLaunch | HttpResponse> {
  checkHttpRequest(request);
  checkLaunchOptions(options);
  if (request.method !== "POST") {
    throw new DataError(`A launch must be a POST request, found ${describe(request.method)}.`);
  }
  const form = readForm(request);
  // 1EdTech retired LTI 1.0 to 1.2 on 2022-06-30; their launch is an OAuth 1.0a form with no id_token.
  if (form.has("oauth_consumer_key")) {
    throw new LtiError(
      "LTI 1.0 to 1.2 launches are not supported; an LTI 1.3 launch posts an id_token and a state.",
      "legacy-launch",
    );
  }
  const idToken = requiredField(form, "id_token");
  const state = requiredField(form, "state");
  const record = await loadLogin(state, options);
  const registration = await findRegistration(options, record.issuer, record.clientId);
  if (record.storageTarget === undefined) {
    checkStateCookie(request, state);
  } else if (isVerification(form)) {
    checkVerification(request, form, state, record, registration);
  } else {
    const { authenticationUrl, redirectUri } = registration;
    return getDataPage({
      frame: record.storageTarget,
      state,
      nonce: record.nonce,
      authenticationUrl,
      redirectUri,
      idToken,
    });
  }
  const claims = await verifyIdToken(idToken, registration, options.jwks, readClock(options.clock));
  if (claims.nonce !== record.nonce) {
    throw new LtiError("The nonce of the token is not the nonce of the login.", "nonce-mismatch");
  }
  const launch = readLaunch(claims, registration);
  // The store removes the login for one caller only, so of two launches that race with one token, one completes.
  if (!(await options.store.delete(state))) {
    throw new LtiError("The login that the launch answers was finished by another request.", "state-reused");
  }
  return launch;
}
