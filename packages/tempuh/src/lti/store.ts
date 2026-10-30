import { checkFunction, checkNonEmptyString, checkNonNegativeInteger, checkRecord } from "../checks.js";

/** What the tool remembers of a login between the authentication request and the launch. */
export interface LoginRecord {
  /** The `nonce` of the authentication request, which the `id_token` must carry. */
  readonly nonce: string;
  /** The issuer of the platform that started the login. */
  readonly issuer: string;
  /** The client identifier of the tool at that platform. */
  readonly clientId: string;
  /** The `lti_storage_target` of the initiation, absent when the state lives in a cookie. */
  readonly storageTarget?: string;
  /** The time in milliseconds since 1970-01-01T00:00:00Z at which the login stops being valid. */
  readonly expiresAt: number;
}

/**
 * The host's record of the logins in progress, by `state`. It keeps the `nonce` single-use: a login completes once.
 * Records past `expiresAt` may be deleted.
 */
export interface LtiStore {
  /** Saves the record of a new login under its `state`. */
  put(state: string, record: LoginRecord): Promise<void>;
  /** Returns the record saved under a `state`, or `undefined` when there is none. */
  get(state: string): Promise<LoginRecord | undefined>;
  /** Deletes the record under a `state` and returns whether there was one. A concurrent second call returns `false`. */
  delete(state: string): Promise<boolean>;
}

/**
 * Checks a store, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with the functions `put`, `get` and `delete`.
 */
export function checkLtiStore(value: unknown): asserts value is LtiStore {
  checkRecord(value, "The option store must be an object");
  checkFunction(value.put, "The function put of the option store must be a function");
  checkFunction(value.get, "The function get of the option store must be a function");
  checkFunction(value.delete, "The function delete of the option store must be a function");
}

/**
 * Checks a record that the store returned, because the store is the host's code.
 *
 * @throws `DataError` when it is not a login record.
 */
export function checkLoginRecord(value: unknown): asserts value is LoginRecord {
  checkRecord(value, "The login record must be an object");
  checkNonEmptyString(value.nonce, "The nonce of a login record");
  checkNonEmptyString(value.issuer, "The issuer of a login record");
  checkNonEmptyString(value.clientId, "The client identifier of a login record");
  if (value.storageTarget !== undefined) {
    checkNonEmptyString(value.storageTarget, "The storage target of a login record");
  }
  checkNonNegativeInteger(value.expiresAt, "The expiry of a login record");
}
