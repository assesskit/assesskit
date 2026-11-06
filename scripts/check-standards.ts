// cspell:ignore measurekit
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, posix, resolve } from "node:path";
import ts from "typescript";
import { checkClaimWords, checkIdentity, checkReadmeLinks, checkTrademarks } from "./check-identity.ts";
import { subpathSources } from "./subpaths.ts";

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

/** Returns an expression without the parentheses, `as` and `satisfies` around it. */
function unwrapped(expression: ts.Expression): ts.Expression {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner))
    inner = inner.expression;
  return inner;
}

/** The text of the name of a property, or `undefined` for a computed one. */
function propertyName(name: ts.PropertyName | undefined): string | undefined {
  return name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : undefined;
}

/** Whether a declaration carries `export`. */
function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The files that are entries of a package, or the indexes that an entry gathers: their exports are its public names. */
const ENTRY_FILE = /^packages\/[^/]+\/src\/(?:.*\/)?(?:index|checks|errors|wire)\.ts$/;

/** The exported interfaces named `*Limits` that hold no limit on input: the time limits of a test are QTI's. */
const NOT_LIMITS = new Set(["EffectiveTimeLimits"]);

/** The names that an entry of a package exports by name. */
function namesExportedBy(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return source.statements.flatMap((statement) => {
    const clause = ts.isExportDeclaration(statement) ? statement.exportClause : undefined;
    return clause !== undefined && ts.isNamedExports(clause) ? clause.elements.map(({ name }) => name.text) : [];
  });
}

/** The names that the entries of the packages export, which make a limits interface a public one. */
function entryExports(files: Files): Set<string> {
  return new Set([...files].flatMap(([file, text]) => (ENTRY_FILE.test(file) ? namesExportedBy(file, text) : [])));
}

/** A node that names a limit, with the name. */
type NamedLimit = readonly [ts.Node, string | undefined];

/** The limit of a `SecurityError` that a `new` expression makes, when it names it in a string. */
function limitOfError(node: ts.NewExpression): NamedLimit[] {
  const limit = node.arguments?.[1];
  const isLimitError = ts.isIdentifier(node.expression) && node.expression.text === "SecurityError";
  return isLimitError && limit !== undefined && ts.isStringLiteralLike(limit) ? [[limit, limit.text]] : [];
}

/** The keys of the exported `*_LIMITS` objects that a statement declares. */
function limitsOfObjects(node: ts.VariableStatement): NamedLimit[] {
  if (!isExported(node)) return [];
  return node.declarationList.declarations.flatMap(({ name, initializer }) => {
    let value = initializer === undefined ? undefined : unwrapped(initializer);
    // `Object.freeze({ ... })` holds the object as its argument.
    if (value !== undefined && ts.isCallExpression(value) && value.arguments.length === 1) {
      const [argument] = value.arguments;
      if (argument !== undefined) value = unwrapped(argument);
    }
    return ts.isIdentifier(name) &&
      name.text.endsWith("_LIMITS") &&
      value !== undefined &&
      ts.isObjectLiteralExpression(value)
      ? value.properties.map((property): NamedLimit => [property, propertyName(property.name)])
      : [];
  });
}

/** The limits that a node names: the limit of a `SecurityError`, the keys of a limits object or the properties of a limits interface. */
function limitsNamedBy(node: ts.Node, exported: ReadonlySet<string>): NamedLimit[] {
  if (ts.isNewExpression(node)) return limitOfError(node);
  if (ts.isVariableStatement(node)) return limitsOfObjects(node);
  if (
    ts.isInterfaceDeclaration(node) &&
    node.name.text.endsWith("Limits") &&
    exported.has(node.name.text) &&
    !NOT_LIMITS.has(node.name.text)
  )
    return node.members.map((member): NamedLimit => [member, propertyName(member.name)]);
  return [];
}

/**
 * The limits that a file of a package names, each with its line: the `limit` of each `SecurityError` that it throws, each
 * key of an exported `*_LIMITS` object, and each property of a `*Limits` interface that an entry of the package exports.
 */
function limitsOf(file: string, text: string, exported: ReadonlySet<string>): [number, string][] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: [number, string][] = [];
  const visit = (node: ts.Node): void => {
    for (const [named, name] of limitsNamedBy(node, exported)) {
      if (name !== undefined) found.push([source.getLineAndCharacterOfPosition(named.getStart(source)).line + 1, name]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * SECURITY.md names every limit of the packages, so that a limit added without its row, or the file emptied by a merge, fails:
 * the `limit` of each `SecurityError`, the keys of each exported `*_LIMITS` object and of each exported `*Limits` interface.
 */
export function checkSecurityLimits(files: Files): Violation[] {
  const security = files.get("SECURITY.md") ?? "";
  const exported = entryExports(files);
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (!isLibrary(file) || !/SecurityError|_LIMITS\b|Limits\b/.test(text)) continue;
    for (const [line, name] of limitsOf(file, text, exported)) {
      if (security.includes(`\`${name}\``)) continue;
      found.push({
        file,
        line,
        rule: "security-limit",
        message: `The limit ${name} is not named in SECURITY.md; give it a row of its table of limits, with its default.`,
      });
    }
  }
  return found;
}

/** A re-export of a source file: the path of the file it takes from, and the names it takes. */
interface Reexport {
  readonly target: string;
  readonly names: ReadonlySet<string> | "all";
}

/** The source file of a specifier: a relative path from the file, or an entry of a package of the family; undefined for any other package. */
function sourceOf(file: string, specifier: string, entries: ReadonlyMap<string, string>): string | undefined {
  if (specifier.startsWith(".")) return posix.normalize(posix.join(dirname(file), specifier.replace(/\.js$/, ".ts")));
  return entries.get(specifier);
}

/** The re-exports of values in a source file, relative or from a package of the family. */
function reexportsOf(file: string, source: ts.SourceFile, entries: ReadonlyMap<string, string>): Reexport[] {
  return source.statements.flatMap((statement): Reexport[] => {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) return [];
    const specifier = (statement.moduleSpecifier as ts.StringLiteral | undefined)?.text;
    const target = specifier === undefined ? undefined : sourceOf(file, specifier, entries);
    if (target === undefined) return [];
    const { exportClause } = statement;
    if (exportClause === undefined) return [{ target, names: "all" }];
    if (!ts.isNamedExports(exportClause)) return [];
    const names = exportClause.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => (element.propertyName ?? element.name).text);
    return [{ target, names: new Set(names) }];
  });
}

/** The tag `@example` at the start of a line of a comment, and not an address such as `learner@example.org` in its text. */
const EXAMPLE_TAG = /^[ \t]*\*[ \t]*@example\b/m;

/**
 * Whether each exported function of an entry, among the names given and through the modules it re-exports, has an
 * `@example`: one value for each function. A file that is being read already, in a cycle of re-exports, adds none.
 */
function functionsOf(
  entry: string,
  files: Files,
  entries: ReadonlyMap<string, string>,
  names: ReadonlySet<string> | "all" = "all",
  reading: ReadonlySet<string> = new Set(),
): boolean[] {
  const text = files.get(entry);
  if (text === undefined || reading.has(entry)) return [];
  const source = ts.createSourceFile(entry, text, ts.ScriptTarget.Latest, true);
  const declared = source.statements.flatMap((statement) =>
    ts.isFunctionDeclaration(statement) &&
    isExported(statement) &&
    statement.name !== undefined &&
    (names === "all" || names.has(statement.name.text))
      ? [EXAMPLE_TAG.test(source.text.slice(statement.getFullStart(), statement.getStart(source)))]
      : [],
  );
  const reexported = reexportsOf(entry, source, entries).flatMap(({ target, names: taken }) =>
    functionsOf(
      target,
      files,
      entries,
      names === "all" ? taken : taken === "all" ? names : new Set([...taken].filter((name) => names.has(name))),
      new Set([...reading, entry]),
    ),
  );
  return [...declared, ...reexported];
}

/**
 * The entry of every subpath of a package, as its manifest exports it, exports a function whose TSDoc has an `@example`: the
 * main function of the module, shown with its result as a comment. An entry that exports no function, such as the errors,
 * has none. The `tsdoc.test.ts` of each package runs every example and compares the results it shows.
 */
export function checkModuleExamples(files: Files): Violation[] {
  const entries = subpathSources(files);
  return [...entries.values()]
    .filter((entry) => {
      const functions = functionsOf(entry, files, entries);
      return functions.length > 0 && !functions.includes(true);
    })
    .map((entry) => ({
      file: entry,
      line: 0,
      rule: "module-example",
      message: "The entry exports no function whose TSDoc has an @example; put one on the main function of the module.",
    }));
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
  checkSecurityLimits,
  checkModuleExamples,
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
