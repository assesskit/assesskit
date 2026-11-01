import { DataError } from "@assesskit/runtime/errors";

/** The media type of every body of the binding. */
const JSON_MEDIA_TYPE = "application/json";

/** Concatenates the chunks of a body. */
function join(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads the JSON body of a request, within a limit on its size, for as long as the caller waits.
 *
 * @param request - The request, whose body is read once.
 * @param maxBytes - The most bytes of body; the read stops at the first byte above it.
 * @param signal - The signal of the caller: when it aborts, the stream is cancelled with its reason and nothing more is read.
 * @returns The parsed JSON.
 * @throws `DataError` when the content type is not `application/json`, the body is larger than the limit, empty, not UTF-8,
 * or not JSON.
 * @throws `signal.reason` when the signal aborts.
 */
export async function readJsonBody(request: Request, maxBytes: number, signal: AbortSignal): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== JSON_MEDIA_TYPE) {
    throw new DataError(`The request must have the content type ${JSON_MEDIA_TYPE}, found ${mediaType ?? "none"}.`);
  }
  const tooLarge = new DataError(`The body of the request is larger than the limit of ${maxBytes} bytes.`);
  // The declared length is a hint that spares the read; the count below is what holds.
  if (Number(request.headers.get("content-length")) > maxBytes) throw tooLarge;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = request.body?.getReader();
  const stop = (): void => void reader?.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener("abort", stop, { once: true });
  try {
    while (reader !== undefined) {
      const { done, value } = await reader.read();
      // A cancelled stream reads as done, so the abort is looked at before the end.
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw tooLarge;
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(join(chunks, length));
  } catch {
    throw new DataError("The body of the request is not valid UTF-8.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError(`The body of the request is not JSON${text === "" ? ", it is empty" : ""}.`);
  }
}
