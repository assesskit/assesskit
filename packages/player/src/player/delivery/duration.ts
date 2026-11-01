import { numberFormatter } from "../internal.js";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** Returns a formatter of whole units in a language, such as "3 minutes". */
const unitFormatter = (language: string, unit: "hour" | "minute" | "second"): Intl.NumberFormat =>
  numberFormatter(language, { style: "unit", unit, unitDisplay: "long" });

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
