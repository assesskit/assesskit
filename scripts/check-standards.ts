// cspell:ignore measurekit
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, resolve } from "node:path";
import { checkClaimWords, checkIdentity, checkReadmeLinks, checkTrademarks } from "./check-identity.ts";

/** One breach of the standards: the file, the 1-based line (0 for the whole file), the rule and what to do. */
export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

/** The text of the files to check, by path relative to the repository root, with `/` as separator. */
export type Files = ReadonlyMap<string, string>;

/** The file types that carry prose or code of the repository. */
const TEXT_EXTENSIONS = new Set([".ts", ".md", ".css", ".yml", ".grit"]);
/** Paths that hold generated or third-party text. */
const EXCLUDED = /(^|\/)(node_modules|dist|docs\/api|\.cache|\.changeset|fixtures)\/|(^|\/)CHANGELOG\.md$/;
/** The script and its test, which hold violations as their input. */
const EXEMPT = /^scripts\/(check-standards\.ts|test\/check-standards\.test\.ts)$/;
/** Scopes of other families of packages, which no package of this repository may import. */
const FOREIGN_SCOPES = ["@measurekit/", "@interopkit/"];
/** Where the foreign scopes are allowed: an example adapts one family to the other. */
const FOREIGN_ALLOWED = /^examples\//;
/** The files whose job is output, so that they may call the console. */
const CONSOLE_ALLOWED = /^packages\/[^/]+\/src\/cli\//;
/** File names, without extension, that say nothing about the concept they hold. */
const VAGUE_FILE_NAMES = new Set(["utils", "util", "helpers", "helper", "misc"]);

/** Splits the text of a file into its lines. */
function linesOf(text: string): string[] {
  return text.split("\n");
}

/** Returns the violations of a rule for each line of a file that matches a pattern. */
function matchLines(
  file: string,
  text: string,
  rule: string,
  pattern: RegExp,
  message: (match: string) => string,
): Violation[] {
  const found: Violation[] = [];
  linesOf(text).forEach((line, index) => {
    const match = pattern.exec(line);
    if (match !== null) found.push({ file, line: index + 1, rule, message: message(match[0]) });
  });
  return found;
}

const isTypeScript = (file: string): boolean => extname(file) === ".ts";
const isMarkdown = (file: string): boolean => extname(file) === ".md";
const isTest = (file: string): boolean => /(^|\/)test\/.*\.ts$/.test(file) || /\.(test|bench)\.ts$/.test(file);
const isLibrary = (file: string): boolean => /^packages\/[^/]+\/src\/.*\.ts$/.test(file);

/** The lines of a Markdown file outside fenced code, with inline code and quoted strings removed, as `[line number, text]`. */
function proseLines(text: string): [number, string][] {
  const prose: [number, string][] = [];
  let fenced = false;
  linesOf(text).forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced) prose.push([index + 1, line.replace(/`[^`]*`|"[^"]*"/g, "")]);
  });
  return prose;
}

/** The comment lines of a TypeScript file, as `[line number, text]`. */
function commentLines(text: string): [number, string][] {
  const comments: [number, string][] = [];
  linesOf(text).forEach((line, index) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) comments.push([index + 1, line]);
  });
  return comments;
}

/** Section signs name a numbered section of a document, which a reader cannot follow: name the rule or link it. */
export function checkSectionSigns(files: Files): Violation[] {
  return [...files].flatMap(([file, text]) =>
    matchLines(
      file,
      text,
      "section-sign",
      /§/,
      () => "Name the rule in words, or link the specification; no section signs.",
    ),
  );
}

/** The titles of the blocks of a test file, which are sentences about behavior. */
const TITLE = /\b(?:describe|it|test|bench)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1).)*)\1/;
/** A code that names a row, a unit or a numbered clause: `[T48]`, `E19:`, `3.4.3.1`. */
const TITLE_CODE =
  /\[[A-Z]{1,4}-?\d+[a-z]?\]|^[A-Z]{1,4}-?\d+[a-z]?[:.\s]|\(\s*[A-Z]{1,4}-?\d+\s*\)|\b(?!\d+\.0\.\d)\d+\.\d+\.\d+(?:\.\d+)?\b/;

/** A test title is a plain sentence about behavior, with no id, row code or clause number. */
export function checkTestTitles(files: Files): Violation[] {
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (!isTest(file) || !isTypeScript(file)) continue;
    linesOf(text).forEach((line, index) => {
      const title = TITLE.exec(line)?.[2];
      const code = title === undefined ? null : TITLE_CODE.exec(title);
      if (code !== null)
        found.push({
          file,
          line: index + 1,
          rule: "test-title",
          message: `The title "${title}" holds the code ${code[0]}; say it in words.`,
        });
    });
  }
  return found;
}

/** Narrative of how the code came to be, which belongs in the commit and never in the text. */
const HISTORY =
  /\b(?:previously|formerly|used to be|renamed|now (?:accepts|returns|reads|throws|uses|holds|runs|has|is|are|checks|rejects|refuses|writes|sends|supports|takes|gives|lists|stores)|we (?:found|decided|added|removed|changed|moved|fixed|chose|used)|(?:was|were) (?:removed|renamed|replaced|moved|added)|earlier versions?|in the past)\b/i;

/** Docs, and the comments of the code, state the current behavior only: no history. */
export function checkHistory(files: Files): Violation[] {
  const found: Violation[] = [];
  const report = (file: string, line: number, text: string): void => {
    const match = HISTORY.exec(text);
    if (match !== null)
      found.push({
        file,
        line,
        rule: "history",
        message: `"${match[0]}" tells how the text came to be; state the current behavior.`,
      });
  };
  for (const [file, text] of files) {
    if (isMarkdown(file)) for (const [line, prose] of proseLines(text)) report(file, line, prose);
    else if (isTypeScript(file) && (isLibrary(file) || isTest(file)))
      for (const [line, comment] of commentLines(text)) report(file, line, comment);
  }
  return found;
}

/** A file name says which concept the file holds. */
export function checkFileNames(files: Files): Violation[] {
  return [...files.keys()]
    .filter((file) => VAGUE_FILE_NAMES.has(basename(file, extname(file))))
    .map((file) => ({
      file,
      line: 0,
      rule: "file-name",
      message: "Name the file after the one concept it holds, never utils, helpers or misc.",
    }));
}

/** Whether a Markdown file is a README or a guide, which opens with a picture. */
function needsDiagram(file: string): boolean {
  return (
    isMarkdown(file) &&
    (basename(file) === "README.md" || basename(file) === "CONTRIBUTING.md" || /^docs\/[^/]+\/[^/]+\.md$/.test(file))
  );
}

/** Every README and guide has a Mermaid diagram: visualization first, then tables, then prose. */
export function checkDiagrams(files: Files): Violation[] {
  return [...files]
    .filter(([file, text]) => needsDiagram(file) && !/^```mermaid$/m.test(text))
    .map(([file]) => ({
      file,
      line: 0,
      rule: "diagram",
      message: "Add a Mermaid diagram of the architecture, flow or states that the document describes.",
    }));
}

/** The titles of the `##` headings of a Markdown file outside fenced code, with the 1-based line of each. */
function sectionTitles(text: string): [number, string][] {
  const titles: [number, string][] = [];
  let fenced = false;
  linesOf(text).forEach((line, index) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith("## ")) titles.push([index + 1, line.slice(3).trim()]);
  });
  return titles;
}

/** The documents of `docs/<package>/` that are not the guide of one module, so that they have no skeleton of a guide. */
const NOT_GUIDES = new Set([
  "architecture",
  "baseline",
  "choosing",
  "conformance",
  "conventions",
  "evidence",
  "performance",
  "size",
  "spec-gaps",
  "supported",
]);

/** The sections of every guide, each with what it holds. */
const GUIDE_SECTIONS: readonly (readonly [string, string])[] = [
  ["Quick start", "a minimal example that runs, so that the guide's first sample shows the main call"],
  ["Errors", "what a user can meet and what to do about it, or None where the module throws nothing"],
  ["Not included", "a table of `| Not included | Why |`, or None"],
  ["Differences from the references", "where the module departs from the specifications or the references, or None"],
];

/** Whether a file is the guide of a module: a document of `docs/<package>/` other than the cross-cutting ones. */
function isGuide(file: string): boolean {
  const name = /^docs\/[^/]+\/([^/]+)\.md$/.exec(file)?.[1];
  return name !== undefined && !NOT_GUIDES.has(name);
}

/** Every guide has the sections of the skeleton: a quick start, errors, what is not included and the differences from the references. */
export function checkGuideSections(files: Files): Violation[] {
  return [...files].flatMap(([file, text]) => {
    if (!isGuide(file)) return [];
    const present = new Set(sectionTitles(text).map(([, title]) => title));
    return GUIDE_SECTIONS.filter(([title]) => !present.has(title)).map(([title, holds]) => ({
      file,
      line: 0,
      rule: "guide-sections",
      message: `The guide has no "## ${title}" section: ${holds}.`,
    }));
  });
}

/** The cells of a row of a Markdown table. */
function cellsOf(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** The header that the table of a "Not included" section has: what is left out and why. */
const NOT_INCLUDED_HEADER = ["Not included", "Why"];

/** The "Not included" section of every document of `docs/<package>/` is one table, `| Not included | Why |`, so that a reader finds the answer in one form. */
export function checkNotIncluded(files: Files): Violation[] {
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (!/^docs\/[^/]+\/[^/]+\.md$/.test(file)) continue;
    const lines = linesOf(text);
    const start = sectionTitles(text).find(([, title]) => title === "Not included")?.[0];
    if (start === undefined) continue;
    const end = lines.findIndex((line, index) => index >= start && line.startsWith("## "));
    const section = lines.slice(start, end === -1 ? undefined : end);
    const header = section.findIndex((line) => line.startsWith("|"));
    const cells = header === -1 ? [] : cellsOf(section[header] ?? "");
    if (cells.length !== NOT_INCLUDED_HEADER.length || cells.some((cell, index) => cell !== NOT_INCLUDED_HEADER[index]))
      found.push({
        file,
        line: start + 1 + Math.max(header, 0),
        rule: "not-included",
        message: `The "Not included" section is a table headed | ${NOT_INCLUDED_HEADER.join(" | ")} |.`,
      });
  }
  return found;
}

/**
 * The sections of a README, in order: the root's guide the reader to a package, and each package's is its npm page, which gives
 * the install line and a minimal example before the diagram, since npm shows a Mermaid diagram as its source.
 */
const README_SECTIONS: readonly { readonly pattern: RegExp; readonly sections: readonly string[] }[] = [
  { pattern: /^README\.md$/, sections: ["Which package", "Documentation", "Development", "Layout", "License"] },
  {
    pattern: /^packages\/[^/]+\/README\.md$/,
    sections: ["Quick start", "Architecture", "API", "Supported", "Documentation", "License"],
  },
];

/** Every README has the sections of its kind, in their order, with others allowed between them. */
export function checkReadmeSections(files: Files): Violation[] {
  const found: Violation[] = [];
  for (const [file, text] of files) {
    const required = README_SECTIONS.find(({ pattern }) => pattern.test(file))?.sections;
    if (required === undefined) continue;
    const titles = sectionTitles(text).map(([, title]) => title);
    let from = 0;
    for (const title of required) {
      const at = titles.indexOf(title, from);
      if (at < 0)
        found.push({
          file,
          line: 0,
          rule: "readme-sections",
          message: `A README has the sections ${required.map((name) => `"${name}"`).join(", ")} in this order; "${title}" is missing or comes too early.`,
        });
      else from = at + 1;
    }
  }
  return found;
}

/** The brand's error is the base class; a package that has an error class of its own breaks the rule of one family of errors. */
export function checkErrorNames(files: Files): Violation[] {
  const packages = new Set(
    [...files.keys()]
      .flatMap((file) => /^packages\/([^/]+)\//.exec(file)?.[1] ?? [])
      .map((name) => name.replaceAll("-", "")),
  );
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (!isTypeScript(file) || !isLibrary(file)) continue;
    linesOf(text).forEach((line, index) => {
      const name = /\bclass\s+([A-Za-z]+)Error\b/.exec(line)?.[1];
      if (name !== undefined && packages.has(name.toLowerCase()))
        found.push({
          file,
          line: index + 1,
          rule: "package-error",
          message: `${name}Error is named after a package; extend the brand's error and name the failure instead.`,
        });
    });
  }
  return found;
}

/** The module specifiers that a TypeScript file imports or re-exports, with their lines. */
function specifiersOf(text: string): [number, string][] {
  const found: [number, string][] = [];
  linesOf(text).forEach((line, index) => {
    const specifier = /(?:from|import)\s*\(?\s*["']([^"']+)["']/.exec(line)?.[1];
    if (specifier !== undefined) found.push([index + 1, specifier]);
  });
  return found;
}

/** Packages of another family are never imported or depended on, apart from the examples that adapt them. */
export function checkFamilies(files: Files): Violation[] {
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (FOREIGN_ALLOWED.test(file) || !isTypeScript(file)) continue;
    for (const [line, specifier] of specifiersOf(text)) {
      const scope = FOREIGN_SCOPES.find((prefix) => specifier.startsWith(prefix));
      if (scope !== undefined)
        found.push({
          file,
          line,
          rule: "family",
          message: `${specifier} belongs to another family; define a port or speak an open standard, and put the adapter in examples.`,
        });
    }
  }
  return found;
}

/** The module that holds a file: the nearest directory with an `index.ts`, or `undefined` for a file outside every module. */
function moduleOf(file: string, files: Files): string | undefined {
  for (
    let directory = dirname(file);
    basename(directory) !== "src" && directory !== ".";
    directory = dirname(directory)
  ) {
    if (files.has(`${directory}/index.ts`)) return directory;
  }
  return undefined;
}

/** The files through which another module reaches a module: its index, its internal file and the `wire.ts` of `delivery`, a second subpath. */
const MODULE_ENTRIES: readonly string[] = ["index.ts", "internal.ts", "wire.ts"];

/** The module that a relative import of a file reaches when it goes past the entries of that module, if any. */
function deepTarget(file: string, specifier: string, files: Files): string | undefined {
  const target = posix.normalize(posix.join(dirname(file), specifier.replace(/\.js$/, ".ts")));
  const targetModule = moduleOf(target, files);
  if (targetModule === undefined || targetModule === moduleOf(file, files)) return undefined;
  const isEntry = MODULE_ENTRIES.includes(posix.basename(target)) && posix.dirname(target) === targetModule;
  return isEntry ? undefined : targetModule;
}

/** A module reaches another only through its `index.ts` or `internal.ts`, never by a deep path. */
export function checkEntries(files: Files): Violation[] {
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (!isTypeScript(file) || !/^packages\/[^/]+\/(src|test)\//.test(file)) continue;
    for (const [line, specifier] of specifiersOf(text)) {
      const reached = specifier.startsWith(".") ? deepTarget(file, specifier, files) : undefined;
      if (reached !== undefined)
        found.push({
          file,
          line,
          rule: "entry",
          message: `${specifier} reaches into ${reached}; import its index.js, internal.js or wire.js.`,
        });
    }
  }
  return found;
}

/** A library never writes to the console: the caller passes a logger, or reads what the library returns. */
export function checkConsole(files: Files): Violation[] {
  return [...files].flatMap(([file, text]) =>
    isLibrary(file) && !CONSOLE_ALLOWED.test(file)
      ? matchLines(
          file,
          text,
          "console",
          /\bconsole\.\w+/,
          (call) => `${call} writes to the console; library code takes a logger or returns the result.`,
        )
      : [],
  );
}

/** Every check, in the order of the standards. */
export const CHECKS: readonly ((files: Files) => Violation[])[] = [
  checkSectionSigns,
  checkTestTitles,
  checkHistory,
  checkFileNames,
  checkDiagrams,
  checkGuideSections,
  checkNotIncluded,
  checkReadmeSections,
  checkErrorNames,
  checkFamilies,
  checkEntries,
  checkConsole,
  checkIdentity,
  checkTrademarks,
  checkClaimWords,
  checkReadmeLinks,
];

/** Runs every check over the files. */
export function checkStandards(files: Files): Violation[] {
  return CHECKS.flatMap((check) => check(files));
}

/** Reads the text files of the repository that git tracks or would track, with the manifests, NOTICE files and the files of the identity, without the generated and third-party ones. */
export function readRepository(root: string): Files {
  const listing = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = new Map<string, string>();
  for (const file of listing.split("\0")) {
    if (
      file === "" ||
      EXCLUDED.test(file) ||
      EXEMPT.test(file) ||
      !(
        TEXT_EXTENSIONS.has(extname(file)) ||
        ["package.json", "NOTICE", "context7.json", "CITATION.cff"].includes(basename(file))
      )
    )
      continue;
    try {
      files.set(file, readFileSync(join(root, file), "utf8"));
    } catch (error) {
      // A file that git lists and the working tree lacks is a deletion that is not staged yet.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return files;
}

/** Prints the violations of the files below the given paths, or of every file, and returns the exit code. */
function main(paths: readonly string[]): number {
  const violations = checkStandards(readRepository(resolve(import.meta.dirname, ".."))).filter(
    ({ file }) => paths.length === 0 || paths.some((path) => file.startsWith(path)),
  );
  for (const { file, line, rule, message } of violations)
    console.error(`${file}${line > 0 ? `:${line}` : ""} [${rule}] ${message}`);
  console.log(violations.length === 0 ? "The standards hold." : `${violations.length} violations of the standards.`);
  return violations.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
