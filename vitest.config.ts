import { defineConfig } from "vitest/config";

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
        },
      },
      {
        test: {
          name: "compat",
          include: ["compat/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "differential",
          include: ["differential/test/**/*.test.ts"],
          exclude: ["**/*.corpus.test.ts"],
        },
      },
      {
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
