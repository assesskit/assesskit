import { ServiceError } from "../errors.js";

/** The most bytes that a platform's answer may have: a key set or a token response is a few kilobytes. */
const MAX_RESPONSE_BYTES = 65_536;

/** The time that a call to a service may take when the host sets none, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The part of the web standard `fetch` that the tool role calls. A host passes `fetch`; a test passes a function that
 * records the requests and answers them.
 */
export type Fetch = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly redirect: "error";
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

/** What a call to a service needs: the `fetch` of the host and the time it may take. */
export interface ServiceCall {
  /** The `fetch` that makes the request. */
  readonly fetch: Fetch;
  /** The most time in milliseconds that the call may take, from the request to the last byte of the answer. */
  readonly timeoutMs: number;
}

/** Reads the body of an answer as text, up to the limit, and stops reading there. */
async function readText(response: Response): Promise<{ readonly text: string; readonly complete: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) return { text: "", complete: true };
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), complete: true };
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { text, complete: false };
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Calls a service of a platform and returns the body of its successful answer.
 *
 * @remarks
 * A redirect is an error, because it could lead from HTTPS to another scheme. The call has a time limit, and its answer
 * a size limit.
 *
 * @param what - Names the service in the error messages, such as `The key set at https://platform.example/jwks`.
 * @throws `ServiceError` with status `0` when the service did not answer, and with its status when it did not answer
 * with a success or answered with more than the limit.
 */
export async function callService(
  service: ServiceCall,
  what: string,
  url: string,
  init: { readonly method: "GET" | "POST"; readonly headers: Readonly<Record<string, string>>; readonly body?: string },
): Promise<string> {
  let response: Response;
  let answer: { readonly text: string; readonly complete: boolean };
  const signal = AbortSignal.timeout(service.timeoutMs);
  try {
    response = await service.fetch(url, { ...init, redirect: "error", signal });
    answer = await readText(response);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ServiceError(`${what} did not answer: ${reason}.`, 0, "");
  }
  if (!response.ok) throw new ServiceError(`${what} answered ${response.status}.`, response.status, answer.text);
  if (!answer.complete) {
    throw new ServiceError(
      `${what} answered with more than ${MAX_RESPONSE_BYTES} bytes.`,
      response.status,
      answer.text,
    );
  }
  return answer.text;
}
