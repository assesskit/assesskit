import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ENGINE_PAIRS, imageOf } from "./engines.ts";

const root = resolve(import.meta.dirname, "..");
const requested = process.argv.slice(2);
const unknown = requested.filter((name) => !ENGINE_PAIRS.some((pair) => pair.name === name));
if (unknown.length > 0) {
  console.error(
    `Unknown engine pairs: ${unknown.join(", ")}. The pairs are ${ENGINE_PAIRS.map(({ name }) => name).join(", ")}.`,
  );
  process.exit(1);
}

let failed = false;
for (const pair of ENGINE_PAIRS.filter(({ name }) => requested.length === 0 || requested.includes(name))) {
  console.log(`${pair.name}: Playwright ${pair.playwright} in ${imageOf(pair)}`);
  const docker = spawnSync(
    "docker",
    [
      ...[
        "run",
        "--rm",
        "--ipc=host",
        "--volume",
        `${root}:/work:ro`,
        "--workdir",
        `/work/compat/engines/${pair.name}`,
      ],
      imageOf(pair),
      ...["node", "node_modules/@playwright/test/cli.js", "test"],
    ],
    { stdio: "inherit" },
  );
  if (docker.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
