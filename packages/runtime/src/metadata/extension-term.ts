import { describe } from "../checks.js";
import { DataError } from "../errors.js";

/** A term outside a vocabulary that an extension defines: `ext:` and a name, as the DRD schema's `ExtensionString.Type`. */
export type ExtensionTerm = `ext:${string}`;

/** Returns whether a string is an extension term; the characters after `ext:` are those that the DRD schema's pattern lists. */
function isExtensionTerm(text: string): text is ExtensionTerm {
  return /^ext:[ a-zA-Z0-9.|_]+$/.test(text);
}

/**
 * Checks that a value to write is one of the terms of a vocabulary or an extension term.
 *
 * @param value - The value.
 * @param label - Names the value in the message, such as `The access mode`.
 * @param vocabulary - The terms of the vocabulary.
 * @throws `DataError` when it is not.
 */
export function checkOpenTerm<T extends string>(
  value: unknown,
  label: string,
  vocabulary: readonly T[],
): asserts value is T | ExtensionTerm {
  if (!(vocabulary.some((term) => term === value) || (typeof value === "string" && isExtensionTerm(value)))) {
    throw new DataError(
      `${label} must be one of ${vocabulary.join(", ")} or an extension term such as ext:name, found ${describe(value)}.`,
    );
  }
}

/**
 * Returns a conversion of the text of an element to a term of a vocabulary or an extension term, for `ElementReader.text`.
 *
 * @param vocabulary - The terms of the vocabulary.
 * @returns A function that returns the term, or throws a `DataError` when the text is neither a term nor an extension term.
 */
export function openTermOf<T extends string>(vocabulary: readonly T[]): (text: string) => T | ExtensionTerm {
  return (text) => {
    checkOpenTerm(text, "The text", vocabulary);
    return text;
  };
}
