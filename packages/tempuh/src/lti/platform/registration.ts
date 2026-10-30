import type { webcrypto } from "node:crypto";
import { errors, type JWTVerifyGetKey } from "jose";
import { checkArray, checkHttpsUrl, checkNonEmptyString, checkRecord, describe } from "../../checks.js";
import { DataError } from "../../errors.js";
import { checkAllowList } from "../../protocol/index.js";
import { MAX_IDENTIFIER_LENGTH } from "../claims.js";
import type { JwksCache } from "../jwks.js";
import { isRsaKey } from "../keys.js";

/** The host's record of one tool that the platform launches, as the platform's administrator and the tool agreed on it. */
export interface ToolRegistration {
  /** The OAuth 2.0 client identifier of the tool at this platform. */
  readonly clientId: string;
  /** The deployment of the tool at this platform (LTI 1.3 Core §3.1.3). */
  readonly deploymentId: string;
  /** The tool's login initiation URL (Security Framework §5.1.1): where the platform sends the browser first. */
  readonly loginUrl: string;
  /** The tool's launch URLs that the platform may post an `id_token` to: the redirect URIs of the tool. */
  readonly redirectUris: readonly string[];
  /** The URL of the tool's key set, which holds the keys that sign its client assertions. Exactly one of this and `keys`. */
  readonly jwksUrl?: string;
  /** The tool's public RSA keys by `kid`, for a tool that gives keys and not a URL. Exactly one of this and `jwksUrl`. */
  readonly keys?: ReadonlyMap<string, webcrypto.CryptoKey>;
  /**
   * The `allow` attribute of the tool's frame: the features of the browser, such as `microphone`, that the tool may use
   * when it runs in an item.
   *
   * @defaultValue none, so that the tool may use no feature that needs permission
   */
  readonly allow?: string;
}

/**
 * Checks a registration that the host's lookup returned.
 *
 * @throws `DataError` when it is not a registration: a field is missing or of the wrong type, a URL is not `https`, or
 * the tool has both or neither of `jwksUrl` and `keys`.
 */
export function checkToolRegistration(value: unknown): asserts value is ToolRegistration {
  checkRecord(value, "The registration of a tool must be an object");
  checkNonEmptyString(value.clientId, "The client identifier of a tool");
  checkNonEmptyString(value.deploymentId, "The deployment of a tool");
  if (value.deploymentId.length > MAX_IDENTIFIER_LENGTH) {
    throw new DataError(
      `The deployment of a tool must have at most 255 characters (LTI 1.3 Core §5.3.3), found ${value.deploymentId.length}.`,
    );
  }
  checkHttpsUrl(value.loginUrl, "The login URL of a tool");
  checkArray(value.redirectUris, "The redirect URIs of a tool must be an array");
  if (value.redirectUris.length === 0) {
    throw new DataError("The redirect URIs of a tool must have at least one URI.");
  }
  for (const uri of value.redirectUris) checkHttpsUrl(uri, "A redirect URI of a tool");
  if ((value.jwksUrl === undefined) === (value.keys === undefined)) {
    throw new DataError("A tool must have exactly one of the properties jwksUrl and keys.");
  }
  if (value.allow !== undefined) checkAllowList(value.allow, "The allow list of a tool");
  if (value.jwksUrl !== undefined) checkHttpsUrl(value.jwksUrl, "The key set URL of a tool");
  if (value.keys !== undefined) {
    const keys = value.keys;
    if (!(keys instanceof Map) || ![...keys].every(([id, key]) => typeof id === "string" && isRsaKey(key, "verify"))) {
      throw new DataError(
        `The keys of a tool must be a Map of public RSASSA-PKCS1-v1_5 keys with SHA-256 by kid, found ${describe(keys)}.`,
      );
    }
  }
}

/**
 * Returns the function that resolves the tool's public key from the header of an assertion: the key set at its `jwksUrl`,
 * or the key of `keys` that has the `kid`.
 */
export function toolKeySet(registration: ToolRegistration, jwks: JwksCache): JWTVerifyGetKey {
  if (registration.jwksUrl !== undefined) return jwks.keySet(registration.jwksUrl);
  const keys = registration.keys ?? new Map<string, webcrypto.CryptoKey>();
  return (header) => {
    const key = typeof header.kid === "string" ? keys.get(header.kid) : undefined;
    if (key === undefined) throw new errors.JWKSNoMatchingKey();
    return Promise.resolve(key);
  };
}
