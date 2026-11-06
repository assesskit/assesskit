import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { subpathSources } from "../subpaths.ts";
import { examplesIn, runExample } from "../tsdoc-examples.ts";
import { sourceLoader, sourcesBelow } from "../tsdoc-sources.ts";

/** A TSDoc comment with the lines of a fenced `ts` block as its `@example`. */
const comment = (...lines: string[]): string =>
  `/**\n * Adds.\n *\n * @example\n * \`\`\`ts\n${lines.map((line) => ` * ${line}`).join("\n")}\n * \`\`\`\n */\nexport function add() {}\n`;

/** An example that the runner takes from a comment. */
const example = (...lines: string[]) => {
  const [found] = examplesIn({ "a.ts": comment(...lines) });
  if (found === undefined) throw new Error("The comment has no example.");
  return found;
};

describe("the subpaths of the packages", () => {
  it("gives the source file of each export that has types, by the address that an import names", () => {
    const manifest = JSON.stringify({
      name: "@family/a",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./client/local": { types: "./dist/client/local/index.d.ts", default: "./dist/client/local/index.js" },
        "./checks": { types: "./dist/checks.d.ts", default: "./dist/checks.js" },
        "./style.css": "./style.css",
        "./files/*": "./dist/files/*",
      },
    });
    const sources = subpathSources(
      new Map([
        ["packages/a/package.json", manifest],
        ["README.md", "# a"],
      ]),
    );
    expect([...sources]).toStrictEqual([
      ["@family/a", "packages/a/src/index.ts"],
      ["@family/a/client/local", "packages/a/src/client/local/index.ts"],
      ["@family/a/checks", "packages/a/src/checks.ts"],
    ]);
  });

  it("gives none for a package that exports nothing", () => {
    expect(subpathSources(new Map([["packages/a/package.json", '{ "name": "@family/a" }']])).size).toBe(0);
  });
});

describe("the examples in a source file", () => {
  it("takes the fenced block of each @example, with the line of its comment, wherever the tag stands", () => {
    const text = [
      "/** No example. */",
      "export const a = 1;",
      "",
      "/**",
      " * Adds.",
      " *",
      " * @example",
      " * ```ts",
      " * add(1, 2); // => 3",
      " * ```",
      " *",
      " * @param a - The first.",
      " */",
      "export function add() {}",
    ].join("\n");
    expect(examplesIn({ "packages/a/src/add.ts": text })).toStrictEqual([
      { file: "packages/a/src/add.ts", line: 4, block: "```ts\nadd(1, 2); // => 3\n```" },
    ]);
  });

  it("gives an empty block for a tag without a fence, so that its run fails", async () => {
    const [found] = examplesIn({
      "a.ts": "/**\n * Adds.\n *\n * @example\n * add(1, 2);\n */\nexport function add() {}\n",
    });
    expect(found?.block).toBe("");
    expect(await runExample(found as NonNullable<typeof found>, async () => ({}))).toBe(0);
  });
});

describe("running an example", () => {
  it("counts the results that it shows and checks, from the modules that the loader gives", async () => {
    const found = example('import { value } from "@family/a";', "value; // => 3", "[value, value + 1]; // => [3, 4]");
    const modules: Record<string, object> = { "@family/a": { value: 3 } };
    expect(await runExample(found, async (specifier) => modules[specifier] ?? {})).toBe(2);
  });

  it("fails on a result that differs from the one the example shows", async () => {
    const found = example('import { value } from "@family/a";', "value; // => 4");
    await expect(runExample(found, async () => ({ value: 3 }))).rejects.toThrow(/expected 3 to strictly equal 4/);
  });

  it("counts none for an example that shows no result, which a test refuses", async () => {
    expect(await runExample(example("1 + 1;"), async () => ({}))).toBe(0);
  });
});

describe("the sources of a repository in Node", () => {
  const root = mkdtempSync(join(tmpdir(), "tsdoc-sources-"));
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    "packages/a/package.json",
    JSON.stringify({ name: "@family/a", exports: { ".": { types: "./dist/index.d.ts" } } }),
  );
  write("packages/a/src/index.ts", `${comment("1;")}export const value = 3;\n`);
  write("packages/a/src/inner/deep.ts", "export const deep = 1;\n");
  write("packages/a/src/notes.md", "# Not a source");

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reads the sources below a folder by their path from the root, and nothing but TypeScript", () => {
    expect(Object.keys(sourcesBelow(root, "packages/a/src")).sort()).toStrictEqual([
      "packages/a/src/index.ts",
      "packages/a/src/inner/deep.ts",
    ]);
  });

  it("loads a package of the repository from its source and any other module with the function it is given", async () => {
    const asked: string[] = [];
    const load = sourceLoader(root, async (specifier) => {
      asked.push(specifier);
      return { other: true };
    });
    expect(await load("@family/a")).toMatchObject({ value: 3 });
    expect(await load("node:fs")).toStrictEqual({ other: true });
    expect(asked).toStrictEqual(["node:fs"]);
  });
});
