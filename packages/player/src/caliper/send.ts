// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.
import { DataError } from "@assesskit/runtime/errors";
import {
  checkArray,
  checkFunction,
  checkHttpsUrl,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  checkString,
  describe,
} from "../checks.js";
import { ServiceError } from "../errors.js";
import { CALIPER_CONTEXT, type CaliperEvent } from "./model.js";
import { caliperTime } from "./time.js";

/** The time that a call to the endpoint may take when the host sets none, in milliseconds. */
export const DEFAULT_CALIPER_TIMEOUT_MS = 10_000;

// The credential of the Bearer scheme is a b64token (RFC 6750 section 2.1).
const BEARER_TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/u;

/** A request of the sensor: the part of `RequestInit` that it uses. */
export interface CaliperFetchInit {
  /** Always `POST` (Caliper 1.2 section 5.4). */
  readonly method: "POST";
  /** The headers: the media type, and the bearer token. */
  readonly headers: Readonly<Record<string, string>>;
  /** The envelope as JSON. */
  readonly body: string;
  /** Always `error`: a redirect would send the bearer token to another address. */
  readonly redirect: "error";
  /** Aborts the request when it takes longer than the timeout. */
  readonly signal: AbortSignal;
}

/** The answer of the endpoint: the part of `Response` that the sensor uses. */
export interface CaliperFetchResponse {
  /** Whether the status is from 200 to 299. */
  readonly ok: boolean;
  /** The HTTP status. */
  readonly status: number;
  /** Returns the body as text. */
  text(): Promise<string>;
}

/** The part of `fetch` that the sensor uses, so that a host can pass `fetch`, or a replacement. */
export type CaliperFetch = (url: string, init: CaliperFetchInit) => Promise<CaliperFetchResponse>;

/** Where and as whom `sendCaliper` sends. */
export interface CaliperSender {
  /** The address of the Caliper endpoint, an `https` URL (Caliper 1.2 section 5.4 requires TLS). */
  readonly endpoint: string;
  /** The bearer token that the endpoint validates (RFC 6750 section 2.1). */
  readonly token: string;
  /** Sends the request. */
  readonly fetch: CaliperFetch;
  /** The IRI that identifies the sensor, which is the application that sends. */
  readonly sensor: string;
  /**
   * The most time in milliseconds that the call may take, from the request to the last byte of the answer.
   *
   * @defaultValue {@link DEFAULT_CALIPER_TIMEOUT_MS}, `10000`
   */
  readonly timeoutMs?: number;
}

/** The options of {@link sendCaliper}: the sender, and when it sends. */
export interface SendCaliperOptions extends CaliperSender {
  /** The time at which the sensor issues the message, in epoch milliseconds. A resend has the time of the resend. */
  readonly sendTime: number;
}

/** Checks the events to send: at least one, each an event with the Caliper context and an identifier. */
function checkEvents(events: unknown): asserts events is readonly CaliperEvent[] {
  checkArray(events, "The Caliper events must be an array");
  if (events.length === 0) throw new DataError("The Caliper events must have at least one event, as an envelope does.");
  events.forEach((event, at) => {
    checkRecord(event, `The Caliper event ${at} must be an object`);
    if (event["@context"] !== CALIPER_CONTEXT) {
      throw new DataError(
        `The @context of the Caliper event ${at} must be ${CALIPER_CONTEXT}, found ${describe(event["@context"])}.`,
      );
    }
    checkNonEmptyString(event.id, `The id of the Caliper event ${at}`);
  });
}

/** Checks the options, as a host passes them from JavaScript. */
function checkOptions(value: unknown): asserts value is SendCaliperOptions {
  checkRecord(value, "The options must be an object");
  checkHttpsUrl(value.endpoint, "The option endpoint");
  checkString(value.token, "The option token");
  if (!BEARER_TOKEN.test(value.token)) {
    throw new DataError(
      "The option token must be a bearer token of RFC 6750 section 2.1: letters, digits and -._~+/, then =.",
    );
  }
  checkFunction(value.fetch, "The option fetch must be a function");
  checkNonEmptyString(value.sensor, "The option sensor");
  if (value.timeoutMs !== undefined) checkPositiveInteger(value.timeoutMs, "The option timeoutMs");
}

/**
 * Sends events to a Caliper endpoint in one envelope.
 *
 * @remarks
 * The request is a POST over HTTPS with the media type `application/json` and the bearer token. A redirect is an error,
 * because it would send the token elsewhere.
 *
 * Resending events duplicates nothing: an endpoint identifies an event by its `id`, which `caliperEvents` makes from the
 * session, the step and the position, so the same step always gives the same identifiers.
 *
 * @param events - The events, at least one.
 * @param options - The endpoint, the token, `fetch`, the sensor and the time of sending.
 * @returns Nothing; the promise resolves when the endpoint answered with a status from 200 to 299.
 * @throws `DataError` when an argument has the wrong type.
 * @throws `ServiceError` with status `0` when the endpoint did not answer, and with its status and body when it answered
 * with another status than 2xx; Caliper names 400, 401, 415 and 422.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2 | Caliper Analytics 1.2}, transport
 */
export async function sendCaliper(events: readonly CaliperEvent[], options: SendCaliperOptions): Promise<void> {
  checkOptions(options);
  checkEvents(events);
  const { endpoint, token, sensor, sendTime, timeoutMs = DEFAULT_CALIPER_TIMEOUT_MS } = options;
  const envelope = {
    sensor,
    sendTime: caliperTime(sendTime, "The option sendTime"),
    dataVersion: CALIPER_CONTEXT,
    data: events,
  };
  let response: CaliperFetchResponse;
  let answer: string;
  try {
    response = await options.fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(envelope),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The body is read even when it is empty, so that the connection is free again.
    answer = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ServiceError(`The Caliper endpoint at ${endpoint} did not answer: ${reason}.`, 0, "");
  }
  if (!response.ok) {
    throw new ServiceError(`The Caliper endpoint at ${endpoint} answered ${response.status}.`, response.status, answer);
  }
}
