/**
 * Recording of the microphone for the upload interaction: the choice of a method, the recorder, and the WAV encoder.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */
export { chooseRecording, type Recording, type RecordingMethod, startRecording } from "./recorder.js";
export { encodeWav } from "./wav.js";
