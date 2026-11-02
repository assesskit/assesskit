import { AssesskitError } from "@assesskit/runtime/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseRecording, RECORDER_START_LIMIT_MS, startRecording } from "../src/player/recording/index.js";
import {
  audioContextRuns,
  fakeMicrophone,
  heardFor,
  needsAudio,
  suspendedAudioContext,
  trackAudioContexts,
  trackedContexts,
} from "./audio.js";
import { STATIC_URL } from "./interactions-fixture.js";
import { waitFor } from "./wait.js";

/** The URL of the worklet that the asset origin of the tests serves. */
const WORKLET = `${STATIC_URL}recorder-worklet.js`;

/** A stream of an oscillator, which a test records in place of the microphone. */
async function tone(): Promise<MediaStream> {
  // A browser starts an audio context only after a gesture of the person.
  await userEvent.click(document.body);
  return fakeMicrophone();
}

/** Reads a WAV header: the fields of RIFF, `fmt ` and `data` (Multimedia Programming Interface and Data Specifications 1.0). */
function header(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string => String.fromCharCode(...bytes.slice(offset, offset + 4));
  return {
    riff: tag(0),
    wave: tag(8),
    fmt: tag(12),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    data: tag(36),
    dataBytes: view.getUint32(40, true),
    riffBytes: view.getUint32(4, true),
  };
}

/** A recorder of the browser that supports the given types, in place of the real one, which differs by engine. */
function recorderOf(...types: readonly string[]): void {
  vi.stubGlobal(
    "MediaRecorder",
    Object.assign(() => undefined, { isTypeSupported: (type: string): boolean => types.includes(type) }),
  );
}

const realSetTimeout = globalThis.setTimeout;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("recording", () => {
  it("records in the first accepted audio type that the recorder of the browser supports, whatever its parameters", () => {
    recorderOf("audio/ogg", "audio/webm");
    expect(chooseRecording(["audio/mpeg", "Audio/OGG; codecs=opus", "audio/webm"])).toEqual({
      kind: "recorder",
      mimeType: "audio/ogg",
    });
  });

  it("records WAV through the worklet when the browser records none of the accepted types and a WAV type is accepted", () => {
    recorderOf();
    expect(chooseRecording(["audio/webm", "audio/wave"])).toEqual({ kind: "wav", mimeType: "audio/wave" });
    expect(chooseRecording(["audio/x-wav"])).toEqual({ kind: "wav", mimeType: "audio/x-wav" });
  });

  it("records nothing for a type that only an encoder would give, or when any file is accepted", () => {
    recorderOf();
    expect(chooseRecording(["audio/mpeg"])).toBeUndefined();
    expect(chooseRecording(["image/png"])).toBeUndefined();
    expect(chooseRecording(undefined)).toBeUndefined();
  });

  it("does not take a WAV type for a type of the recorder of the browser", () => {
    recorderOf("audio/wav", "audio/wave", "audio/x-wav");
    expect(chooseRecording(["audio/wav"])).toEqual({ kind: "wav", mimeType: "audio/wav" });
  });

  it("records WAV or nothing in a browser that has no recorder", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(chooseRecording(["audio/webm", "audio/wav"])).toEqual({ kind: "wav", mimeType: "audio/wav" });
    expect(chooseRecording(["audio/webm"])).toBeUndefined();
  });

  it("records with the recorder of the browser into a blob of the type", async (context) => {
    // The WebKit of Playwright on Linux has no MediaRecorder.
    if (typeof MediaRecorder === "undefined") context.skip();
    await needsAudio(context, audioContextRuns());
    const type = ["audio/webm", "audio/ogg", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    expect(type).toBeDefined();
    trackAudioContexts();
    const stream = await tone();
    const recording = await startRecording(stream, { kind: "recorder", mimeType: type ?? "" }, WORKLET);
    await heardFor(0.2);
    const blob = await recording.stop();
    expect(blob.type).toBe(type);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("gives what was recorded when the tracks of the recorder of the browser ended before the stop", async (context) => {
    if (typeof MediaRecorder === "undefined") context.skip();
    await needsAudio(context, audioContextRuns());
    const type = ["audio/webm", "audio/ogg", "audio/mp4"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
    trackAudioContexts();
    const stream = await tone();
    const started = vi.spyOn(MediaRecorder.prototype, "start");
    const recording = await startRecording(stream, { kind: "recorder", mimeType: type ?? "" }, WORKLET);
    await heardFor(0.2);
    const recorder = started.mock.contexts[0];
    if (recorder === undefined) throw new Error("The recorder did not start.");
    const inactive = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    for (const track of stream.getTracks()) track.stop();
    await inactive;
    // The recorder stopped by itself, so a stop now finds it inactive, and fires no event.
    expect(recorder.state).toBe("inactive");
    const blob = await recording.stop();
    expect(blob.size).toBeGreaterThan(0);
  });

  it("records 16-bit mono PCM through the worklet into a WAV file", async (context) => {
    await needsAudio(context, audioContextRuns());
    trackAudioContexts();
    const stream = await tone();
    const recording = await startRecording(stream, { kind: "wav", mimeType: "audio/wav" }, WORKLET);
    await heardFor(0.4);
    const blob = await recording.stop();
    expect(blob.type).toBe("audio/wav");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fields = header(bytes);
    expect(fields).toMatchObject({
      riff: "RIFF",
      wave: "WAVE",
      fmt: "fmt ",
      format: 1,
      channels: 1,
      bitsPerSample: 16,
      data: "data",
    });
    expect(fields.dataBytes).toBe(bytes.length - 44);
    expect(fields.riffBytes).toBe(bytes.length - 8);
    expect(fields.sampleRate).toBeGreaterThanOrEqual(8000);
    // The worklet delivers blocks of 128 frames, so a recording of a moment holds many of them.
    expect(fields.dataBytes).toBeGreaterThan(0);
    expect(fields.dataBytes % 2).toBe(0);
  });
  describe("the start of a WAV recording", () => {
    const wav = { kind: "wav", mimeType: "audio/wav" } as const;

    it("gives up at the limit when the audio context never runs, and lets go of the context", async () => {
      const contexts = suspendedAudioContext();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let settled = false;
      const outcome = startRecording(new MediaStream(), wav, WORKLET)
        .then(
          () => "started",
          (error: unknown) => error,
        )
        .finally(() => {
          settled = true;
        });
      await vi.advanceTimersByTimeAsync(RECORDER_START_LIMIT_MS - 1);
      expect([settled, contexts.made(), contexts.closed()]).toEqual([false, 1, 0]);
      await vi.advanceTimersByTimeAsync(1);
      const error = await outcome;
      expect(error).toBeInstanceOf(AssesskitError);
      expect((error as Error).message).toContain(`did not run within ${RECORDER_START_LIMIT_MS} ms`);
      expect([contexts.made(), contexts.closed()]).toEqual([1, 1]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("limits the start to the 5 seconds that the guide states", () => {
      expect(RECORDER_START_LIMIT_MS).toBe(5000);
    });

    it("hears of a start that fails after the limit once, and not again", async () => {
      const heard: unknown[] = [];
      const listen = (event: PromiseRejectionEvent): void => void heard.push(event.reason);
      window.addEventListener("unhandledrejection", listen);
      let closed = 0;
      vi.stubGlobal(
        "AudioContext",
        class {
          state = "suspended";
          audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
          resume(): Promise<void> {
            return new Promise((_, failed) =>
              setTimeout(() => failed(new Error("The device failed late.")), RECORDER_START_LIMIT_MS + 1000),
            );
          }
          close(): Promise<void> {
            closed += 1;
            return Promise.resolve();
          }
        },
      );
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const outcome = startRecording(new MediaStream(), wav, WORKLET).then(
        () => "started",
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(RECORDER_START_LIMIT_MS);
      expect(await outcome).toBeInstanceOf(AssesskitError);
      await vi.advanceTimersByTimeAsync(1000);
      await new Promise((done) => realSetTimeout(done, 50));
      window.removeEventListener("unhandledrejection", listen);
      expect([heard, closed]).toEqual([[], 1]);
    });

    it("starts when the context runs just before the limit", async (context) => {
      await needsAudio(context, audioContextRuns());
      const stream = await tone();
      const Real = globalThis.AudioContext;
      const late = RECORDER_START_LIMIT_MS - 1000;
      vi.stubGlobal(
        "AudioContext",
        class extends Real {
          override resume(): Promise<void> {
            return new Promise((running) => setTimeout(() => running(super.resume()), late));
          }
        },
      );
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const started = startRecording(stream, wav, WORKLET);
      await vi.advanceTimersByTimeAsync(late);
      const recording = await started;
      expect(vi.getTimerCount()).toBe(0);
      vi.useRealTimers();
      expect((await recording.stop()).type).toBe("audio/wav");
    });

    it("lets go of the context when the worklet cannot load", async (context) => {
      await needsAudio(context, audioContextRuns());
      trackAudioContexts();
      const stream = await tone();
      await expect(startRecording(stream, wav, `${STATIC_URL}nothing-here/recorder-worklet.js`)).rejects.toThrow();
      const [microphone, recorder] = trackedContexts();
      expect(microphone?.state).toBe("running");
      await waitFor(() => expect(recorder?.state).toBe("closed"));
    });
  });
});
