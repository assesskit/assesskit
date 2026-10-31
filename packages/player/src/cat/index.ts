/**
 * Computer adaptive testing on the server: the engine of a remote service over the REST/JSON binding of CAT 1.0, and the
 * deployment of the adaptive sections of a package. Engines in process over measurekit are in `@assesskit/player/cat/measurekit`.
 *
 * @module @assesskit/player/cat
 */
export { type DeployedCatSection, deployCatSections } from "./deploy.js";
export type { CatFetch, CatFetchRequest, CatFetchResponse, OAuthClientCredentials } from "./rest-client.js";
export { type RestCatPortOptions, restCatPort } from "./rest-port.js";
