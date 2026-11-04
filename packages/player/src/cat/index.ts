/**
 * Computer adaptive testing on a server or in a page: the deployment of the adaptive sections of a package to their
 * engines, through any `CatPort`. The client of a remote engine is `@assesskit/player/cat-rest`.
 *
 * @module @assesskit/player/cat
 */
export { type DeployCatSectionsOptions, type DeployedCatSection, deployCatSections } from "./deploy.js";
