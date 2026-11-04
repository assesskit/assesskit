import { FAMILY, HOLDERS, MARKS, type Mark, PACKAGES, type PackageIdentity, SITE } from "./family.ts";

/**
 * What the texts of the family say of themselves, computed from `family.ts`: the address of each package's page, the lines
 * of the marks of others, and the first paragraph of a Markdown page. Every family copies this file
 * unchanged.
 */

/** The folder of a package below `packages/` and `docs/`: its name after the scope. */
export function folderOf(name: string): string {
  return name.slice(name.indexOf("/") + 1);
}

/** The path of a package's page on the docs site, as the `structure-dir` router of TypeDoc writes it: `_<scope>/<name>/`. */
export function packagePath(name: string): string {
  return `${name.replace(/^@/, "_")}/`;
}

/** The address of a package's page on the docs site, which is its `homepage`. */
export function packageUrl(name: string): string {
  return `${SITE}${packagePath(name)}`;
}

/** The identity of the package of a folder below `packages/`, or `undefined` when the table has no row for it. */
export function findPackage(folder: string): PackageIdentity | undefined {
  return PACKAGES.find((identity) => folderOf(identity.name) === folder);
}

/** The line of a mark, in the form that its holder asks for. */
export function markLineOf(mark: Mark): string {
  const form = HOLDERS[mark.holder]?.markLine;
  if (form === undefined) throw new Error(`The holder ${mark.holder} of ${mark.mark} has no markLine in family.ts.`);
  return form.replace("{mark}", mark.mark);
}

/** The start of the line that says the family is not affiliated with some bodies. */
const NOT_AFFILIATED_START = `${FAMILY.name} is not affiliated with, endorsed by or approved by `;

/** The line that says the family is not affiliated with the bodies named by their keys in `HOLDERS`. */
export function notAffiliatedLine(holders: readonly string[]): string {
  const names = holders.map((key) => HOLDERS[key]?.name ?? key);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : (names[0] ?? "");
  return `${NOT_AFFILIATED_START}${list}${list.endsWith(".") ? "" : "."}`;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every line of a mark or of a body that the family may write, longest first so that none is cut by a shorter one. */
const FIXED_LINES = [
  ...MARKS.map(markLineOf),
  ...Object.values(HOLDERS).flatMap(({ trademark }) => trademark ?? []),
].sort((a, b) => b.length - a.length);
/** The line that the family is not affiliated with some bodies, whichever they are: it ends at the first period that ends a sentence. */
const NOT_AFFILIATED = new RegExp(`${escapeRegExp(NOT_AFFILIATED_START)}[^\\n]*?\\.(?=\\s|$)`, "g");

/** A text without the lines of marks and bodies that it holds, so that the names inside them name nothing. */
export function withoutLines(text: string): string {
  let rest = text.replace(NOT_AFFILIATED, "");
  for (const line of FIXED_LINES) rest = rest.replaceAll(line, "");
  return rest;
}

/** The lines of the marks and the bodies that a text names: one for each mark, the bodies' own, and the line that the family is none of theirs. */
function linesNaming(marks: readonly Mark[], holders: readonly string[]): string[] {
  const trademarks = holders.flatMap((key) => HOLDERS[key]?.trademark ?? []);
  return [...marks.map(markLineOf), ...trademarks, ...(holders.length === 0 ? [] : [notAffiliatedLine(holders)])];
}

/** The lines that a text needs, in their order: one for each mark it names, each named body's own line, and the line that the family is not affiliated with them. */
export function linesFor(text: string): string[] {
  const rest = withoutLines(text);
  const marks = MARKS.filter(({ named }) => named.test(rest));
  const holders = Object.entries(HOLDERS)
    .filter(([key, { named }]) => named.test(rest) || marks.some((mark) => mark.holder === key))
    .map(([key]) => key);
  return linesNaming(marks, holders);
}

/** Every line of the family, as the footer of every page of the docs site carries them. */
export function familyLines(): string[] {
  return linesNaming(MARKS, Object.keys(HOLDERS));
}

/** The lines of a Markdown text outside its fenced blocks, as `[line number, text]` with 1-based numbers. */
export function unfencedLines(markdown: string): [number, string][] {
  const lines: [number, string][] = [];
  let fenced = false;
  markdown.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) lines.push([index + 1, line]);
  });
  return lines;
}

/** Whether a line opens a block that is not prose: a heading, a table, a quote, a list, an image or HTML. */
const NOT_PROSE = /^\s*(#|\||>|[-*+] |\d+\. |!\[|<)/;

/**
 * The first paragraph of prose of a Markdown text after its title, its lines joined by a space, with its Markdown as written:
 * the first block of lines that are not fenced, a heading, a table, a quote, a list, an image or HTML.
 */
export function firstParagraph(markdown: string): string | undefined {
  const blocks: string[][] = [[]];
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      blocks.push([]);
    } else if (fenced || line.trim() === "") blocks.push([]);
    else blocks.at(-1)?.push(line.trim());
  }
  const paragraph = blocks.find((block) => block.length > 0 && !NOT_PROSE.test(block[0] ?? ""));
  return paragraph?.join(" ");
}
