import { exportJWK } from "jose";
import { type HttpResponse, jsonResponse } from "../internal.js";
import { platformKeyId } from "./config.js";
import { checkPlatformOptions, type PlatformOptions } from "./options.js";

// Security Framework section 6.3 lets the issuer signal how long a retriever may cache the key set. The tool role of this package
// caches for the same hour.
const MAX_AGE_SECONDS = 3600;

/**
 * Answers a request for the platform's key set (Security Framework section 6.3, RFC 7517): the public key that verifies its
 * `id_token`s, as an RSA key with `use: sig`, `alg: RS256` and a `kid`, the thumbprint of the key (RFC 7638).
 *
 * @param options - The platform.
 * @returns The key set as JSON.
 * @throws `DataError` when the options are not those of a platform.
 */
export async function platformJwks(options: PlatformOptions): Promise<HttpResponse> {
  checkPlatformOptions(options);
  const key = {
    ...(await exportJWK(options.config.keys.publicKey)),
    alg: "RS256",
    use: "sig",
    kid: await platformKeyId(options.config),
  };
  return jsonResponse(200, { keys: [key] }, { "cache-control": `public, max-age=${MAX_AGE_SECONDS}` });
}
