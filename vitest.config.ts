import { resolve } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { COMMANDS } from "./packages/player/test/fixtures/commands.js";

/** Resolves the runtime and its subpaths to their sources, so that the player tests run the code and not a build. */
const RUNTIME_SOURCES = [
  { find: /^@assesskit\/runtime$/, replacement: resolve(import.meta.dirname, "packages/runtime/src/index.ts") },
  {
    find: /^@assesskit\/runtime\/(errors|checks|delivery\/wire)$/,
    replacement: resolve(import.meta.dirname, "packages/runtime/src/$1.ts"),
  },
  {
    find: /^@assesskit\/runtime\/(.+)$/,
    replacement: resolve(import.meta.dirname, "packages/runtime/src/$1/index.ts"),
  },
];

/** Resolves the player and its subpaths to their sources, for the examples that use them. */
const PLAYER_SOURCES = [
  { find: /^@assesskit\/player$/, replacement: resolve(import.meta.dirname, "packages/player/src/index.ts") },
  {
    find: /^@assesskit\/player\/(.+)$/,
    replacement: resolve(import.meta.dirname, "packages/player/src/$1/index.ts"),
  },
];

/**
 * The limit of a test in the projects whose tests do seconds of work on the CPU. It is there to catch a hang, and not to
 * judge speed: a host that runs many test runs at once takes tens of times as long as a quiet one.
 */
const HANG_LIMIT = 60_000;

/**
 * The engines that run, from `BROWSERS` as a comma-separated list. Coverage and `check:rules` run Chromium alone, the one
 * engine that reports coverage and the one the rule checks need; CI runs all three for the tests.
 */
const ENGINES = (process.env.BROWSERS ?? "chromium,firefox,webkit").split(",");

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
  ].filter(({ browser: engine }) => ENGINES.includes(engine)),
  commands: COMMANDS,
});

/** Starts the servers of the browser tests of the player, with its static files and the packages they load. */
const GLOBAL_SETUP = ["packages/player/test/fixtures/global-setup.ts"];

/** Starts the exam server, which runs session hosts and the asset gate over HTTP for the end-to-end tests. */
const EXAM_SETUP = "packages/player/test/fixtures/exam-setup.ts";

/** Starts the servers of the LTI browser tests: the storage page of a platform and two tools. */
const LTI_SETUP = "packages/player/test/fixtures/lti-setup.ts";

/**
 * The coverage floors, by the folders they hold. The tests of the runtime and of the folders of the player that need no page
 * run in Node (`pnpm test:coverage`); the folders that draw a page and the client that waits on timers run in Chromium
 * (`pnpm test:coverage:browser`, with `COVERAGE_RUN=browser`), the one engine that reports coverage. A run holds only the
 * floors of the folders it exercises, so a gap in the tests of one part fails its own floor and no other.
 */
const FLOORS: Record<string, { statements: number; branches: number; functions: number; lines: number }> =
  process.env.COVERAGE_RUN === "browser"
    ? {
        "packages/player/src/player/**": { statements: 93, branches: 84, functions: 94, lines: 95 },
        "packages/player/src/client/**": { statements: 86, branches: 71, functions: 82, lines: 90 },
      }
    : {
        "packages/runtime/src/**": { statements: 96, branches: 92, functions: 97, lines: 97 },
        "packages/player/src/{cat,cat-rest,messages,protocol,scoring,server}/**": {
          statements: 95,
          branches: 88,
          functions: 96,
          lines: 97,
        },
      };

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
          exclude: ["**/*.browser.test.ts", "**/*.corpus.test.ts", "**/*.xsd.test.ts"],
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
        // The time to mount, with the CPU slowed by a factor that only Chromium can apply: `pnpm bench` runs it.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "player-bench",
          include: ["packages/player/test/**/*.browser.bench.ts"],
          globalSetup: GLOBAL_SETUP,
          testTimeout: HANG_LIMIT,
          browser: { ...browser(), instances: [{ browser: "chromium" as const }] },
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
        // The HTML elements of the ASI schema: `pnpm schemas` downloads it. The first document that a test validates compiles the
        // 18.8 MB schema, which takes seconds and, on a runner of CI, more than the five seconds of a test.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "player-xsd",
          include: ["packages/player/test/**/*.xsd.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        // The runnable examples: each is a package of its own, with the dependencies that only it needs.
        resolve: { alias: [...RUNTIME_SOURCES, ...PLAYER_SOURCES] },
        test: {
          name: "examples",
          include: ["examples/*/*/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts", "**/*.xsd.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples of the runtime that read the 1EdTech examples: `pnpm corpus` downloads them.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "runtime-examples-corpus",
          include: ["examples/runtime/*/test/**/*.corpus.test.ts"],
          testTimeout: HANG_LIMIT,
        },
      },
      {
        // The examples of the runtime that validate against the official XSDs: `pnpm schemas` and `pnpm corpus` download them.
        resolve: { alias: RUNTIME_SOURCES },
        test: {
          name: "runtime-examples-xsd",
          include: ["examples/runtime/*/test/**/*.xsd.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "scripts",
          include: ["scripts/test/**/*.test.ts"],
          testTimeout: HANG_LIMIT,
          hookTimeout: HANG_LIMIT,
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
        resolve: {
          alias: [
            {
              find: /^@assesskit\/runtime$/,
              replacement: resolve(import.meta.dirname, "packages/runtime/dist/index.js"),
            },
          ],
        },
        // The benchmarks and budgets of the runtime: `pnpm bench` runs them with `vitest bench`, which gives the project the
        // suffix "(bench)". A test builds its input and runs benchmarks of seconds, so it may take longer than the default.
        // The benchmark against Longsight imports the runtime by name, and the project loads its build natively, as Longsight
        // loads from node_modules: Vite's rewrite of the imports of a source file makes the runtime about 1.7 times slower than
        // the code that ships. `pnpm bench` builds first.
        test: {
          name: "runtime-bench",
          include: [],
          server: { deps: { external: [/\/packages\/runtime\/dist\//] } },
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
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      // One floor for each part of a package, held by the run that exercises it, a little below what the tests reach.
      thresholds: FLOORS,
    },
  },
});
