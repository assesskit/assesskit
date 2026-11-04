import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { build } from "esbuild";
import { ENGINE_PAIRS, imageOf } from "./engines.ts";

const root = resolve(import.meta.dirname, "..");
const requested = process.argv.slice(2);

/** The characters of a name that Docker gives a container. */
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u;
/** The CPUs that a container may use, so that runs beside it on a shared machine keep theirs. */
const CPUS = "2";

/**
 * The name of the containers of this run, each followed by its pair: `CONTAINER_NAME`, so that the unit that runs it on a
 * shared machine names its own, or `assesskit-engines-` and 8 random hexadecimal digits.
 */
function containerName(): string {
  const named = process.env.CONTAINER_NAME;
  if (named === undefined || named === "") return `assesskit-engines-${randomBytes(4).toString("hex")}`;
  if (!CONTAINER_NAME.test(named)) {
    console.error(
      `CONTAINER_NAME must be a name of a Docker container, such as engines-unit, found ${JSON.stringify(named)}.`,
    );
    process.exit(1);
  }
  return named;
}
const container = containerName();
const unknown = requested.filter((name) => !ENGINE_PAIRS.some((pair) => pair.name === name));
if (unknown.length > 0) {
  console.error(
    `Unknown engine pairs: ${unknown.join(", ")}. The pairs are ${ENGINE_PAIRS.map(({ name }) => name).join(", ")}.`,
  );
  process.exit(1);
}

// The root, the player and the protocol import the runtime by package name, which a browser cannot resolve, so the pages of the
// smoke test load each as one bundle. The containers cannot make them: they run on the node_modules of this machine, and esbuild is a native
// program.
await build({
  entryPoints: {
    index: resolve(root, "packages/player/dist/index.js"),
    player: resolve(root, "packages/player/dist/player/index.js"),
    protocol: resolve(root, "packages/player/dist/protocol/index.js"),
  },
  outdir: resolve(root, "compat/.smoke"),
  bundle: true,
  format: "esm",
  target: ["chrome111", "firefox115", "safari16.4"],
  logLevel: "warning",
});

let failed = false;
for (const pair of ENGINE_PAIRS.filter(({ name }) => requested.length === 0 || requested.includes(name))) {
  console.log(`${pair.name}: Playwright ${pair.playwright} in ${imageOf(pair)}, container ${container}-${pair.name}`);
  const docker = spawnSync(
    "docker",
    [
      ...[
        "run",
        "--rm",
        `--name=${container}-${pair.name}`,
        `--cpus=${CPUS}`,
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
