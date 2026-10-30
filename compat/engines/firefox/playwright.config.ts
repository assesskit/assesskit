import { defineConfig } from "@playwright/test";

// biome-ignore lint/style/noDefaultExport: Playwright reads its configuration from the default export.
export default defineConfig({
  reporter: "list",
  // The repository is mounted read-only in the container.
  outputDir: "/tmp/playwright",
  projects: [{ name: "firefox", use: { browserName: "firefox" } }],
});
