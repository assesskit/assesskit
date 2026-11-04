import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Violation } from "./check-standards.ts";
import { FAMILY, SITE } from "./family.ts";
import { sourcePagePath, unfencedLines } from "./identity.ts";

/**
 * The test of the built docs site (`pnpm check:site`, after `pnpm docs:api`): every page has a title of its own, a description
 * other than TypeDoc's and a canonical URL that the sitemap lists; every README and guide has its Markdown copy; `llms.txt` has
 * the parts of llms.txt; every link to the site from the READMEs, the copies and `llms.txt` reaches a file of it; no two
 * addresses of the site differ only by case. Every family
 * copies this file unchanged.
 */

/** The text files of the built site, by their path below its folder, with `/` as separator. */
export type Site = ReadonlyMap<string, string>;

/** The description that TypeDoc writes on every page, which says nothing of the page. */
const TYPEDOC_DESCRIPTION = `Documentation for ${FAMILY.name}`;
/** The files of the site that are not pages of the docs. */
const NOT_PAGES = new Set(["404.html"]);
/** A link of Markdown, with what it points to. */
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const violation = (file: string, line: number, rule: string, message: string): Violation => ({
  file,
  line,
  rule,
  message,
});

/** The path below the site's base by which the site links a page: `""` for `index.html`, `x/` for `x/index.html`. */
function pagePath(file: string): string {
  return file.replace(/(^|\/)index\.html$/, "$1");
}

/** The file of the site that an address of it names, or `undefined` for an address elsewhere. */
export function fileOf(url: string): string | undefined {
  if (!url.startsWith(SITE)) return undefined;
  const path = url.slice(SITE.length).replace(/[#?].*$/, "");
  return path === "" || path.endsWith("/") ? `${path}index.html` : path;
}

const attribute = (html: string, pattern: RegExp): string | undefined => pattern.exec(html)?.[1];

/** The violations of one page's head: its title against those of the pages before it, its description, its canonical link. */
function headViolations(file: string, html: string, titles: Map<string, string>): Violation[] {
  const found: Violation[] = [];
  const title = attribute(html, /<title>([^<]*)<\/title>/) ?? "";
  const description = attribute(html, /<meta name="description" content="([^"]*)"/) ?? "";
  const links = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map(([, href]) => href);
  const expected = `${SITE}${pagePath(file)}`;
  const other = titles.get(title);
  if (title === "") found.push(violation(file, 0, "site-title", "Give the page a title."));
  else if (other !== undefined)
    found.push(violation(file, 0, "site-title", `The title "${title}" is also that of ${other}.`));
  titles.set(title, other ?? file);
  if (description === "" || description === TYPEDOC_DESCRIPTION)
    found.push(violation(file, 0, "site-description", "Give the page a description of its own."));
  if (links.length !== 1 || links[0] !== expected)
    found.push(violation(file, 0, "site-canonical", `Give the page one canonical link, to ${expected}.`));
  return found;
}

/** The violations of the sitemap against the canonical URLs of the pages: each listed once, nothing else, no `lastmod`. */
function sitemapViolations(text: string, canonical: ReadonlySet<string>): Violation[] {
  const listed = new Set([...text.matchAll(/<loc>([^<]*)<\/loc>/g)].flatMap(([, url]) => url ?? []));
  return [
    ...[...canonical].filter((url) => !listed.has(url)).map((url) => `List ${url} in the sitemap.`),
    ...[...listed].filter((url) => !canonical.has(url)).map((url) => `${url} is no page of the site.`),
    ...(/<lastmod>/.test(text) ? ["Leave out lastmod: the build time is not when a page changed."] : []),
  ].map((message) => violation("sitemap.xml", 0, "site-sitemap", message));
}

/**
 * Every page has a title that no other page has, a description of its own that is not TypeDoc's, and one canonical URL, at
 * which the site links it and which the sitemap lists; the sitemap lists no other URL.
 */
export function checkPages(site: Site): Violation[] {
  const titles = new Map<string, string>();
  const pages = [...site].filter(([file]) => file.endsWith(".html") && !NOT_PAGES.has(file));
  const heads = pages.flatMap(([file, html]) => headViolations(file, html, titles));
  const canonical = new Set(pages.map(([file]) => `${SITE}${pagePath(file)}`));
  return [...heads, ...sitemapViolations(site.get("sitemap.xml") ?? "", canonical)];
}

/**
 * The path of every address of the site and of each folder above it, as the files of the site, its sitemap and its canonical
 * links name them, so that two spellings of one folder are found on a disk that tells the cases apart as on one that does not.
 */
function addressedPaths(site: Site): Set<string> {
  const urls = [...(site.get("sitemap.xml") ?? "").matchAll(/<loc>([^<]*)<\/loc>/g)].flatMap(([, url]) => url ?? []);
  const canonical = [...site].flatMap(([, text]) =>
    [...text.matchAll(/<link rel="canonical" href="([^"]*)"/g)].flatMap(([, href]) => href ?? []),
  );
  const paths = [...site.keys(), ...[...urls, ...canonical].map((url) => url.slice(SITE.length))];
  return new Set(
    paths.flatMap((path) => {
      const parts = path.split("/").filter(Boolean);
      return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    }),
  );
}

/**
 * No two addresses of the site, nor two folders on the way to them, differ only by case: a disk that ignores case merges them
 * and a search engine takes them for one page.
 */
export function checkCaseCollisions(site: Site): Violation[] {
  const spellings = new Map<string, string[]>();
  for (const path of addressedPaths(site)) {
    const key = path.toLowerCase();
    spellings.set(key, [...(spellings.get(key) ?? []), path]);
  }
  const reported: string[] = [];
  return [...spellings]
    .filter(([, paths]) => paths.length > 1)
    .sort(([a], [b]) => a.length - b.length)
    .flatMap(([key, paths]) => {
      // A folder inside one that is reported already differs only because its parent does.
      if (reported.some((parent) => key.startsWith(`${parent}/`))) return [];
      reported.push(key);
      const urls = paths.map((path) => `${SITE}${path}`).join(" and ");
      return [violation(paths[0] ?? "", 0, "site-case", `${urls} differ only by case: name one of them otherwise.`)];
    });
}

/** Every README and guide of the repository has its page and, beside it, its Markdown copy, which the page links. */
export function checkMarkdownCopies(site: Site, sources: readonly string[]): Violation[] {
  const found: Violation[] = [];
  for (const source of sources) {
    const path = sourcePagePath(source);
    if (path === undefined) continue;
    const html = site.get(`${path}index.html`);
    if (html === undefined) {
      found.push(violation(source, 0, "site-copy", `The page of ${source} is not at ${SITE}${path}.`));
      continue;
    }
    if (!site.has(`${path}index.md`))
      found.push(violation(source, 0, "site-copy", `Write the Markdown copy of ${source} at ${SITE}${path}index.md.`));
    if (!html.includes(`<link rel="alternate" type="text/markdown" href="${SITE}${path}index.md"/>`))
      found.push(
        violation(`${path}index.html`, 0, "site-copy", "Link the Markdown copy of the page as its alternate."),
      );
  }
  return found;
}

/** `llms.txt` opens with the family's name as its H1 and a blockquote, and lists its links under H2 sections, as llms.txt asks. */
export function checkLlms(site: Site): Violation[] {
  const text = site.get("llms.txt");
  if (text === undefined) return [violation("llms.txt", 0, "site-llms", "Write llms.txt.")];
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const found: Violation[] = [];
  if (lines[0] !== `# ${FAMILY.name}`) found.push(violation("llms.txt", 1, "site-llms", `Open with # ${FAMILY.name}.`));
  if (!lines[1]?.startsWith("> "))
    found.push(violation("llms.txt", 0, "site-llms", "Follow the H1 with a blockquote."));
  if (lines.some((line) => /^#{3,} /.test(line)) || !lines.some((line) => line.startsWith("## ")))
    found.push(violation("llms.txt", 0, "site-llms", "List the links under H2 sections, and use no deeper heading."));
  const listed = lines.filter((line) => /^- \[[^\]]+\]\([^)]+\)/.test(line));
  if (listed.length === 0) found.push(violation("llms.txt", 0, "site-llms", "List the pages as - [name](url): notes."));
  return found;
}

/** The links to the site in a text of Markdown, with their lines. */
function siteLinks(text: string): [number, string][] {
  return unfencedLines(text).flatMap(([line, content]) =>
    [...content.replace(/`[^`]*`/g, "").matchAll(MARKDOWN_LINK)].flatMap(([, url = ""]) =>
      url.startsWith(SITE) ? [[line, url] as [number, string]] : [],
    ),
  );
}

/** Every link to the site from a README of the repository, from a Markdown copy or from `llms.txt` reaches a file of the site. */
export function checkSiteLinks(site: Site, readmes: ReadonlyMap<string, string>): Violation[] {
  const texts = [...readmes, ...[...site].filter(([file]) => file.endsWith(".md") || file === "llms.txt")];
  return texts.flatMap(([file, text]) =>
    siteLinks(text).flatMap(([line, url]) => {
      const target = fileOf(url);
      return target !== undefined && site.has(target)
        ? []
        : [violation(file, line, "site-link", `${url} reaches no file of the site.`)];
    }),
  );
}

/** `robots.txt` lets every crawler in and names the sitemap, and `CNAME` names the host of the site. */
export function checkSiteFiles(site: Site): Violation[] {
  const found: Violation[] = [];
  const robots = site.get("robots.txt") ?? "";
  if (!/^User-agent: \*$/m.test(robots) || /^Disallow: \S/m.test(robots))
    found.push(violation("robots.txt", 0, "site-files", "Let every crawler in: User-agent: * with no Disallow."));
  if (!robots.includes(`Sitemap: ${SITE}sitemap.xml`))
    found.push(violation("robots.txt", 0, "site-files", `Name the sitemap: Sitemap: ${SITE}sitemap.xml.`));
  if ((site.get("CNAME") ?? "").trim() !== new URL(SITE).host)
    found.push(violation("CNAME", 0, "site-files", `Write the host of the site, ${new URL(SITE).host}.`));
  if (!site.has("404.html"))
    found.push(violation("404.html", 0, "site-files", "Write the page of an address that holds none."));
  return found;
}

/** Runs every check of the built site. */
export function checkSite(site: Site, sources: readonly string[], readmes: ReadonlyMap<string, string>): Violation[] {
  return [
    ...checkPages(site),
    ...checkCaseCollisions(site),
    ...checkMarkdownCopies(site, sources),
    ...checkLlms(site),
    ...checkSiteLinks(site, readmes),
    ...checkSiteFiles(site),
  ];
}

/** Reads the text files of a built site. */
function readSite(directory: string): Site {
  const site = new Map<string, string>();
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(html|md|xml|txt)$|^CNAME$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    site.set(relative(directory, file).split("\\").join("/"), readFileSync(file, "utf8"));
  }
  return site;
}

/** Checks the site built into a folder, `docs/api` by default, against the Markdown files of the repository. */
function main(folder: string): number {
  const root = resolve(import.meta.dirname, "..");
  const sources = execFileSync("git", ["ls-files", "README.md", "packages/*/README.md", "docs/*/*.md"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const readmes = new Map(
    sources
      .filter((file) => file.endsWith("README.md"))
      .map((file): [string, string] => [file, readFileSync(join(root, file), "utf8")]),
  );
  const violations = checkSite(readSite(resolve(root, folder)), sources, readmes);
  for (const { file, line, rule, message } of violations)
    console.error(`${file}${line > 0 ? `:${line}` : ""} [${rule}] ${message}`);
  console.log(violations.length === 0 ? "The site holds." : `${violations.length} violations in the site.`);
  return violations.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv[2] ?? "docs/api");
