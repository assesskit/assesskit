import type { MediaInteraction } from "@luthfanwakan/olah/asi";

/** The controls that an item can ask for besides playing and pausing (VOCAB §1.2.11.1). */
type MediaControl = "audioDescription" | "captions" | "rewind";

/** What the item asks of the player of a media interaction. */
export interface MediaSettings {
  /** The controls besides play and pause. `default` and no attribute give all of them; `none` gives none. */
  readonly controls: ReadonlySet<MediaControl>;
  /** The seconds that playback waits after the candidate presses play (VOCAB §1.2.11.2). */
  readonly pauseDelay?: number;
  /** The seconds that a pause lasts before playback continues by itself (VOCAB §1.2.11.3). */
  readonly pauseDuration?: number;
  /** The most times the candidate can pause during one play (VOCAB §1.2.11.4). */
  readonly pauseCount?: number;
}

const ALL_CONTROLS: ReadonlySet<MediaControl> = new Set(["rewind", "captions", "audioDescription"]);

/** The VOCAB spells the attributes without `data-`, and its examples and the rest of its vocabulary with it: both are read (§1.2.11.2–4). */
const PREFIXES = ["data-qti-media-player-", "qti-media-player-"];

/** Returns the value of an attribute of the vocabulary in either spelling, or `undefined`. */
function attributeOf(node: MediaInteraction, name: string): string | undefined {
  const spellings = PREFIXES.map((prefix) => `${prefix}${name}`);
  return node.extensions?.find((extension) => extension.namespace === "" && spellings.includes(extension.name))?.value;
}

/** Reads a number of seconds that is greater than 0, or `undefined` for anything else. */
function secondsOf(text: string | undefined): number | undefined {
  const seconds = Number(text);
  return text !== undefined && text.trim() !== "" && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** Reads the controls that the item asks for: the words of `data-qti-media-player-controls` (VOCAB §1.2.11.1). */
function controlsOf(text: string | undefined): ReadonlySet<MediaControl> {
  if (text === undefined) return ALL_CONTROLS;
  const words = text.split(/[\s,]+/u);
  if (words.includes("default")) return ALL_CONTROLS;
  return new Set([...ALL_CONTROLS].filter((control) => words.includes(control)));
}

/** Reads what the item asks of the player, in both spellings of the vocabulary. */
export function readMediaSettings(node: MediaInteraction): MediaSettings {
  const count = secondsOf(attributeOf(node, "pause-count"));
  const pauseDelay = secondsOf(attributeOf(node, "pause-delay"));
  const pauseDuration = secondsOf(attributeOf(node, "pause-duration"));
  return {
    controls: controlsOf(attributeOf(node, "controls")),
    ...(pauseDelay === undefined ? {} : { pauseDelay }),
    ...(pauseDuration === undefined ? {} : { pauseDuration }),
    ...(count === undefined ? {} : { pauseCount: Math.floor(count) }),
  };
}
