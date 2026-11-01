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
