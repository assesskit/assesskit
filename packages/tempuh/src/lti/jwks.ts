import { createRemoteJWKSet, customFetch, type JWTVerifyGetKey } from "jose";
import { checkFunction, checkHttpsUrl, checkPositiveInteger, checkRecord } from "../checks.js";
import { callService, DEFAULT_TIMEOUT_MS, type Fetch } from "./service.js";

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_REFRESH_SECONDS = 60;
const MILLISECONDS = 1000;

/** The options of `createJwksCache`. */
export interface JwksCacheOptions {
  /** The `fetch` that gets the key sets. */
  readonly fetch: Fetch;
  /** How long a key set stays in the cache, in seconds. Default: `3600`. */
  readonly ttlSeconds?: number;
  /**
   * The least time between two fetches of one key set, in seconds. A `kid` that the cached set lacks fetches it again
   * only after this time, so that a platform that rotates its keys is followed, and a token with an invented `kid`
   * cannot make the tool fetch on every request. Default: `60`.
   */
  readonly refreshSeconds?: number;
  /** The most time that a fetch may take, in milliseconds. Default: `10000`. */
  readonly timeoutMs?: number;
}

/** The keys that a platform signs its tokens with, cached by the URL of its key set. */
export interface JwksCache {
  /**
   * Returns the key set at a URL as the function that resolves the public key of a token from its header, for `jwtVerify`
   * of jose. The cache fetches the set when it holds none or an old one, and again when the set lacks the `kid` and the
   * refresh time has passed. It uses the key that has the `kid` and is for signing with RS256, and refuses a `kid` that
   * two keys share.
   *
   * @throws `DataError` when `url` is not an `https` URL.
   */
  keySet(url: string): JWTVerifyGetKey;
}

/**
 * Checks a cache, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a function `keySet`.
 */
export function checkJwksCache(value: unknown): asserts value is JwksCache {
  checkRecord(value, "The option jwks must be an object");
  checkFunction(value.keySet, "The function keySet of the option jwks must be a function");
}

/**
 * Creates the cache of the key sets of platforms.
 *
 * The cache holds one entry per key set URL, and the URLs come from the host's registrations, never from a token. A
 * fetch is shared by the requests that wait for it. The key sets are fetched with the `fetch` of the host, without
 * redirects, within `timeoutMs` and up to 64 KiB. The cache reads the time of the system, as jose does.
 *
 * @throws `DataError` when an option has the wrong type.
 */
export function createJwksCache(options: JwksCacheOptions): JwksCache {
  checkRecord(options, "The options must be an object");
  const { fetch, ttlSeconds = DEFAULT_TTL_SECONDS, refreshSeconds = DEFAULT_REFRESH_SECONDS } = options;
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  checkFunction(fetch, "The option fetch must be a function");
  checkPositiveInteger(ttlSeconds, "The option ttlSeconds");
  checkPositiveInteger(refreshSeconds, "The option refreshSeconds");
  checkPositiveInteger(timeoutMs, "The option timeoutMs");
  const sets = new Map<string, JWTVerifyGetKey>();

  // jose passes its own fetch options, which do not fit the rules of the tool role; callService applies them.
  const fetchKeySet = async (url: string): Promise<Response> =>
    new Response(
      await callService({ fetch, timeoutMs }, `The key set at ${url}`, url, {
        method: "GET",
        headers: { accept: "application/json" },
      }),
    );

  return {
    keySet(url) {
      checkHttpsUrl(url, "The URL of a key set");
      let set = sets.get(url);
      if (set === undefined) {
        set = createRemoteJWKSet(new URL(url), {
          cacheMaxAge: ttlSeconds * MILLISECONDS,
          cooldownDuration: refreshSeconds * MILLISECONDS,
          [customFetch]: fetchKeySet,
        });
        sets.set(url, set);
      }
      return set;
    },
  };
}
