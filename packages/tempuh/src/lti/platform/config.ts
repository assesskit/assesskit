import type { webcrypto } from "node:crypto";
import { checkRecord, describe, isRecord } from "../../checks.js";
import { DataError } from "../../errors.js";
import { encodeBase64Url } from "../base64url.js";
import { checkHttpsUrl } from "../http.js";
import { isHmacKey, isRsaKey } from "../keys.js";

const AUTHORIZATION_PATH = "/authorize";
const JWKS_PATH = "/jwks";
const TOKEN_PATH = "/token";
/** The path under which the platform serves its line items; the segment after it names a line item. */
export const LINE_ITEM_PATH = "/ags/";

/** What the platform is: its identity, its origins and its keys. */
export interface PlatformConfig {
  /** The issuer identifier of the platform: the `iss` of its tokens, an `https` URL without query or fragment. */
  readonly issuer: string;
  /** The origin that serves the platform's handlers. It differs from the origins of the player and of the assets. */
  readonly origin: string;
  /** The origin of the player page, which frames the tool and answers its storage messages. */
  readonly playerOrigin: string;
  /** The origin that serves the files of packages. */
  readonly assetOrigin: string;
  /** The RSA key pair (RS256) that signs the `id_token`s. The public key must be extractable. */
  readonly keys: webcrypto.CryptoKeyPair;
  /** The HMAC key (SHA-256, usages `sign` and `verify`) that signs hints, line item identifiers and access tokens. */
  readonly hintKey: webcrypto.CryptoKey;
}

/** The URLs of the platform's endpoints, which the tool's administrator registers with the tool. */
export interface PlatformEndpoints {
  /** The OpenID Connect authentication endpoint, served by `ltiPlatformAuthorize`. */
  readonly authorization: string;
  /** The key set, served by `platformJwks`. */
  readonly jwks: string;
  /** The OAuth 2.0 token endpoint, served by `platformToken`; also the audience of the tool's client assertions. */
  readonly token: string;
}

/** Checks that a value is the origin of an `https` URL, such as `https://platform.example`. */
function checkOrigin(value: unknown, label: string): asserts value is string {
  checkHttpsUrl(value, label);
  if (new URL(value).origin !== value) {
    throw new DataError(
      `${label} must be an origin without a path, such as "https://platform.example", found ${describe(value)}.`,
    );
  }
}

/**
 * Checks a platform configuration, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not one: the issuer is not an `https` URL without query or fragment, an origin is not an
 * `https` origin, two of the three origins coincide, a key is not what its property says, or the public key cannot be
 * exported.
 */
export function checkPlatformConfig(value: unknown): asserts value is PlatformConfig {
  checkRecord(value, "The platform configuration must be an object");
  checkHttpsUrl(value.issuer, "The issuer of the platform");
  const issuer = new URL(value.issuer);
  if (issuer.search !== "" || issuer.hash !== "") {
    throw new DataError(
      `The issuer of the platform must not have a query or a fragment, found ${describe(value.issuer)}.`,
    );
  }
  checkOrigin(value.origin, "The origin of the platform");
  checkOrigin(value.playerOrigin, "The origin of the player");
  checkOrigin(value.assetOrigin, "The origin of the assets");
  if (new Set([value.origin, value.playerOrigin, value.assetOrigin]).size !== 3) {
    // D-M1: the tool's frame has allow-same-origin, so a platform page on the player's origin would share it with the player.
    throw new DataError(
      "The platform, the player and the assets must have three different origins, found " +
        `${describe(value.origin)}, ${describe(value.playerOrigin)} and ${describe(value.assetOrigin)}.`,
    );
  }
  checkRecord(value.keys, "The keys of the platform must be an object");
  if (!isRsaKey(value.keys.privateKey, "sign")) {
    throw new DataError("The private key of the platform must be an RSASSA-PKCS1-v1_5 key with SHA-256 for signing.");
  }
  const publicKey = value.keys.publicKey;
  if (!isRsaKey(publicKey, "verify") || !isRecord(publicKey) || publicKey.extractable !== true) {
    throw new DataError(
      "The public key of the platform must be an extractable RSASSA-PKCS1-v1_5 key with SHA-256 for verifying.",
    );
  }
  if (!isHmacKey(value.hintKey)) {
    throw new DataError("The hint key of the platform must be an HMAC key with SHA-256 for signing and verifying.");
  }
}

/** Returns the URLs of the endpoints of a platform whose configuration has been checked. */
export function endpointsOf(config: PlatformConfig): PlatformEndpoints {
  return {
    authorization: `${config.origin}${AUTHORIZATION_PATH}`,
    jwks: `${config.origin}${JWKS_PATH}`,
    token: `${config.origin}${TOKEN_PATH}`,
  };
}

/**
 * Returns the URLs of the endpoints of a platform: what its administrator registers with a tool.
 *
 * @throws `DataError` when the configuration is not one.
 */
export function platformEndpoints(config: PlatformConfig): PlatformEndpoints {
  checkPlatformConfig(config);
  return endpointsOf(config);
}

const keyIds = new WeakMap<webcrypto.CryptoKey, Promise<string>>();

/**
 * Returns the `kid` of the platform's signing key: its JWK thumbprint (RFC 7638), so that a new key has a new `kid` and no
 * host needs to name it. Security Framework §6.3 requires a `kid` for every key of a key set.
 */
export function platformKeyId(config: PlatformConfig): Promise<string> {
  const { publicKey } = config.keys;
  const known = keyIds.get(publicKey);
  if (known !== undefined) return known;
  const computed = (async () => {
    const { e, n } = await crypto.subtle.exportKey("jwk", publicKey);
    // RFC 7638 §3.2: the required members of an RSA key in lexicographic order, without white space.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify({ e, kty: "RSA", n })),
    );
    return encodeBase64Url(new Uint8Array(digest));
  })();
  keyIds.set(publicKey, computed);
  return computed;
}
