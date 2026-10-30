import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/** Resolves olah and its subpaths to their sources, so that the differential tests run the code and not a build. */
const OLAH_SOURCES = [
  { find: /^@luthfanwakan\/olah$/, replacement: resolve(import.meta.dirname, "packages/olah/src/index.ts") },
  { find: /^@luthfanwakan\/olah\/(.+)$/, replacement: resolve(import.meta.dirname, "packages/olah/src/$1/index.ts") },
];

// biome-ignore lint/style/noDefaultExport: Vitest reads its configuration from the default export.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "olah",
          include: ["packages/olah/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts", "**/*.xsd.test.ts"],
        },
      },
      {
        test: {
          name: "tempuh",
          include: ["packages/tempuh/test/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts"],
        },
      },
      {
        // Rendering tests run in the engines of the player: the page is the fixture.
        test: {
          name: "tempuh-browser",
          include: ["packages/tempuh/test/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
        },
      },
      {
        test: {
          name: "compat",
          include: ["compat/test/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: OLAH_SOURCES },
        test: {
          name: "differential",
          include: ["differential/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts"],
        },
      },
      {
        resolve: { alias: OLAH_SOURCES },
        test: {
          name: "differential-corpus",
          include: ["differential/test/**/*.corpus.test.ts"],
        },
      },
      {
        test: {
          name: "scripts",
          include: ["scripts/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "conformance",
          include: ["conformance/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "olah-corpus",
          include: ["packages/olah/test/**/*.corpus.test.ts"],
        },
      },
      {
        // Compiling the 18.8 MB ASI schema takes seconds.
        test: {
          name: "olah-xsd",
          include: ["packages/olah/test/**/*.xsd.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
