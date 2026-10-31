import { describe } from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";

/**
 * Checks that a value is one of the terms of a vocabulary.
 *
 * @param value - The value to check.
 * @param terms - The terms of the vocabulary.
 * @param label - What the value is, for the message.
 * @throws `DataError` when the value is not one of the terms.
 */
export function checkTerm(value: unknown, terms: readonly string[], label: string): void {
  if (!terms.some((term) => term === value)) {
    throw new DataError(
      `${label} must be ${terms.map((term) => JSON.stringify(term)).join(", ")}, found ${describe(value)}.`,
    );
  }
}

/**
 * Checks a speaking rate: a whole number of words per minute of at least 1.
 *
 * @param value - The value to check.
 * @param label - What the value is, for the message.
 * @throws `DataError` when the value is not a positive integer.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, speech rate}
 */
export function checkSpeechRate(value: unknown, label: string): void {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) {
    throw new DataError(`${label} must be a positive integer of words per minute, found ${describe(value)}.`);
  }
}

/**
 * Checks a pitch or a volume: a number from 0 to 1.
 *
 * @param value - The value to check.
 * @param label - What the value is, for the message.
 * @throws `DataError` when the value is not a number from 0 to 1.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, pitch and volume}
 */
export function checkUnitInterval(value: unknown, label: string): void {
  if (!(typeof value === "number" && value >= 0 && value <= 1)) {
    throw new DataError(`${label} must be a number from 0 to 1, found ${describe(value)}.`);
  }
}
