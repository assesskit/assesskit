import { describe, expect, it } from "vitest";
import {
  checkClaimWords,
  checkEvidencePages,
  checkIdentity,
  checkReadmeLinks,
  checkTrademarks,
} from "../check-identity.ts";
import type { Files } from "../check-standards.ts";
import { FAMILY, HOLDERS, MARKS, PACKAGES, REPOSITORY, SITE } from "../family.ts";
import { folderOf, linesFor, markLineOf, notAffiliatedLine, packageUrl } from "../identity.ts";
import { familyFiles } from "./family-repository.ts";

/** The files of a repository that holds the identity of the family, with some files changed or added. */
function repository(changes: Record<string, string> = {}): Files {
  return new Map(Object.entries({ ...familyFiles(), ...changes }));
}

const FIRST = PACKAGES[0] ?? expect.unreachable("family.ts has no package.");
const FOLDER = folderOf(FIRST.name);
const MANIFEST = `packages/${FOLDER}/package.json`;
const README = `packages/${FOLDER}/README.md`;
const MARK = MARKS[0] ?? expect.unreachable("family.ts has no mark.");
/** The mark as a text names it, without its symbol. */
const MARK_NAME = MARK.mark.replace(/[®™]/g, "");

const manifest = (changes: Record<string, unknown>): string =>
  JSON.stringify({ ...JSON.parse(familyFiles()[MANIFEST] ?? "{}"), ...changes });

describe("identity", () => {
  it("accepts manifests and READMEs that say what family.ts says", () => {
    expect(checkIdentity(repository())).toStrictEqual([]);
  });

  it("names the field of a manifest that differs from the package's row", () => {
    const changed = repository({
      [MANIFEST]: manifest({
        description: "Another sentence.",
        keywords: FIRST.keywords.slice(1),
        homepage: `${REPOSITORY}#readme`,
        author: "Someone",
      }),
    });
    expect(checkIdentity(changed).map(({ message }) => message.split(" to ")[0])).toStrictEqual([
      "Set description",
      "Set keywords",
      "Set homepage",
      "Set author",
    ]);
  });

  it("refuses a README whose first sentence is not the description", () => {
    const readme = familyFiles()[README] ?? "";
    for (const changed of [
      readme.replace(FIRST.description, `The ${FIRST.description}`),
      `# ${FIRST.name}\n\nIntro.\n`,
    ])
      expect(checkIdentity(repository({ [README]: changed })).map(({ file }) => file)).toStrictEqual([README]);
  });

  it("accepts a README whose first paragraph goes on after the description, over several lines", () => {
    const readme = (familyFiles()[README] ?? "").replace(
      FIRST.description,
      `${FIRST.description.replace(" ", "\n")} It knows nothing of any product.`,
    );
    expect(checkIdentity(repository({ [README]: readme }))).toStrictEqual([]);
  });

  it("refuses a package without a row and a row without a package", () => {
    const files = familyFiles();
    delete files[MANIFEST];
    files["packages/extra/package.json"] = JSON.stringify({ name: "@scope/extra" });
    expect(checkIdentity(new Map(Object.entries(files))).map(({ file }) => file)).toStrictEqual([
      "packages/extra/package.json",
      "scripts/family.ts",
    ]);
  });

  it("holds the root README to the family's sentence and to each package's description", () => {
    const readme = (familyFiles()["README.md"] ?? "")
      .replace(FAMILY.sentence, "Packages for learning.")
      .replace(FIRST.description, "A package.");
    expect(
      checkIdentity(repository({ "README.md": readme })).map(({ message }) => message.split(":")[0]),
    ).toStrictEqual([
      "Open the README, after its title, with the family's sentence",
      `Give ${FIRST.name} its description in the table of packages`,
    ]);
  });
  it("holds the citation and the Context7 file to the family's sentence, its site and its facts", () => {
    const changed = repository({
      "CITATION.cff": "cff-version: 1.2.0\nabstract: Another sentence.\n",
      "context7.json": JSON.stringify({ description: FAMILY.sentence, rules: [] }),
    });
    expect(checkIdentity(changed).map(({ file }) => file)).toStrictEqual(["CITATION.cff", "context7.json"]);
  });
});

describe("trademarks", () => {
  it("accepts READMEs and NOTICE files that carry the lines of what they name", () => {
    expect(checkTrademarks(repository())).toStrictEqual([]);
  });

  it("asks a README that names a mark for the mark's line and the line of its holder", () => {
    const text = `# Example\n\nIt implements ${MARK_NAME}.\n`;
    const holder = HOLDERS[MARK.holder] ?? expect.unreachable("The mark has no holder.");
    expect(checkTrademarks(repository({ "examples/a/README.md": text })).map(({ message }) => message)).toStrictEqual(
      [
        markLineOf(MARK),
        ...(holder.trademark === undefined ? [] : [holder.trademark]),
        notAffiliatedLine([MARK.holder]),
      ].map((line) => `Add the line, on a line of its own: ${line}`),
    );
  });

  it("refuses a line that the text does not need, and a line that is wrapped, whose symbols stand outside a line", () => {
    const needless = `# Example\n\nNothing of others.\n\n${markLineOf(MARK)}\n`;
    const text = `# Example\n\nIt implements ${MARK_NAME}.\n`;
    const [first = "", ...rest] = linesFor(text);
    const parts = first.replace(" is a ", " is a\n").split("\n");
    const wrapped = `${text}\n${parts.join("\n")}\n${rest.join("\n")}\n`;
    // The parts of the wrapped line start on line 5; each that holds a symbol stands outside a line.
    const symbols = parts.flatMap((part, index) => (/[®™]/.test(part) ? [["examples/b/NOTICE", 5 + index]] : []));
    expect(
      checkTrademarks(repository({ "examples/a/README.md": needless, "examples/b/NOTICE": wrapped })).map(
        ({ file, line }) => [file, line],
      ),
    ).toStrictEqual([["examples/a/README.md", 5], ["examples/b/NOTICE", 0], ...symbols]);
    expect(symbols.length).toBeGreaterThan(0);
  });

  it("refuses a symbol of a mark outside its line, in any Markdown text", () => {
    const guide = `# Guide\n\nThe ${MARK.mark} launch.\n`;
    expect(checkTrademarks(repository({ "docs/a/guide.md": guide }))).toMatchObject([
      { file: "docs/a/guide.md", line: 3, rule: "trademark" },
    ]);
  });
});

describe("claim words", () => {
  it("refuses a claim in a README, a NOTICE, a guide and a description", () => {
    const files = repository({
      "README.md": "# A\n\nThe package is certified.\n",
      "packages/a/NOTICE": "It is compliant.\n",
      "docs/a/evidence.md": "# Evidence\n\nThe official schemas.\n",
      "packages/a/package.json": JSON.stringify({ description: "An approved library." }),
    });
    expect(checkClaimWords(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["README.md", 3],
      ["packages/a/NOTICE", 1],
      ["docs/a/evidence.md", 3],
      ["packages/a/package.json", 0],
    ]);
  });

  it("allows the words in code, in a quotation, in the lines of marks and in files that state no claim", () => {
    const files = repository({
      "docs/a/signing.md":
        '# Signing\n\nThe result is `certified`; the specification asks for "a fully conformant LRS".\n',
      "docs/a/model.md": "# Model\n\n```ts\nconst approved = true;\n```\n",
      "AGENTS.md": "The owner approved it.\n",
    });
    expect(checkClaimWords(files)).toStrictEqual([]);
  });
});

describe("README links", () => {
  it("refuses a relative link and a repository link to a page that the docs site publishes", () => {
    const readme = [
      `# ${FIRST.name}`,
      "",
      "[guide](../../docs/a/guide.md), [license](LICENSE),",
      `[guide](${REPOSITORY}/blob/main/docs/${FOLDER}/model.md), [readme](${REPOSITORY}/tree/main/packages/${FOLDER}#readme),`,
      `[old base](https://old.example${new URL(packageUrl(FIRST.name)).pathname}).`,
      "",
    ].join("\n");
    expect(
      checkReadmeLinks(repository({ [README]: readme })).map(({ line, message }) => [line, message.split(" ")[0]]),
    ).toStrictEqual([
      [3, "Link"],
      [3, "Link"],
      [4, "Link"],
      [4, "Link"],
      [5, "Link"],
    ]);
  });

  it("accepts links to the docs site, to other files of the repository, to anchors and to other sites", () => {
    const readme = [
      `# ${FIRST.name}`,
      "",
      `[page](${packageUrl(FIRST.name)}guide/), [license](${REPOSITORY}/blob/main/LICENSE), [section](#api),`,
      "[standard](https://example.org/spec), and in a sample: `[x](y.md)`",
      "",
      "```md",
      "[x](y.md)",
      "```",
      "",
    ].join("\n");
    expect(checkReadmeLinks(repository({ [README]: readme, "examples/a/README.md": "[x](y.md)\n" }))).toStrictEqual([]);
    expect(SITE.endsWith("/")).toBe(true);
  });
});

describe("evidence pages", () => {
  it("asks every package for its Supported, Evidence and Choosing pages", () => {
    expect(checkEvidencePages(repository())).toStrictEqual([]);
    const files = familyFiles();
    delete files[`docs/${FOLDER}/choosing.md`];
    expect(checkEvidencePages(new Map(Object.entries(files))).map(({ file }) => file)).toStrictEqual([
      `docs/${FOLDER}/choosing.md`,
    ]);
  });
});
