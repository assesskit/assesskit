import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { chooseRecording, startRecording } from "../src/player/recording/index.js";
import { audioContextRuns, needsAudio } from "./audio.js";
import { STATIC_URL } from "./interactions-fixture.js";

/** The URL of the worklet that the asset origin of the tests serves. */
const WORKLET = `${STATIC_URL}recorder-worklet.js`;

/** A stream of an oscillator, which a test records in place of the microphone. */
async function tone(): Promise<MediaStream> {
  // A browser starts an audio context only after a gesture of the person.
  await userEvent.click(document.body);
  const context = new AudioContext();
  await context.resume();
  const oscillator = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  return destination.stream;
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

afterEach(() => {
  vi.unstubAllGlobals();
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
    const recording = await startRecording(await tone(), { kind: "recorder", mimeType: type ?? "" }, WORKLET);
    await new Promise((done) => setTimeout(done, 200));
    const blob = await recording.stop();
    expect(blob.type).toBe(type);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("records 16-bit mono PCM through the worklet into a WAV file", async (context) => {
    await needsAudio(context, audioContextRuns());
    const stream = await tone();
    const recording = await startRecording(stream, { kind: "wav", mimeType: "audio/wav" }, WORKLET);
    await new Promise((done) => setTimeout(done, 400));
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
});
