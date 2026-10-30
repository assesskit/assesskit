import type { Engine } from "./banned-features.ts";

/**
 * A pinned release of Playwright and the engines of the baseline it provides. A release runs in the container image of
 * the same version, because the old browser builds need the system libraries of their time.
 */
export interface EnginePair {
  /** The folder of `engines/` that pins the release. */
  readonly name: string;
  /** The exact version of `@playwright/test` and of the image. */
  readonly playwright: string;
  /** The engines of this release that are at the baseline. */
  readonly engines: readonly Engine[];
}

/**
 * The pairs, read from `browsers.json` of each release: 1.31.2 has Chromium 111.0.5563.19 and WebKit 16.4; 1.36.2 has
 * Firefox 115.0. No single release has all three: 1.31.2 has Firefox 109, and 1.36.2 has Chromium 115 and WebKit 17.0.
 */
export const ENGINE_PAIRS: readonly EnginePair[] = [
  { name: "chromium-webkit", playwright: "1.31.2", engines: ["chromium", "webkit"] },
  { name: "firefox", playwright: "1.36.2", engines: ["firefox"] },
];

/** Returns the image that holds the browsers of a release. */
export function imageOf({ playwright }: EnginePair): string {
  return `mcr.microsoft.com/playwright:v${playwright}-jammy`;
}
