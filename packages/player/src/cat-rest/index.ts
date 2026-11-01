/**
 * Both sides of the REST/JSON binding of CAT 1.0. `createRestCatPort` is the client of a remote computer adaptive testing engine:
 * it gives the runtime's `CatPort` and takes an OAuth client secret, so it belongs on a server and never in a page.
 * `createCatRestHandler` is the engine side: it answers the six requests of the binding over web-standard `Request` and
 * `Response`, for any `CatPort`.
 *
 * @module @assesskit/player/cat-rest
 */

export type { CatAuthorization, CatAuthorizer } from "./authorization.js";
export type { CatFetch, CatFetchRequest, CatFetchResponse, OAuthClientCredentials } from "./rest-client.js";
export { type CatRestHandlerOptions, createCatRestHandler } from "./rest-handler.js";
export {
  type CatEngine,
  type CatEngineResolver,
  type CatEngines,
  createRestCatPort,
  type RestCatPortOptions,
} from "./rest-port.js";
export type { CatOperation } from "./route.js";
export { CAT_SCOPES, scopesOf } from "./scopes.js";
