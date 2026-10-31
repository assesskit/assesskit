/** The significant digits of a number on a display, the width of a desk calculator's. */
export const DISPLAY_DIGITS = 12;

/**
 * Rounds a number to {@link DISPLAY_DIGITS} significant digits, so that the noise of binary fractions (0.1 + 0.2) stays off
 * the display.
 *
 * @param value - The number.
 * @returns The rounded number.
 */
export function roundForDisplay(value: number): number {
  return Number(value.toPrecision(DISPLAY_DIGITS));
}

/**
 * Writes a number as a display shows it: rounded to {@link DISPLAY_DIGITS} significant digits, without trailing zeros.
 *
 * @param value - The number.
 * @returns The text.
 */
export function formatNumber(value: number): string {
  return String(roundForDisplay(value));
}
