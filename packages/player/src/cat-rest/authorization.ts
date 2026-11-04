// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import type { CatPort } from "@assesskit/runtime/cat";
import { methodsSchema, parseWith } from "@assesskit/runtime/checks";
import * as v from "valibot";
import type { CatOperation } from "./route.js";
import { listScopes } from "./scopes.js";
import { failureResponse } from "./status.js";

/**
 * What an authorization step decides about a request.
 *
 * - `true` serves the request with the port that the handler was created with.
 * - `false` answers 401.
 * - `{ port }` serves the request with that port: the port of the caller, which a host builds over a shared engine with a
 *   check of the owner of each section and session, so that a client cannot read or end the objects of another.
 * - `{ denied: "invalid-token" }` answers 401 with `error="invalid_token"`: the request carries a token that is not valid.
 * - `{ denied: "insufficient-scope" }` answers 403 with the code minor `forbidden` and `error="insufficient_scope"`: the
 *   token is valid and does not carry the scope of the operation. `scopes` names the scopes that would do, by default
 *   those of `listScopes(operation)`.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc6750#section-3.1 | RFC 6750, error codes}
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, security and scopes}
 */
export type CatAuthorization =
  | boolean
  | {
      /** The port that serves this request: the port of the caller. */
      readonly port: CatPort;
    }
  | {
      /** The request carries a token that is not valid. */
      readonly denied: "invalid-token";
    }
  | {
      /** The token is valid and lacks the scope of the operation. */
      readonly denied: "insufficient-scope";
      /** The scopes that would do, as scope tokens; by default those of `listScopes(operation)`. */
      readonly scopes?: readonly string[];
    };

/**
 * Decides whether a request may use an operation, before any of its body is read.
 *
 * @param request - The request, with its body unread. The bearer token is in its `Authorization` header. The step must not
 * read the body: a body that it read cannot be read again, and the request answers 500.
 * @param operation - The operation that the request selects; the scopes of the binding map to it.
 * @returns The decision. A function that throws, or answers another shape, answers 500.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, security and scopes}
 */
export type CatAuthorizer = (request: Request, operation: CatOperation) => CatAuthorization | Promise<CatAuthorization>;

/** A scope token of RFC 6749 section 3.3: printable ASCII without a space, a quote or a backslash. */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/u;

const scopesSchema = v.pipe(
  v.array(v.pipe(v.string(), v.regex(SCOPE_TOKEN, "expected a scope token without a space, a quote or a backslash"))),
  v.minLength(1),
);

const decisionSchema = v.union([
  v.boolean(),
  v.strictObject({
    port: methodsSchema<CatPort>(
      "createSection",
      "getSection",
      "createSession",
      "submitResults",
      "endSession",
      "endSection",
    ),
  }),
  v.strictObject({ denied: v.literal("invalid-token") }),
  v.strictObject({ denied: v.literal("insufficient-scope"), scopes: v.optional(scopesSchema) }),
]);

/** What the handler does after the authorization step: serve with a port (its own when `undefined`), or answer. */
export type Grant =
  | { readonly serve: true; readonly port: CatPort | undefined }
  | { readonly serve: false; readonly response: Response };

/**
 * Reads the result of an authorization step.
 *
 * @throws `DataError` when it is not one of the shapes of {@link CatAuthorization}.
 */
export function grantOf(result: unknown, operation: CatOperation): Grant {
  const decision = parseWith(decisionSchema, result, "The result of authorize");
  if (decision === true) return { serve: true, port: undefined };
  if (decision === false) {
    return {
      serve: false,
      response: failureResponse(401, "The request is not authorized.", { "WWW-Authenticate": "Bearer" }),
    };
  }
  if ("port" in decision) return { serve: true, port: decision.port };
  if (decision.denied === "invalid-token") {
    return {
      serve: false,
      response: failureResponse(401, "The token is not valid.", {
        "WWW-Authenticate": 'Bearer error="invalid_token"',
      }),
    };
  }
  const scopes = decision.scopes ?? listScopes(operation);
  return {
    serve: false,
    response: failureResponse(403, "The token does not carry the scope of this operation.", {
      "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scopes.join(" ")}"`,
    }),
  };
}
