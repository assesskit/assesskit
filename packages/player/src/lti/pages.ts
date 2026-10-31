import { escapeHtml, pagePolicy } from "./html.js";
import type { HttpResponse } from "./http.js";

// How long a page waits for the platform to answer a storage message before it tells the user. A storage message is a
// local call between two frames of one browser, so a few seconds mean that the platform does not answer.
const STORAGE_TIMEOUT_MS = 10_000;

/** The form parameter in which the verification page returns the `state` that it fetched from the platform's storage. */
export const STORED_STATE = "stored_state";
/** The form parameter in which the verification page returns the `nonce` that it fetched from the platform's storage. */
export const STORED_NONCE = "stored_nonce";

// The pages are small and static, so that the CSP names the hash of each script; the values go in a data attribute, which
// the script parses. The messages follow LTI Client Side OIDC 0.1 §3.1 to §3.4: `lti.put_data` and `lti.get_data`, a
// response `<subject>.response` with the same `message_id`, from the origin of the platform's authentication endpoint.
const PUT_SCRIPT = `(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("lti").dataset.config);
  var failure = document.getElementById("failure");
  var pending = new Set();
  var timer = window.setTimeout(fail, config.timeoutMs);
  function fail() {
    window.clearTimeout(timer);
    failure.hidden = false;
  }
  var target;
  try {
    var base = window.parent !== window ? window.parent : window.opener;
    target = config.frame === "_parent" ? base : base.frames[config.frame];
  } catch (error) {
    target = null;
  }
  if (!target) {
    fail();
    return;
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.origin !== config.origin || typeof data !== "object" || data === null) return;
    if (data.subject !== "lti.put_data.response" || !pending.has(data.message_id)) return;
    if (data.error) {
      fail();
      return;
    }
    pending.delete(data.message_id);
    if (pending.size === 0) {
      window.clearTimeout(timer);
      window.location.replace(config.authenticationRequest);
    }
  });
  [["state_" + config.state, config.state], ["nonce_" + config.nonce, config.nonce]].forEach(function (entry) {
    var id = window.crypto.randomUUID();
    pending.add(id);
    target.postMessage({ subject: "lti.put_data", message_id: id, key: entry[0], value: entry[1] }, config.origin);
  });
})();`;

const GET_SCRIPT = `(function () {
  "use strict";
  var config = JSON.parse(document.getElementById("lti").dataset.config);
  var failure = document.getElementById("failure");
  var form = document.getElementById("form");
  var pending = new Map();
  var timer = window.setTimeout(fail, config.timeoutMs);
  function fail() {
    window.clearTimeout(timer);
    failure.hidden = false;
  }
  var target;
  try {
    var base = window.parent !== window ? window.parent : window.opener;
    target = config.frame === "_parent" ? base : base.frames[config.frame];
  } catch (error) {
    target = null;
  }
  if (!target) {
    fail();
    return;
  }
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.origin !== config.origin || typeof data !== "object" || data === null) return;
    if (data.subject !== "lti.get_data.response" || !pending.has(data.message_id)) return;
    if (data.error || typeof data.value !== "string") {
      fail();
      return;
    }
    form.elements.namedItem(pending.get(data.message_id)).value = data.value;
    pending.delete(data.message_id);
    if (pending.size === 0) {
      window.clearTimeout(timer);
      form.requestSubmit();
    }
  });
  [["state_" + config.state, config.stateField], ["nonce_" + config.nonce, config.nonceField]].forEach(function (entry) {
    var id = window.crypto.randomUUID();
    pending.set(id, entry[1]);
    target.postMessage({ subject: "lti.get_data", message_id: id, key: entry[0] }, config.origin);
  });
})();`;

const FAILURE =
  "The launch could not continue: the platform did not store or return the launch state. Close this window and start the launch again.";

/** Builds a page with one script, for the browser to run in the frame of the platform. */
async function respond(script: string, config: object, body: string): Promise<HttpResponse> {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>LTI launch</title>
</head>
<body>
<div id="lti" data-config="${escapeHtml(JSON.stringify({ ...config, timeoutMs: STORAGE_TIMEOUT_MS }))}"></div>
${body}<p id="failure" role="alert" hidden>${FAILURE}</p>
<script>${script}</script>
</body>
</html>
`;
  return {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": await pagePolicy(script, "'self'"),
    },
    body: html,
  };
}

/** The values of a login that the page stores in the platform. */
export interface StoragePut {
  /** The `lti_storage_target` of the initiation: the name of the platform's frame, or `_parent`. */
  readonly frame: string;
  /** The `state` of the authentication request. */
  readonly state: string;
  /** The `nonce` of the authentication request. */
  readonly nonce: string;
  /** The authentication request: the URL to which the page redirects the browser once the platform has stored the values. */
  readonly authenticationRequest: string;
}

/**
 * Builds the page that stores `state` and `nonce` in the platform with `lti.put_data` and then redirects the browser
 * to the authentication request (LTI Client Side OIDC 0.1 §2.3, §2.5).
 */
export function putDataPage(put: StoragePut): Promise<HttpResponse> {
  const { frame, state, nonce, authenticationRequest } = put;
  const origin = new URL(authenticationRequest).origin;
  return respond(PUT_SCRIPT, { frame, state, nonce, origin, authenticationRequest }, "");
}

/** What the verification page needs to fetch the values and return them with the token. */
export interface StorageGet {
  /** The `lti_storage_target` of the initiation. */
  readonly frame: string;
  /** The `state` of the launch. */
  readonly state: string;
  /** The `nonce` of the login. */
  readonly nonce: string;
  /** The authentication endpoint of the platform, whose origin the storage answers from. */
  readonly authenticationUrl: string;
  /** The launch URL of the tool, to which the page posts the form. */
  readonly redirectUri: string;
  /** The `id_token` that the platform posted, which the form returns unchanged. */
  readonly idToken: string;
}

/**
 * Builds the verification page: it fetches `state` and `nonce` from the platform's storage with `lti.get_data` and
 * submits them with the token to the launch URL (LTI Client Side OIDC 0.1 §2.7).
 */
export function getDataPage(get: StorageGet): Promise<HttpResponse> {
  const { frame, state, nonce, authenticationUrl, redirectUri, idToken } = get;
  const field = (name: string, value: string): string =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">\n`;
  const form = `<form id="form" method="post" action="${escapeHtml(redirectUri)}">
${field("id_token", idToken)}${field("state", state)}${field(STORED_STATE, "")}${field(STORED_NONCE, "")}</form>
`;
  const config = {
    frame,
    state,
    nonce,
    origin: new URL(authenticationUrl).origin,
    stateField: STORED_STATE,
    nonceField: STORED_NONCE,
  };
  return respond(GET_SCRIPT, config, form);
}
