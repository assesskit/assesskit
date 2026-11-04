// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers and of the status fields are those of the binding.

import { DataError, SecurityError, ServiceError } from "@assesskit/runtime/errors";
import { TokenEndpointError } from "./rest-client.js";
import type { CatOperation } from "./route.js";

/** The statuses of the answers that succeed (table 2.4 of the binding). */
const SUCCESS_STATUS: Readonly<Record<CatOperation, number>> = {
  createSection: 201,
  getSection: 200,
  endSection: 204,
  createSession: 201,
  submitResults: 201,
  endSession: 204,
};

/**
 * The code minor of each status that fails: table 2.4 for 400, 401, 404 and 500, and the `default` response of the binding
 * for the others, with the values of its enumeration (`server_busy` as the schema writes it). A status that is not here has
 * no code minor.
 */
const MINORS: ReadonlyMap<number, string> = new Map([
  [400, "invaliddata"],
  [401, "unauthorisedrequest"],
  [403, "forbidden"],
  [404, "unknownobject"],
  [413, "invaliddata"],
  [429, "server_busy"],
  [500, "internal_server_error"],
  [503, "server_busy"],
]);

/** Names the system that reports a code minor; the binding asks for the identity of the reporting system. */
const REPORTER = "TargetEndSystem";

/** What the statement of a 404 says, which the binding asks to be presented. */
const UNKNOWN_OBJECT = "Unknown Object";

/** The text of a failure of the engine or of the host: it never says more, because the cause names addresses and data. */
const FAULT = "The engine failed to answer the request.";

/** The headers of every answer: the bodies hold a candidate's data, and an intermediary must not keep them. */
const BASE_HEADERS = { "Cache-Control": "no-store" } as const;

/** A failure to answer with: a status, what to tell the caller, and whether it is a fault that the operator should see. */
export interface Failure {
  readonly status: 400 | 404 | 413 | 429 | 500 | 503;
  readonly description: string;
  /** Whether the engine or the host failed, which `onError` reports. A refusal of the caller is not a fault. */
  readonly fault: boolean;
}

/**
 * Maps an error of reading the body of a request to the failure that the binding defines for it.
 *
 * @remarks
 * A `SecurityError` of the reader is a body above `maxBodyBytes` or `maxTokens`: 413 with the message, which names the limit.
 * A `DataError` of the readers says what is wrong with the caller's own request, and names the path of the value: 400 with
 * the message. Any other error is not the caller's: a stream that fails, or a body that `authorize` read.
 */
export function bodyFailure(error: unknown): Failure {
  if (error instanceof SecurityError) return { status: 413, description: error.message, fault: false };
  if (error instanceof DataError) return { status: 400, description: error.message, fault: false };
  return { status: 500, description: FAULT, fault: true };
}

/**
 * Maps an error of the port to the failure that the binding defines for it, by the status of its `ServiceError`.
 *
 * @remarks
 * The port refuses with a `ServiceError`, which is also what `createRestCatPort` throws for the answer of an engine: 404 for
 * an object that is unknown, 400 for a request that the engine refuses, 429 and 503 for an engine that is busy. Create
 * Section names no object, so a 404 there is a fault of the engine or of the endpoint of a gateway. A failed request for a
 * token is a fault of the gateway whatever its status, because its credentials or token URL are wrong and the caller did
 * nothing. Every other error is a fault of the engine, whatever its class, and nothing of it is shown: a `DataError` of a
 * gateway names the address of the upstream engine, and one of an engine its own state.
 */
export function portFailure(error: unknown, operation: CatOperation): Failure {
  if (error instanceof ServiceError && !(error instanceof TokenEndpointError)) {
    if (error.status === 404 && operation !== "createSection") {
      return { status: 404, description: UNKNOWN_OBJECT, fault: false };
    }
    if (error.status === 400) return { status: 400, description: "The engine refused the request.", fault: false };
    if (error.status === 429 || error.status === 503) {
      return { status: error.status, description: "The engine is busy; try again later.", fault: false };
    }
  }
  return { status: 500, description: FAULT, fault: true };
}

/** The failure of an answer that the port gave and the binding cannot carry. */
export const ENCODING_FAILURE: Failure = { status: 500, description: FAULT, fault: true };

/** The failure of an authorization step that throws or answers something that is not a decision. */
export const AUTHORIZATION_FAILURE: Failure = {
  status: 500,
  description: "The request could not be authorized.",
  fault: true,
};

/** Returns the answer of a request that fails: the status information of the binding, as JSON. */
export function failureResponse(
  status: number,
  description: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  const minor = MINORS.get(status);
  const body = {
    imsx_codeMajor: minor === undefined ? "unsupported" : "failure",
    imsx_severity: "error",
    imsx_description: description,
    ...(minor === undefined
      ? {}
      : {
          imsx_codeMinor: {
            imsx_codeMinorField: [{ imsx_codeMinorFieldName: REPORTER, imsx_codeMinorFieldValue: minor }],
          },
        }),
  };
  return Response.json(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** Returns the answer of a request that succeeds: the JSON of the answer, or no body for the status 204. */
export function successResponse(operation: CatOperation, json: unknown): Response {
  const status = SUCCESS_STATUS[operation];
  if (status === 204) return new Response(null, { status, headers: BASE_HEADERS });
  return Response.json(json, { status, headers: BASE_HEADERS });
}
