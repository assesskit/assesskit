import { basename } from "node:path";
import type { Files, Violation } from "./check-standards.ts";
import { FACTS, FAMILY, PACKAGES, REPOSITORY, SITE } from "./family.ts";
import {
  findPackage,
  firstParagraph,
  folderOf,
  linesFor,
  packagePath,
  packageUrl,
  unfencedLines,
  withoutLines,
} from "./identity.ts";

/**
 * The rules of the identity of the family (STANDARDS.md sections 2 "Names" and 8 "Identity"): each package says what
 * `family.ts` says of it, the texts carry the lines of the marks they name, no claim word is used, and the published READMEs
 * link absolutely. `check:standards` runs them; every family copies this file unchanged.
 */

/** The words that claim a status that only the holder of a standard grants. */
const CLAIM_WORDS = /\b(compliant|conformant|certified|official|approved|endorsed)\b/i;
/** The symbols that only the line of a mark carries. */
const MARK_SYMBOLS = /[®™]/;
/** The manifest of a package, by its folder. */
const MANIFEST = /^packages\/([^/]+)\/package\.json$/;
/**
 * The READMEs that are published: the root, which is the home page of the docs site and of the repository, each package's, and
 * the profile of the organization, which the owner copies into its `.github` repository.
 */
const PUBLISHED_README = /^(README\.md|packages\/[^/]+\/README\.md|\.github\/profile\/README\.md)$/;
/** The texts that state what the family is and does to a reader: every README, NOTICE and page of the docs. */
const STATED = /(^|\/)(README\.md|NOTICE)$|^docs\/[^/]+\/[^/]+\.md$/;
/** The links of a line of Markdown, with what each points to. */
const LINK = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
/** A link into the repository that names a guide or the README of a package, which the docs site publishes. */
const PUBLISHED_IN_REPOSITORY = new RegExp(
  `^${REPOSITORY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?:blob|tree)/[^/]+/(?:docs/[^/]+/[^/]+\\.md|packages/[^/#]+(?:/README\\.md)?(?:#readme)?)(?:#.*)?$`,
);

const violation = (file: string, line: number, rule: string, message: string): Violation => ({
  file,
  line,
  rule,
  message,
});

/** Reads a manifest, or `undefined` when its text is not JSON. */
function manifestOf(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const sameList = (a: unknown, b: readonly string[]): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);

/** The violations of one package's manifest and README against its row of `family.ts`. */
function packageViolations(folder: string, manifestFile: string, files: Files): Violation[] {
  const identity = findPackage(folder);
  if (identity === undefined)
    return [
      violation(manifestFile, 0, "identity", `Add a row for packages/${folder} to PACKAGES in scripts/family.ts.`),
    ];
  const manifest = manifestOf(files.get(manifestFile) ?? "") ?? {};
  const found: Violation[] = [];
  const expect = (field: string, holds: boolean, wanted: string): void => {
    if (!holds)
      found.push(violation(manifestFile, 0, "identity", `Set ${field} to ${wanted}, as scripts/family.ts says.`));
  };
  expect("name", manifest.name === identity.name, JSON.stringify(identity.name));
  expect("description", manifest.description === identity.description, JSON.stringify(identity.description));
  expect("keywords", sameList(manifest.keywords, identity.keywords), JSON.stringify(identity.keywords));
  expect("homepage", manifest.homepage === packageUrl(identity.name), JSON.stringify(packageUrl(identity.name)));
  expect("author", manifest.author === FAMILY.author, JSON.stringify(FAMILY.author));
  const readmeFile = `packages/${folder}/README.md`;
  const paragraph = firstParagraph(files.get(readmeFile) ?? "") ?? "";
  if (paragraph !== identity.description && !paragraph.startsWith(`${identity.description} `))
    found.push(
      violation(
        readmeFile,
        0,
        "identity",
        `Open the README, after its title, with the description of the package as its first sentence: ${identity.description}`,
      ),
    );
  return found;
}

/**
 * Each package's `description`, `keywords`, `homepage` and `author` are those of its row of `family.ts`, its README opens with
 * the description as its first sentence, every row names a package that exists, the root README opens with the family's
 * sentence and gives each package its description, and `CITATION.cff` and `context7.json` say what `family.ts` says.
 */
export function checkIdentity(files: Files): Violation[] {
  const folders = [...files.keys()].flatMap((file) => MANIFEST.exec(file)?.[1] ?? []);
  const found = folders.flatMap((folder) => packageViolations(folder, `packages/${folder}/package.json`, files));
  for (const { name } of PACKAGES) {
    if (!folders.includes(folderOf(name)))
      found.push(violation("scripts/family.ts", 0, "identity", `${name} has a row but no packages/${folderOf(name)}.`));
  }
  return [...found, ...rootViolations(files.get("README.md") ?? ""), ...repositoryFileViolations(files)];
}

/** `CITATION.cff` and `context7.json` give the family's sentence, its site and its facts of use, as `family.ts` does. */
function repositoryFileViolations(files: Files): Violation[] {
  const found: Violation[] = [];
  const citation = (files.get("CITATION.cff") ?? "").replace(/\s+/g, " ");
  if (!citation.includes(FAMILY.sentence) || !citation.includes(`url: ${SITE}`))
    found.push(
      violation("CITATION.cff", 0, "identity", `Give the family's sentence as the abstract and ${SITE} as the url.`),
    );
  const context7 = manifestOf(files.get("context7.json") ?? "") ?? {};
  if (context7.description !== FAMILY.sentence || !sameList(context7.rules, FACTS))
    found.push(
      violation(
        "context7.json",
        0,
        "identity",
        "Give the family's sentence as the description and FACTS as the rules.",
      ),
    );
  return found;
}

/** The root README opens with the family's sentence and gives each package's description, the same as everywhere. */
function rootViolations(readme: string): Violation[] {
  const found: Violation[] = [];
  const paragraph = firstParagraph(readme) ?? "";
  if (paragraph !== FAMILY.sentence && !paragraph.startsWith(`${FAMILY.sentence} `))
    found.push(
      violation(
        "README.md",
        0,
        "identity",
        `Open the README, after its title, with the family's sentence: ${FAMILY.sentence}`,
      ),
    );
  const text = readme.replace(/\s+/g, " ");
  for (const { name, description } of PACKAGES)
    if (!text.includes(description))
      found.push(
        violation("README.md", 0, "identity", `Give ${name} its description in the table of packages: ${description}`),
      );
  return found;
}

/** The violations of the lines of one README or NOTICE: a line that it needs and lacks, or holds and does not need. */
function lineViolations(file: string, text: string): Violation[] {
  const lines = text.split("\n").map((line) => line.trim());
  const expected = linesFor(text);
  const missing = expected
    .filter((line) => !lines.includes(line))
    .map((line) => violation(file, 0, "trademark", `Add the line, on a line of its own: ${line}`));
  const needless = lines.flatMap((line, index) =>
    line !== "" && withoutLines(line).trim() === "" && !expected.includes(line)
      ? [violation(file, index + 1, "trademark", "Remove the line: the text names no mark or body that needs it.")]
      : [],
  );
  return [...missing, ...needless];
}

/** The violations of the symbols of marks in a text: each line where a ® or a ™ stands outside the line of its mark. */
function symbolViolations(file: string, text: string): Violation[] {
  return withoutLines(text)
    .split("\n")
    .flatMap((line, index) =>
      MARK_SYMBOLS.test(line)
        ? [
            violation(
              file,
              index + 1,
              "trademark",
              "Write the plain name: a ® or a ™ belongs only inside the line of the mark.",
            ),
          ]
        : [],
    );
}

/**
 * Every README and NOTICE carries, each on one line, the line of each mark of another that it names, the line of each body
 * whose standard it names, and the line that the family is not affiliated with those bodies, and no other; a ® or a ™ appears
 * in no text but inside those lines.
 */
export function checkTrademarks(files: Files): Violation[] {
  return [...files].flatMap(([file, text]) => {
    const name = basename(file);
    const lines = name === "README.md" || name === "NOTICE" ? lineViolations(file, text) : [];
    return file.endsWith(".md") || name === "NOTICE" ? [...lines, ...symbolViolations(file, text)] : [];
  });
}

/** The prose of a text that states what the family is: outside code, inline code, quotations and the lines of marks. */
function statedProse(file: string, text: string): [number, string][] {
  if (basename(file) === "package.json") {
    const description = manifestOf(text)?.description;
    return typeof description === "string" ? [[0, description]] : [];
  }
  const prose = file.endsWith(".md")
    ? unfencedLines(text)
    : text.split("\n").map((line, index): [number, string] => [index + 1, line]);
  return prose.map(([line, content]) => [line, withoutLines(content).replace(/`[^`]*`|"[^"]*"/g, "")]);
}

/**
 * No README, NOTICE, page of the docs or description claims a status that only the holder of a standard grants: a test result
 * is a dated count, and a quotation of a specification stays in quotation marks.
 */
export function checkClaimWords(files: Files): Violation[] {
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (!STATED.test(file) && !MANIFEST.test(file)) continue;
    for (const [line, prose] of statedProse(file, text)) {
      const word = CLAIM_WORDS.exec(prose)?.[0];
      if (word !== undefined)
        found.push(
          violation(
            file,
            line,
            "claim-word",
            `"${word}" claims a status that only the holder of a standard grants; state what was tested, with its count and date.`,
          ),
        );
    }
  }
  return found;
}

/** What is wrong with a link of a published README, or `undefined` when it is right. */
function linkProblem(target: string, scopePath: string): string | undefined {
  if (!/^(https?:|mailto:|#)/.test(target))
    return `Link ${target} absolutely: npm shows the README away from the repository.`;
  if (PUBLISHED_IN_REPOSITORY.test(target)) return `Link ${target} at its page on ${SITE}.`;
  const elsewhere = /^https?:/.test(target) && !target.startsWith(SITE);
  if (elsewhere && new URL(target).pathname.startsWith(scopePath))
    return `Link ${target} under ${SITE}, the base of the docs site.`;
  return undefined;
}

/**
 * The published READMEs link absolutely, since npm shows a package's README away from the repository, and link a guide or a
 * package's README at its page on the docs site, under the site's one base.
 */
export function checkReadmeLinks(files: Files): Violation[] {
  const scopePath = `/${packagePath(PACKAGES[0]?.name ?? "@/").split("/")[0]}/`;
  const found: Violation[] = [];
  for (const [file, text] of files) {
    if (!PUBLISHED_README.test(file)) continue;
    for (const [line, content] of unfencedLines(text))
      for (const [, target = ""] of content.replace(/`[^`]*`/g, "").matchAll(LINK)) {
        const message = linkProblem(target, scopePath);
        if (message !== undefined) found.push(violation(file, line, "readme-link", message));
      }
  }
  return found;
}

/** The pages that every package has beside the guides of its modules (STANDARDS.md section 8, "Evidence pages"). */
const EVIDENCE_PAGES = ["supported", "evidence", "choosing"];

/**
 * Every package has a Supported, an Evidence and a Choosing page in `docs/<package>/`: what it includes and leaves out, what
 * shows it right with dated counts, and when another library fits better.
 */
export function checkEvidencePages(files: Files): Violation[] {
  return PACKAGES.flatMap(({ name }) =>
    EVIDENCE_PAGES.filter((page) => !files.has(`docs/${folderOf(name)}/${page}.md`)).map((page) =>
      violation(`docs/${folderOf(name)}/${page}.md`, 0, "evidence-page", `Write the ${page} page of ${name}.`),
    ),
  );
}
