/**
 * The identity of the family: its site, its sentence, the identity of each package and the marks of others that its texts
 * name. `check:standards`, the TypeDoc plugin of `docs/typedoc-seo.ts`, `scripts/llms.ts` and `scripts/check-site.ts` read
 * this file and nothing else of the family, so another family copies them unchanged and writes its own copy of this file.
 */

/**
 * The base of every URL of the docs site, with its trailing slash: the `hostedBaseUrl` of TypeDoc, the `homepage` of each
 * package, the links of the READMEs, the sitemap, `robots.txt` and the `CNAME` of the site; the owner's domain (2026-11-04).
 * Changing it is this one line, and `check:standards` then lists each homepage, README link and citation that names the old one.
 */
export const SITE = "https://assesskit.wakan.dev/";

/** The repository, which a link to a file that the docs site does not publish points into, on its default branch. */
export const REPOSITORY = "https://github.com/assesskit/assesskit";

/** The name of the family, its sentence and the `author` of every package. */
export const FAMILY = {
  name: "assesskit",
  sentence:
    "QTI 3.0 runtime and player for JavaScript and TypeScript: read, validate, score and deliver assessment items and tests, with adaptive testing.",
  author: "Fariz Wakan (https://github.com/luthfanwakan)",
} as const;

/** The identity of one package: what npm, the README, the docs site and `llms.txt` say of it. */
export interface PackageIdentity {
  /** The name on npm, which is also the folder below `packages/` and `docs/` after the scope. */
  readonly name: string;
  /** The standard and its version that the package implements, which the title of each of its pages carries. */
  readonly label?: string;
  /** The identity sentence: the `description` of `package.json` and the first sentence of the README. */
  readonly description: string;
  /** The `keywords` of `package.json`, as people type them. */
  readonly keywords: readonly string[];
}

/**
 * Every package of the family, in the order of the README's table. Each implements QTI 3.0, which the title of each of its
 * pages carries.
 */
export const PACKAGES: readonly PackageIdentity[] = [
  {
    name: "@assesskit/runtime",
    label: "QTI 3.0",
    description:
      "QTI 3.0 runtime for JavaScript and TypeScript: reads, writes, validates and scores assessment items, tests, content packages and results, converts items to and from GIFT and Moodle XML, and runs test sessions, adaptive ones included, without a user interface on a server or a device.",
    keywords: [
      "qti",
      "qti3",
      "qti-3",
      "question-and-test-interoperability",
      "assessment",
      "assessment-items",
      "assessment-tests",
      "response-processing",
      "scoring",
      "content-package",
      "results-reporting",
      "validator",
      "computerized-adaptive-testing",
      "e-assessment",
      "gift",
      "typescript",
    ],
  },
  {
    name: "@assesskit/player",
    label: "QTI 3.0",
    description:
      "QTI 3.0 player for JavaScript and TypeScript, built on @assesskit/runtime: renders the 20 standard interactions in the browser, hosts portable custom interactions, and serves test sessions and adaptive tests from a server.",
    keywords: [
      "qti",
      "qti3",
      "qti-player",
      "assessment-player",
      "portable-custom-interactions",
      "pci",
      "accessibility",
      "wcag",
      "computerized-adaptive-testing",
      "online-assessment",
      "e-assessment",
      "test-delivery",
      "typescript",
    ],
  },
  {
    name: "@assesskit/custom-interactions",
    label: "QTI 3.0",
    description:
      "QTI 3.0 portable custom interactions for JavaScript and TypeScript: math entry for formulas in LaTeX and stroke writing for characters, each an AMD module that loads entirely from the item's package.",
    keywords: [
      "qti",
      "qti3",
      "portable-custom-interaction",
      "pci",
      "custom-interaction",
      "math-input",
      "math-entry",
      "stroke-order",
      "stroke-writing",
      "e-assessment",
      "typescript",
    ],
  },
];

/** A body whose standards the family implements: how a text names it, and the lines that it asks for. */
export interface Holder {
  /** The name in the line that the family is not affiliated with it. */
  readonly name: string;
  /** Words that name the body or a standard of it that holds no mark of its own, so that a text that has one carries the line. */
  readonly named: RegExp;
  /** The line that names the body's own mark, where it asks for one. */
  readonly trademark?: string;
  /** The line of each of its marks, with `{mark}` where the mark goes. */
  readonly markLine?: string;
}

/**
 * The bodies, in the order of their lines. 1EdTech holds the marks of QTI and of the standards that the texts name beside it,
 * and asks for a line for each mark and for the body; W3C publishes the Recommendations that the texts name (WCAG, MathML);
 * IEEE publishes the learning object metadata that `@assesskit/runtime/metadata` reads. Products of others that the texts
 * name, such as Moodle, MathLive and Hanzi Writer, are named plainly, with no line.
 */
export const HOLDERS: Readonly<Record<string, Holder>> = {
  "1edtech": {
    name: "1EdTech Consortium, Inc.",
    named: /\b1EdTech\b/,
    markLine: "{mark} is a trademark of 1EdTech® Consortium, Inc. (1edtech.org).",
  },
  w3c: {
    name: "W3C",
    named: /\bW3C\b|\bWCAG\b|\bMathML\b|\bWeb Content Accessibility Guidelines\b/,
    trademark: "W3C® is a trademark of the World Wide Web Consortium.",
  },
  ieee: {
    name: "IEEE",
    named: /\bIEEE\b/,
    trademark: "IEEE is a trademark of the Institute of Electrical and Electronics Engineers, Inc.",
  },
};

/** A mark of another, as its holder lists it, and how a text names it. */
export interface Mark {
  /** The mark with its symbol, as the holder writes it. */
  readonly mark: string;
  /** The key of its holder in `HOLDERS`. */
  readonly holder: string;
  /** Words that name it. */
  readonly named: RegExp;
}

/** The marks that the texts of the family name, in the order of their lines; 1EdTech asks for one line for each. */
export const MARKS: readonly Mark[] = [
  { mark: "QTI®", holder: "1edtech", named: /\bQTI\b/ },
  {
    mark: "Question & Test Interoperability®",
    holder: "1edtech",
    named: /\bQuestion (?:and|&) Test Interoperability\b/,
  },
  { mark: "AccessForAll®", holder: "1edtech", named: /\bAccessForAll\b|\bAfA\b/ },
  { mark: "LTI®", holder: "1edtech", named: /\bLTI\b/ },
  { mark: "Learning Tools Interoperability®", holder: "1edtech", named: /\bLearning Tools Interoperability\b/ },
  { mark: "Caliper Analytics®", holder: "1edtech", named: /\bCaliper\b/ },
];
