import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { COMMANDS } from "./packages/player/test/fixtures/commands.js";

/** Resolves the runtime and its subpaths to their sources, so that the player tests run the code and not a build. */
const RUNTIME_SOURCES = [
  { find: /^@assesskit\/runtime$/, replacement: resolve(import.meta.dirname, "packages/runtime/src/index.ts") },
  {
    find: /^@assesskit\/runtime\/errors$/,
    replacement: resolve(import.meta.dirname, "packages/runtime/src/errors.ts"),
  },
  {
    find: /^@assesskit\/runtime\/(.+)$/,
    replacement: resolve(import.meta.dirname, "packages/runtime/src/$1/index.ts"),
  },
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

/** Starts the servers of the browser tests of the player, with its static files and the packages they load. */
const GLOBAL_SETUP = ["packages/player/test/fixtures/global-setup.ts"];

/** Starts the exam server, which runs session hosts and the asset gate over HTTP for the end-to-end tests. */
const EXAM_SETUP = "packages/player/test/fixtures/exam-setup.ts";

/** Starts the servers of the LTI browser tests: the storage page of a platform and two tools. */
const LTI_SETUP = "packages/player/test/fixtures/lti-setup.ts";

// biome-ignore lint/style/noDefaultExport: Vitest reads its configuration from the default export.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "runtime",
          include: ["packages/runtime/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts", "**/*.xsd.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "player",
          include: ["packages/player/test/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts", "**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // Browser tests run in the engines of the player: the page is the fixture, and the global setup serves the frame.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "player-browser",
          include: ["packages/player/test/**/*.browser.test.ts"],
          globalSetup: [...GLOBAL_SETUP, EXAM_SETUP, LTI_SETUP],
          browser: browser(),
        },
      },
      {
        // The 1EdTech examples in the browsers: `pnpm corpus` downloads them.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "player-corpus",
          include: ["packages/player/test/**/*.browser.corpus.test.ts"],
          globalSetup: GLOBAL_SETUP,
          browser: browser(),
        },
      },
      {
        // The asset gate and the session host over the 1EdTech examples, in Node.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "player-corpus-node",
          include: ["packages/player/test/**/*.corpus.test.ts"],
          exclude: ["**/*.browser.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The HTML elements of the ASI schema: `pnpm schemas` downloads it.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "player-xsd",
          include: ["packages/player/test/**/*.xsd.test.ts"],
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
          name: "runtime-corpus",
          include: ["packages/runtime/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The benchmarks and budgets of the runtime: `pnpm bench` runs them with `vitest bench`, which gives the project the
        // suffix "(bench)". A test builds its input and runs benchmarks of seconds, so it may take longer than the default.
        test: {
          name: "runtime-bench",
          include: [],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          benchmark: {
            include: ["packages/runtime/test/**/*.bench.ts"],
            // Vitest counts the export getters that a benchmark reads and warns about them. The counting makes the
            // benchmarks of the engine two to three times slower, so the project turns it off.
            suppressExportGetterWarnings: true,
          },
        },
      },
      {
        // Compiling the 18.8 MB ASI schema takes seconds.
        test: {
          name: "runtime-xsd",
          include: ["packages/runtime/test/**/*.xsd.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
