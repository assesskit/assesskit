/**
 * The client of a remote computer adaptive testing engine over the REST/JSON binding of CAT 1.0. It gives the runtime's
 * `CatPort` and takes an OAuth client secret, so it belongs on a server and never in a page.
 *
 * @module @assesskit/player/cat-rest
 */
export type { CatFetch, CatFetchRequest, CatFetchResponse, OAuthClientCredentials } from "./rest-client.js";
export { type RestCatPortOptions, restCatPort } from "./rest-port.js";
