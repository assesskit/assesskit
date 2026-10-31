/**
 * Returns a number formatter for a language.
 *
 * @remarks
 * A language tag that `Intl` does not accept gives English, so that a number is written for any interface language.
 *
 * @param language - The language of the interface, a BCP 47 tag.
 * @param options - The options of `Intl.NumberFormat`. Default: the plain format of the language.
 * @returns The formatter.
 * @see {@link https://tc39.es/ecma402/#numberformat-objects | ECMA-402, Intl.NumberFormat}
 */
export function numberFormatter(language: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(language, options);
  } catch {
    return new Intl.NumberFormat("en", options);
  }
}
