import { describe, expect, it } from "vitest";
import {
  checkConsole,
  checkDiagrams,
  checkEntries,
  checkErrorNames,
  checkFamilies,
  checkFileNames,
  checkGuideSections,
  checkHistory,
  checkModuleExamples,
  checkNotIncluded,
  checkReadmeSections,
  checkReadonlyResults,
  checkSectionSigns,
  checkSecurityLimits,
  checkStandards,
  checkTestTitles,
  type Files,
} from "../check-standards.ts";
import { familyFiles } from "./family-repository.ts";

/** The files of a repository as the checks read them. */
function repository(files: Record<string, string>): Files {
  return new Map(Object.entries(files));
}

const DIAGRAM = "```mermaid\nflowchart LR\n  A --> B\n```\n";

describe("section signs", () => {
  it("reports a section sign in code and in docs", () => {
    const files = repository({
      "packages/a/src/x.ts": "// Rule §4.1 applies.\n",
      "docs/a/guide.md": "See §2.\n",
      "packages/a/src/y.ts": "// Section 4.1 applies.\n",
    });
    expect(checkSectionSigns(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["packages/a/src/x.ts", 1],
      ["docs/a/guide.md", 1],
    ]);
  });
});

describe("test titles", () => {
  it("reports a row code, a unit code and a clause number in a title", () => {
    const files = repository({
      "packages/a/test/x.test.ts": [
        'it("reads the score [T48]", () => {});',
        'describe("E19: the reader", () => {});',
        'it("reads the score of clause 3.4.3.1", () => {});',
        'it("answers with the media type (D9)", () => {});',
      ].join("\n"),
    });
    expect(checkTestTitles(files).map(({ line }) => line)).toStrictEqual([1, 2, 3, 4]);
  });

  it("accepts a plain sentence, a version number and code outside a title", () => {
    const files = repository({
      "packages/a/test/x.test.ts": [
        'it("reads QTI 3.0.1 documents", () => {});',
        'it("shares the places at a tied boundary equally", () => {});',
        "const code = [T48];",
      ].join("\n"),
    });
    expect(checkTestTitles(files)).toStrictEqual([]);
  });
});

describe("history", () => {
  it("reports history in prose and in comments, and ignores code and fences", () => {
    const files = repository({
      "docs/a/guide.md": [
        "The reader now accepts a URL.",
        '`previously` in code is skipped, and so is the shipped text "previously".',
        "```ts",
        "// previously",
        "```",
        "The option was renamed.",
      ].join("\n"),
      "packages/a/src/x.ts": "/** Returns the text; it formerly returned bytes. */\nconst previously = 1;\n",
      "packages/a/test/x.test.ts": "// We found that the order matters.\n",
    });
    expect(checkHistory(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["docs/a/guide.md", 1],
      ["docs/a/guide.md", 6],
      ["packages/a/src/x.ts", 1],
      ["packages/a/test/x.test.ts", 1],
    ]);
  });

  it("accepts a state that changes while the code runs", () => {
    const files = repository({ "docs/a/guide.md": "The tool is no longer open once the item is closed.\n" });
    expect(checkHistory(files)).toStrictEqual([]);
  });
});

describe("file names", () => {
  it("reports utils, helpers and misc files, whatever their folder or extension", () => {
    const files = repository({
      "packages/a/src/utils.ts": "",
      "packages/a/src/x/helpers.ts": "",
      "packages/a/test/misc.ts": "",
      "packages/a/src/utilities.ts": "",
    });
    expect(checkFileNames(files).map(({ file }) => file)).toStrictEqual([
      "packages/a/src/utils.ts",
      "packages/a/src/x/helpers.ts",
      "packages/a/test/misc.ts",
    ]);
  });
});

describe("diagrams", () => {
  it("reports a README, a contributing guide and a guide without a Mermaid diagram", () => {
    const files = repository({
      "README.md": "# A\n",
      "CONTRIBUTING.md": "# A\n",
      "packages/a/README.md": "# A\n",
      "docs/a/guide.md": "# Guide\n",
      "docs/a/diagram.md": `# Guide\n\n${DIAGRAM}`,
      "AGENTS.md": "# Agents\n",
    });
    expect(checkDiagrams(files).map(({ file }) => file)).toStrictEqual([
      "README.md",
      "CONTRIBUTING.md",
      "packages/a/README.md",
      "docs/a/guide.md",
    ]);
  });
});

describe("guide sections", () => {
  const Skeleton =
    "## Quick start\n\n## Errors\n\n## Not included\n\n| Not included | Why |\n| --- | --- |\n\n## Differences from the references\n";

  it("reports each section of the skeleton that a guide lacks, with what it holds", () => {
    const files = repository({
      "docs/a/guide.md": `# Guide\n\n${DIAGRAM}\n## Quick start\n\n## Errors\n`,
      "docs/a/complete.md": `# Guide\n\n${DIAGRAM}\n${Skeleton}`,
    });
    const found = checkGuideSections(files);
    expect(found.map(({ file }) => file)).toStrictEqual(["docs/a/guide.md", "docs/a/guide.md"]);
    expect(found.map(({ message }) => message.split(":")[0])).toStrictEqual([
      'The guide has no "## Not included" section',
      'The guide has no "## Differences from the references" section',
    ]);
  });

  it("does not take a heading in a fence or one of another level for a section", () => {
    const files = repository({
      "docs/a/guide.md": "# Guide\n\n```md\n## Quick start\n## Errors\n```\n\n### Not included\n",
    });
    expect(checkGuideSections(files)).toHaveLength(4);
  });

  it("leaves out the documents that are not the guide of a module, and files outside docs", () => {
    const files = repository({
      "docs/a/evidence.md": "# Evidence\n",
      "docs/a/architecture.md": "# Architecture\n",
      "docs/a/supported.md": "# Supported\n",
      "docs/a/spec-gaps.md": "# Gaps\n",
      "docs/a/performance.md": "# Performance\n",
      "docs/a/sub/guide.md": "# Guide\n",
      "README.md": "# A\n",
    });
    expect(checkGuideSections(files)).toStrictEqual([]);
  });
});

describe("not included", () => {
  it("reports a table that is headed in another way, with the line of its header", () => {
    const files = repository({
      "docs/a/one.md": "# One\n\n## Not included\n\nText first.\n\n| What | Why |\n| --- | --- |\n",
      "docs/a/two.md": "# Two\n\n## Not included\n\n| Not included | Reason |\n| --- | --- |\n",
      "docs/a/three.md": "# Three\n\n## Not included\n\n- A bullet\n\n## Files\n\n| Not included | Why |\n",
      "docs/a/four.md": "# Four\n\n## Not included\n\n| Not included | Why | Owner |\n",
    });
    expect(checkNotIncluded(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["docs/a/one.md", 7],
      ["docs/a/two.md", 5],
      ["docs/a/three.md", 4],
      ["docs/a/four.md", 5],
    ]);
  });

  it("accepts the table of the form, and a document that has no such section", () => {
    const files = repository({
      "docs/a/guide.md": "# Guide\n\n## Not included\n\n| Not included | Why |\n| --- | --- |\n| A | B |\n\n## Files\n",
      "docs/a/other.md": "# Other\n",
      "README.md": "# A\n\n## Not included\n\n- A bullet\n",
    });
    expect(checkNotIncluded(files)).toStrictEqual([]);
  });
});

describe("README sections", () => {
  const root = "# A\n## Which package\n## Documentation\n## Development\n## Layout\n## License\n";
  const pkg = "# A\n## Quick start\n## Architecture\n## API\n## Supported\n## Documentation\n## License\n";

  it("accepts the sections of the root and of a package in their order, with others between them", () => {
    const files = repository({
      "README.md": root,
      "packages/a/README.md": pkg.replace("## API", "## CLI\n## API"),
      "examples/a/README.md": "# Example\n",
    });
    expect(checkReadmeSections(files)).toStrictEqual([]);
  });

  it("names the section that is missing or out of order", () => {
    const files = repository({
      "README.md": root.replace("## Layout\n", ""),
      "packages/a/README.md":
        "# A\n## Quick start\n## API\n## Architecture\n## Supported\n## Documentation\n## License\n",
    });
    expect(
      checkReadmeSections(files).map(({ file, message }) => [file, message.match(/; "([^"]+)" is/)?.[1]]),
    ).toStrictEqual([
      ["README.md", "Layout"],
      ["packages/a/README.md", "API"],
    ]);
  });
});

describe("error names", () => {
  it("reports an error class that carries the name of a package", () => {
    const files = repository({
      "packages/player/src/x.ts": "export class PlayerError extends Error {}\nexport class LtiError extends Error {}\n",
      "packages/knowledge-tracing/src/y.ts": "class KnowledgeTracingError extends Error {}\n",
      "packages/runtime/src/errors.ts": "export class AssesskitError extends Error {}\n",
    });
    expect(checkErrorNames(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["packages/player/src/x.ts", 1],
      ["packages/knowledge-tracing/src/y.ts", 1],
    ]);
  });
});

describe("families", () => {
  it("reports an import of another family outside the examples", () => {
    const files = repository({
      "packages/player/src/x.ts": 'import { fit } from "@measurekit/psychometrics";\n',
      "packages/player/test/x.test.ts": 'const m = await import("@measurekit/core");\n',
      "examples/player/cat/src/index.ts": 'import { fit } from "@measurekit/psychometrics";\n',
      "packages/player/src/y.ts": 'import { DataError } from "@assesskit/runtime/errors";\n',
    });
    expect(checkFamilies(files).map(({ file }) => file)).toStrictEqual([
      "packages/player/src/x.ts",
      "packages/player/test/x.test.ts",
    ]);
  });

  it("reports an import of interopkit outside the examples, in the runtime and the player alike", () => {
    const files = repository({
      "packages/runtime/src/x.ts": 'import { handleLogin } from "@interopkit/tool-integration/tool";\n',
      "packages/player/src/x.ts": 'export * from "@interopkit/learning-analytics";\n',
      "packages/player/test/x.test.ts": 'const k = await import("@interopkit/core");\n',
      "examples/player/lms-integration/src/index.ts": 'import { buildEvent } from "@interopkit/learning-analytics";\n',
    });
    expect(checkFamilies(files).map(({ file }) => file)).toStrictEqual([
      "packages/runtime/src/x.ts",
      "packages/player/src/x.ts",
      "packages/player/test/x.test.ts",
    ]);
  });
});

describe("module entries", () => {
  const files = repository({
    "packages/a/src/checks.ts": "",
    "packages/a/src/one/index.ts": "",
    "packages/a/src/one/internal.ts": "",
    "packages/a/src/one/read.ts": "",
    "packages/a/src/one/wire.ts": "",
    "packages/a/src/one/write.ts": 'import { read } from "./read.js";\n',
    "packages/a/src/one/nested/index.ts": "",
    "packages/a/src/one/nested/deep.ts": 'import { read } from "../read.js";\n',
    "packages/a/src/two/index.ts": "",
    "packages/a/src/two/use.ts": [
      'import { checks } from "../checks.js";',
      'import { one } from "../one/index.js";',
      'import { shared } from "../one/internal.js";',
      'import { wire } from "../one/wire.js";',
      'import { read } from "../one/read.js";',
      'import { nested } from "../one/nested/deep.js";',
    ].join("\n"),
    "packages/a/test/one.test.ts": [
      'import { one } from "../src/one/index.js";',
      'import { read } from "../src/one/read.js";',
      'import { checks } from "../src/checks.js";',
    ].join("\n"),
  });

  it("reports an import that reaches a file of another module", () => {
    expect(checkEntries(files).map(({ file, line }) => [file, line])).toStrictEqual([
      ["packages/a/src/one/nested/deep.ts", 1],
      ["packages/a/src/two/use.ts", 5],
      ["packages/a/src/two/use.ts", 6],
      ["packages/a/test/one.test.ts", 2],
    ]);
  });

  it("accepts the entries of a module, its wire forms, its own files and the files of the package root", () => {
    const accepted = [...files].filter(([file]) => file === "packages/a/src/one/write.ts");
    expect(checkEntries(new Map(accepted))).toStrictEqual([]);
  });
});

describe("module examples", () => {
  const documented =
    "/**\n * Adds.\n *\n * @example\n * ```ts\n * add(1, 2); // => 3\n * ```\n */\nexport function add(): number { return 3; }\n";
  const plain = "/** Subtracts. */\nexport function subtract(): number { return 1; }\n";
  /** A manifest whose subpaths are given with the file that their types come from, as `tsc` writes it in `dist/`. */
  const manifest = (subpaths: Record<string, string>): string =>
    JSON.stringify({
      name: "@family/a",
      exports: Object.fromEntries(
        Object.entries(subpaths).map(([subpath, types]) => [
          subpath,
          { types, default: types.replace(".d.ts", ".js") },
        ]),
      ),
    });

  it("accepts an entry that exports a function with an example, by name or through export *, at any depth", () => {
    const files = repository({
      "packages/a/package.json": manifest({
        ".": "./dist/index.d.ts",
        "./m": "./dist/m/index.d.ts",
        "./n": "./dist/n/index.d.ts",
      }),
      "packages/a/src/index.ts": 'export * from "./m/index.js";\n',
      "packages/a/src/m/index.ts": 'export { add } from "./add.js";\nexport type { Sum } from "./add.js";\n',
      "packages/a/src/m/add.ts": documented,
      "packages/a/src/n/index.ts": 'export { add as plus } from "../m/add.js";\n',
    });
    expect(checkModuleExamples(files)).toStrictEqual([]);
  });

  it("reports an entry whose exported functions have no example, even when another function of the file has one", () => {
    const files = repository({
      "packages/a/package.json": manifest({ "./m": "./dist/m/index.d.ts", "./n": "./dist/n/index.d.ts" }),
      "packages/a/src/m/index.ts": 'export { subtract } from "./ops.js";\n',
      "packages/a/src/m/ops.ts": `${plain}${documented}`,
      "packages/a/src/n/index.ts": 'export { subtract } from "./plain.js";\n',
      "packages/a/src/n/plain.ts": plain,
    });
    expect(checkModuleExamples(files)).toStrictEqual([
      {
        file: "packages/a/src/m/index.ts",
        line: 0,
        rule: "module-example",
        message:
          "The entry exports no function whose TSDoc has an @example; put one on the main function of the module.",
      },
      {
        file: "packages/a/src/n/index.ts",
        line: 0,
        rule: "module-example",
        message:
          "The entry exports no function whose TSDoc has an @example; put one on the main function of the module.",
      },
    ]);
  });

  it("takes the entries from the exports of the manifests, files that are not an index among them", () => {
    const files = repository({
      "packages/a/package.json": manifest({ "./checks": "./dist/checks.d.ts", "./wire": "./dist/delivery/wire.d.ts" }),
      "packages/a/src/checks.ts": plain,
      "packages/a/src/delivery/wire.ts": documented,
      "packages/a/src/other/index.ts": plain,
    });
    expect(checkModuleExamples(files).map(({ file }) => file)).toStrictEqual(["packages/a/src/checks.ts"]);
  });

  it("takes the tag at the start of a line of the comment, and not an address that holds the word", () => {
    const files = repository({
      "packages/a/package.json": manifest({ "./m": "./dist/m/index.d.ts", "./n": "./dist/n/index.d.ts" }),
      "packages/a/src/m/index.ts": "/**\n * Mails learner@example.org.\n */\nexport function mail(): void {}\n",
      "packages/a/src/n/index.ts":
        "/**\n * Adds.\n *\n * @example\n * ```ts\n * add(); // => 1\n * ```\n */\nexport function add(): void {}\n",
    });
    expect(checkModuleExamples(files).map(({ file }) => file)).toStrictEqual(["packages/a/src/m/index.ts"]);
  });

  it("follows a re-export of an entry of another package, and stops at a cycle of re-exports", () => {
    const files = repository({
      "packages/a/package.json": manifest({ ".": "./dist/index.d.ts" }),
      "packages/b/package.json": JSON.stringify({
        name: "@family/b",
        exports: {
          ".": { types: "./dist/index.d.ts" },
          "./loop": { types: "./dist/loop/index.d.ts" },
          "./other": { types: "./dist/other.d.ts" },
        },
      }),
      "packages/a/src/index.ts": 'export { add } from "@family/b";\nexport { subtract } from "@family/b/other";\n',
      "packages/b/src/index.ts": 'export * from "./add.js";\n',
      "packages/b/src/add.ts": documented,
      "packages/b/src/other.ts": plain,
      "packages/b/src/loop/index.ts": 'export * from "./again.js";\n',
      "packages/b/src/loop/again.ts": 'export * from "./index.js";\nexport function loop(): void {}\n',
    });
    expect(checkModuleExamples(files).map(({ file }) => file)).toStrictEqual([
      "packages/b/src/loop/index.ts",
      "packages/b/src/other.ts",
    ]);
  });

  it("leaves out an entry that exports no function, a type, a class, a constant and an export without types", () => {
    const files = repository({
      "packages/a/package.json": JSON.stringify({
        name: "@family/a",
        exports: {
          "./errors": { types: "./dist/errors.d.ts", default: "./dist/errors.js" },
          "./style.css": "./style.css",
        },
      }),
      "packages/a/src/errors.ts": [
        "export class AError extends Error {}",
        "export const LIMIT = 1;",
        "export type Sum = number;",
        'export type { Other } from "./other.js";',
        'export { type Third } from "./other.js";',
      ].join("\n"),
      "packages/a/src/other.ts": plain,
      "packages/b/package.json": '{ "name": "@family/b" }',
    });
    expect(checkModuleExamples(files)).toStrictEqual([]);
  });
});

describe("console", () => {
  it("reports a console call in library code, except in the command line", () => {
    const files = repository({
      "packages/a/src/x.ts": 'console.log("x");\n',
      "packages/a/src/cli/run.ts": 'console.error("x");\n',
      "packages/a/test/x.test.ts": 'console.log("x");\n',
      "scripts/x.ts": 'console.log("x");\n',
    });
    expect(checkConsole(files).map(({ file }) => file)).toStrictEqual(["packages/a/src/x.ts"]);
  });
});

describe("the limits in SECURITY.md", () => {
  const code = {
    "packages/a/src/read.ts": 'throw new SecurityError("Too many.", "maxThings", 10);\n',
    "packages/a/src/limits.ts":
      "export const READ_LIMITS = { maxDepth: 64, maxItems: 100 } as const;\nexport const KEY_LIMITS = Object.freeze({ maxKeys: 8 });\n",
    "packages/a/src/options.ts": "export interface StoreLimits {\n  readonly maxBodyBytes?: number;\n}\n",
    "packages/a/src/index.ts": 'export type { StoreLimits } from "./options.js";\n',
  };

  it("reports each limit of a SecurityError, an exported limits object or an exported limits interface that it does not name", () => {
    const found = checkSecurityLimits(repository({ ...code, "SECURITY.md": "| `maxDepth` | 64 | levels |\n" }));
    expect(found.map(({ file, line, rule }) => `${file}:${line} ${rule}`)).toStrictEqual([
      "packages/a/src/read.ts:1 security-limit",
      "packages/a/src/limits.ts:1 security-limit",
      "packages/a/src/limits.ts:2 security-limit",
      "packages/a/src/options.ts:2 security-limit",
    ]);
    expect(found.map(({ message }) => /limit (\w+)/.exec(message)?.[1])).toStrictEqual([
      "maxThings",
      "maxItems",
      "maxKeys",
      "maxBodyBytes",
    ]);
  });

  it("reports every limit when SECURITY.md is empty or gone, as a merge may leave it", () => {
    expect(checkSecurityLimits(repository({ ...code, "SECURITY.md": "" }))).toHaveLength(5);
    expect(checkSecurityLimits(repository(code))).toHaveLength(5);
  });

  it("accepts a file that names every limit, and leaves out an interface that no entry exports, a limit passed on and the time limits of a test", () => {
    const files = repository({
      ...code,
      "packages/a/src/inner.ts":
        "export interface InnerLimits {\n  readonly maxHidden: number;\n}\nthrow new SecurityError(message, error.limit, error.maximum);\n",
      "packages/a/src/time.ts": "export interface EffectiveTimeLimits {\n  readonly maxTime: number;\n}\n",
      "packages/a/src/delivery/index.ts": 'export type { EffectiveTimeLimits } from "../time.js";\n',
      "SECURITY.md": "`maxThings`, `maxDepth`, `maxItems`, `maxKeys` and `maxBodyBytes`\n",
    });
    expect(checkSecurityLimits(files)).toStrictEqual([]);
  });
});

describe("all checks", () => {
  it("reports nothing for a repository that holds the standards", () => {
    const files = repository({
      ...familyFiles(),
      "packages/a/src/index.ts": "export const A = 1;\n",
      "packages/a/test/a.test.ts": 'it("returns one", () => {});\n',
    });
    expect(checkStandards(files)).toStrictEqual([]);
  });

  it("holds SECURITY.md to the limits of the packages", () => {
    const files = repository({
      ...familyFiles(),
      "packages/a/src/index.ts":
        'export function read() {\n  throw new SecurityError("Too many.", "maxThings", 10);\n}\n',
    });
    expect(checkStandards(files).map(({ rule }) => rule)).toStrictEqual(["security-limit"]);
    expect(checkStandards(new Map([...files, ["SECURITY.md", "| `maxThings` | 10 |\n"]]))).toStrictEqual([]);
  });

  it("names the rule and the line of each violation", () => {
    const files = repository({ ...familyFiles(), "packages/a/src/x.ts": "const a = 1;\n// §1\n" });
    expect(checkStandards(files)).toStrictEqual([
      {
        file: "packages/a/src/x.ts",
        line: 2,
        rule: "section-sign",
        message: "Name the rule in words, or link the specification; no section signs.",
      },
    ]);
  });
});

describe("readonly results", () => {
  const index =
    'export { rows, matrix, byId, maybe, table, sorted, pair } from "./x.js";\nexport type { Row } from "./x.js";\n';

  it("reports a public function that returns a mutable list, matrix or record, alone or in a union", () => {
    const files = repository({
      "packages/a/src/m/index.ts": index,
      "packages/a/src/m/x.ts": [
        "export function rows(): Row[] { return []; }",
        "export function matrix(): readonly number[][] { return []; }",
        "export function byId(): Record<string, number> { return {}; }",
        "export function maybe(): Array<number> | null { return null; }",
        "export function table(): Readonly<Record<string, string[]>> { return {}; }",
      ].join("\n"),
    });
    expect(
      checkReadonlyResults(files).map(({ file, line, message }) => [file, line, message.split(";")[0]]),
    ).toStrictEqual([
      ["packages/a/src/m/x.ts", 1, "rows returns Row[]"],
      ["packages/a/src/m/x.ts", 2, "matrix returns number[]"],
      ["packages/a/src/m/x.ts", 3, "byId returns Record<string, number>"],
      ["packages/a/src/m/x.ts", 4, "maybe returns Array<number>"],
      ["packages/a/src/m/x.ts", 5, "table returns string[]"],
    ]);
  });

  it("accepts readonly lists, matrices and records, tuples, promises of them, and a function the module keeps to itself", () => {
    const files = repository({
      "packages/a/src/m/index.ts": index,
      "packages/a/src/m/x.ts": [
        "export function rows(): readonly Row[] { return []; }",
        "export function matrix(): readonly (readonly number[])[] { return []; }",
        "export function byId(): Readonly<Record<string, number>> { return {}; }",
        "export function maybe(): ReadonlyArray<number> | null { return null; }",
        "export function table(): Readonly<Record<string, readonly string[]>> { return {}; }",
        "export function sorted(): Promise<readonly number[]> { return Promise.resolve([]); }",
        "export function hidden(): Row[] { return []; }",
        "export function pair(): [number, number] { return [0, 0]; }",
      ].join("\n"),
    });
    expect(checkReadonlyResults(files).map(({ message }) => message.split(" ")[0])).toStrictEqual([]);
  });
});
