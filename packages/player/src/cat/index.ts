/**
 * Computer adaptive testing on the server: the client of a remote engine over the REST/JSON binding of CAT 1.0, and the
 * deployment of the adaptive sections of a package. Both give the runtime's `CatPort`, which any engine can implement.
 *
 * @module @assesskit/player/cat
 */
export { type DeployedCatSection, deployCatSections } from "./deploy.js";
export type { CatFetch, CatFetchRequest, CatFetchResponse, OAuthClientCredentials } from "./rest-client.js";
export { type RestCatPortOptions, restCatPort } from "./rest-port.js";
