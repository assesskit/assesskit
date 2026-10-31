import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { COMMANDS } from "./packages/tempuh/test/fixtures/commands.js";

/** Resolves olah and its subpaths to their sources, so that the differential and tempuh tests run the code and not a build. */
const OLAH_SOURCES = [
  { find: /^@luthfanwakan\/olah$/, replacement: resolve(import.meta.dirname, "packages/olah/src/index.ts") },
  { find: /^@luthfanwakan\/olah\/(.+)$/, replacement: resolve(import.meta.dirname, "packages/olah/src/$1/index.ts") },
];

/**
 * The limit of a test in the projects whose tests do seconds of work on the CPU. It is there to catch a hang, and not to
 * judge speed: a host that runs many test runs at once takes tens of times as long as a quiet one.
 */
const HANG_LIMIT = 60_000;

/**
 * The engines of the browser tests, and the commands that they use. Vitest names the instances, so each project has its own.
 * Firefox runs one file at a time: the mouse of a page can reach another page of the same Firefox that runs at once, so
 * that the pages take each other's presses, moves and drags.
 */
const browser = () => ({
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: [
    { browser: "chromium" as const },
    { browser: "firefox" as const, fileParallelism: false },
    { browser: "webkit" as const },
  ],
  commands: COMMANDS,
});

/** Starts the servers of the browser tests of tempuh, with its static files and the packages they load. */
const GLOBAL_SETUP = ["packages/tempuh/test/fixtures/global-setup.ts"];

/** Starts the exam server, which runs session hosts and the asset gate over HTTP for the end-to-end tests. */
const EXAM_SETUP = "packages/tempuh/test/fixtures/exam-setup.ts";

/** Starts the servers of the LTI browser tests: the storage page of a platform and two tools. */
const LTI_SETUP = "packages/tempuh/test/fixtures/lti-setup.ts";

// biome-ignore lint/style/noDefaultExport: Vitest reads its configuration from the default export.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "olah",
          include: ["packages/olah/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts", "**/*.xsd.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        resolve: { alias: OLAH_SOURCES },
        test: {
          name: "tempuh",
          include: ["packages/tempuh/test/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts", "**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // Browser tests run in the engines of the player: the page is the fixture, and the global setup serves the frame.
        resolve: { alias: OLAH_SOURCES },
        test: {
          name: "tempuh-browser",
          include: ["packages/tempuh/test/**/*.browser.test.ts"],
          globalSetup: [...GLOBAL_SETUP, EXAM_SETUP, LTI_SETUP],
          browser: browser(),
        },
      },
      {
        // The 1EdTech examples in the browsers: `pnpm corpus` downloads them.
        resolve: { alias: OLAH_SOURCES },
        test: {
          name: "tempuh-corpus",
          include: ["packages/tempuh/test/**/*.browser.corpus.test.ts"],
          globalSetup: GLOBAL_SETUP,
          browser: browser(),
        },
      },
      {
        // The asset gate and the session host over the 1EdTech examples, in Node.
        resolve: { alias: OLAH_SOURCES },
        test: {
          name: "tempuh-corpus-node",
          include: ["packages/tempuh/test/**/*.corpus.test.ts"],
          exclude: ["**/*.browser.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
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
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The benchmarks and budgets of olah: `pnpm bench` runs them with `vitest bench`, which gives the project the
        // suffix "(bench)". A test builds its input and runs benchmarks of seconds, so it may take longer than the default.
        test: {
          name: "olah-bench",
          include: [],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/olah/test/**/*.bench.ts"],
            // Vitest counts the export getters that a benchmark reads and warns about them. The counting makes the
            // benchmarks of the engine two to three times slower, so the project turns it off.
            suppressExportGetterWarnings: true,
          },
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
