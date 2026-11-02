import { AssesskitError } from "@assesskit/runtime/errors";
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
  /**
   * Ends the recording and returns what was recorded.
   *
   * @returns The recording as a file.
   */
  stop(): Promise<Blob>;
}

/**
 * Returns a MIME type without its parameters, in lower case.
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc2045#section-5.1 | RFC 2045, the Content-Type header field}
 */
const essenceOf = (mimeType: string): string => (mimeType.split(";")[0] ?? "").trim().toLowerCase();

/**
 * Chooses how to record for the types that an interaction accepts.
 *
 * @remarks
 * The recorder of the browser records in the first accepted audio type that it supports; chosen first, because it is the
 * browser's own encoder. Otherwise an interaction that accepts WAV gets a recording of 16-bit PCM through an audio
 * worklet. Any other interaction gets none: an MP3 encoder would need a dependency.
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

/**
 * The longest a WAV recording may take to start, in milliseconds: the audio context runs, the worklet loads and the graph is
 * connected. That takes tens of milliseconds, and a slow link to the asset origin adds the load of a file of a few
 * kilobytes, so 5 seconds is generous; a context that has not run by then will not, because a browser with no audio
 * output holds it suspended and never settles `resume()`. The limit is short enough that a candidate who is told of the
 * failure has most of a speaking turn left.
 */
export const RECORDER_START_LIMIT_MS = 5000;

/** What a WAV recording keeps once its graph is connected. */
interface WavGraph {
  readonly blocks: Float32Array[];
  readonly source: MediaStreamAudioSourceNode;
  readonly node: AudioWorkletNode;
}

/** Runs the context, loads the worklet and connects the stream to it, so that the samples it delivers are kept. */
async function connectWorklet(context: AudioContext, stream: MediaStream, workletUrl: string): Promise<WavGraph> {
  // A browser may hold a context that no press created suspended, as at a recording that starts by itself.
  await context.resume();
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
  return { blocks, source, node };
}

/**
 * Records the samples that the worklet delivers, and writes them as a WAV file when the recording ends.
 *
 * @remarks
 * A start that fails or takes longer than {@link RECORDER_START_LIMIT_MS} closes the context, so that nothing is held.
 */
async function recordWav(stream: MediaStream, workletUrl: string, mimeType: string): Promise<Recording> {
  const context = new AudioContext();
  const connecting = connectWorklet(context, stream, workletUrl);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new AssesskitError(
            `The audio context did not run within ${RECORDER_START_LIMIT_MS} ms, so the recording did not start. A browser holds it suspended when the device has no audio output; put an audio type that the browser records, such as audio/webm, before audio/wav in the type of the interaction.`,
          ),
        ),
      RECORDER_START_LIMIT_MS,
    );
  });
  let graph: WavGraph;
  try {
    graph = await Promise.race([connecting, limit]);
  } catch (error) {
    // The context closes whether the start failed or timed out; a start that goes on after the limit fails on it unheard,
    // because the race has taken its rejection.
    context.close().catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const { blocks, source, node } = graph;
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
 * @param stream - The stream.
 * @param method - How to record, from {@link chooseRecording}.
 * @param workletUrl - The URL of `recorder-worklet.js`, which a WAV recording loads.
 * @returns The recording under way.
 * @throws `AssesskitError` when a WAV recording does not start within {@link RECORDER_START_LIMIT_MS}, and the error of the
 * browser when its worklet cannot load.
 */
export function startRecording(stream: MediaStream, method: RecordingMethod, workletUrl: string): Promise<Recording> {
  return method.kind === "recorder"
    ? Promise.resolve(recordWithRecorder(stream, method.mimeType))
    : recordWav(stream, workletUrl, method.mimeType);
}
