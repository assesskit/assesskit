import { FACTS, FAMILY, PACKAGES, SITE } from "./family.ts";
import { linesFor } from "./identity.ts";

/**
 * The text of `llms.txt` in the form of its proposal: the family's name, its sentence, one section for each package with its
 * README and its guides as Markdown, and the API reference and the performance pages under "Optional". The TypeDoc plugin of
 * `docs/typedoc-seo.ts` calls it with the pages it rendered; every family copies this file unchanged.
 */

/** A page of the docs site, as the plugin rendered it. */
export interface SitePage {
  /** Its path below the site's base: `""` for the home page, a path that ends in `/` for any other. */
  readonly path: string;
  /** What it shows: the root README, a package's README, a guide, a module of the API, or another page of the API. */
  readonly kind: "home" | "package" | "guide" | "module" | "api";
  /** The name of its package, for every page but the home page. */
  readonly packageName?: string;
  /** Its heading: the title of a guide, or the name of a package or a module. */
  readonly heading: string;
  /** Its description, which its `<meta name="description">` holds. */
  readonly description: string;
  /** The path of its Markdown copy below the site's base, for a README or a guide. */
  readonly markdown?: string;
}

/** The guides that a reader of the package may skip: what each costs, rather than what it does. */
const OPTIONAL_GUIDES = new Set(["performance"]);

const entry = (title: string, path: string, description: string): string =>
  `- [${title}](${SITE}${path}): ${description}`;

/** The last segment of a page's path: the name of the file a guide comes from. */
const pageName = (page: SitePage): string => page.path.split("/").at(-2) ?? "";

/** The section of one package: its README, then its guides in the order of their paths. */
function packageSection(name: string, pages: readonly SitePage[]): string[] {
  const own = pages.filter((page) => page.packageName === name);
  const readme = own.find((page) => page.kind === "package");
  const guides = own
    .filter((page) => page.kind === "guide" && !OPTIONAL_GUIDES.has(pageName(page)))
    .sort((a, b) => a.path.localeCompare(b.path));
  const lines = [`## ${name}`, ""];
  if (readme?.markdown !== undefined)
    lines.push(entry(name, readme.markdown, `${readme.description} Install it with \`npm install ${name}\`.`));
  for (const guide of guides)
    if (guide.markdown !== undefined) lines.push(entry(guide.heading, guide.markdown, guide.description));
  return [...lines, ""];
}

/** The pages that a reader may skip: the modules of the API of each package and its performance page. */
function optionalSection(pages: readonly SitePage[]): string[] {
  const order = (page: SitePage): number => PACKAGES.findIndex(({ name }) => name === page.packageName);
  const optional = pages
    .filter((page) => page.kind === "module" || (page.kind === "guide" && OPTIONAL_GUIDES.has(pageName(page))))
    .sort((a, b) => order(a) - order(b) || a.path.localeCompare(b.path));
  return [
    "## Optional",
    "",
    ...optional.map((page) =>
      page.kind === "module"
        ? entry(`API of ${page.heading}`, page.path, page.description)
        : entry(page.heading, page.markdown ?? page.path, page.description),
    ),
    "",
  ];
}

/** Writes `llms.txt` from the pages of the site, ending with the lines of the marks that it names. */
export function buildLlmsText(pages: readonly SitePage[]): string {
  const example = PACKAGES[0]?.name ?? FAMILY.name;
  const body = [
    `# ${FAMILY.name}`,
    "",
    `> ${FAMILY.sentence} Each package installs by its name, such as \`npm install ${example}\`, and the Markdown of each page below is at its address.`,
    "",
    ...FACTS.map((fact) => `- ${fact}`),
    "",
    ...PACKAGES.flatMap(({ name }) => packageSection(name, pages)),
    ...optionalSection(pages),
  ].join("\n");
  return `${body}${linesFor(body).join("\n")}\n`;
}
