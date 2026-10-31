/**
 * `xs:language` (XML Schema Part 2, 3.3.3): subtags of one to eight letters or digits, the first of letters, separated
 * by hyphens, or nothing: `xml:lang=""` undoes an inherited language (XML 1.0 §2.12).
 */
const LANGUAGE = /^(?:[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*)?$/;

/**
 * Returns whether a value can be the value of `xml:lang`: a language tag such as `en` or `pt-BR`, or the empty string.
 * The subtags are not checked against the IANA registry.
 */
export function isXmlLanguage(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE.test(value);
}
