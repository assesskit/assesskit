/**
 * The program that runs in the audio worklet of a WAV recording: it passes the samples that reach it to the page, in
 * blocks of 128 frames, mixed down to one channel.
 *
 * @remarks
 * `pnpm build` bundles it into the classic script `recorder-worklet.js`, which the page loads from
 * `MountOptions.staticUrl`.
 */
import { RECORDER_PROCESSOR } from "../names.js";

/** The scope of an audio worklet has these, and the libraries of the page do not. */
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

/** Sends the first channel set of the input as one channel: the mean of the channels, frame by frame. */
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs: readonly (readonly Float32Array[])[]): boolean {
    const channels = inputs[0] ?? [];
    const [first] = channels;
    if (first === undefined) return true;
    const mono = new Float32Array(first.length);
    for (const channel of channels) {
      for (let frame = 0; frame < mono.length; frame++)
        mono[frame] = (mono[frame] ?? 0) + (channel[frame] ?? 0) / channels.length;
    }
    this.port.postMessage(mono, [mono.buffer]);
    return true;
  }
}

registerProcessor(RECORDER_PROCESSOR, RecorderProcessor);
