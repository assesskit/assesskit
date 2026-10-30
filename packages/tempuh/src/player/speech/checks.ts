import { describe } from "../../checks.js";
import { DataError } from "../../errors.js";

/** Checks that a value is one of the terms of a vocabulary. */
export function checkTerm(value: unknown, terms: readonly string[], label: string): void {
  if (!terms.some((term) => term === value)) {
    throw new DataError(
      `${label} must be ${terms.map((term) => JSON.stringify(term)).join(", ")}, found ${describe(value)}.`,
    );
  }
}

/** Checks a speaking rate: a whole number of words per minute of at least 1 (BPIG §5.2.1.4). */
export function checkSpeechRate(value: unknown, label: string): void {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) {
    throw new DataError(`${label} must be a positive integer of words per minute, found ${describe(value)}.`);
  }
}

/** Checks a pitch or a volume: a number from 0 to 1 (BPIG §5.2.1.5, §5.2.1.6). */
export function checkUnitInterval(value: unknown, label: string): void {
  if (!(typeof value === "number" && value >= 0 && value <= 1)) {
    throw new DataError(`${label} must be a number from 0 to 1, found ${describe(value)}.`);
  }
}
