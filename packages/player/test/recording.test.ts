import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodeWav } from "../src/player/recording/wav.js";

/** Reads the 16-bit samples that follow the 44-byte header. */
function samplesOf(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: (bytes.length - 44) / 2 }, (_, index) => view.getInt16(44 + index * 2, true));
}

describe("encodeWav", () => {
  it("writes the header of a WAV file of 16-bit mono PCM, as the Waveform Audio File Format gives it", () => {
    const bytes = encodeWav([new Float32Array([0, 0.5]), new Float32Array([-0.5])], 8000);
    // The bytes of the header of a RIFF WAVE file with 3 frames at 8000 Hz: 36 + 6 bytes of RIFF, PCM format 1, one
    // channel, 8000 frames and 16000 bytes a second, a block of 2 bytes of 16 bits, and 6 bytes of data.
    const header = [
      ...Buffer.from("RIFF"),
      ...[42, 0, 0, 0],
      ...Buffer.from("WAVE"),
      ...Buffer.from("fmt "),
      ...[16, 0, 0, 0, 1, 0, 1, 0],
      ...[0x40, 0x1f, 0, 0],
      ...[0x80, 0x3e, 0, 0],
      ...[2, 0, 16, 0],
      ...Buffer.from("data"),
      ...[6, 0, 0, 0],
    ];
    expect([...bytes.slice(0, 44)]).toEqual(header);
    expect(bytes).toHaveLength(50);
  });

  it("scales a sample to a signed 16-bit integer and clips what is outside −1 to 1", () => {
    const bytes = encodeWav([new Float32Array([0, 1, -1, 0.5, 2, -3])], 44100);
    expect(samplesOf(bytes)).toEqual([0, 32767, -32768, 16383, 32767, -32768]);
  });

  it("writes no samples for no blocks", () => {
    expect(encodeWav([], 48000)).toHaveLength(44);
  });

  it("keeps every sample in order across blocks", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { maxLength: 20 }), { maxLength: 6 }),
        (blocks) => {
          const bytes = encodeWav(
            blocks.map((block) => new Float32Array(block)),
            16000,
          );
          const flat = blocks.flat();
          expect(samplesOf(bytes)).toHaveLength(flat.length);
          const view = new DataView(bytes.buffer);
          expect(view.getUint32(40, true)).toBe(flat.length * 2);
          expect(view.getUint32(4, true)).toBe(bytes.length - 8);
        },
      ),
    );
  });
});
