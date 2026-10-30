import type { webcrypto } from "node:crypto";
import { checkArray, checkNonEmptyString, checkRecord, describe, isRecord } from "../checks.js";
import { DataError } from "../errors.js";
import { checkHttpsUrl } from "./http.js";

/** The host's record of one platform that the tool trusts, as the platform's administrator and the tool agreed on it. */
export interface PlatformRegistration {
  /** The issuer identifier of the platform: the `iss` of its tokens, an `https` URL without query or fragment. */
  readonly issuer: string;
  /** The OAuth 2.0 client identifier that the platform gave the tool. */
  readonly clientId: string;
  /** The deployments of the tool at the platform that it accepts: the `deployment_id` of a launch must be one of them. */
  readonly deploymentIds: readonly string[];
  /** The OpenID Connect authentication endpoint of the platform, to which the tool redirects the browser. */
  readonly authenticationUrl: string;
  /** The URL of the platform's JSON Web Key Set, which holds the keys that sign its tokens. */
  readonly jwksUrl: string;
  /** The OAuth 2.0 token endpoint of the platform, where the tool requests access tokens for its services. */
  readonly accessTokenUrl: string;
  /** The tool's launch URL, which the platform knows as a redirect URI. The authorization response is posted to it. */
  readonly redirectUri: string;
  /** The `kid` that the tool's public key has in the key set that the platform fetches. */
  readonly keyId: string;
  /** The tool's private RSA key, with which it signs client assertions and Deep Linking responses (RS256). */
  readonly signingKey: webcrypto.CryptoKey;
}

/**
 * Checks a registration that the host's lookup returned.
 *
 * @throws `DataError` when it is not a registration: a field is missing or of the wrong type, a URL is not `https`, the
 * issuer has a query or a fragment, or the signing key is not a private RSA key for RS256.
 */
export function checkPlatformRegistration(value: unknown): asserts value is PlatformRegistration {
  checkRecord(value, "The registration must be an object");
  checkHttpsUrl(value.issuer, "The issuer of a registration");
  const issuer = new URL(value.issuer);
  if (issuer.search !== "" || issuer.hash !== "") {
    throw new DataError(
      `The issuer of a registration must not have a query or a fragment, found ${describe(value.issuer)}.`,
    );
  }
  checkNonEmptyString(value.clientId, "The client identifier of a registration");
  checkArray(value.deploymentIds, "The deployment identifiers of a registration must be an array");
  if (value.deploymentIds.length === 0) {
    throw new DataError("The deployment identifiers of a registration must have at least one deployment.");
  }
  for (const deploymentId of value.deploymentIds) {
    checkNonEmptyString(deploymentId, "A deployment identifier of a registration");
  }
  checkHttpsUrl(value.authenticationUrl, "The authentication URL of a registration");
  checkHttpsUrl(value.jwksUrl, "The key set URL of a registration");
  checkHttpsUrl(value.accessTokenUrl, "The access token URL of a registration");
  checkHttpsUrl(value.redirectUri, "The redirect URI of a registration");
  checkNonEmptyString(value.keyId, "The key identifier of a registration");
  if (!isSigningKey(value.signingKey)) {
    throw new DataError(
      `The signing key of a registration must be a private RSASSA-PKCS1-v1_5 key with SHA-256 for signing, found ${describe(value.signingKey)}.`,
    );
  }
}

/** Returns whether a value is a `CryptoKey` for signing with RS256. */
function isSigningKey(key: unknown): boolean {
  if (!isRecord(key)) return false;
  const { algorithm, usages } = key;
  return (
    isRecord(algorithm) &&
    algorithm.name === "RSASSA-PKCS1-v1_5" &&
    isRecord(algorithm.hash) &&
    algorithm.hash.name === "SHA-256" &&
    Array.isArray(usages) &&
    usages.includes("sign")
  );
}
