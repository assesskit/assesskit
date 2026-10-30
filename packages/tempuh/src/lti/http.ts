import { checkRecord, checkString, describe } from "../checks.js";
import { DataError } from "../errors.js";

/**
 * A request in a form that does not depend on a web framework. The host builds it from its own request type, and the
 * handlers of this module read only these four properties.
 */
export interface HttpRequest {
  /** The method in upper case, such as `GET` or `POST`. */
  readonly method: string;
  /** The absolute URL of the request, with its query. */
  readonly url: string;
  /** The headers, by name in lower case, such as `cookie` and `origin`. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body as text, or the empty string when the request has none. */
  readonly body: string;
}

/** An answer in a form that does not depend on a web framework. The host sends it. */
export interface HttpResponse {
  /** The HTTP status code. */
  readonly status: number;
  /** The headers, by name. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body as text, or the empty string when the answer has none. */
  readonly body: string;
}

/** Builds an answer with a JSON body and a media type. */
export function jsonResponse(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
  type = "application/json;charset=UTF-8",
): HttpResponse {
  return { status, headers: { "content-type": type, ...headers }, body: JSON.stringify(body) };
}

/** Builds the body of an error answer of OAuth 2.0 (RFC 6749 §5.2) and of the services: an `error` code and a description. */
export function errorBody(error: string, description: string): Record<string, string> {
  return Object.fromEntries([
    ["error", error],
    ["error_description", description],
  ]);
}

const FORM_TYPE = "application/x-www-form-urlencoded";

/**
 * Checks a request, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with a `method`, an absolute `url`, a `body` that are strings, and
 * `headers` that are strings by name in lower case.
 */
export function checkHttpRequest(value: unknown): asserts value is HttpRequest {
  checkRecord(value, "The request must be an object");
  checkString(value.method, "The method of the request");
  checkString(value.url, "The URL of the request");
  if (!URL.canParse(value.url)) {
    throw new DataError(`The URL of the request must be an absolute URL, found ${describe(value.url)}.`);
  }
  checkString(value.body, "The body of the request");
  const { headers } = value;
  checkRecord(headers, "The headers of the request must be an object");
  for (const [name, header] of Object.entries(headers)) {
    checkString(header, `The header ${describe(name)} of the request`);
    if (name !== name.toLowerCase()) {
      throw new DataError(`The header names of the request must be in lower case, found ${describe(name)}.`);
    }
  }
}

/**
 * Checks that a value is an absolute `https` URL. LTI requires HTTPS for every URL of a message and a service
 * (LTI 1.3 Core §3.5).
 *
 * @param label - Names the value in the error message, such as `The option jwksUrl`.
 * @throws `DataError` when it is not.
 */
export function checkHttpsUrl(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!URL.canParse(value) || new URL(value).protocol !== "https:") {
    throw new DataError(`${label} must be an absolute https URL, found ${describe(value)}.`);
  }
}

/** Collects the parameters of a query or a form into a map. */
function collect(parameters: URLSearchParams, where: string): ReadonlyMap<string, string> {
  const collected = new Map<string, string>();
  for (const [name, value] of parameters) {
    // RFC 6749 §3.1: a request parameter must not occur more than once.
    if (collected.has(name)) throw new DataError(`${where} has the parameter ${describe(name)} more than once.`);
    collected.set(name, value);
  }
  return collected;
}

/**
 * Reads the parameters of the query of a request.
 *
 * @throws `DataError` when a parameter occurs more than once.
 */
export function readQuery(request: HttpRequest): ReadonlyMap<string, string> {
  return collect(new URL(request.url).searchParams, "The query of the request");
}

/**
 * Reads the parameters of the form that a request carries.
 *
 * @throws `DataError` when the body is not `application/x-www-form-urlencoded`, or a parameter occurs more than once.
 */
export function readForm(request: HttpRequest): ReadonlyMap<string, string> {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (type !== FORM_TYPE) {
    throw new DataError(`The content type of the request must be ${FORM_TYPE}, found ${describe(type)}.`);
  }
  return collect(new URLSearchParams(request.body), "The form of the request");
}

/** Returns the value of the cookie of that name in the request, or `undefined` when the request has none. */
export function readCookie(request: HttpRequest, name: string): string | undefined {
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at !== -1 && pair.slice(0, at).trim() === name) return pair.slice(at + 1).trim();
  }
  return undefined;
}
