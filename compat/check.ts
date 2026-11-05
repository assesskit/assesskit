import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type LintBaselineOptions, lintBaseline } from "./lint.ts";

const ROOT = resolve(import.meta.dirname, "..");

/** The browsers of the baseline, as the `browserslist` of the player names them. */
const BASELINE: readonly string[] = JSON.parse(
  readFileSync(resolve(ROOT, "packages/player/package.json"), "utf8"),
).browserslist;

/** The packages whose built code runs in the baseline browsers, with what to lint of each. */
const PACKAGES: readonly (LintBaselineOptions & { readonly directory: string })[] = [
  { directory: "packages/player", serverFolders: ["server", "cat-rest"] },
  // The player loads the runtime in the browser: the protocol, the content and the engine of a local session. Its access to
  // files and its command line run only in Node.js.
  { directory: "packages/runtime", serverFolders: ["node", "cli"], browsers: BASELINE },
  {
    // The modules of the custom interactions run in the player's frame. MathLive calls navigator.vibrate and reads
    // navigator.userAgentData only after testing that the browser has them.
    directory: "packages/custom-interactions",
    scripts: ["modules/*.js"],
    tested: ["navigator.vibrate", "navigator.userAgentData"],
  },
];

let failed = false;
let total = 0;
for (const { directory, ...options } of PACKAGES) {
  const { problems, scripts } = await lintBaseline(resolve(ROOT, directory), options);
  if (scripts === 0) {
    console.error(`There is no built JavaScript to lint in ${directory}: run pnpm build first.`);
    failed = true;
  }
  for (const { file, line, message } of problems) console.error(`${directory}/${file}:${line} ${message}`);
  if (problems.length > 0) failed = true;
  total += scripts;
}
if (failed) process.exit(1);
console.log(`Baseline: ${total} scripts, no feature outside Chromium 111, Firefox 115 and Safari 16.4.`);
