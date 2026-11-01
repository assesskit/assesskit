/**
 * The longest recording in seconds, which bounds the memory a recording holds: the WAV path keeps 192 kB per second, so
 * 115 MB at the limit.
 */
export const MAX_RECORDING_SECONDS = 600;

/** What an author asks of a recording with the `data-ak-record-*` attributes of `qti-upload-interaction`. */
export interface RecordAttributes {
  /** The seconds after the interaction is shown at which recording starts by itself; absent: the candidate starts it. */
  readonly start: number | undefined;
  /** The longest recording in seconds, at most {@link MAX_RECORDING_SECONDS}. */
  readonly limit: number;
  /** Whether the candidate has no second recording and no Remove once a recording has started. */
  readonly once: boolean;
}

/** A whole number of seconds: digits only. */
const WHOLE_SECONDS = /^\d+$/;

/** Returns the seconds an attribute holds, or `undefined` when it is absent, not a whole number, or below `least`. */
function secondsOf(element: Element, name: string, least: number): number | undefined {
  const text = element.getAttribute(name);
  if (text === null || !WHOLE_SECONDS.test(text)) return undefined;
  const seconds = Number(text);
  return seconds >= least ? seconds : undefined;
}

/**
 * Reads the attributes `data-ak-record-start`, `data-ak-record-limit` and `data-ak-record-once` of an upload interaction.
 *
 * @remarks
 * QTI has no attribute for them, so the runtime knows nothing of them and another player ignores them. A value that is not
 * a whole number of seconds counts as absent.
 *
 * @param element - The element of the interaction.
 * @returns The attributes, with their defaults: no start, the limit {@link MAX_RECORDING_SECONDS}, not once.
 */
export function readRecordAttributes(element: Element): RecordAttributes {
  return {
    start: secondsOf(element, "data-ak-record-start", 0),
    limit: Math.min(secondsOf(element, "data-ak-record-limit", 1) ?? MAX_RECORDING_SECONDS, MAX_RECORDING_SECONDS),
    once: element.getAttribute("data-ak-record-once") === "true",
  };
}
