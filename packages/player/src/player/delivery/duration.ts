const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Writes a time left as a clock, `4:05` or `1:02:03`; a part of a second counts as the whole second, so 0 means the time
 * is over.
 *
 * @param milliseconds - The time left.
 * @returns The clock text.
 */
export function clockText(milliseconds: number): string {
  const total = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Returns a formatter of whole units in a language, such as "3 minutes"; an invalid language tag gives English. */
function unitFormatter(language: string, unit: "hour" | "minute" | "second"): Intl.NumberFormat {
  const options = { style: "unit", unit, unitDisplay: "long" } as const;
  try {
    return new Intl.NumberFormat(language, options);
  } catch {
    return new Intl.NumberFormat("en", options);
  }
}

/**
 * Writes a time left in words in the language, such as "3 minutes 20 seconds", for a screen reader to speak.
 *
 * @param milliseconds - The time left.
 * @param language - The language of the interface, a BCP 47 tag.
 * @returns The text.
 */
export function spokenText(milliseconds: number, language: string): string {
  const total = Math.ceil(milliseconds / 1000);
  const parts = [
    { unit: "hour", count: Math.floor(total / SECONDS_PER_HOUR) },
    { unit: "minute", count: Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE) },
    { unit: "second", count: total % SECONDS_PER_MINUTE },
  ] as const;
  const spoken = parts
    .filter(({ count }) => count > 0)
    .map(({ unit, count }) => unitFormatter(language, unit).format(count));
  return spoken.length === 0 ? unitFormatter(language, "second").format(0) : spoken.join(" ");
}
