/**
 * The parts of media that elements, supports and tests share: the rules of playing a recording, the settings an item
 * asks for, text tracks, and the companion that follows a recording.
 *
 * @remarks
 * The package does not export them.
 *
 * @module
 */
export { followPlayback, recordingOf } from "./companion.js";
export { Playback, type PlaybackNotice, type PlaybackRules } from "./playback.js";
export { type MediaSettings, readMediaSettings } from "./settings.js";
export { CAPTION_KINDS, DESCRIPTION_KINDS, isShowing, showTracks, tracksOf } from "./tracks.js";
