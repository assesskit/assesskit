/**
 * Both sides of the REST/JSON binding of CAT 1.0. `restCatPort` is the client of a remote computer adaptive testing engine:
 * it gives the runtime's `CatPort` and takes an OAuth client secret, so it belongs on a server and never in a page.
 * `catRestHandler` is the engine side: it answers the six requests of the binding over web-standard `Request` and
 * `Response`, for any `CatPort`.
 *
 * @module @assesskit/player/cat-rest
 */

export type { CatFetch, CatFetchRequest, CatFetchResponse, OAuthClientCredentials } from "./rest-client.js";
export { type CatAuthenticate, type CatRestHandlerOptions, catRestHandler } from "./rest-handler.js";
export { type RestCatPortOptions, restCatPort } from "./rest-port.js";
export type { CatOperation } from "./route.js";
