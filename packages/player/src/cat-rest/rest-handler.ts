// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import type { CatPort } from "@assesskit/runtime/cat";
import {
  functionSchema,
  guardSchema,
  methodsSchema,
  parseWith,
  positiveIntegerSchema,
  untilAborted,
} from "@assesskit/runtime/checks";
import * as v from "valibot";
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
import { type CatOperation, matchRoute, type PathIdentifiers } from "./route.js";
import { failureOf, failureResponse, successResponse } from "./status.js";

/**
 * Decides whether a request may use an operation.
 *
 * @param request - The request, whose body is not read yet. The bearer token is in its `Authorization` header.
 * @param operation - The operation that the request selects; the scopes of the binding map to it.
 * @returns `true` to serve the request; anything else answers 401. A function that throws answers 500.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, security and scopes}
 */
export type CatAuthenticate = (request: Request, operation: CatOperation) => boolean | Promise<boolean>;

/** Options of {@link catRestHandler}. */
export interface CatRestHandlerOptions {
  /** Decides whether a request is authorized; the handler serves nothing without it. */
  readonly authenticate: CatAuthenticate;
  /**
   * The path under which the six endpoints are served, from the root of the host, with no trailing slash. The binding
   * fixes it as `/ims/cat/v1p0`.
   *
   * @defaultValue `"/ims/cat/v1p0"`
   */
  readonly root?: string;
  /**
   * The most bytes of a request body. A larger body answers 400 and is not read to its end.
   *
   * @defaultValue `33554432` (32 MiB, the default size limit of an XML file in the runtime, which the largest field of a body holds in base64)
   */
  readonly maxBodyBytes?: number;
}

/** The path of the endpoints in the binding (section 2.2). */
const DEFAULT_ROOT = "/ims/cat/v1p0";

/** The default size limit of a request body, in bytes: that of an XML file in the runtime, 32 MiB. */
const DEFAULT_MAX_BODY_BYTES = 33_554_432;

const rootSchema = v.pipe(
  v.string(),
  v.check(
    (root) => root.startsWith("/") && !root.endsWith("/"),
    (issue) => `expected a path that starts with a slash and does not end with one, found ${issue.received}`,
  ),
);

const optionsSchema = v.strictObject({
  authenticate: functionSchema<CatAuthenticate>(),
  root: v.optional(rootSchema, DEFAULT_ROOT),
  maxBodyBytes: v.optional(positiveIntegerSchema, DEFAULT_MAX_BODY_BYTES),
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

/** Calls the port and returns the function that encodes its answer, so that a failure of the port is told from one of the encoding. */
type Invocation = () => Promise<() => unknown>;

/**
 * Returns the engine side of the REST/JSON binding of CAT 1.0: a function from a web `Request` to a `Response`.
 *
 * @remarks
 * It is the mirror of `restCatPort`, over web-standard `Request` and `Response`, so that it runs on Node.js, Deno, Bun and
 * edge runtimes; mount it on the paths under `root`. It serves the six requests of the binding, reads their bodies with
 * the codec of the runtime and the shapes of `restCatPort`, and calls the `CatPort` with the URL prefix of the request
 * (its origin and `root`).
 *
 * - **Order.** The path and method select the operation (404 or 405 if none), `authenticate` decides (401), then the body
 *   is read and checked (400), then the port is called.
 * - **Authorization.** The handler holds no credentials. The authorization server issues the tokens of the OAuth 2.0
 *   client credentials grant, and `authenticate` checks the bearer token and its scope. TLS is the host's.
 * - **Failures.** The answers are those of table 2.4 of the binding, with the status information as JSON. The port
 *   signals an unknown section or session with a `ServiceError` of status 404; a `DataError`, `ReadError` or
 *   `SecurityError` answers 400 with its message; any other error, an `authenticate` that throws, and an answer of the
 *   port that is not valid answer 500 without the message.
 * - **Abort.** A request whose signal aborts ends the wait: the promise rejects with the reason, nothing is sent, and the
 *   port is not called when the abort came first. A call of the port that has begun runs on, because `CatPort` takes no
 *   signal.
 * - **Metadata.** A `qtiMetadata` object of Create Section is checked and dropped, and the metadata file of the section
 *   data is not returned by Get Section, because the binding gives the file no place (see the guide).
 * - **Session end.** A stage without items is sent as no `nextItems`, which is how the binding ends a session.
 *
 * To log the failures of the engine, wrap the port: the handler logs nothing.
 *
 * @param port - The engine.
 * @param options - Authentication, the root path and the size limit of a body.
 * @returns The handler.
 * @throws `DataError` when `port` lacks a method or an option has the wrong type.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding}
 */
export function catRestHandler(port: CatPort, options: CatRestHandlerOptions): (request: Request) => Promise<Response> {
  parseWith(portSchema, port, "The port");
  const { authenticate, root, maxBodyBytes } = parseWith(optionsSchema, options, "The options object");

  /** Reads the body of an operation and returns what calls the port. */
  const invocation = async (
    operation: CatOperation,
    { sectionIdentifier, sessionIdentifier }: PathIdentifiers,
    prefix: string,
    request: Request,
  ): Promise<Invocation> => {
    const body = (): Promise<unknown> => readJsonBody(request, maxBodyBytes);
    switch (operation) {
      case "createSection": {
        const data = readSectionBody(await body());
        return async () => {
          const answer = await port.createSection(prefix, data);
          return () => writeCreateSectionAnswer(answer);
        };
      }
      case "getSection":
        return async () => {
          const answer = await port.getSection(prefix, sectionIdentifier);
          return () => writeGetSectionAnswer(answer);
        };
      case "endSection":
        return async () => {
          await port.endSection(prefix, sectionIdentifier);
          return () => undefined;
        };
      case "createSession": {
        const session = readCreateSessionBody(await body());
        return async () => {
          const answer = await port.createSession(prefix, sectionIdentifier, session);
          return () => writeCreateSessionAnswer(answer);
        };
      }
      case "submitResults": {
        const results = readResultsBody(await body());
        return async () => {
          const answer = await port.submitResults(prefix, sectionIdentifier, sessionIdentifier, results);
          return () => writeSubmitResultsAnswer(answer);
        };
      }
      case "endSession":
        return async () => {
          await port.endSession(prefix, sectionIdentifier, sessionIdentifier);
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

    let authorized: boolean;
    try {
      authorized = (await authenticate(request, operation)) === true;
    } catch {
      signal.throwIfAborted();
      return failureResponse(500, "The request could not be authorized.");
    }
    if (!authorized) return failureResponse(401, "The request is not authorized.", { "WWW-Authenticate": "Bearer" });

    let invoke: Invocation;
    try {
      invoke = await invocation(operation, identifiers, `${url.origin}${root}`, request);
    } catch (error) {
      signal.throwIfAborted();
      const { status, description } = failureOf(error);
      return failureResponse(status, description);
    }
    signal.throwIfAborted();

    let encode: () => unknown;
    try {
      encode = await invoke();
    } catch (error) {
      const { status, description } = failureOf(error);
      return failureResponse(status, description);
    }
    try {
      return successResponse(operation, encode());
    } catch {
      return failureResponse(500, "The engine failed to answer the request.");
    }
  };

  return async (request) => {
    parseWith(requestSchema, request, "The request");
    request.signal.throwIfAborted();
    return untilAborted(answer(request), request.signal);
  };
}
