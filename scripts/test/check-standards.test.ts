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
  checkNotIncluded,
  checkReadmeSections,
  checkSectionSigns,
  checkStandards,
  checkTestTitles,
  type Files,
} from "../check-standards.ts";

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
  it("reports the sections that the README of the repository and of a package lack", () => {
    const files = repository({
      "README.md": "# A\n\n## Which package\n\n## License\n",
      "packages/a/README.md": "# A\n\n## Quick start\n\n## API\n\n## Supported\n\n## Documentation\n",
      "packages/a/docs/README.md": "# Not a package README\n",
    });
    expect(checkReadmeSections(files).map(({ file, message }) => [file, message.split(";")[0]])).toStrictEqual([
      ["README.md", 'The README has no "## Documentation" section'],
      ["README.md", 'The README has no "## Development" section'],
      ["README.md", 'The README has no "## Layout" section'],
      ["packages/a/README.md", 'The README has no "## License" section'],
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
    "packages/a/src/one/write.ts": 'import { read } from "./read.js";\n',
    "packages/a/src/one/nested/index.ts": "",
    "packages/a/src/one/nested/deep.ts": 'import { read } from "../read.js";\n',
    "packages/a/src/two/index.ts": "",
    "packages/a/src/two/use.ts": [
      'import { checks } from "../checks.js";',
      'import { one } from "../one/index.js";',
      'import { shared } from "../one/internal.js";',
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
      ["packages/a/src/two/use.ts", 4],
      ["packages/a/src/two/use.ts", 5],
      ["packages/a/test/one.test.ts", 2],
    ]);
  });

  it("accepts the entries of a module, its own files and the files of the package root", () => {
    const accepted = [...files].filter(([file]) => file === "packages/a/src/one/write.ts");
    expect(checkEntries(new Map(accepted))).toStrictEqual([]);
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

describe("all checks", () => {
  it("reports nothing for a repository that holds the standards", () => {
    const files = repository({
      "README.md": `# A\n\n${DIAGRAM}\n${["Which package", "Documentation", "Development", "Layout", "License"].map((title) => `## ${title}\n`).join("\n")}`,
      "packages/a/src/index.ts": "export const A = 1;\n",
      "packages/a/test/a.test.ts": 'it("returns one", () => {});\n',
    });
    expect(checkStandards(files)).toStrictEqual([]);
  });

  it("names the rule and the line of each violation", () => {
    const files = repository({ "packages/a/src/x.ts": "const a = 1;\n// §1\n" });
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
