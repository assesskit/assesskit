import { deepStrictEqual } from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "esbuild";
import type { Results } from "./scenario.ts";

const DIST = join(import.meta.dirname, ".dist");
/** The workerd program: the package of that name exports the path of the binary for the platform. */
const WORKERD = (createRequire(import.meta.url)("workerd") as { readonly default: string }).default;
/** How long workerd has to listen, and the time between two tries. */
const LISTEN_LIMIT_MS = 15_000;
const LISTEN_TRY_MS = 50;

/** What the scenario must give on Node.js, from what the packages promise: the sample of the README of the runtime, and more. */
const EXPECTED: Omit<Results, "state"> & { readonly state: Pick<Results["state"], "equal"> } = {
  pkg: {
    paths: ["imsmanifest.xml", "items/q1.xml", "items/q2.xml", "test.xml"],
    resources: 3,
    issues: 0,
  },
  session: {
    title: "Capital of France?",
    choices: ["A", "B"],
    actions: ["set-responses", "submit", "skip", "mark", "move", "end-part", "end-test", "suspend"],
    viewHoldsKey: false,
    viewRead: "Capital of France?",
    steps: [
      "responses-set",
      "attempt-ended response-processed outcome-processed moved presented",
      "responses-set",
      "attempt-ended response-processed outcome-processed part-ended test-ended",
    ],
    refusal: "linear-backward",
    status: "ended",
    total: '{"cardinality":"single","baseType":"float","value":1}',
    reported: ["q1 final", "q2 final"],
    totalXml:
      '<outcomeVariable identifier="TOTAL" cardinality="single" baseType="float"><value>1</value></outcomeVariable>',
  },
  state: { equal: true },
  limits: { doctype: "SecurityError doctype", nodes: "SecurityError maxNodes", pattern: [true, true, false, false] },
  cat: { refused: 400, oversize: 413, missing: 404 },
};

/** The options that both bundles share: one ES module of the packages as they ship, for a platform with the web standards alone. */
const SHARED = {
  outdir: DIST,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  // The packages as built, whatever the paths of the type checker say.
  tsconfigRaw: {},
  logLevel: "warning",
} as const;

/** Bundles the entries into one file each, which every runtime then runs as it is. */
async function bundle(): Promise<void> {
  await build({ ...SHARED, entryPoints: { run: join(import.meta.dirname, "run.ts") } });
  await build({ ...SHARED, entryPoints: { worker: join(import.meta.dirname, "worker.ts") } });
}

/** Runs a command and returns what it printed. */
function execute(command: string, args: readonly string[]): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk;
    });
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) done(out);
      else fail(new Error(`${command} exited with ${code}: ${err.trim()}`));
    });
  });
}

/** A runtime: how to ask its version, and how to run the bundle in it. */
interface Runtime {
  readonly version: () => Promise<string>;
  readonly run: () => Promise<Results>;
}

const script = join(DIST, "run.js");
const fromCommand = async (command: string, args: readonly string[]): Promise<Results> =>
  JSON.parse((await execute(command, args)).trim().split("\n").at(-1) ?? "");

/** Finds a port that nothing listens on. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        address !== null && typeof address === "object" ? done(address.port) : fail(new Error("No port.")),
      );
    });
  });
}

/** Whether something accepts connections at the port. */
function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect(port, "127.0.0.1");
    socket.on("connect", () => socket.end(() => done(true)));
    socket.on("error", () => done(false));
  });
}

/** Waits until the child listens at the port, or it exits, or the limit passes. */
async function untilListening(child: ChildProcess, port: number, output: () => string): Promise<void> {
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  for (let waited = 0; waited < LISTEN_LIMIT_MS; waited += LISTEN_TRY_MS) {
    if (exited) throw new Error(`workerd exited before it listened: ${output().trim()}`);
    if (await listening(port)) return;
    await sleep(LISTEN_TRY_MS);
  }
  throw new Error(`workerd did not listen within ${LISTEN_LIMIT_MS} ms: ${output().trim()}`);
}

/** Runs the worker in workerd and asks it once for the results. */
async function runOnWorkerd(): Promise<Results> {
  const port = await freePort();
  const child = spawn(
    WORKERD,
    ["serve", `--socket-addr=http=127.0.0.1:${port}`, join(import.meta.dirname, "worker.capnp")],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let log = "";
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk;
  });
  try {
    await untilListening(child, port, () => log);
    const response = await fetch(`http://127.0.0.1:${port}/`);
    if (!response.ok) {
      throw new Error(`The worker answered ${response.status}: ${(await response.text()).slice(0, 400)} ${log.trim()}`);
    }
    return (await response.json()) as Results;
  } finally {
    child.kill();
  }
}

const RUNTIMES: Readonly<Record<string, Runtime>> = {
  node: {
    version: async () => `node ${(await execute("node", ["--version"])).trim()}`,
    run: () => fromCommand("node", [script]),
  },
  deno: {
    version: async () => (await execute("deno", ["--version"])).split("\n")[0]?.trim() ?? "deno",
    run: () => fromCommand("deno", ["run", script]),
  },
  bun: {
    version: async () => `bun ${(await execute("bun", ["--version"])).trim()}`,
    run: () => fromCommand("bun", ["run", script]),
  },
  workerd: {
    version: async () => (await execute(WORKERD, ["--version"])).trim(),
    run: runOnWorkerd,
  },
};

/** Runs the bundle on the runtimes, and checks the results against what the packages promise and against Node.js. */
async function main(names: readonly string[]): Promise<number> {
  const selected = names.length === 0 ? Object.keys(RUNTIMES) : names;
  const unknown = selected.find((name) => RUNTIMES[name] === undefined);
  if (unknown !== undefined) {
    throw new Error(`Unknown runtime ${unknown}; the runtimes are ${Object.keys(RUNTIMES).join(", ")}.`);
  }
  await bundle();
  const reference = await RUNTIMES.node?.run();
  if (reference === undefined) throw new Error("Node.js does not run.");
  // The size of the state is whatever the packages write, and every runtime must write the same; the rest is what they promise.
  deepStrictEqual(
    { ...reference, state: { equal: reference.state.equal } },
    EXPECTED,
    "Node.js does not give the results that the packages promise.",
  );
  let failures = 0;
  for (const name of selected) {
    const runtime = RUNTIMES[name];
    if (runtime === undefined) continue;
    try {
      const version = await runtime.version();
      deepStrictEqual(await runtime.run(), reference);
      console.log(`pass  ${name.padEnd(8)} ${version}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL  ${name.padEnd(8)} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(failures === 0 ? `The runtime runs the same on ${selected.join(", ")}.` : `${failures} runtimes differ.`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
