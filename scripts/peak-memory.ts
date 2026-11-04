// The peak memory of each reader of untrusted input on its worst input within the limits of SECURITY.md, in a Node.js process of
// its own whose heap is bounded, so that a regression fails the reading and the load of the machine cannot. `peak-memory-readings.ts`
// makes each input and reads it, `test/peak-memory.test.ts` holds the cases with their heaps, and `node scripts/peak-memory.ts
// [name...]` prints the least heap in which each reading ends, from which a heap is chosen: twice that, rounded up to 16 MiB.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import type { ReadingName } from "./peak-memory-readings.ts";

/** The packages of the repository. */
const PACKAGES = resolve(import.meta.dirname, "../packages");

/**
 * Resolves the packages of the repository to their sources, as the aliases of the Vitest configuration do, so that the process
 * of a reading needs no build: `errors`, `checks` and `delivery/wire` are files of the runtime, the other subpaths are folders.
 */
const SOURCES: Plugin = {
  name: "sources",
  setup(bundler) {
    bundler.onResolve({ filter: /^@assesskit\// }, ({ path }) => {
      const [, name = "", ...rest] = path.split("/");
      const subpath = rest.join("/");
      if (subpath === "") return { path: resolve(PACKAGES, name, "src/index.ts") };
      if (name === "runtime" && /^(errors|checks|delivery\/wire)$/.test(subpath)) {
        return { path: resolve(PACKAGES, name, "src", `${subpath}.ts`) };
      }
      return { path: resolve(PACKAGES, name, "src", subpath, "index.ts") };
    });
  },
};

/** The bytes of one MiB. */
const MIB = 1024 * 1024;

/**
 * The environment variable that gives a reading the directory of its bundle for the files it makes, so that the run that made the
 * bundle removes them: a process that runs out of heap ends without a chance to remove its own.
 */
const DIRECTORY_VARIABLE = "PEAK_MEMORY_DIRECTORY";

/** What a reading in a process of its own gave: how far it raised the peak resident memory, and what it returned or threw. */
export interface ReadingResult {
  /** The rise of the peak resident memory over the process before the reading, in bytes; it depends on when V8 collects. */
  readonly rise: number;
  /** What the reading returned or threw, as a sentence the case compares. */
  readonly outcome: string;
}

/** The process of a reading, bundled from the sources of the packages in a directory of its own. */
export interface Bundle {
  readonly directory: string;
  readonly child: string;
}

/** Bundles the process of a reading once, for all the readings of a run; {@link removeBundle} removes it. */
export async function bundleReadings(): Promise<Bundle> {
  const directory = mkdtempSync(join(tmpdir(), "assesskit-peak-memory-"));
  const child = join(directory, "child.mjs");
  await build({
    entryPoints: [join(import.meta.dirname, "peak-memory-child.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: child,
    plugins: [SOURCES],
    logLevel: "silent",
  });
  return { directory, child };
}

/** Removes the directory of a bundle. */
export function removeBundle({ directory }: Bundle): void {
  rmSync(directory, { recursive: true, force: true });
}

/** Runs a program to its end, and resolves with its exit code and what it wrote. */
function run(
  command: string,
  args: readonly string[],
  directory?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(
      command,
      args,
      directory === undefined ? {} : { env: { ...process.env, [DIRECTORY_VARIABLE]: directory } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Runs a reading in a Node.js process of its own whose heap may hold `heapMiB` MiB and no more, the input of the reading and
 * the code of the process included: the reading fails when what it keeps alive at once passes the heap, whenever the collector
 * of V8 runs, so the test holds on a loaded machine as on a quiet one. The inputs are made in the process, in memory outside
 * the heap, so that they add nothing to it. The rise of the peak resident memory is measured as well, for the record, and
 * depends on when the collector runs.
 *
 * @returns The result of the reading, or the end of the process, which is `undefined` when it ran out of heap.
 */
async function attempt(bundle: Bundle, name: ReadingName, heapMiB: number): Promise<ReadingResult | string> {
  const { code, stdout, stderr } = await run(
    process.execPath,
    [`--max-old-space-size=${heapMiB}`, bundle.child, name],
    bundle.directory,
  );
  return code === 0 ? (JSON.parse(stdout) as ReadingResult) : stderr.slice(-1_000);
}

/**
 * Reads in a process of its own with a heap of `heapMiB` MiB.
 *
 * @throws `Error` when the process does not end, as when the heap is too small.
 */
export async function readInProcess(bundle: Bundle, name: ReadingName, heapMiB: number): Promise<ReadingResult> {
  const result = await attempt(bundle, name, heapMiB);
  if (typeof result === "string") {
    throw new Error(`The reading ${name} did not end within a heap of ${heapMiB} MiB: ${result}`);
  }
  return result;
}

/** Says how far a reading raised the peak, in the annotation of the test. */
export const risen = (rise: number): string => `The peak rose by ${(rise / MIB).toFixed(1)} MiB.`;

/** The names of the readings of the bundle. */
export async function readingNames(bundle: Bundle): Promise<ReadingName[]> {
  const { stdout } = await run(process.execPath, [bundle.child, "--names"]);
  return JSON.parse(stdout) as ReadingName[];
}

/** The step of the search for the least heap, in MiB. */
const STEP_MIB = 8;

/** The most heap the search tries, in MiB; a reading that needs more is reported as above it. */
const SEARCH_LIMIT_MIB = 4_096;

/** Finds the least heap, in steps of 8 MiB, in which a reading ends, and its result there; `undefined` when it needs more than the search tries. */
async function leastHeap(
  bundle: Bundle,
  name: ReadingName,
): Promise<{ heapMiB: number; result: ReadingResult } | undefined> {
  let low = 1;
  let high = SEARCH_LIMIT_MIB / STEP_MIB;
  let found: { heapMiB: number; result: ReadingResult } | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const result = await attempt(bundle, name, middle * STEP_MIB);
    if (typeof result === "string") {
      low = middle + 1;
    } else {
      found = { heapMiB: middle * STEP_MIB, result };
      high = middle - 1;
    }
  }
  return found;
}

if (import.meta.main) {
  const wanted = process.argv.slice(2);
  const bundle = await bundleReadings();
  try {
    const names = (await readingNames(bundle)).filter((name) => wanted.length === 0 || wanted.includes(name));
    console.log("| Reading | Least heap (MiB) | Rise of the peak (MiB) | Outcome |");
    console.log("| ------- | ---------------: | ---------------------: | ------- |");
    for (const name of names) {
      const least = await leastHeap(bundle, name);
      console.log(
        least === undefined
          ? `| ${name} | above ${SEARCH_LIMIT_MIB} | | |`
          : `| ${name} | ${least.heapMiB} | ${(least.result.rise / MIB).toFixed(0)} | ${least.result.outcome} |`,
      );
    }
  } finally {
    removeBundle(bundle);
  }
}
