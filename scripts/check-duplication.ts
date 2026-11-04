import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

/** The fewest tokens and lines that jscpd calls a clone: the settings of the three repositories of the family. */
const MIN_TOKENS = 40;
const MIN_LINES = 4;
/** The most that jscpd may print, in bytes: its report of a hundred clones is a file, but the console lists them too. */
const OUTPUT_MAX_BYTES = 64 * 1024 * 1024;
/** The heading of the table in AGENTS.md that lists the repeats left on purpose. */
const SECTION = "## Repeats left on purpose";

/** A piece of code that two places of the sources of the packages hold, or one place holds twice. */
export interface Clone {
  /** The files, as `<package>/<path below src>`: one when the piece repeats within a file, else two, in order. */
  readonly files: readonly string[];
  /** The lines of the piece. */
  readonly lines: number;
}

/** A row of the table: what repeats, and the files that hold it. */
export interface Repeat {
  readonly name: string;
  readonly files: ReadonlySet<string>;
}

/** Writes a source file as the table of AGENTS.md names it: `core/src/answer.ts` is `core/answer.ts`. */
function nameOf(file: string): string {
  return file.replace(/^([^/]+)\/src\//u, "$1/");
}

/**
 * Reads the clones from the JSON report of jscpd, one for each pair of files, the longest of the pair.
 *
 * @param report - The text of `jscpd-report.json`, which jscpd wrote with absolute paths.
 * @param packages - The folder `packages` of the repository.
 */
export function clonesOf(report: string, packages: string): Clone[] {
  const found = new Map<string, Clone>();
  for (const clone of JSON.parse(report).duplicates as {
    readonly firstFile: { readonly name: string };
    readonly secondFile: { readonly name: string };
    readonly lines: number;
  }[]) {
    const files = [...new Set([clone.firstFile.name, clone.secondFile.name])]
      .map((file) => nameOf(relative(packages, file)))
      .sort();
    const key = files.join(" ");
    if ((found.get(key)?.lines ?? 0) < clone.lines) found.set(key, { files, lines: clone.lines });
  }
  return [...found.values()].sort((a, b) => a.files.join(" ").localeCompare(b.files.join(" ")));
}

/** Expands the one group of braces that a path may hold: `a/{b,c}.ts` is `a/b.ts` and `a/c.ts`. */
function expandBraces(path: string): string[] {
  const group = /^(.*)\{([^{}]+)\}(.*)$/u.exec(path);
  if (group?.[1] === undefined || group[2] === undefined || group[3] === undefined) return [path];
  return group[2].split(",").flatMap((name) => expandBraces(`${group[1]}${name.trim()}${group[3]}`));
}

/** Reads the rows of the table under "Repeats left on purpose": the first cell names the repeat, the second lists its files. */
export function readRepeats(agents: string): Repeat[] {
  const start = agents.indexOf(SECTION);
  if (start === -1) throw new Error(`AGENTS.md has no section "${SECTION}".`);
  const rest = agents.slice(start + SECTION.length);
  const section = rest.slice(0, rest.search(/^## /mu) === -1 ? undefined : rest.search(/^## /mu));
  const rows = section.split("\n").filter((line) => line.startsWith("|"));
  const repeats: Repeat[] = [];
  for (const row of rows.slice(2)) {
    const cells = row.split("|").map((cell) => cell.trim());
    const [, name, where] = cells;
    if (name === undefined || where === undefined) continue;
    const files = [...where.matchAll(/`([^`]+)`/gu)].flatMap((match) => expandBraces(match[1] ?? ""));
    repeats.push({ name, files: new Set(files) });
  }
  if (repeats.length === 0) throw new Error(`The table under "${SECTION}" of AGENTS.md has no rows.`);
  return repeats;
}

/**
 * Compares what the scan found with what the table lists. A clone is listed when one row holds all of its files. A file in a
 * row that takes part in no clone is a row to cut, so that the table never keeps a repeat that was merged.
 */
export function judge(clones: readonly Clone[], repeats: readonly Repeat[]): string[] {
  const problems: string[] = [];
  for (const clone of clones) {
    if (repeats.some(({ files }) => clone.files.every((file) => files.has(file)))) continue;
    const where = clone.files.length === 1 ? `${clone.files[0]} twice` : clone.files.join(" and ");
    problems.push(
      `${where} repeat ${clone.lines} lines that no row of "${SECTION.slice(3)}" lists: merge them into a helper of the module that owns the concept, or list them with the reason.`,
    );
  }
  const repeating = new Set(clones.flatMap(({ files }) => files));
  for (const { name, files } of repeats) {
    for (const file of files) {
      if (!repeating.has(file)) {
        problems.push(
          `${file} is in the row "${name}" of "${SECTION.slice(3)}" and repeats nothing now: take it out of the row.`,
        );
      }
    }
  }
  return problems;
}

/** Runs jscpd over `packages` of a repository and returns its clones. */
export function findClones(root: string, bin: string = join(root, "node_modules/.bin/jscpd")): Clone[] {
  const output = mkdtempSync(join(tmpdir(), "assesskit-duplication-"));
  try {
    const run = spawnSync(
      bin,
      [
        "packages",
        "--format",
        "typescript",
        "--min-tokens",
        String(MIN_TOKENS),
        "--min-lines",
        String(MIN_LINES),
        "--ignore",
        "**/test/**,**/dist/**,**/node_modules/**",
        "--absolute",
        "--reporters",
        "json",
        "--output",
        output,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: OUTPUT_MAX_BYTES },
    );
    if (run.error !== undefined || run.status !== 0) {
      throw new Error(
        `jscpd failed with ${run.error?.message ?? `exit code ${run.status}`}.\n${run.stdout}${run.stderr}`,
      );
    }
    // jscpd writes the real paths, which differ from the given ones where a folder is a link, as the temporary folder of macOS is.
    return clonesOf(readFileSync(join(output, "jscpd-report.json"), "utf8"), realpathSync(join(root, "packages")));
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

/** Checks the scan against AGENTS.md and returns the exit code. */
function main(): number {
  const root = resolve(dirname(import.meta.dirname));
  const clones = findClones(root);
  const problems = judge(clones, readRepeats(readFileSync(join(root, "AGENTS.md"), "utf8")));
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) return 1;
  console.log(`The ${clones.length} repeats of the sources of the packages are all listed in AGENTS.md.`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
