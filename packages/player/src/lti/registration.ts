import type { webcrypto } from "node:crypto";
import { guardSchema, looseRecord, nonEmptyStringSchema, parseWith } from "@assesskit/runtime/checks";
import * as v from "valibot";
import { httpsUrlSchema } from "../checks.js";
import { isRsaKey } from "./keys.js";

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

const registrationSchema = looseRecord({
  issuer: v.pipe(
    httpsUrlSchema,
    v.check(
      (issuer) => new URL(issuer).search === "" && new URL(issuer).hash === "",
      (issue) => `expected an issuer without a query or a fragment, found ${issue.received}`,
    ),
  ),
  clientId: nonEmptyStringSchema,
  deploymentIds: v.pipe(v.array(nonEmptyStringSchema), v.minLength(1)),
  authenticationUrl: httpsUrlSchema,
  jwksUrl: httpsUrlSchema,
  accessTokenUrl: httpsUrlSchema,
  redirectUri: httpsUrlSchema,
  keyId: nonEmptyStringSchema,
  signingKey: guardSchema(
    (key): key is webcrypto.CryptoKey => isRsaKey(key, "sign"),
    "a private RSASSA-PKCS1-v1_5 key with SHA-256 for signing",
  ),
});

/**
 * Checks a registration that the host's lookup returned.
 *
 * @throws `DataError` when it is not a registration: a field is missing or of the wrong type, a URL is not `https`, the
 * issuer has a query or a fragment, or the signing key is not a private RSA key for RS256.
 */
export function checkPlatformRegistration(value: unknown): asserts value is PlatformRegistration {
  parseWith(registrationSchema, value, "The registration");
}
