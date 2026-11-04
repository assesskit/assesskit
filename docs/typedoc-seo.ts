import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import {
  Application,
  Comment,
  type CommentDisplayPart,
  DeclarationReflection,
  PageEvent,
  type ProjectReflection,
  type Reflection,
  ReflectionKind,
  RendererEvent,
} from "typedoc";
import { FAMILY, PACKAGES, type PackageIdentity, SITE } from "../scripts/family.ts";
import {
  describeParagraph,
  familyLines,
  firstParagraph,
  folderOf,
  linesFor,
  plainText,
  repositoryUrl,
  titleOf,
  unfencedLines,
} from "../scripts/identity.ts";
import { buildLlmsText, type SitePage } from "../scripts/llms.ts";

/**
 * The plugin of TypeDoc that makes the docs site say what `scripts/family.ts` says. Each page gets a title that names its
 * subject, its package and its standard, a description from its own text, and a canonical URL that the sitemap lists as the
 * site links it; each README and guide gets a Markdown copy beside it; the site gets `llms.txt`, `robots.txt`, `CNAME` and a
 * `404.html`, and the footer of every page carries the lines of the marks of others. Every family copies this file unchanged.
 */

/** The root of the repository, against which the sources of pages are named. */
const ROOT = join(import.meta.dirname, "..");
/** The `<meta name="description">` that TypeDoc writes on every page. */
const TYPEDOC_DESCRIPTION = /<meta name="description" content="[^"]*"\/>/;
/** A link of a line of Markdown, with what it points to. */
const MARKDOWN_LINK = /(!?\[[^\]]*\])\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

/** A rendered page with its title and the Markdown file it comes from, if any. */
interface RenderedPage extends SitePage {
  readonly title: string;
  readonly source?: string;
}

const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The path of a page below the site's base as the site links it: a page in a folder ends in `/`, the home page is `""`. */
function sitePath(url: string): string {
  return url.replace(/(^|\/)index\.html$/, "$1");
}

/** The reflection just below the project that holds a reflection: its package. */
function packageOf(model: Reflection): Reflection {
  let reflection = model;
  while (reflection.parent !== undefined && !reflection.parent.isProject()) reflection = reflection.parent;
  return reflection;
}

/** The nearest module that holds a reflection below its package: the entry point that a host imports. */
function moduleOf(model: Reflection, top: Reflection): Reflection {
  let reflection = model;
  while (reflection.parent !== undefined && reflection.parent !== top && !reflection.kindOf(ReflectionKind.Module))
    reflection = reflection.parent;
  return reflection.kindOf(ReflectionKind.Module) ? reflection : top;
}

/** The summary of the comment of a reflection, of its first signature or of its getter. */
function summaryOf(model: Reflection): readonly CommentDisplayPart[] | undefined {
  if (model.comment !== undefined) return model.comment.summary;
  if (model instanceof DeclarationReflection)
    return (model.signatures?.[0] ?? model.getSignature ?? model.indexSignatures?.[0])?.comment?.summary;
  return undefined;
}

/** The standard of a package, as the title of each of its pages carries it after the package's name. */
const labelOf = (identity: PackageIdentity | undefined): string =>
  identity?.label === undefined ? "" : ` (${identity.label})`;

/** The Markdown source of a document, from the registry of the project or else from the folder of its package's guides. */
function documentSource(project: ProjectReflection, model: Reflection, folder: string): string {
  const path = project.files.getReflectionPath(model);
  return path === undefined ? `docs/${folder}/${model.name}.md` : relative(ROOT, path).split("\\").join("/");
}

/** The names from a module down to a reflection, as a host writes them: `Namespace.member`. */
function nameBelow(model: Reflection, module: Reflection): string {
  const names: string[] = [];
  for (let reflection: Reflection | undefined = model; reflection !== undefined && reflection !== module; ) {
    names.unshift(reflection.name);
    reflection = reflection.parent;
  }
  return names.join(".");
}

/** What the page of a package's README is. */
function describePackage(path: string, top: Reflection, identity: PackageIdentity | undefined): RenderedPage {
  const description = identity?.description ?? describeParagraph(Comment.combineDisplayParts(summaryOf(top)));
  return {
    path,
    kind: "package",
    packageName: top.name,
    heading: top.name,
    title: `${top.name} · ${description.split(":")[0]}`,
    description,
    source: `packages/${folderOf(top.name)}/README.md`,
  };
}

/** What the page of a guide is: its title and its first paragraph come from its Markdown. */
function describeGuide(path: string, source: string, top: Reflection, label: string): RenderedPage {
  const text = readFileSync(join(ROOT, source), "utf8");
  const heading = titleOf(text) ?? plainText(source);
  return {
    path,
    kind: "guide",
    packageName: top.name,
    heading,
    title: `${heading} · ${top.name}${label}`,
    description: describeParagraph(firstParagraph(text) ?? heading),
    source,
  };
}

/** What the page of a reflection is: a package, a guide, a module of the API or a part of one. */
function describeReflection(project: ProjectReflection, model: Reflection, path: string): RenderedPage {
  const top = packageOf(model);
  const identity = PACKAGES.find(({ name }) => name === top.name);
  const label = labelOf(identity);
  if (model === top) return describePackage(path, top, identity);
  if (model.isDocument()) return describeGuide(path, documentSource(project, model, folderOf(top.name)), top, label);
  const module = moduleOf(model, top);
  const summary = summaryOf(model);
  const kind = ReflectionKind.singularString(model.kind).toLowerCase();
  const description =
    summary === undefined
      ? `The ${kind} ${model.name} of ${module.name}.`
      : describeParagraph(Comment.combineDisplayParts(summary));
  if (model === module)
    return {
      path,
      kind: "module",
      packageName: top.name,
      heading: model.name,
      title: `${model.name} API${label}`,
      description,
    };
  const name = nameBelow(model, module);
  return {
    path,
    kind: "api",
    packageName: top.name,
    heading: name,
    title: `${name} · ${module.name}${label}`,
    description,
  };
}

/** What a page is: the home page, an index of the project, or the page of a reflection. */
function describePage(page: PageEvent): RenderedPage {
  const path = sitePath(page.url);
  const model = page.model as Reflection;
  if (path === "")
    return {
      path,
      kind: "home",
      heading: FAMILY.name,
      title: `${FAMILY.name} · ${FAMILY.sentence.split(":")[0]}`,
      description: FAMILY.sentence,
      source: "README.md",
    };
  if (!model.isProject()) return describeReflection(page.project, model, path);
  const hierarchy = page.pageKind === "hierarchy";
  return {
    path,
    kind: "api",
    heading: FAMILY.name,
    title: hierarchy ? `Class hierarchy · ${FAMILY.name}` : `Packages and modules · ${FAMILY.name}`,
    description: hierarchy
      ? `The classes and interfaces of the ${FAMILY.name} packages, and what each extends.`
      : `Every package of ${FAMILY.name} and the modules of its API.`,
  };
}

/** The head of a page with its title, its description, its canonical URL and, for a README or a guide, its Markdown copy. */
function rewriteHead(contents: string, page: RenderedPage): string {
  const links = [
    // TypeDoc writes the canonical link of the home page itself.
    page.path === "" ? "" : `<link rel="canonical" href="${SITE}${page.path}"/>`,
    page.markdown === undefined ? "" : `<link rel="alternate" type="text/markdown" href="${SITE}${page.markdown}"/>`,
  ].join("");
  return contents
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
    .replace(TYPEDOC_DESCRIPTION, `<meta name="description" content="${escapeHtml(page.description)}"/>`)
    .replace("</head>", `${links}</head>`);
}

/** A link of a Markdown copy made absolute: a page of the site at its address, any other file of the repository at its own. */
function absoluteLink(source: string, target: string, pages: ReadonlyMap<string, string>): string {
  if (/^([a-z][a-z0-9+.-]*:|#)/i.test(target)) return target;
  const [path = "", anchor] = target.split("#");
  const file = posix.normalize(posix.join(posix.dirname(source), path)).replace(/\/$/, "");
  const page = pages.get(file);
  const address = page === undefined ? repositoryUrl(file) : `${SITE}${page}`;
  return anchor === undefined ? address : `${address}#${anchor}`;
}

/** The Markdown copy of a page: its source with every link absolute, ending with the lines of the marks that it names. */
function markdownCopy(source: string, pages: ReadonlyMap<string, string>): string {
  const text = readFileSync(join(ROOT, source), "utf8");
  const unfenced = new Set(unfencedLines(text).map(([line]) => line));
  const copy = text
    .split("\n")
    .map((line, index) =>
      unfenced.has(index + 1)
        ? line.replace(
            MARKDOWN_LINK,
            (_, label: string, target: string, title: string) =>
              `${label}(${absoluteLink(source, target, pages)}${title})`,
          )
        : line,
    )
    .join("\n")
    .trimEnd();
  const missing = linesFor(copy).filter((line) => !copy.includes(line));
  return missing.length === 0 ? `${copy}\n` : `${copy}\n\n${missing.join("\n")}\n`;
}

/** The sitemap of the pages, at the addresses the site links them by, without the build time as `lastmod`. */
function sitemap(pages: readonly RenderedPage[]): string {
  const urls = pages.map(({ path }) => `  <url><loc>${escapeHtml(`${SITE}${path}`)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/** The page that GitHub Pages serves for an address that holds none, linked absolutely since any path may show it. */
function notFoundPage(): string {
  const lines = familyLines()
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="robots" content="noindex"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Page not found · ${escapeHtml(FAMILY.name)}</title><link rel="stylesheet" href="${SITE}assets/style.css"/></head>
<body><main class="container container-main"><h1>Page not found</h1>
<p>This address holds no page of the ${escapeHtml(FAMILY.name)} docs. <a href="${SITE}">The home page</a> lists every package,
and <a href="${SITE}llms.txt">llms.txt</a> every guide.</p>
${lines}
</main></body>
</html>
`;
}

/** Writes a file of the site, with its folder. */
async function writeSiteFile(directory: string, path: string, text: string): Promise<void> {
  const file = join(directory, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Writes what the site holds beside its pages: the sitemap, the Markdown copies, `llms.txt`, `robots.txt`, `CNAME`, `404.html`. */
async function writeSiteFiles(directory: string, pages: readonly RenderedPage[]): Promise<void> {
  const sources = new Map(pages.flatMap(({ source, path }) => (source === undefined ? [] : [[source, path] as const])));
  await Promise.all([
    writeSiteFile(directory, "sitemap.xml", sitemap(pages)),
    ...pages.flatMap(({ source, markdown }) =>
      source === undefined || markdown === undefined
        ? []
        : [writeSiteFile(directory, markdown, markdownCopy(source, sources))],
    ),
    writeSiteFile(directory, "llms.txt", buildLlmsText(pages)),
    writeSiteFile(directory, "robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`),
    writeSiteFile(directory, "CNAME", `${new URL(SITE).host}\n`),
    writeSiteFile(directory, "404.html", notFoundPage()),
  ]);
}

/** Loads the plugin into TypeDoc, which calls it once its options are read. */
export function load(app: Application): void {
  app.on(Application.EVENT_BOOTSTRAP_END, () => {
    app.options.setValue("hostedBaseUrl", SITE);
    app.options.setValue(
      "customFooterHtml",
      familyLines()
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("\n"),
    );
    app.options.setValue("customFooterHtmlDisableWrapper", true);
  });
  let pages: RenderedPage[] = [];
  app.renderer.on(RendererEvent.BEGIN, () => {
    pages = [];
    app.renderer.postRenderAsyncJobs.push((event) => writeSiteFiles(event.outputDirectory, pages));
  });
  app.renderer.on(PageEvent.END, (page) => {
    const described = describePage(page);
    const rendered =
      described.source === undefined ? described : { ...described, markdown: `${described.path}index.md` };
    pages.push(rendered);
    if (page.contents !== undefined) page.contents = rewriteHead(page.contents, rendered);
  });
}
