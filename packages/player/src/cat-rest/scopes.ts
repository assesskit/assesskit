import type { CatOperation } from "./route.js";

/**
 * The OAuth 2.0 scopes of the CAT 1.0 REST binding: `api` enables every endpoint, `configure` the management of sections and
 * `deliver` the management of sessions.
 *
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, section 4.3}
 */
export const CAT_SCOPES = {
  /** Enables every endpoint. */
  api: "https://purl.imsglobal.org/cat/v1p0/scope/api",
  /** Enables Create Section, Get Section and End Section. */
  configure: "https://purl.imsglobal.org/cat/v1p0/scope/configure",
  /** Enables Create Session, Submit Results and End Session. */
  deliver: "https://purl.imsglobal.org/cat/v1p0/scope/deliver",
} as const;

/** The scope, besides `api`, that enables each operation (tables 4.3.2 and 4.3.3 of the binding). */
const OPERATION_SCOPES: Readonly<Record<CatOperation, string>> = {
  createSection: CAT_SCOPES.configure,
  getSection: CAT_SCOPES.configure,
  endSection: CAT_SCOPES.configure,
  createSession: CAT_SCOPES.deliver,
  submitResults: CAT_SCOPES.deliver,
  endSession: CAT_SCOPES.deliver,
};

/**
 * Returns the scopes that enable an operation: `api`, and `configure` for a section or `deliver` for a session.
 *
 * @param operation - One of the six operations of the binding.
 * @returns A token that carries one of them may use the operation.
 * @see {@link https://www.imsglobal.org/spec/cat/v1p0/bind | CAT 1.0 REST/JSON binding, section 4.3}
 */
export function scopesOf(operation: CatOperation): readonly string[] {
  return [CAT_SCOPES.api, OPERATION_SCOPES[operation]];
}
