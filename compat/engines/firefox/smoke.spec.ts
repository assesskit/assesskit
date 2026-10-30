import { test } from "@playwright/test";
import { SMOKE_CASES } from "../../smoke.ts";

for (const { title, run } of SMOKE_CASES) {
  test(title, async ({ page, browser, browserName }) => {
    await run({ page, engine: browserName, version: browser.version() });
  });
}
