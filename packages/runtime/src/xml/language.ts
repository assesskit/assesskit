/**
 * `xs:language`: subtags of one to eight letters or digits, the first of letters, separated by hyphens, or nothing,
 * because `xml:lang=""` undoes an inherited language.
 */
const LANGUAGE = /^(?:[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*)?$/;

/**
 * Returns whether a value can be the value of `xml:lang`: a language tag such as `en` or `pt-BR`, or the empty string.
 *
 * @remarks
 * The subtags are not checked against the IANA registry.
 *
 * @param value - The value to test.
 * @returns `true` for a string in the form of `xs:language` or an empty string.
 * @see {@link https://www.w3.org/TR/xml/ | Extensible Markup Language (XML) 1.0, Language Identification}
 * @see {@link https://www.w3.org/TR/xmlschema-2/ | XML Schema Part 2, language}
 */
export function isXmlLanguage(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE.test(value);
}
