import type { webcrypto } from "node:crypto";
import { DataError } from "@assesskit/runtime/errors";
import { type QtiPackage, resolveReference } from "@assesskit/runtime/package";
import type { FileValue } from "@assesskit/runtime/values";
import * as v from "valibot";
import {
  checkNonNegativeInteger,
  checkRecord,
  checkString,
  describe,
  functionSchema,
  methodsSchema,
  parseWith,
  positiveIntegerSchema,
} from "../../checks.js";
import { isHmacKey } from "../../lti/internal.js";
import { openToken, sealToken } from "../../lti/platform/internal.js";
import type { FileStore } from "../internal.js";
import { contentTypeOf } from "./content-type.js";
import { deniedPaths, isQtiData } from "./deny.js";

/** The seconds a token for a prefix of package paths is valid by default: an hour, renewed by every envelope. */
export const DEFAULT_TTL_SECONDS = 3600;

/** The seconds a token for a file of a candidate is valid by default: five minutes. */
export const DEFAULT_UPLOAD_TTL_SECONDS = 300;

const MILLISECONDS = 1000;
const PACKAGE_USE = "asset";
const FILE_USE = "file";

/** The options of {@link createAssetGate}. */
export interface AssetGateOptions {
  /** The key that signs tokens: HMAC with SHA-256 and the usages `sign` and `verify`. */
  readonly key: webcrypto.CryptoKey;
  /** The origin that serves the gate, `https` and without a path, such as `https://assets.example`. */
  readonly origin: string;
  /** Returns the package that a session delivers. */
  readonly packages: (session: string) => Promise<QtiPackage>;
  /** The storage of the files that candidates upload. */
  readonly files: FileStore;
  /**
   * The seconds a token for a prefix is valid.
   *
   * @defaultValue {@link DEFAULT_TTL_SECONDS}, `3600`
   */
  readonly ttlSeconds?: number;
  /**
   * The seconds a token for a file is valid.
   *
   * @defaultValue {@link DEFAULT_UPLOAD_TTL_SECONDS}, `300`
   */
  readonly uploadTtlSeconds?: number;
}

/** The answer of the gate to a request. */
export interface GateResponse {
  /** `200` for a file, `403` for a token or a path that is not allowed, `404` for a file the gate does not have or does not serve. */
  readonly status: 200 | 403 | 404;
  /** The headers to send, with `Referrer-Policy` and `X-Content-Type-Options` on every response. */
  readonly headers: Readonly<Record<string, string>>;
  /** The bytes of the file, for `200` only. */
  readonly body?: Uint8Array;
}

/** The asset gate: the one place where package files and candidate files leave the server. */
export interface AssetGate {
  /**
   * Signs the prefixes of a session for `ttlSeconds` from `now`.
   *
   * @param session - The identifier of the session.
   * @param prefixes - Directories of the package, each `""` or ending in `/`.
   * @param now - The time in epoch milliseconds.
   * @returns The base URL of each prefix, `https://<origin>/g/<token>/`; the URL of a file is the base plus its path.
   * @throws `DataError` when an argument has the wrong type or a prefix is not a directory.
   */
  sign(session: string, prefixes: Iterable<string>, now: number): Promise<Readonly<Record<string, string>>>;
  /**
   * Signs the URL of one file of a candidate for `uploadTtlSeconds` from `now`.
   *
   * @param session - The identifier of the session.
   * @param file - The file value that names the file in the host's store.
   * @param now - The time in epoch milliseconds.
   * @returns The URL, `https://<origin>/f/<token>/<reference>`.
   * @throws `DataError` when an argument has the wrong type.
   */
  signFile(session: string, file: FileValue, now: number): Promise<string>;
  /**
   * Answers a request for a path of the form `/g/<token>/<package path>` or `/f/<token>/<reference>`.
   *
   * @remarks
   * | Status | When |
   * | ------ | ---- |
   * | 403    | The token's MAC is wrong, it expired, or the path is outside its prefix or names another file |
   * | 404    | The file does not exist, or is never served: the manifest, a file of a QTI resource type, a file that `qti-adaptive-selection` names, or an XML file in a namespace of QTI data |
   * | 200    | Otherwise |
   *
   * @param request - The path of the request, without the origin and the query.
   * @param now - The time of the request in epoch milliseconds.
   * @returns The status, the headers and, for `200`, the bytes.
   * @throws `DataError` when an argument has the wrong type.
   */
  serve(request: { readonly path: string }, now: number): Promise<GateResponse>;
}

/** The headers of every response: the token is in the URL, so no referrer carries it, and nothing is sniffed. */
const BASE_HEADERS = { "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } as const;

/** The files of a candidate are untrusted content of the asset origin, so they get no script, no frame and no form. */
const FILE_HEADERS = { ...BASE_HEADERS, "Content-Security-Policy": "sandbox" } as const;

const REQUEST_PATH = /^\/([gf])\/([^/]+)\/(.*)$/su;

/** The hosts on which `http` is as trustworthy as `https`: a browser treats a loopback address as a secure context. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Checks the origin of the gate: `https` without a path, or `http` on a loopback address for development. */
function checkOrigin(value: unknown): asserts value is string {
  checkString(value, "The option origin");
  const url = URL.canParse(value) ? new URL(value) : undefined;
  const trustworthy =
    url?.protocol === "https:" || (url?.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname));
  if (url === undefined || !trustworthy) {
    throw new DataError(`The option origin must be an absolute https URL, found ${describe(value)}.`);
  }
  if (url.origin !== value) {
    throw new DataError(
      `The option origin must be an origin without a path, such as "https://assets.example", found ${describe(value)}.`,
    );
  }
}

const gateOptionsSchema = v.strictObject({
  key: v.custom<webcrypto.CryptoKey>(
    isHmacKey,
    "The option key must be an HMAC key with SHA-256 for signing and verifying.",
  ),
  origin: v.unknown(),
  packages: functionSchema<AssetGateOptions["packages"]>(),
  files: methodsSchema<FileStore>("put", "read"),
  ttlSeconds: v.optional(positiveIntegerSchema, DEFAULT_TTL_SECONDS),
  uploadTtlSeconds: v.optional(positiveIntegerSchema, DEFAULT_UPLOAD_TTL_SECONDS),
});

function checkGateOptions(options: unknown): asserts options is AssetGateOptions {
  checkOrigin(parseWith(gateOptionsSchema, options, "The options object").origin);
}

/** Checks that a prefix is a directory in normal form: empty, or segments each followed by a slash. */
function checkPrefix(prefix: unknown): asserts prefix is string {
  checkString(prefix, "A prefix");
  const segments = prefix.split("/");
  const last = segments.pop();
  const normal = segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
  if (!(last === "" && normal)) {
    throw new DataError(
      `A prefix must be a directory of the package, empty or ending in "/", found ${describe(prefix)}.`,
    );
  }
  if (/[\\\p{Cc}]/u.test(prefix)) {
    throw new DataError(`A prefix must have no backslash and no control character, found ${describe(prefix)}.`);
  }
}

function checkFileValue(file: unknown): asserts file is FileValue {
  checkRecord(file, "The file must be an object");
  checkString(file.reference, "The reference of the file");
  checkString(file.mimeType, "The mimeType of the file");
}

/** Reads the claims of a token and checks its expiry; `undefined` when the token is no good. */
async function claimsOf(
  key: webcrypto.CryptoKey,
  token: string,
  use: string,
  now: number,
): Promise<Readonly<Record<string, unknown>> | undefined> {
  const claims = await openToken(token, use, key);
  const expires = claims?.exp;
  return claims !== undefined && typeof expires === "number" && now <= expires ? claims : undefined;
}

/** The answer for a request that is not allowed, or for a file that is not there. */
const refused = (status: 403 | 404): GateResponse => ({ status, headers: BASE_HEADERS });

/**
 * Creates the asset gate: the origin that serves package files to a candidate's browser, with the tokens that the session
 * host puts in its envelopes.
 *
 * @remarks
 * - A token names a session, a prefix of package paths and an expiry, and carries a MAC. Relative URLs inherit it, so a
 *   module that `define`s `./renderer` and a stylesheet with `url(../fonts/x.woff)` load under the prefix.
 * - Whatever the token, the gate never serves the manifest, a file of a QTI resource type, a file that
 *   `qti-adaptive-selection` names, or an XML file whose first element is in a namespace of QTI data. These hold keys.
 * - A file token names one file of a session and expires after `uploadTtlSeconds`.
 *
 * @param options - See {@link AssetGateOptions}.
 * @returns The gate.
 * @throws `DataError` when an option has the wrong type.
 */
export function createAssetGate(options: AssetGateOptions): AssetGate {
  checkGateOptions(options);
  const { key, origin, packages, files } = options;
  const { ttlSeconds = DEFAULT_TTL_SECONDS, uploadTtlSeconds = DEFAULT_UPLOAD_TTL_SECONDS } = options;

  const servePackage = async (token: string, rest: string, now: number): Promise<GateResponse> => {
    const claims = await claimsOf(key, token, PACKAGE_USE, now);
    const session = claims?.session;
    const prefix = claims?.prefix;
    if (typeof session !== "string" || typeof prefix !== "string") return refused(403);
    const path = resolveReference("", rest);
    if (path === undefined || !path.startsWith(prefix)) return refused(403);
    const pkg = await packages(session);
    const bytes = pkg.file(path);
    const type = contentTypeOf(path);
    if (bytes === undefined || type === undefined || deniedPaths(pkg).has(path) || isQtiData(bytes))
      return refused(404);
    return { status: 200, headers: { ...BASE_HEADERS, "Content-Type": type }, body: bytes };
  };

  const serveFile = async (token: string, rest: string, now: number): Promise<GateResponse> => {
    const claims = await claimsOf(key, token, FILE_USE, now);
    const reference = claims?.reference;
    const mimeType = claims?.mimeType;
    if (typeof reference !== "string" || typeof mimeType !== "string") return refused(403);
    let named: string;
    try {
      named = decodeURIComponent(rest);
    } catch {
      return refused(403);
    }
    if (named !== reference) return refused(403);
    const bytes = await files.read({ reference, mimeType });
    return bytes === undefined
      ? refused(404)
      : { status: 200, headers: { ...FILE_HEADERS, "Content-Type": mimeType }, body: bytes };
  };

  return {
    sign: async (session, prefixes, now) => {
      checkString(session, "The session");
      checkNonNegativeInteger(now, "The time now");
      const signed = new Map<string, string>();
      for (const prefix of prefixes) {
        checkPrefix(prefix);
        const token = await sealToken(PACKAGE_USE, { session, prefix, exp: now + ttlSeconds * MILLISECONDS }, key);
        signed.set(prefix, `${origin}/g/${token}/`);
      }
      return Object.fromEntries(signed);
    },
    signFile: async (session, file, now) => {
      checkString(session, "The session");
      checkFileValue(file);
      checkNonNegativeInteger(now, "The time now");
      const claims = {
        session,
        reference: file.reference,
        mimeType: file.mimeType,
        exp: now + uploadTtlSeconds * MILLISECONDS,
      };
      return `${origin}/f/${await sealToken(FILE_USE, claims, key)}/${encodeURIComponent(file.reference)}`;
    },
    serve: async (request, now) => {
      checkRecord(request, "The request must be an object");
      checkString(request.path, "The path of the request");
      checkNonNegativeInteger(now, "The time now");
      const match = REQUEST_PATH.exec(request.path);
      if (match === null) return refused(404);
      const [, kind = "", token = "", rest = ""] = match;
      return kind === "g" ? servePackage(token, rest, now) : serveFile(token, rest, now);
    },
  };
}
