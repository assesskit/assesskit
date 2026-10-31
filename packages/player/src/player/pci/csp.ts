/**
 * Builds the content security policy of the frame.
 *
 * @remarks
 * Nothing is allowed by default; scripts, styles, images, media and fonts come from the frame's own origin and the allowed
 * ones; inline styles are allowed, since most interactions set them, and so are `data:` images, media and fonts, which reach
 * no network; no connection, frame, form or `base`. No script runs inline and no string is evaluated.
 *
 * @param frameOrigin - The origin of the frame's document, which also serves the package files.
 * @param origins - The other origins that may serve scripts, styles, images, media and fonts.
 * @returns The policy.
 * @see {@link https://www.w3.org/TR/CSP3/ | Content Security Policy Level 3}
 */
export function buildFrameCsp(frameOrigin: string, origins: readonly string[]): string {
  const sources = [frameOrigin, ...origins].join(" ");
  return [
    "default-src 'none'",
    `script-src ${sources}`,
    `style-src ${sources} 'unsafe-inline'`,
    `img-src ${sources} data:`,
    `media-src ${sources} data:`,
    `font-src ${sources} data:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}
