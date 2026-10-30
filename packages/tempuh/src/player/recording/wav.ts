/** The size of the header of a WAV file of PCM samples (RIFF, `fmt ` and `data` chunk headers). */
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const PCM = 1;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const FMT_CHUNK_BYTES = 16;
const INT16_MAX = 0x7fff;
const INT16_MIN = 0x8000;

/** Writes four ASCII letters. */
function writeTag(view: DataView, offset: number, tag: string): void {
  for (let index = 0; index < tag.length; index++) view.setUint8(offset + index, tag.charCodeAt(index));
}

/**
 * Encodes samples of one channel as a WAV file of 16-bit PCM (RIFF WAVE; Microsoft and IBM Multimedia Programming
 * Interface and Data Specifications 1.0, "Waveform Audio File Format"). A sample outside −1 to 1 is clipped.
 *
 * @param blocks - The samples, in blocks, as the audio worklet delivers them.
 * @param sampleRate - The frames in a second.
 */
export function encodeWav(blocks: readonly Float32Array[], sampleRate: number): Uint8Array<ArrayBuffer> {
  const frames = blocks.reduce((total, block) => total + block.length, 0);
  const bytes = new Uint8Array(new ArrayBuffer(HEADER_BYTES + frames * BYTES_PER_SAMPLE));
  const view = new DataView(bytes.buffer);
  const dataBytes = frames * BYTES_PER_SAMPLE;
  writeTag(view, 0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeTag(view, 8, "WAVE");
  writeTag(view, 12, "fmt ");
  view.setUint32(16, FMT_CHUNK_BYTES, true);
  view.setUint16(20, PCM, true);
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeTag(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = HEADER_BYTES;
  for (const block of blocks) {
    for (const sample of block) {
      const clipped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clipped < 0 ? clipped * INT16_MIN : clipped * INT16_MAX, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}
