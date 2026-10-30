/**
 * The platform role of LTI 1.3: the handlers that launch a tool inside an item. The player navigates the item's frame to
 * the URL of `ltiPlatformLogin`; the tool's authentication request reaches `ltiPlatformAuthorize`, which answers with a page
 * that posts the `id_token`; the tool fetches the key set from `platformJwks`, gets a token from `platformToken` and
 * reads its line item with `agsLineItem` and posts scores with `agsScores`.
 */

export { agsLineItem, agsScores } from "./ags.js";
export { type AgsScore, readAgsScore } from "./ags-score.js";
export { ltiPlatformAuthorize } from "./authorize.js";
export { type PlatformConfig, type PlatformEndpoints, platformEndpoints } from "./config.js";
export { platformJwks } from "./jwks.js";
export { LTI_HINT_TTL_SECONDS, ltiPlatformLogin } from "./login.js";
export type {
  AgsScoresOptions,
  PlatformAuthorizeOptions,
  PlatformLoginOptions,
  PlatformOptions,
  PlatformTokenOptions,
} from "./options.js";
export type { ToolRegistration } from "./registration.js";
export { platformToken } from "./token.js";
