import { RECORDER_PROCESSOR } from "./names.js";
import { encodeWav } from "./wav.js";

/** The MIME types of WAV files, all of which a WAV recording satisfies. */
const WAV_TYPES: readonly string[] = ["audio/wav", "audio/wave", "audio/x-wav"];

/** How a recording is made: by the recorder of the browser in a type, or into a WAV file through a worklet. */
export type RecordingMethod =
  | { readonly kind: "recorder"; readonly mimeType: string }
  | { readonly kind: "wav"; readonly mimeType: string };

/** A recording that is under way. */
export interface Recording {
  /** Ends the recording and returns what was recorded. */
  stop(): Promise<Blob>;
}

/** Returns a MIME type without its parameters, in lower case (RFC 2045 §5.1). */
const essenceOf = (mimeType: string): string => (mimeType.split(";")[0] ?? "").trim().toLowerCase();

/**
 * Chooses how to record for the types that an interaction accepts (the player design §2.5). The recorder of the browser
 * records in the first accepted audio type that it supports; chosen first, because it is the browser's own encoder.
 * Otherwise an interaction that accepts WAV gets a recording of 16-bit PCM through an audio worklet. Any other
 * interaction gets none: an MP3 encoder would need a dependency.
 *
 * @param accepted - The MIME types that the interaction accepts; `undefined` for any, which names no audio type.
 * @returns The method, or `undefined` when the browser cannot record in an accepted type.
 */
export function chooseRecording(accepted: readonly string[] | undefined): RecordingMethod | undefined {
  const types = (accepted ?? []).map(essenceOf).filter((type) => type.startsWith("audio/"));
  // Playwright's WebKit on Linux, where the tests run, has no MediaRecorder; such a browser records WAV or nothing.
  const recorder = typeof MediaRecorder === "undefined" ? undefined : MediaRecorder;
  const supported = types.find((type) => !WAV_TYPES.includes(type) && recorder?.isTypeSupported(type) === true);
  if (supported !== undefined) return { kind: "recorder", mimeType: supported };
  const wav = types.find((type) => WAV_TYPES.includes(type));
  return wav === undefined ? undefined : { kind: "wav", mimeType: wav };
}

/** Records with the recorder of the browser. */
function recordWithRecorder(stream: MediaStream, mimeType: string): Recording {
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.addEventListener("dataavailable", (event) => chunks.push(event.data));
  recorder.start();
  return {
    stop: () =>
      new Promise((resolve) => {
        recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mimeType })), { once: true });
        recorder.stop();
      }),
  };
}

/** Records the samples that the worklet delivers, and writes them as a WAV file when the recording ends. */
async function recordWav(stream: MediaStream, workletUrl: string, mimeType: string): Promise<Recording> {
  const context = new AudioContext();
  await context.audioWorklet.addModule(workletUrl);
  const blocks: Float32Array[] = [];
  const node = new AudioWorkletNode(context, RECORDER_PROCESSOR);
  node.port.addEventListener("message", (event) => blocks.push(event.data));
  node.port.start();
  const source = context.createMediaStreamSource(stream);
  // A node that nothing listens to may be left out of the graph, so the worklet is connected to a gain of zero.
  const silence = context.createGain();
  silence.gain.value = 0;
  source.connect(node);
  node.connect(silence);
  silence.connect(context.destination);
  return {
    stop: async () => {
      source.disconnect();
      node.disconnect();
      await context.close();
      return new Blob([encodeWav(blocks, context.sampleRate)], { type: mimeType });
    },
  };
}

/**
 * Starts recording a stream of the microphone.
 *
 * @param workletUrl - The URL of `recorder-worklet.js`, which a WAV recording loads.
 */
export function startRecording(stream: MediaStream, method: RecordingMethod, workletUrl: string): Promise<Recording> {
  return method.kind === "recorder"
    ? Promise.resolve(recordWithRecorder(stream, method.mimeType))
    : recordWav(stream, workletUrl, method.mimeType);
}
