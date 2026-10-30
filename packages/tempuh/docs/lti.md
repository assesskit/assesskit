# LTI tool role

`@luthfanwakan/tempuh/lti` lets a learning platform launch tempuh as an LTI 1.3 tool. It runs on a server, uses only the Web
Crypto API and has no runtime dependency. LTI 1.0 to 1.2 launches (OAuth 1.0a, retired on 2022-06-30) are refused.

| Function                                      | Does                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ltiLogin(request, options)`                  | Answers the platform's third-party initiated login with the authentication request            |
| `ltiLaunch(request, options)`                 | Validates the `id_token` and returns the launch, or the verification page of the storage path |
| `deepLinkResponse(launch, items, options)`    | Signs the response to a Deep Linking request                                                  |
| `ltiAccessToken(deployment, scopes, options)` | Requests an access token for the platform's services (client-credentials grant, JWT)          |
| `createJwksCache(options)`                    | Creates the cache of the platforms' key sets that `ltiLaunch` verifies signatures with        |

The handlers take an `HttpRequest` and return an `HttpResponse`, plain objects that a host builds from any web framework. The
host owns the routes, the sessions, the database and the keys.

## Sources

| Specification                                                                                                                                                                                                  | Used for                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [LTI 1.3 Core](https://www.imsglobal.org/spec/lti/v1p3)                                                                                                                                                        | Login parameters, launch claims, token endpoint                     |
| [LTI Security Framework 1.0](https://www.imsglobal.org/spec/security/v1p0)                                                                                                                                     | Authentication request, `id_token` validation, key sets, assertions |
| [LTI Deep Linking 2.0](https://www.imsglobal.org/spec/lti-dl/v2p0)                                                                                                                                             | Deep Linking request and response                                   |
| [LTI Assignment and Grade Services 2.0](https://www.imsglobal.org/spec/lti-ags/v2p0)                                                                                                                           | The `endpoint` claim of a launch                                    |
| [LTI Client Side OIDC 0.1](https://www.imsglobal.org/spec/lti-cs-oidc/v0p1)                                                                                                                                    | `state` and `nonce` in the platform's browser storage               |
| [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749), [RFC 7515](https://www.rfc-editor.org/rfc/rfc7515), [RFC 7518](https://www.rfc-editor.org/rfc/rfc7518), [RFC 7523](https://www.rfc-editor.org/rfc/rfc7523) | OAuth 2.0, JWS, RS256, the JWT assertion                            |

## Example

A host with the Fetch API request and response types. It generates its key in the sample; a real host keeps the key that
the platform's administrator registered.

```ts
import {
  createJwksCache,
  type HttpRequest,
  type HttpResponse,
  type LoginRecord,
  type LtiLaunchOptions,
  type LtiStore,
  ltiLaunch,
  ltiLogin,
  type PlatformRegistration,
} from "@luthfanwakan/tempuh/lti";

const keys = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  false,
  ["sign"],
);
const registration: PlatformRegistration = {
  issuer: "https://lms.example.edu",
  clientId: "962fa4d8-bcbf-49a0-94b2-2de05ad274af",
  deploymentIds: ["07940580-b309-415e-a37c-914d387c1150"],
  authenticationUrl: "https://lms.example.edu/auth",
  jwksUrl: "https://lms.example.edu/jwks",
  accessTokenUrl: "https://lms.example.edu/token",
  redirectUri: "https://tool.example.com/lti/launch",
  keyId: "tool-1",
  signingKey: keys.privateKey,
};

const logins = new Map<string, LoginRecord>();
const store: LtiStore = {
  put: async (state, record) => {
    logins.set(state, record);
  },
  get: async (state) => logins.get(state),
  delete: async (state) => logins.delete(state),
};
const clock = { now: () => Date.now() };
const options: LtiLaunchOptions = {
  registration: async (issuer, clientId) =>
    issuer === registration.issuer && (clientId === undefined || clientId === registration.clientId)
      ? registration
      : undefined,
  clock,
  store,
  jwks: createJwksCache({ fetch, clock }),
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
  return new Response(body, { status, headers });
}

/** The route of the tool's login URL. */
export async function login(request: Request): Promise<Response> {
  return toResponse(await ltiLogin(await toHttpRequest(request), options));
}

/** The route of the tool's launch URL, which the platform knows as the redirect URI. */
export async function launch(request: Request): Promise<Response> {
  const result = await ltiLaunch(await toHttpRequest(request), options);
  if (!("messageType" in result)) return toResponse(result);
  return Response.json({ user: result.subject, custom: [...result.custom] });
}
```

`Object.fromEntries(request.headers)` gives the header names in lower case, as `HttpRequest` requires.

## Registrations

`options.registration(issuer, clientId)` returns the `PlatformRegistration` of a platform, or `undefined`. `clientId` is
`undefined` unless the platform names it (`client_id`, LTI 1.3 Core §4.1.3). The returned registration is checked on every
call and must match the issuer and the client.

| Property            | Meaning                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `issuer`            | The `iss` of the platform: an `https` URL without query or fragment                        |
| `clientId`          | The OAuth 2.0 client identifier that the platform gave the tool                            |
| `deploymentIds`     | The deployments that the tool accepts; the `deployment_id` of a launch must be one of them |
| `authenticationUrl` | The platform's OIDC authentication endpoint                                                |
| `jwksUrl`           | The platform's key set                                                                     |
| `accessTokenUrl`    | The platform's token endpoint, also the `aud` of the client assertion                      |
| `redirectUri`       | The tool's launch URL. The route of `ltiLaunch` must answer it                             |
| `keyId`             | The `kid` of the tool's public key in the key set that the platform fetches                |
| `signingKey`        | The tool's private RSA key (`RSASSA-PKCS1-v1_5`, SHA-256, usage `sign`)                    |

Every URL is `https` (LTI 1.3 Core §3.5). The platform needs the tool's public key under `keyId`: the host publishes it, and the sample does not.

## The login store

`LtiStore` keeps the logins in progress, by `state`. `ltiLogin` calls `put`, `ltiLaunch` calls `get` and then `delete`.

| Method               | Contract                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `put(state, record)` | Saves the `LoginRecord`: `nonce`, `issuer`, `clientId`, `storageTarget` and `expiresAt`           |
| `get(state)`         | Returns the record, or `undefined`                                                                |
| `delete(state)`      | Deletes the record and returns whether there was one. Of two concurrent calls, one returns `true` |

A login is valid for 600 seconds (`expiresAt`). The host may delete expired records. `delete` must be atomic: it is what makes
a login complete once.

## Login and launch

The platform sends the browser to the login URL (Security Framework §5.1.1.1). `ltiLogin` creates a `state` and a `nonce`
of 160 random bits each, saves them in the store and answers with the authentication request (§5.1.1.2): `scope=openid`,
`response_type=id_token`, `client_id`, `redirect_uri`, `login_hint`, `state`, `response_mode=form_post`, `nonce`,
`prompt=none`, and `lti_message_hint` unchanged when the platform sent it. The initiation may be a GET or a form POST.

The tool must tie the launch to the browser that logged in, or an attacker could make a victim's browser launch with the
attacker's token (login CSRF, Security Framework §7.3.1). There are two ways.

| Path    | When                                       | The answer of `ltiLogin`                                                                                                           | What binds the browser                                                                      |
| ------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Cookie  | The initiation has no `lti_storage_target` | A 302 to the authentication request, with `__Host-lti_state_<state>=<state>; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=None` | The cookie, which the launch compares with `state`                                          |
| Storage | The initiation has `lti_storage_target`    | A page that stores `state` and `nonce` in the platform with `lti.put_data`, then redirects                                         | The platform's storage, which the verification page reads with `lti.get_data` at the launch |

The storage path works in an iframe whose browser blocks third-party cookies. The `__Host-` prefix keeps a sibling subdomain
from setting the cookie, and the name holds the `state`, so that several launches in one browser do not collide.

### The storage path

LTI Client Side OIDC 0.1 §2.3 to §2.7 and §3 define the messages. The page stores `state_<state>` and `nonce_<nonce>` in the
frame named by `lti_storage_target` (`_parent` for the parent), waits for `lti.put_data.response`, and navigates to the
authentication request. A message counts only when it comes from the origin of `authenticationUrl`, has the subject
`<subject>.response` and answers the page's `message_id`. If the platform answers with an error, names no such frame or is
silent for 10 seconds, the page shows a message and stops.

At the launch, the platform posts the `id_token` to the redirect URI. `ltiLaunch` answers with the verification page: it
fetches `state_<state>` and `nonce_<nonce>` with `lti.get_data` and submits the form with `id_token`, `state`, `stored_state`
and `stored_nonce` to the same URL. That second request completes the launch, so the host routes both to `ltiLaunch`. It must
pass the `origin` header, because `ltiLaunch` accepts the second request only from the origin of the redirect URI: without
cookies, nothing else stops a cross-site form from posting a token of the attacker's with values of its own.

The scripts of the two pages use only features of the [browser baseline](baseline.md): they run in Chromium 111, Firefox 115
and Safari 16.4, and later versions. Both pages carry a CSP that allows their one script by hash (`default-src 'none'; script-src 'sha256-...'; base-uri 'none';
form-action 'self'`), `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and every value in them is
HTML-encoded. `ltiLaunch` echoes the `id_token` of the platform's post into the verification page before it verifies it, and
only for a `state` that the tool issued.

### What `ltiLaunch` checks

A request that is not a POST of a form with `id_token` and `state` is a `DataError`. Then, in this order, a failure throws
`LtiError` with the reason in the table. The login stays in the store until the launch succeeds or expires.

| Check                                                                                                                           | Reason                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| The form has no `oauth_consumer_key`, which an LTI 1.0 to 1.2 launch carries                                                    | `legacy-launch`                                   |
| `state` names a login in the store, made of base64url characters                                                                | `state-unknown`                                   |
| The login has not expired                                                                                                       | `state-expired`                                   |
| The platform is still registered                                                                                                | `platform-unknown`                                |
| Cookie path: the state cookie equals `state`                                                                                    | `state-cookie`                                    |
| Storage path: the second post comes from the redirect URI's origin, with `stored_state` and `stored_nonce` equal to the login's | `origin-mismatch`, `storage-mismatch`             |
| The token has three base64url parts, a JSON header and a JSON payload; no `crit` header                                         | `token-malformed`                                 |
| `alg` is `RS256`; `none` and the HMAC algorithms are refused                                                                    | `algorithm-unsupported`                           |
| The header has a `kid` that the key set holds, as an RSA signing key of 2,048 bits or more                                      | `key-unknown`                                     |
| The signature verifies with that key                                                                                            | `signature-invalid`                               |
| `iss` equals the registration's issuer                                                                                          | `issuer-mismatch`                                 |
| `aud` is the client identifier alone (a string or an array); `azp`, when present, is the client identifier                      | `audience-mismatch`, `authorized-party-mismatch`  |
| `exp` is later than the time minus 60 seconds; `iat` is not later than the time plus 60 seconds                                 | `token-expired`, `issued-in-future`               |
| `nonce` is present and equals the login's                                                                                       | `nonce-mismatch`                                  |
| The message type is `LtiResourceLinkRequest` or `LtiDeepLinkingRequest`; the version is `1.3.0`                                 | `message-type-unsupported`, `version-unsupported` |
| `deployment_id` is one of the registration's                                                                                    | `deployment-unknown`                              |
| The claims of the message type have the shape of the specifications                                                             | `claim-missing`, `claim-invalid`                  |
| The store deletes the login                                                                                                     | `state-reused`                                    |

A host maps `LtiError` to 401 (Security Framework §5.1.3) and `DataError` to 400.

### The launch

`ltiLaunch` returns an `LtiLaunch`, a union by `messageType`.

| Property                             | Meaning                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `issuer`, `clientId`, `deploymentId` | The platform, the tool's client and the deployment                                                                       |
| `targetLinkUri`                      | The `target_link_uri` claim. The tool relies on it, not on the unsigned parameter of the login                           |
| `subject`                            | The user's `sub`; absent in an anonymous launch                                                                          |
| `roles`                              | The role URIs                                                                                                            |
| `custom`                             | The custom properties of the link, a `Map`                                                                               |
| `resourceLink`                       | `LtiResourceLinkRequest`: `id`, `title`, `description`                                                                   |
| `ags`                                | `LtiResourceLinkRequest`: the grade services, `scopes`, `lineitems` and `lineitem`; absent when the platform offers none |
| `settings`                           | `LtiDeepLinkingRequest`: `returnUrl`, `acceptTypes`, `acceptMultiple` and `data`                                         |

A launch holds a `Map`; a host that stores it converts `custom` to an array of entries.

## Deep Linking

When `ltiLaunch` returns a Deep Linking request, the host lets the user choose, then calls `deepLinkResponse(launch, items,
options)`. The result is the signed `LtiDeepLinkingResponse`, the value of the form parameter `JWT`. The host sends the browser
to `launch.settings.returnUrl` with an auto-submitted form POST (Deep Linking 2.0 §2.3), also when no item was chosen.

An item is an LTI resource link:

| Property   | Meaning                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `title`    | The title of the link                                                                                       |
| `text`     | A description                                                                                               |
| `url`      | The URL to launch, sent back as `target_link_uri`; the tool's base LTI URL when absent                      |
| `custom`   | A `Map` of strings that the platform sends with each launch of the link, such as the identifier of the test |
| `lineItem` | `scoreMaximum` (above 0), `label`, `resourceId` and `tag`: the line item that the platform may create       |

The response has `iss` (the client identifier), `aud` (the platform), `exp` (300 seconds after `iat`), `iat`, a `nonce`, the
deployment, the message type, the version, the `data` of the request when it had one, and `content_items`. It is signed with
the registration's key and `keyId`. `deepLinkResponse` throws `DataError` when the platform does not accept
`ltiResourceLink` or, for several items, does not say `accept_multiple: true`.

## Access tokens

`ltiAccessToken(deployment, scopes, options)` posts a form to `accessTokenUrl` with `grant_type=client_credentials`,
`client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, `client_assertion` and `scope`
(space-separated), as Security Framework §4.1.1 describes. The assertion has `iss` and `sub` equal to the client
identifier, `aud` equal to the token endpoint, `iat`, `exp` (300 seconds later), a new `jti` and the deployment claim (LTI 1.3
Core §6.2.1). `deployment` is a launch or any object with `issuer`, `clientId` and `deploymentId`.

The result is an `AccessToken`: `value`, `expiresAt` (milliseconds) and `scopes`, which are those requested, or the subset the
platform granted. A service request carries `Authorization: Bearer <value>`. The tool may keep the token until `expiresAt`; the
function keeps none.

## The key set cache

`createJwksCache({ fetch, clock })` caches each key set by its URL, which comes from a registration and never from a token.

| Option           | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| `fetch`          | The `fetch` that gets the key sets                          |
| `clock`          | The source of the time                                      |
| `ttlSeconds`     | How long a set stays cached. Default: `3600`.               |
| `refreshSeconds` | The least time between two fetches of a set. Default: `60`. |
| `timeoutMs`      | The most time one fetch may take. Default: `10000`.         |

A set that is older than `ttlSeconds` is fetched again. A `kid` that the cached set lacks fetches it again only after
`refreshSeconds` (Security Framework §6.4: the platform adds a rotated key under a new `kid`), so a token with an invented
`kid` cannot make the tool fetch on every request. Requests that wait for one fetch share it. The cache keeps the RSA keys
for signing of 2,048 bits or more (RFC 7518 §3.3) and skips the others.

## Calls to the platform

`fetch` is an option and nothing else calls the network. The functions that do (`createJwksCache`, `ltiAccessToken`) set a
time limit, refuse a redirect (it could leave HTTPS) and read at most 64 KiB of the answer. A failure is a `ServiceError`: its
`status` is the HTTP status, or `0` when the platform did not answer. An answer that is not what the specification describes is
a `DataError`.

## The clock

`clock.now()` answers whole milliseconds, as `Date.now()` does. The functions read no other clock.

## Deployment

- Serve every route over HTTPS, and limit the size of a request body: the handlers read what the host gives them.
- Route the login URL to `ltiLogin`, and the redirect URI to `ltiLaunch` for both requests of the storage path.
- Pass the `origin` header, and the `cookie` header for the cookie path, in lower case.
- Make `LtiStore.delete` atomic, and delete expired records.
- Start the host's own session after `ltiLaunch` returns a launch; the state cookie serves the login only.
- Keep the tool's private key in the host's key store, and publish its public key to the platform under the `keyId`.
