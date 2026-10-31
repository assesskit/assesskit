/**
 * LTI 1.3 in both roles.
 *
 * The tool role is a tool that a learning platform launches: it starts the OpenID Connect login (with a cookie, or with the
 * platform's browser storage in an iframe), validates the launch, answers a Deep Linking request and requests access
 * tokens for the platform's services.
 *
 * The platform role launches the LTI items of a package: it starts the login of a tool, answers its authentication request
 * with the `id_token`, publishes its key set, issues access tokens and serves the line item and the scores of an item.
 *
 * @module @assesskit/player/lti
 */

export type { LtiFrame } from "../protocol/index.js";
export { type AccessToken, ltiAccessToken } from "./access-token.js";
export type { Clock } from "./clock.js";
export { type DeepLinkItem, type DeepLinkLineItem, deepLinkResponse } from "./deep-link.js";
export type { HttpRequest, HttpResponse } from "./http.js";
export { createJwksCache, type JwksCache, type JwksCacheOptions } from "./jwks.js";
export { ltiLaunch } from "./launch.js";
export type {
  AgsEndpoint,
  DeepLinkingLaunch,
  DeepLinkingSettings,
  LaunchBase,
  LtiDeployment,
  LtiLaunch,
  ResourceLink,
  ResourceLinkLaunch,
} from "./launch-model.js";
export { ltiLogin } from "./login.js";
export type { AccessTokenOptions, LtiLaunchOptions, LtiLoginOptions, ToolOptions } from "./options.js";
export {
  type AgsScore,
  type AgsScoresOptions,
  agsLineItem,
  agsScores,
  LTI_HINT_TTL_SECONDS,
  ltiPlatformAuthorize,
  ltiPlatformFrame,
  ltiPlatformLogin,
  type PlatformAuthorizeOptions,
  type PlatformConfig,
  type PlatformEndpoints,
  type PlatformLoginOptions,
  type PlatformOptions,
  type PlatformTokenOptions,
  platformEndpoints,
  platformJwks,
  platformStorage,
  platformToken,
  readAgsScore,
  type ToolRegistration,
} from "./platform/index.js";
export { publishScore } from "./publish-score.js";
export type { PlatformRegistration } from "./registration.js";
export type { Fetch } from "./service.js";
export type { LoginRecord, LtiStore } from "./store.js";
