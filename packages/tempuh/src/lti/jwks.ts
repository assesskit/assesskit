import type { webcrypto } from "node:crypto";
import {
  checkFunction,
  checkHttpsUrl,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  isRecord,
} from "../checks.js";
import { DataError } from "../errors.js";
import { type Clock, checkClock, readClock } from "./clock.js";
import { callService, DEFAULT_TIMEOUT_MS, type Fetch } from "./service.js";

const DEFAULT_TTL_SECONDS = 3600;
const DEFAULT_REFRESH_SECONDS = 60;
// RFC 7518 §3.3: a key of at least 2048 bits must be used with RS256.
const MIN_MODULUS_BITS = 2048;

/** The options of `createJwksCache`. */
export interface JwksCacheOptions {
  /** The `fetch` that gets the key sets. */
  readonly fetch: Fetch;
  /** The source of the current time. */
  readonly clock: Clock;
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
   * Returns the public key of a key set with the given `kid`, or `undefined` when the set has none. The cache fetches the
   * set when it holds none or an old one, and again when the set lacks the `kid` and the refresh time has passed.
   *
   * @throws `DataError` when `url` is not an `https` URL or `keyId` is not a non-empty string, or the key set is not a
   * JWK Set (RFC 7517 §5).
   * @throws `ServiceError` when the platform's server does not answer with a success.
   */
  key(url: string, keyId: string): Promise<webcrypto.CryptoKey | undefined>;
}

/**
 * Checks a cache, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a function `key`.
 */
export function checkJwksCache(value: unknown): asserts value is JwksCache {
  checkRecord(value, "The option jwks must be an object");
  checkFunction(value.key, "The function key of the option jwks must be a function");
}

/** The keys of one fetched key set, by `kid`, and the time of the fetch. */
interface Fetched {
  readonly keys: ReadonlyMap<string, webcrypto.CryptoKey>;
  readonly fetchedAt: number;
}

/** Imports the public key of a JWK if it is an RSA signing key of at least 2,048 bits, else returns `undefined`. */
async function importKey(jwk: unknown): Promise<webcrypto.CryptoKey | undefined> {
  if (!isRecord(jwk) || jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") return undefined;
  if ((jwk.use !== undefined && jwk.use !== "sig") || (jwk.alg !== undefined && jwk.alg !== "RS256")) return undefined;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256" },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const { algorithm } = key;
    const bits = "modulusLength" in algorithm ? algorithm.modulusLength : 0;
    return typeof bits === "number" && bits >= MIN_MODULUS_BITS ? key : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a key set (RFC 7517 §5) into its usable keys by `kid`. The first key of a `kid` is the one that counts. */
async function readKeys(body: string): Promise<ReadonlyMap<string, webcrypto.CryptoKey>> {
  let set: unknown;
  try {
    set = JSON.parse(body);
  } catch {
    throw new DataError("The key set must be JSON.");
  }
  if (!isRecord(set) || !Array.isArray(set.keys)) {
    throw new DataError("The key set must be an object with an array keys (RFC 7517 §5).");
  }
  const keys = new Map<string, webcrypto.CryptoKey>();
  for (const jwk of set.keys) {
    const kid = isRecord(jwk) ? jwk.kid : undefined;
    if (typeof kid !== "string" || keys.has(kid)) continue;
    const key = await importKey(jwk);
    if (key !== undefined) keys.set(kid, key);
  }
  return keys;
}

/**
 * Creates the cache of the key sets of platforms.
 *
 * The cache holds one entry per key set URL, and the URLs come from the host's registrations, never from a token. A
 * fetch is shared by the requests that wait for it. The cache keeps the RSA keys of at least 2,048 bits that are meant
 * for signing and skips the others (RFC 7518 §3.3).
 *
 * @throws `DataError` when an option has the wrong type.
 */
export function createJwksCache(options: JwksCacheOptions): JwksCache {
  checkRecord(options, "The options must be an object");
  const { fetch, clock, ttlSeconds = DEFAULT_TTL_SECONDS, refreshSeconds = DEFAULT_REFRESH_SECONDS } = options;
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  checkFunction(fetch, "The option fetch must be a function");
  checkClock(clock);
  checkPositiveInteger(ttlSeconds, "The option ttlSeconds");
  checkPositiveInteger(refreshSeconds, "The option refreshSeconds");
  checkPositiveInteger(timeoutMs, "The option timeoutMs");
  const cache = new Map<string, Fetched>();
  const running = new Map<string, Promise<Fetched>>();

  async function fetchSet(url: string): Promise<Fetched> {
    const body = await callService({ fetch, timeoutMs }, `The key set at ${url}`, url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const fetched = { keys: await readKeys(body), fetchedAt: readClock(clock) };
    cache.set(url, fetched);
    return fetched;
  }

  function load(url: string): Promise<Fetched> {
    const pending = running.get(url) ?? fetchSet(url).finally(() => running.delete(url));
    running.set(url, pending);
    return pending;
  }

  /** Returns whether a cached set is too old, or lacks the key and may be fetched again. */
  function isStale(cached: Fetched, keyId: string): boolean {
    const age = (readClock(clock) - cached.fetchedAt) / 1000;
    return age >= ttlSeconds || (!cached.keys.has(keyId) && age >= refreshSeconds);
  }

  return {
    async key(url, keyId) {
      checkHttpsUrl(url, "The URL of a key set");
      checkNonEmptyString(keyId, "The identifier of a key");
      const cached = cache.get(url);
      const set = cached !== undefined && !isStale(cached, keyId) ? cached : await load(url);
      return set.keys.get(keyId);
    },
  };
}
