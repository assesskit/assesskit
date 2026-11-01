// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers and of the status fields are those of the binding.

import { DataError, ReadError, SecurityError } from "@assesskit/runtime/errors";
import { ServiceError } from "../errors.js";
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

/** The statuses of the answers that fail, with the code minor of each; a status that is not here has no code minor. */
const MINORS: ReadonlyMap<number, string> = new Map([
  [400, "invaliddata"],
  [401, "unauthorisedrequest"],
  [404, "unknownobject"],
  [500, "internal_server_error"],
]);

/** Names the system that reports a code minor; the binding asks for the identity of the reporting system. */
const REPORTER = "TargetEndSystem";

/** What the statement of a 404 says, which the binding asks to be presented. */
const UNKNOWN_OBJECT = "Unknown Object";

/** The headers of every answer: the bodies hold a candidate's data, and an intermediary must not keep them. */
const BASE_HEADERS = { "Cache-Control": "no-store" } as const;

/** A failure to answer with: a status of table 2.4 and what to tell the caller. */
export interface Failure {
  readonly status: 400 | 404 | 500;
  readonly description: string;
}

/**
 * Maps an error of the engine to the failure that the binding defines for it.
 *
 * @remarks
 * `DataError`, `ReadError` and `SecurityError` mean the engine refused the data of the request: 400 with the message,
 * which says what to correct. A `ServiceError` with the status 404 means the section or session is unknown, and with 400
 * that the request is bad; its message names an address of the engine's own service, so it is not shown. Anything else
 * is a failure of the engine: 500, and nothing of the error is shown.
 */
export function failureOf(error: unknown): Failure {
  if (error instanceof DataError || error instanceof ReadError || error instanceof SecurityError) {
    return { status: 400, description: error.message };
  }
  if (error instanceof ServiceError && error.status === 404) return { status: 404, description: UNKNOWN_OBJECT };
  if (error instanceof ServiceError && error.status === 400) {
    return { status: 400, description: "The engine refused the request." };
  }
  return { status: 500, description: "The engine failed to answer the request." };
}

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
