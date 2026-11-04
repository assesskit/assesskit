import { describe, expect, it } from "vitest";
import {
  checkLlms,
  checkMarkdownCopies,
  checkPages,
  checkSite,
  checkSiteFiles,
  checkSiteLinks,
  fileOf,
  type Site,
} from "../check-site.ts";
import { FAMILY, PACKAGES, SITE } from "../family.ts";
import { packagePath } from "../identity.ts";

const PACKAGE = PACKAGES[0]?.name ?? expect.unreachable("family.ts has no package.");
const GUIDE = `${packagePath(PACKAGE)}model/`;

/** The HTML of a page as the plugin writes it. */
function page(path: string, title: string, options: { description?: string; markdown?: boolean } = {}): string {
  const description = options.description ?? `What ${title} is.`;
  const alternate = options.markdown
    ? `<link rel="alternate" type="text/markdown" href="${SITE}${path}index.md"/>`
    : "";
  return `<!DOCTYPE html><html><head><title>${title}</title><meta name="description" content="${description}"/><link rel="canonical" href="${SITE}${path}"/>${alternate}</head><body></body></html>`;
}

const sitemap = (paths: readonly string[]): string =>
  `<?xml version="1.0"?>\n<urlset>\n${paths.map((path) => `<url><loc>${SITE}${path}</loc></url>`).join("\n")}\n</urlset>\n`;

/** A site that holds: a home page, a package page, a guide, their copies, the sitemap, llms.txt and the files beside them. */
function site(changes: Record<string, string | undefined> = {}): Site {
  const files: Record<string, string | undefined> = {
    "index.html": page("", FAMILY.name, { markdown: true }),
    "index.md": `# ${FAMILY.name}\n\n[package](${SITE}${packagePath(PACKAGE)})\n`,
    [`${packagePath(PACKAGE)}index.html`]: page(packagePath(PACKAGE), PACKAGE, { markdown: true }),
    [`${packagePath(PACKAGE)}index.md`]: `# ${PACKAGE}\n\n[model](${SITE}${GUIDE}#rules)\n`,
    [`${GUIDE}index.html`]: page(GUIDE, `Model · ${PACKAGE}`, { markdown: true }),
    [`${GUIDE}index.md`]: "# Model\n",
    "modules.html": page("modules.html", `Packages · ${FAMILY.name}`),
    "404.html": "<title>Page not found</title>",
    "sitemap.xml": sitemap(["", packagePath(PACKAGE), GUIDE, "modules.html"]),
    "llms.txt": `# ${FAMILY.name}\n\n> ${FAMILY.sentence}\n\n## ${PACKAGE}\n\n- [${PACKAGE}](${SITE}${packagePath(PACKAGE)}index.md): its README\n`,
    "robots.txt": `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`,
    CNAME: `${new URL(SITE).host}\n`,
    ...changes,
  };
  return new Map(Object.entries(files).flatMap(([path, text]) => (text === undefined ? [] : [[path, text]])));
}

const SOURCES = ["README.md", `packages/${PACKAGE.split("/")[1]}/README.md`, `docs/${PACKAGE.split("/")[1]}/model.md`];

describe("the built site", () => {
  it("holds when every part is there", () => {
    expect(checkSite(site(), SOURCES, new Map([["README.md", `[home](${SITE})`]]))).toStrictEqual([]);
  });

  it("names the file of a page by the address that links it", () => {
    expect([
      fileOf(SITE),
      fileOf(`${SITE}${GUIDE}#rules`),
      fileOf(`${SITE}llms.txt`),
      fileOf("https://example.org/"),
    ]).toStrictEqual(["index.html", `${GUIDE}index.html`, "llms.txt", undefined]);
  });
});

describe("pages", () => {
  it("refuses a title that another page has, TypeDoc's description, and a canonical URL elsewhere", () => {
    const changed = site({
      "modules.html": page("modules.html", FAMILY.name, { description: `Documentation for ${FAMILY.name}` }),
      [`${GUIDE}index.html`]: page(GUIDE, `Model · ${PACKAGE}`).replace(
        `href="${SITE}${GUIDE}"`,
        `href="${SITE}other/"`,
      ),
    });
    expect(checkPages(changed).map(({ file, rule }) => [file, rule])).toStrictEqual([
      [`${GUIDE}index.html`, "site-canonical"],
      ["modules.html", "site-title"],
      ["modules.html", "site-description"],
    ]);
  });

  it("holds the sitemap to the pages, both ways, without lastmod", () => {
    const changed = site({
      "sitemap.xml": sitemap(["", packagePath(PACKAGE), GUIDE, "gone/"]).replace(
        "</urlset>",
        "<lastmod>x</lastmod></urlset>",
      ),
    });
    expect(checkPages(changed).map(({ message }) => message.split(" ")[0])).toStrictEqual([
      "List",
      `${SITE}gone/`,
      "Leave",
    ]);
  });
});

describe("Markdown copies", () => {
  it("asks each README and guide for its copy, and its page for the link to it", () => {
    const changed = site({
      [`${GUIDE}index.md`]: undefined,
      [`${packagePath(PACKAGE)}index.html`]: page(packagePath(PACKAGE), PACKAGE),
    });
    expect(checkMarkdownCopies(changed, SOURCES).map(({ file }) => file)).toStrictEqual([
      `${packagePath(PACKAGE)}index.html`,
      SOURCES[2],
    ]);
  });

  it("names a source whose page is not where the router puts it, and leaves out files the site does not publish", () => {
    expect(
      checkMarkdownCopies(site(), [...SOURCES, `docs/${PACKAGE.split("/")[1]}/gone.md`, "AGENTS.md"]).map(
        ({ file }) => file,
      ),
    ).toStrictEqual([`docs/${PACKAGE.split("/")[1]}/gone.md`]);
  });
});

describe("llms.txt", () => {
  it("asks for the H1, the blockquote, H2 sections and links", () => {
    expect(
      checkLlms(site({ "llms.txt": "Packages\n\n### Deep\n" })).map(({ message }) => message.split(" ")[0]),
    ).toStrictEqual(["Open", "Follow", "List", "List"]);
    expect(checkLlms(site({ "llms.txt": undefined })).map(({ message }) => message)).toStrictEqual(["Write llms.txt."]);
  });
});

describe("links to the site", () => {
  it("refuses a link from a README, a copy or llms.txt that reaches no file", () => {
    const changed = site({ "index.md": `# ${FAMILY.name}\n\n[gone](${SITE}gone/)\n\n\`[code](${SITE}code/)\`\n` });
    const readmes = new Map([["README.md", `[old](${SITE}${packagePath(PACKAGE)}old/)\n`]]);
    expect(checkSiteLinks(changed, readmes).map(({ file, line }) => [file, line])).toStrictEqual([
      ["README.md", 1],
      ["index.md", 3],
    ]);
  });
});

describe("files beside the pages", () => {
  it("asks robots.txt to let crawlers in and name the sitemap, CNAME for the host, and a 404 page", () => {
    const changed = site({
      "robots.txt": "User-agent: *\nDisallow: /\n",
      CNAME: "example.org\n",
      "404.html": undefined,
    });
    expect(checkSiteFiles(changed).map(({ file }) => file)).toStrictEqual([
      "robots.txt",
      "robots.txt",
      "CNAME",
      "404.html",
    ]);
  });
});
