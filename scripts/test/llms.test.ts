import { describe, expect, it } from "vitest";
import { FAMILY, PACKAGES, SITE } from "../family.ts";
import { linesFor, packagePath } from "../identity.ts";
import { buildLlmsText, type SitePage } from "../llms.ts";

const NAME = PACKAGES[0]?.name ?? expect.unreachable("family.ts has no package.");
const BASE = packagePath(NAME);

const PAGES: SitePage[] = [
  { path: "", kind: "home", heading: FAMILY.name, description: FAMILY.sentence, markdown: "index.md" },
  {
    path: BASE,
    kind: "package",
    packageName: NAME,
    heading: NAME,
    description: "Its README.",
    markdown: `${BASE}index.md`,
  },
  {
    path: `${BASE}tool/`,
    kind: "guide",
    packageName: NAME,
    heading: "Tool",
    description: "The tool.",
    markdown: `${BASE}tool/index.md`,
  },
  {
    path: `${BASE}api/`,
    kind: "guide",
    packageName: NAME,
    heading: "API guide",
    description: "Calls.",
    markdown: `${BASE}api/index.md`,
  },
  {
    path: `${BASE}performance/`,
    kind: "guide",
    packageName: NAME,
    heading: "Performance",
    description: "Speed.",
    markdown: `${BASE}performance/index.md`,
  },
  { path: `${BASE}${BASE}`, kind: "module", packageName: NAME, heading: NAME, description: "The root module." },
  { path: `${BASE}${BASE}run/`, kind: "api", packageName: NAME, heading: "run", description: "Runs." },
];

describe("llms.txt", () => {
  const text = buildLlmsText(PAGES);
  const lines = text.split("\n");

  it("opens with the family's name and its sentence in a blockquote", () => {
    expect(lines.slice(0, 3)).toStrictEqual([
      `# ${FAMILY.name}`,
      "",
      `> ${FAMILY.sentence} Each package installs by its name, such as \`npm install ${NAME}\`, and the Markdown of each page below is at its address.`,
    ]);
  });

  it("lists a package's README with its install line, then its guides in the order of their paths, as Markdown", () => {
    const section = lines.slice(lines.indexOf(`## ${NAME}`) + 2, lines.indexOf(`## ${NAME}`) + 5);
    expect(section).toStrictEqual([
      `- [${NAME}](${SITE}${BASE}index.md): Its README. Install it with \`npm install ${NAME}\`.`,
      `- [API guide](${SITE}${BASE}api/index.md): Calls.`,
      `- [Tool](${SITE}${BASE}tool/index.md): The tool.`,
    ]);
  });

  it("puts the modules of the API and the performance pages under Optional, and no other page of the API", () => {
    const optional = lines.slice(lines.indexOf("## Optional") + 2).filter((line) => line.startsWith("- "));
    expect(optional).toStrictEqual([
      `- [API of ${NAME}](${SITE}${BASE}${BASE}): The root module.`,
      `- [Performance](${SITE}${BASE}performance/index.md): Speed.`,
    ]);
    expect(text).not.toContain("Runs.");
  });

  it("ends with the lines of the marks that it names", () => {
    const needed = linesFor(text);
    expect(lines.slice(-needed.length - 1, -1)).toStrictEqual(needed);
  });
});
