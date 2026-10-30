# LTI platform role

`@luthfanwakan/tempuh/lti` also launches tools: an LTI resource in a package (BPIG §6.2.9, resource type
`imsbasiclti_xmlv1p3`) is an item that a tool delivers, and a conformant tool refuses a launch that skips the OpenID
Connect handshake. The platform role is the other side of the [tool role](lti.md): it uses the same JWT, key set and HTTP
primitives, and no dependency but the Web Crypto API.

| Function                                    | Does                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `ltiPlatformLogin(caller, item, link, ...)` | Prepares the launch of a tool for an item and returns the URL of the tool's third-party initiated login |
| `ltiPlatformAuthorize(request, options)`    | Answers the tool's authentication request with the page that posts the `id_token`                       |
| `platformJwks(options)`                     | Publishes the key set that verifies the `id_token`s                                                     |
| `platformToken(request, options)`           | Grants access tokens by the client-credentials grant with a JWT assertion                               |
| `agsLineItem(request, options)`             | Answers a request for the one line item of an item instance                                             |
| `agsScores(request, options)`               | Receives the scores that the tool posts to the line item                                                |
| `readAgsScore(body)`                        | Reads the body of a score request                                                                       |
| `platformEndpoints(config)`                 | Gives the URLs of the authorization endpoint, the key set and the token endpoint                        |

The handlers take an `HttpRequest` and return an `HttpResponse`, as in the tool role. They take callbacks and never the
session host: `check` confirms the caller's session, `once` records single-use identifiers, and `onScore` receives the
scores. The sources are the same as the tool role's, with [LTI AGS 2.0](https://www.imsglobal.org/spec/lti-ags/v2p0) for the
line item and the scores.

## Three origins

The platform's handlers are served from `PlatformConfig.origin`, which differs from the origin of the player page and from
the origin of the assets (D-M1). The frame of a tool has `allow-same-origin`, so a platform page on the player's origin
would share the origin with the player, and any injection into that page would reach it. Every handler therefore

- refuses a configuration in which two of the three origins coincide, with `DataError`;
- refuses a request whose URL is for another origin than `origin`, with `AccessError` (`wrong-origin`). The `url` of an
  `HttpRequest` is the public URL, so a proxy must pass the original.

`ltiPlatformLogin` also refuses a tool whose launch URL, login URL or redirect URIs are on any of the three origins
(`LtiError`, `origin-refused`): a tool must be cross-origin to the player.

## Configuration

| Property       | Meaning                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `issuer`       | The `iss` of the platform: an `https` URL without query or fragment                                              |
| `origin`       | The origin of the handlers, such as `https://lti.platform.example`                                               |
| `playerOrigin` | The origin of the player page, which frames the tool and holds the platform's storage for it                     |
| `assetOrigin`  | The origin that serves the files of packages                                                                     |
| `keys`         | An RSA `CryptoKeyPair` for RS256; the public key must be extractable. The `kid` is its JWK thumbprint (RFC 7638) |
| `hintKey`      | An HMAC key with SHA-256 for `sign` and `verify`                                                                 |

`platformEndpoints(config)` gives the URLs that the tool's administrator registers with the tool. The handlers answer at these
paths of `origin`, and the host routes them:

| Endpoint              | Path                             | Handler                |
| --------------------- | -------------------------------- | ---------------------- |
| Authorization         | `/authorize` (GET or POST)       | `ltiPlatformAuthorize` |
| Key set               | `/jwks` (GET)                    | `platformJwks`         |
| Token                 | `/token` (POST)                  | `platformToken`        |
| Line item             | `/ags/{line item}` (GET)         | `agsLineItem`          |
| Scores of a line item | `/ags/{line item}/scores` (POST) | `agsScores`            |

## Registrations

A `ToolRegistration` is the host's record of a tool. The host looks it up in two ways: `registration(link)` at the login,
from olah's `LtiLink` (by its launch URL, else its vendor code), and `client(clientId)` at the authorization and the token
endpoint.

| Property       | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `clientId`     | The client identifier of the tool                                                                 |
| `deploymentId` | The deployment, at most 255 characters                                                            |
| `loginUrl`     | The tool's login initiation URL                                                                   |
| `redirectUris` | The URLs that the platform may post an `id_token` to; the `redirect_uri` of a request must be one |
| `jwksUrl`      | The tool's key set. Exactly one of this and `keys`                                                |
| `keys`         | The tool's public RSA keys by `kid`, a `Map`. Exactly one of this and `jwksUrl`                   |

Every URL is `https`. A link must have a launch URL: `secureLaunchUrl`, else `launchUrl`. A link that names only a vendor is
refused with `DataError`.

## The launch

1. The host's authenticated route calls `ltiPlatformLogin(caller, item, link, options)`. `options.check(caller)` runs first and
   confirms that the session is the caller's (`SessionHost.check`, `AccessError` otherwise). The result is the URL of the
   tool's login: `iss`, `login_hint`, `lti_message_hint`, `target_link_uri`, `client_id`, `lti_deployment_id` and
   `lti_storage_target=_parent`. The player navigates the item's frame to it.
2. The tool answers with its authentication request (Security Framework §5.1.1.2) to the authorization endpoint.
   `ltiPlatformAuthorize` checks it and answers with a page that posts the `id_token` and the `state` to the redirect URI.

### The hints

The authorization binds to `lti_message_hint`, and not to a cookie: the request is a navigation, often a cross-site POST in the
cross-site frame of the tool, where Safari and Firefox may withhold the host's session cookie.

| Hint               | Holds                                                                                                                                                                                      | Signed with  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `lti_message_hint` | The session, the item, the principal, the client, the `target_link_uri`, the custom properties, the title, the highest score, a random `jti` and an expiry of `LTI_HINT_TTL_SECONDS` (300) | HMAC-SHA-256 |
| `login_hint`       | The principal                                                                                                                                                                              | HMAC-SHA-256 |

Both are signed and not encrypted, so the tool can read them: the principal is also the `sub` of the launch, and the session
identifier must be one that the tool may know. A hint is valid for one use: `options.once` records its `jti`.

### What `ltiPlatformAuthorize` checks

In this order. An `AccessError` means the request is not bound to a launch that the platform made, and a host maps it to 403.
An `LtiError` means the tool broke the protocol. Neither redirects the browser to the tool (OpenID Connect Core §3.1.2.6).

| Check                                                                              | Error and reason                                                                                |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The request is for the platform's origin                                           | `AccessError`, `wrong-origin`                                                                   |
| `scope=openid`, `response_type=id_token`, `response_mode=form_post`, `prompt=none` | `LtiError`, `scope-invalid`, `response-type-invalid`, `response-mode-invalid`, `prompt-invalid` |
| `client_id` is a tool of the platform                                              | `LtiError`, `client-unknown`                                                                    |
| `redirect_uri` is one of the tool's redirect URIs, exactly                         | `LtiError`, `redirect-uri-mismatch`                                                             |
| `nonce` and `state` are present                                                    | `LtiError`, `nonce-missing`, `state-missing`                                                    |
| `lti_message_hint` is present and sealed by this platform                          | `AccessError`, `hint-missing`, `hint-invalid`                                                   |
| The hint has not expired                                                           | `AccessError`, `hint-expired`                                                                   |
| The hint is for this tool                                                          | `AccessError`, `client-mismatch`                                                                |
| `login_hint` names the principal of the hint                                       | `AccessError`, `principal-mismatch`                                                             |
| When `options.caller` is given, it names the session and the principal of the hint | `AccessError`, `caller-mismatch`                                                                |
| `options.once` has not seen the hint                                               | `AccessError`, `hint-used`                                                                      |

`options.caller` is the identity that the host's cookie gave, when the cookie arrived. It is an extra check and never a
requirement.

### The page

The page holds a form with the `id_token` and the `state` and one script that submits it. Its policy allows that script by
hash and nothing else: `default-src 'none'; script-src 'sha256-...'; base-uri 'none'; form-action <origin of the redirect
URI>; frame-ancestors <player origin>`. Every value is HTML-encoded. The answer is not cached and sends no referrer. Without
JavaScript the form has a button.

### The `id_token`

| Claim                                         | Value                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `iss`, `aud`                                  | `issuer`; the client identifier                                                |
| `sub`                                         | The principal                                                                  |
| `iat`, `exp`, `nonce`                         | The time; five minutes later; the tool's nonce                                 |
| `.../claim/message_type`, `.../claim/version` | `LtiResourceLinkRequest`, `1.3.0`                                              |
| `.../claim/deployment_id`                     | The deployment of the registration                                             |
| `.../claim/target_link_uri`                   | The launch URL of the link                                                     |
| `.../claim/resource_link`                     | `id`, a hash of the session and the item instance, and the `title` of the link |
| `.../claim/roles`                             | The role of a learner                                                          |
| `.../claim/custom`                            | The custom properties of the link                                              |
| `.../lti-ags/claim/endpoint`                  | The scopes `lineitem.readonly` and `score`, and the `lineitem` URL             |

The header has `alg: RS256` and the `kid` of the key set. The results service and line items that the tool creates are not
offered, because the platform makes the one line item an item needs.

## The token endpoint

`platformToken` grants the client-credentials grant with a JWT assertion (Security Framework §4.1.1). The access token is
sealed with the hint key, lasts one hour and holds the requested scopes, which must be among `lineitem.readonly` and `score`.
A request that fails gets status 400 with an `error` and an `error_description` (RFC 6749 §5.2). The checks, in order:

| Check                                                                                                      | `error`                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------ |
| The method is POST and the body is a form without a repeated parameter                                     | `invalid_request`        |
| `grant_type=client_credentials`                                                                            | `unsupported_grant_type` |
| `client_assertion_type` is `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, with an assertion     | `invalid_request`        |
| `scope` names at least one scope, all offered                                                              | `invalid_scope`          |
| The assertion is a JWT, `alg` is `RS256`, `iss` is a tool, and its key (by `kid`) verifies the signature   | `invalid_client`         |
| `sub` equals `iss`                                                                                         | `invalid_client`         |
| `aud` is the token URL                                                                                     | `invalid_client`         |
| `exp` has not passed (60 seconds of leeway), is at most 3,600 seconds away, and `iat` is not in the future | `invalid_client`         |
| `jti` is present and `options.once` has not seen it for this tool                                          | `invalid_client`         |

The key set of a tool comes from `options.jwks`, the cache of the tool role (`createJwksCache`). A `ServiceError` for a key
set that cannot be fetched reaches the host, and the assertion is not used up.

## The line item and the scores

The line item URL is `{origin}/ags/{line item}`. The identifier is sealed with the hint key and names the session, the item
instance, the tool, the user (`sub`), the label and the highest score, so the platform keeps no state. It has no expiry: a
tool may post a score long after the test (LTI AGS 2.0 §3.1).

`agsLineItem` answers a GET with `application/vnd.ims.lis.v2.lineitem+json`: `id`, `label` (the title of the link),
`scoreMaximum` (`options.scoreMaximum(item)` at the login, above 0, LTI AGS 2.0 §3.2.8) and `resourceLinkId`, the `id` of
the launch's resource link. `agsScores` receives `POST {line item}/scores` with `application/vnd.ims.lis.v1.score+json` and
answers 204.

| Status | When                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 401    | No bearer token, or one that this platform did not issue or that has expired (`invalid_token`)                                                   |
| 403    | The token lacks the scope (`insufficient_scope`), the line item is another tool's, or the score is for another user than the `sub` of the launch |
| 404    | The path names no line item of this platform                                                                                                     |
| 405    | A method other than GET (line item) or POST (scores); `Allow` names the method                                                                   |
| 415    | The score has another media type                                                                                                                 |
| 400    | The body is not JSON or not a score                                                                                                              |

`readAgsScore` reads the body of a score. `userId`, `timestamp`, `activityProgress` and `gradingProgress` are required. A
`scoreGiven` is a number from 0, may be higher than `scoreMaximum` (§3.4.4), and needs a `scoreMaximum` above 0; `null` or
absent means no score. The `timestamp` is ISO 8601 with a time zone designator (`Z`, `+00:00` or `+00`; §3.4.9); a fraction
of a second is read when it is there. `timestampMs` is the same instant in milliseconds, so that scores of one line item and
user compare across time zones. The platform must not update a result with an older score (§3.4.9), and `agsScores` does not
keep one: `onScore` receives every score that passed the checks, and the host keeps the one with the greatest `timestampMs`.

## Example

A host with the Fetch API request and response types, one tool and an in-memory ledger. The tool's key set is fetched from its
URL.

```ts
import type { ItemKey } from "@luthfanwakan/olah/delivery";
import type { LtiLink } from "@luthfanwakan/olah/package";
import {
  type AgsScore,
  agsLineItem,
  agsScores,
  createJwksCache,
  type HttpRequest,
  type HttpResponse,
  ltiPlatformAuthorize,
  ltiPlatformLogin,
  type PlatformConfig,
  platformJwks,
  platformToken,
  type ToolRegistration,
} from "@luthfanwakan/tempuh/lti";

const keys = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const config: PlatformConfig = {
  issuer: "https://platform.example",
  origin: "https://lti.platform.example",
  playerOrigin: "https://player.platform.example",
  assetOrigin: "https://assets.platform.example",
  keys,
  hintKey: await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
};
const tool: ToolRegistration = {
  clientId: "962fa4d8-bcbf-49a0-94b2-2de05ad274af",
  deploymentId: "07940580-b309-415e-a37c-914d387c1150",
  loginUrl: "https://tool.example.com/lti/login",
  redirectUris: ["https://tool.example.com/lti/launch"],
  jwksUrl: "https://tool.example.com/.well-known/jwks.json",
};

const clock = { now: () => Date.now() };
const used = new Map<string, number>();
const options = {
  config,
  clock,
  registration: async (_link: LtiLink) => tool,
  client: async (clientId: string) => (clientId === tool.clientId ? tool : undefined),
  jwks: createJwksCache({ fetch, clock }),
  once: async (id: string, expiresAt: number) => {
    if (used.has(id)) return false;
    used.set(id, expiresAt);
    return true;
  },
  scoreMaximum: async (_item: ItemKey) => 10,
  onScore: async (session: string, item: ItemKey, score: AgsScore) => {
    console.log(session, item.ref, score.gradingProgress, score.scoreGiven);
  },
};

async function toHttpRequest(request: Request): Promise<HttpRequest> {
  return {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers),
    body: await request.text(),
  };
}

function toResponse({ status, headers, body }: HttpResponse): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

/** The route of the host, behind its own authentication: the URL to navigate the item's frame to. */
export function launchUrl(session: string, principal: string, item: ItemKey, link: LtiLink): Promise<string> {
  return ltiPlatformLogin({ session, principal }, item, link, { ...options, check: async () => undefined });
}

/** The routes of the platform's own origin. */
export async function platform(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const http = await toHttpRequest(request);
  if (pathname === "/authorize") return toResponse(await ltiPlatformAuthorize(http, options));
  if (pathname === "/jwks") return toResponse(await platformJwks(options));
  if (pathname === "/token") return toResponse(await platformToken(http, options));
  if (pathname.endsWith("/scores")) return toResponse(await agsScores(http, options));
  if (pathname.startsWith("/ags/")) return toResponse(await agsLineItem(http, options));
  return new Response(null, { status: 404 });
}
```

## Deployment

- Serve the handlers over HTTPS from their own origin, and nothing else from it. The player and the assets have origins of
  their own.
- `options.once` must be atomic, and may delete an identifier after the time it was given. A `jti` and a hint are used once
  across all processes of the host.
- Keep the hint key secret and stable while hints, line items and access tokens are in use: changing it ends them. Line items
  have no expiry.
- Limit the size of a request body.
- Wire `check` to `SessionHost.check`, and call `ltiPlatformLogin` only from a route that authenticated the caller.
- `onScore` is where the host decides what a score is worth: it keeps the latest score by `timestampMs`, and supplies only a
  `FullyGraded` score to the session.
