// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import type { CatPort } from "@assesskit/runtime/cat";
import {
  functionSchema,
  guardSchema,
  methodsSchema,
  parseWith,
  positiveIntegerSchema,
  raceAbort,
} from "@assesskit/runtime/checks";
import * as v from "valibot";
import { httpsUrlSchema } from "../checks.js";
import { type CatAuthorizer, grantOf } from "./authorization.js";
import {
  readCreateSessionBody,
  readResultsBody,
  readSectionBody,
  writeCreateSectionAnswer,
  writeCreateSessionAnswer,
  writeGetSectionAnswer,
  writeSubmitResultsAnswer,
} from "./binding.js";
import { readJsonBody } from "./body.js";
import { DEFAULT_MAX_TOKENS } from "./json-tokens.js";
import { type CatOperation, matchRoute, type PathIdentifiers } from "./route.js";
import {
  AUTHORIZATION_FAILURE,
  bodyFailure,
  ENCODING_FAILURE,
  type Failure,
  failureResponse,
  portFailure,
  successResponse,
} from "./status.js";

/** Options of {@link createCatRestHandler}. */
export interface CatRestHandlerOptions {
  /** Decides whether a request may use an operation, and with which port; the handler serves nothing without it. */
  readonly authorize: CatAuthorizer;
  /**
   * The path that the handler receives, from the root of the host, with no trailing slash, or `""` where a proxy strips the
   * path. The binding asks the public paths to begin with `/ims/cat/v1p0`; another root is for a proxy that rewrites the
   * path.
   *
   * @defaultValue `"/ims/cat/v1p0"`
   */
  readonly root?: string;
  /**
   * The reference that every call of the port receives as its `prefix`: the address of the engine as the
   * `qti-adaptive-engine-ref` of its sections names it, an `https` URL. Trailing slashes are removed. Set it for a public
   * deployment: the URL of a request is internal behind a proxy, and its host may come from a header.
   *
   * @defaultValue the origin and `root` of the request
   */
  readonly prefix?: string;
  /**
   * The most bytes of a request body, counted as the stream is read. A larger body answers 400 and is not read to its end.
   * It holds a base64 field of about 24 MiB of file.
   *
   * @defaultValue `33554432` (32 MiB, the default size limit of an XML file in the runtime)
   */
  readonly maxBodyBytes?: number;
  /**
   * The most tokens of the JSON of a request body, counted before it is parsed: a structural character, a string, a number
   * or a literal each count one. A body with more answers 400. The memory of a parse follows its tokens, not its bytes:
   * 32 MiB of empty objects parse into more than a gigabyte, and a million tokens into tens of megabytes. A base64 file is
   * one token, and a report of a section of a hundred items a few tens of thousands.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
  /**
   * Receives the error behind every answer of 500, with the request and the operation, so that an operator sees what failed.
   * It is not called for a refusal of the caller (4xx), for an engine that is busy (429, 503), or after an abort, when
   * nothing is answered. An error or a rejection of the callback is ignored, and it is not awaited. What it receives may hold
   * addresses, tokens or candidate data.
   *
   * @defaultValue none
   */
  readonly onError?: (error: unknown, request: Request, operation: CatOperation) => void;
}

/** The path of the endpoints in the binding (section 2.2). */
const DEFAULT_ROOT = "/ims/cat/v1p0";

/** The default size limit of a request body, in bytes: that of an XML file in the runtime, 32 MiB. */
const DEFAULT_MAX_BODY_BYTES = 33_554_432;

const rootSchema = v.pipe(
  v.string(),
  v.check(
    (root) => root === "" || (root.startsWith("/") && !root.endsWith("/")),
    (issue) => `expected "" or a path that starts with a slash and does not end with one, found ${issue.received}`,
  ),
);

const optionsSchema = v.strictObject({
  authorize: functionSchema<CatAuthorizer>(),
  root: v.optional(rootSchema, DEFAULT_ROOT),
  prefix: v.optional(httpsUrlSchema),
  maxBodyBytes: v.optional(positiveIntegerSchema, DEFAULT_MAX_BODY_BYTES),
  maxTokens: v.optional(positiveIntegerSchema, DEFAULT_MAX_TOKENS),
  onError: v.optional(functionSchema<NonNullable<CatRestHandlerOptions["onError"]>>()),
});

const portSchema = methodsSchema<CatPort>(
  "createSection",
  "getSection",
  "createSession",
  "submitResults",
  "endSession",
  "endSection",
);

const requestSchema = guardSchema((value): value is Request => value instanceof Request, "a Request");

/** Removes the slashes that end a URL, so that a reference with and without one is the same. */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

/** Calls the port and returns the function that encodes its answer, so that a failure of the port is told from one of the encoding. */
type Invocation = () => Promise<() => unknown>;

/**
 * Returns the engine side of the REST/JSON binding of CAT 1.0: a function from a web `Request` to a `Response`.
 *
 * @remarks
 * It is the mirror of `createRestCatPort`, over web-standard `Request` and `Response`, so that it runs on Node.js, Deno, Bun
 * and edge runtimes; mount it on the paths under `root`. It serves the six requests of the binding, reads their bodies with
 * the codec of the runtime and the shapes of `createRestCatPort`, and calls the `CatPort` with the `prefix` of the engine.
 *
 * - **Order.** The path and method select the operation (404 or 405 if none), `authorize` decides (401 or 403) before any of
 *   the body is read, then the body is read and checked (400), then the port is called.
 * - **Authorization.** The handler holds no credentials. The authorization server issues the tokens of the OAuth 2.0
 *   client credentials grant, and `authorize` checks the bearer token and its scope. It may answer with the port of the
 *   caller, so that several clients share one root and one engine without seeing each other's sections. TLS is the host's.
 * - **Failures.** The answers are those of table 2.4 of the binding and its `default` response, with the status
 *   information as JSON. The status follows the origin of the error: a malformed request is 400 with the path of the value;
 *   a `ServiceError` of the port is 404 (an unknown object, but not for Create Section), 400, or 429 and 503 for an engine
 *   that is busy; every other error of the port, of `authorize` or of the encoding is 500 with a fixed text, and goes to
 *   `onError`.
 * - **Abort.** A request whose signal aborts ends the wait: the promise rejects with the reason, nothing is sent, the read of
 *   the body is cancelled, and the port is not called when the abort came first. A call of the port that has begun runs
 *   on, because `CatPort` takes no signal.
 * - **Metadata.** A `qtiMetadata` object of Create Section reaches the port as `qtiMetadataRecord`, and Get Section returns
 *   it. The metadata file of the section data is not returned, because the binding gives the file no place (see the guide).
 * - **Session end.** A stage without items is sent as no `nextItems`, which is how the binding ends a session.
 *
 * @param port - The engine, for a request that `authorize` answers with `true`.
 * @param options - Authorization, the root path, the reference, the size limits of a body and the callback for faults.
 * @returns The handler.
 * @throws `DataError` when `port` lacks a method or an option has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding}
 */
export function createCatRestHandler(
  port: CatPort,
  options: CatRestHandlerOptions,
): (request: Request) => Promise<Response> {
  parseWith(portSchema, port, "The port");
  const { authorize, root, prefix, maxBodyBytes, maxTokens, onError } = parseWith(
    optionsSchema,
    options,
    "The options object",
  );
  const limits = { maxBytes: maxBodyBytes, maxTokens };
  const reference = prefix === undefined ? undefined : withoutTrailingSlashes(prefix);

  /** Tells the operator about a fault, never after an abort, and never lets the callback change the answer. */
  const report = (error: unknown, request: Request, operation: CatOperation): void => {
    if (onError === undefined || request.signal.aborted) return;
    try {
      Promise.resolve(onError(error, request, operation)).catch(() => undefined);
    } catch {
      // The answer is 500 already.
    }
  };

  /** Reads the body of an operation and returns what calls the port. */
  const invocation = async (
    operation: CatOperation,
    { sectionIdentifier, sessionIdentifier }: PathIdentifiers,
    engine: CatPort,
    engineReference: string,
    request: Request,
  ): Promise<Invocation> => {
    const body = (): Promise<unknown> => readJsonBody(request, limits, request.signal);
    switch (operation) {
      case "createSection": {
        const data = readSectionBody(await body());
        return async () => {
          const answer = await engine.createSection(engineReference, data);
          return () => writeCreateSectionAnswer(answer);
        };
      }
      case "getSection":
        return async () => {
          const answer = await engine.getSection(engineReference, sectionIdentifier);
          return () => writeGetSectionAnswer(answer);
        };
      case "endSection":
        return async () => {
          await engine.endSection(engineReference, sectionIdentifier);
          return () => undefined;
        };
      case "createSession": {
        const session = readCreateSessionBody(await body());
        return async () => {
          const answer = await engine.createSession(engineReference, sectionIdentifier, session);
          return () => writeCreateSessionAnswer(answer);
        };
      }
      case "submitResults": {
        const results = readResultsBody(await body());
        return async () => {
          const answer = await engine.submitResults(engineReference, sectionIdentifier, sessionIdentifier, results);
          return () => writeSubmitResultsAnswer(answer);
        };
      }
      case "endSession":
        return async () => {
          await engine.endSession(engineReference, sectionIdentifier, sessionIdentifier);
          return () => undefined;
        };
    }
  };

  const answer = async (request: Request): Promise<Response> => {
    const { signal } = request;
    const url = new URL(request.url);
    const route = matchRoute(url.pathname, request.method, root);
    switch (route.kind) {
      case "none":
        return failureResponse(404, "Unknown Object: the path is not an endpoint of the CAT binding.");
      case "malformed":
        return failureResponse(400, "The path holds an identifier that is not valid percent-encoding.");
      case "method":
        return failureResponse(405, "The method is not allowed for this endpoint.", { Allow: route.allow.join(", ") });
      case "operation":
        break;
    }
    const { operation, identifiers } = route;

    /** Answers a failure, and reports it when it is a fault of the engine or of the host. */
    const failed = (failure: Failure, cause: unknown): Response => {
      signal.throwIfAborted();
      if (failure.fault) report(cause, request, operation);
      return failureResponse(failure.status, failure.description);
    };

    let granted: ReturnType<typeof grantOf>;
    try {
      granted = grantOf(await authorize(request, operation), operation);
    } catch (error) {
      return failed(AUTHORIZATION_FAILURE, error);
    }
    signal.throwIfAborted();
    if (!granted.serve) return granted.response;

    let invoke: Invocation;
    try {
      invoke = await invocation(
        operation,
        identifiers,
        granted.port ?? port,
        reference ?? `${url.origin}${root}`,
        request,
      );
    } catch (error) {
      return failed(bodyFailure(error), error);
    }

    let encode: () => unknown;
    try {
      encode = await invoke();
    } catch (error) {
      return failed(portFailure(error, operation), error);
    }
    try {
      return successResponse(operation, encode());
    } catch (error) {
      return failed(ENCODING_FAILURE, error);
    }
  };

  return async (request) => {
    parseWith(requestSchema, request, "The request");
    request.signal.throwIfAborted();
    return raceAbort(answer(request), { signal: request.signal });
  };
}
