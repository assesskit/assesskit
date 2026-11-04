import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { downloadText } from "./download.ts";

/** A file of the Unicode Character Database, pinned to the SHA-256 of its bytes. */
interface UnicodeFile {
  /** Where the file is downloaded from. */
  readonly url: string;
  /** The SHA-256 of the file as lowercase hexadecimal. */
  readonly sha256: string;
}

/**
 * The block names of XML Schema 1.0 (Datatypes, Appendix F.1.1) are those of Unicode 3.1, which `Blocks-4.txt` lists.
 * The general categories come from the Unicode version that the runtime pins, so that a pattern matches the same text in every
 * JavaScript runtime whatever Unicode version the runtime has.
 */
export const UNICODE_FILES = {
  blocks: {
    url: "https://www.unicode.org/Public/3.1-Update/Blocks-4.txt",
    sha256: "00cdecb26876e7576abb724e39fafb78be24c2f34fe59b94deb70e8262f7bba5",
  },
  characters: {
    url: "https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt",
    sha256: "2e1efc1dcb59c575eedf5ccae60f95229f706ee6d031835247d843c11d96470c",
  },
  graphemeBreaks: {
    url: "https://www.unicode.org/Public/17.0.0/ucd/auxiliary/GraphemeBreakProperty.txt",
    sha256: "d6b51d1d2ae5c33b451b7ed994b48f1f4dc62b2272a5831e7fd418514a6bae89",
  },
  emoji: {
    url: "https://www.unicode.org/Public/17.0.0/ucd/emoji/emoji-data.txt",
    sha256: "2cb2bb9455cda83e8481541ecf5b6dfda66a3bb89efa3fa7c5297eccf607b72b",
  },
  coreProperties: {
    url: "https://www.unicode.org/Public/17.0.0/ucd/DerivedCoreProperties.txt",
    sha256: "24c7fed1195c482faaefd5c1e7eb821c5ee1fb6de07ecdbaa64b56a99da22c08",
  },
  graphemeBreakTest: {
    url: "https://www.unicode.org/Public/17.0.0/ucd/auxiliary/GraphemeBreakTest.txt",
    sha256: "e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec",
  },
} as const satisfies Record<string, UnicodeFile>;

/** The Unicode version of `UNICODE_FILES.characters`. */
const UNICODE_VERSION = "17.0.0";

/** The highest Unicode code point. */
const MAX_CODE_POINT = 0x10ffff;

/** The category of the code points that `UnicodeData.txt` does not list. */
const UNASSIGNED = "Cn";

const TARGET_DIRECTORY = "packages/runtime/src/values";
/** Where the table of grapheme breaks goes, beside the operators that count clusters, and the fixture of the test cases. */
const GRAPHEME_DIRECTORY = "packages/runtime/src/operators";
const GRAPHEME_TEST_FIXTURE = "packages/runtime/test/fixtures/grapheme-break-test.json";

/** The Grapheme_Cluster_Break values, in the order of their codes; `Other` is 0. */
export const GRAPHEME_BREAKS = [
  "Other",
  "CR",
  "LF",
  "Control",
  "Extend",
  "ZWJ",
  "Regional_Indicator",
  "Prepend",
  "SpacingMark",
  "L",
  "V",
  "T",
  "LV",
  "LVT",
] as const;
/** The Indic_Conjunct_Break values, in the order of their codes; `None` is 0. */
export const CONJUNCT_BREAKS = ["None", "Consonant", "Linker", "Extend"] as const;

/** A range of code points with a value of a property, both ends included. */
export interface PropertyRange {
  readonly first: number;
  readonly last: number;
  readonly value: string;
}

/** A run of consecutive code points of one code. */
export interface CodeRun {
  readonly code: number;
  readonly length: number;
}

/**
 * Reads a property file of the Unicode Character Database: lines `first..last ; Value` or `code ; Value`, with comments
 * after `#`. With `field`, a line `range ; Property ; Value` gives its value when its property is `field`.
 */
export function parseProperty(text: string, field?: string): PropertyRange[] {
  const ranges: PropertyRange[] = [];
  for (const line of text.split("\n")) {
    const data = (line.split("#")[0] ?? "").trim();
    if (data === "") continue;
    const parts = data.split(";").map((part) => part.trim());
    const [range = "", first = "", second] = parts;
    if (field !== undefined && first !== field) continue;
    const value = field === undefined ? first : (second ?? "");
    const match = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?$/.exec(range);
    if (!match) throw new Error(`Cannot read the property line ${JSON.stringify(line)}.`);
    ranges.push({ first: parseInt(match[1] ?? "", 16), last: parseInt(match[2] ?? match[1] ?? "", 16), value });
  }
  return ranges;
}

/**
 * The code of every code point from 0 to U+10FFFF in order, as runs: its Grapheme_Cluster_Break, plus 16 times its
 * Indic_Conjunct_Break, plus 64 when it is Extended_Pictographic.
 */
export function buildGraphemeRuns(
  breaks: readonly PropertyRange[],
  pictographs: readonly PropertyRange[],
  conjuncts: readonly PropertyRange[],
): CodeRun[] {
  const codes = new Uint8Array(MAX_CODE_POINT + 1);
  for (const { first, last, value } of breaks) codes.fill(GRAPHEME_BREAKS.indexOf(value as never), first, last + 1);
  for (const { first, last, value } of conjuncts)
    for (let point = first; point <= last; point += 1)
      codes[point] = (codes[point] ?? 0) + 16 * CONJUNCT_BREAKS.indexOf(value as never);
  for (const { first, last } of pictographs)
    for (let point = first; point <= last; point += 1) codes[point] = (codes[point] ?? 0) + 64;
  const runs: CodeRun[] = [];
  for (const code of codes) {
    const last = runs.at(-1);
    if (last?.code === code) runs[runs.length - 1] = { code, length: last.length + 1 };
    else runs.push({ code, length: 1 });
  }
  return runs;
}

/** A case of `GraphemeBreakTest.txt`: the code points of a text, and the clusters it splits into. */
export interface GraphemeCase {
  readonly clusters: readonly (readonly number[])[];
}

/** Reads the cases of `GraphemeBreakTest.txt`: `÷` marks a break and `×` none, between code points written in hex. */
export function parseGraphemeBreakTest(text: string): GraphemeCase[] {
  const cases: GraphemeCase[] = [];
  for (const line of text.split("\n")) {
    const data = (line.split("#")[0] ?? "").trim();
    if (data === "") continue;
    const clusters: number[][] = [];
    for (const token of data.split(/\s+/)) {
      if (token === "\u00f7") clusters.push([]);
      else if (token !== "\u00d7") clusters.at(-1)?.push(parseInt(token, 16));
    }
    cases.push({ clusters: clusters.filter((cluster) => cluster.length > 0) });
  }
  return cases;
}

/** A block of Unicode: the first and last code point, both included, and the name as the pattern language spells it. */
export interface Block {
  readonly name: string;
  readonly first: number;
  readonly last: number;
}

/** A run of consecutive code points of one general category. */
export interface CategoryRun {
  readonly category: string;
  readonly length: number;
}

/** Returns the SHA-256 of a text's UTF-8 bytes as lowercase hexadecimal. */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Reads `Blocks-4.txt`: lines `first..last; Block Name`. The name is written without its spaces, as `\p{IsBlockName}`
 * spells it. A name that occurs on several lines, such as `Specials`, has several blocks.
 */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const match = /^([0-9A-F]+)\.\.([0-9A-F]+); (.+)$/.exec(line.trim());
    if (!match) throw new Error(`Cannot read the block line ${JSON.stringify(line)}.`);
    blocks.push({
      name: (match[3] ?? "").replaceAll(" ", ""),
      first: parseInt(match[1] ?? "", 16),
      last: parseInt(match[2] ?? "", 16),
    });
  }
  return blocks;
}

/**
 * Reads `UnicodeData.txt` into runs of equal general category that cover every code point in order. A range of the
 * file is a line named `<..., First>` and the line named `<..., Last>` that follows it; code points the file does not
 * list are `Cn`.
 */
export function parseCategories(text: string): CategoryRun[] {
  const runs: CategoryRun[] = [];
  let next = 0;
  const extend = (category: string, length: number): void => {
    if (length === 0) return;
    const last = runs.at(-1);
    if (last?.category === category) runs[runs.length - 1] = { category, length: last.length + length };
    else runs.push({ category, length });
  };
  let rangeStart: number | undefined;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [hex, name, category] = line.split(";");
    if (hex === undefined || name === undefined || category === undefined) {
      throw new Error(`Cannot read the character line ${JSON.stringify(line)}.`);
    }
    const codePoint = parseInt(hex, 16);
    if (codePoint < next) throw new Error(`The character ${hex} is out of order.`);
    if (name.endsWith(", First>")) {
      rangeStart = codePoint;
      continue;
    }
    const first = rangeStart ?? codePoint;
    rangeStart = undefined;
    extend(UNASSIGNED, first - next);
    extend(category, codePoint - first + 1);
    next = codePoint + 1;
  }
  extend(UNASSIGNED, MAX_CODE_POINT + 1 - next);
  return runs;
}

/** Writes runs as `<category><length in base 36>` tokens separated by spaces. */
export function encodeRuns(runs: readonly CategoryRun[]): string {
  return runs.map(({ category, length }) => `${category}${length.toString(36)}`).join(" ");
}

const header = (source: UnicodeFile): string =>
  `// Generated by scripts/unicode.ts; do not edit.\n// Source: ${source.url} (SHA-256 ${source.sha256}).\n`;

/** Returns the source of `unicode-blocks.ts`. */
export function renderBlocks(blocks: readonly Block[]): string {
  const names = [...new Set(blocks.map(({ name }) => name))];
  const entries = names.map((name) => {
    const ranges = blocks
      .filter((block) => block.name === name)
      .map(({ first, last }) => `[0x${first.toString(16)}, 0x${last.toString(16)}]`);
    return `  [${JSON.stringify(name)}, [${ranges.join(", ")}]],`;
  });
  return `${header(UNICODE_FILES.blocks)}
import type { CodePointSet } from "./code-point-set.js";

/**
 * The blocks that \`\\p{Is...}\` names in XML Schema 1.0 (Datatypes, Appendix F.1.1): the blocks of Unicode 3.1, each
 * under its name without spaces, such as \`LatinExtended-A\`. A name with several ranges, such as \`PrivateUse\`, has
 * all of them.
 */
export const UNICODE_BLOCKS: ReadonlyMap<string, CodePointSet> = new Map([
${entries.join("\n")}
]);
`;
}

/** Returns the source of `unicode-categories.ts`. */
export function renderCategories(runs: readonly CategoryRun[]): string {
  return `${header(UNICODE_FILES.characters)}

/**
 * The general category of every code point from 0 to U+10FFFF in order, as runs: a two-letter category and the length
 * of the run in base 36, separated by spaces.
 */
export const CATEGORY_RUNS =
  ${JSON.stringify(encodeRuns(runs))};
`;
}

/** Returns the source of `unicode-graphemes.ts`. */
export function renderGraphemes(runs: readonly CodeRun[]): string {
  const sources = [UNICODE_FILES.graphemeBreaks, UNICODE_FILES.emoji, UNICODE_FILES.coreProperties];
  return `// Generated by scripts/unicode.ts; do not edit.
${sources.map((source) => `// Source: ${source.url} (SHA-256 ${source.sha256}).`).join("\n")}

/**
 * The code of every code point from 0 to U+10FFFF in order, as runs: its Grapheme_Cluster_Break (\`Other\` 0, \`CR\` 1,
 * \`LF\` 2, \`Control\` 3, \`Extend\` 4, \`ZWJ\` 5, \`Regional_Indicator\` 6, \`Prepend\` 7, \`SpacingMark\` 8, \`L\` 9,
 * \`V\` 10, \`T\` 11, \`LV\` 12, \`LVT\` 13), plus 16 times its Indic_Conjunct_Break (\`Consonant\` 1, \`Linker\` 2,
 * \`Extend\` 3), plus 64 when it is Extended_Pictographic, of Unicode ${UNICODE_VERSION}: the code and the length of the run in
 * base 36, joined by a colon, separated by spaces.
 */
export const GRAPHEME_RUNS =
  ${JSON.stringify(runs.map(({ code, length }) => `${code.toString(36)}:${length.toString(36)}`).join(" "))};
`;
}

async function download(file: UnicodeFile): Promise<string> {
  const text = await downloadText(file.url);
  if (sha256(text) !== file.sha256) throw new Error(`${file.url} has another SHA-256 than the pinned ${file.sha256}.`);
  return text;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "..");
  const blocks = renderBlocks(parseBlocks(await download(UNICODE_FILES.blocks)));
  const categories = renderCategories(parseCategories(await download(UNICODE_FILES.characters)));
  const files = [
    join(root, TARGET_DIRECTORY, "unicode-blocks.ts"),
    join(root, TARGET_DIRECTORY, "unicode-categories.ts"),
  ];
  const graphemes = renderGraphemes(
    buildGraphemeRuns(
      parseProperty(await download(UNICODE_FILES.graphemeBreaks)),
      parseProperty(await download(UNICODE_FILES.emoji)).filter(({ value }) => value === "Extended_Pictographic"),
      parseProperty(await download(UNICODE_FILES.coreProperties), "InCB"),
    ),
  );
  const cases = parseGraphemeBreakTest(await download(UNICODE_FILES.graphemeBreakTest));
  files.push(join(root, GRAPHEME_DIRECTORY, "unicode-graphemes.ts"), join(root, GRAPHEME_TEST_FIXTURE));
  writeFileSync(files[0] ?? "", blocks);
  writeFileSync(files[1] ?? "", categories);
  writeFileSync(files[2] ?? "", graphemes);
  writeFileSync(files[3] ?? "", `${JSON.stringify({ source: UNICODE_FILES.graphemeBreakTest, cases })}\n`);
  execFileSync("pnpm", ["exec", "biome", "format", "--write", ...files.filter((file) => file.endsWith(".ts"))], {
    cwd: root,
    stdio: "inherit",
  });
  console.log(`Wrote ${files.length} files: ${files.join(", ")}.`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
