import { resolve } from "node:path";
import { lintBaseline } from "./lint.ts";

const packageDirectory = resolve(import.meta.dirname, "../packages/tempuh");
const { problems, scripts } = await lintBaseline(packageDirectory);

if (scripts === 0) {
  console.error("There is no built JavaScript to lint: run pnpm build first.");
  process.exit(1);
}
for (const { file, line, message } of problems) console.error(`${file}:${line} ${message}`);
if (problems.length > 0) process.exit(1);
console.log(`Baseline: ${scripts} scripts, no feature outside Chromium 111, Firefox 115 and Safari 16.4.`);
