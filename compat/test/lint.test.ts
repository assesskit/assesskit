import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { lintBaseline } from "../lint.ts";

const directories: string[] = [];

/** Makes a package directory with the given files. */
function packageWith(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "tempuh-compat-"));
  directories.push(directory);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
  return directory;
}

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

describe("lintBaseline", () => {
  it("reports an API that a baseline browser lacks in the built JavaScript", async () => {
    const { problems, scripts } = await lintBaseline(
      packageWith({ "dist/segment.js": 'export const segmenter = new Intl.Segmenter("en");\n' }),
    );
    expect(scripts).toBe(1);
    expect(problems).toEqual([
      { file: "dist/segment.js", line: 1, message: "Intl.Segmenter() is not supported in Firefox 115" },
    ]);
  });

  it("reports a CSS feature that a baseline browser lacks", async () => {
    const { problems } = await lintBaseline(
      packageWith({ "dist/index.js": "export {};\n", "player.css": "a:has(b) { color: red; }\n" }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ file: "player.css", line: 1 });
    expect(problems[0]?.message).toContain('"css-has" is not supported by Firefox 115-120');
  });

  it("passes code that stays inside the baseline", async () => {
    const { problems, scripts } = await lintBaseline(
      packageWith({
        "dist/index.js": "export const a = [1, 2].toSorted();\nexport const b = new ResizeObserver(() => {});\n",
        "player.css": "dialog { color: color-mix(in srgb, red, blue); }\n:focus-visible { outline: 1px solid; }\n",
      }),
    );
    expect(scripts).toBe(1);
    expect(problems).toEqual([]);
  });

  it("leaves the server folders to the servers", async () => {
    const { problems, scripts } = await lintBaseline(
      packageWith({
        "dist/index.js": "export {};\n",
        "dist/server/index.js": 'export const segmenter = new Intl.Segmenter("en");\n',
        "dist/cat/index.js": 'export const segmenter = new Intl.Segmenter("en");\n',
      }),
    );
    expect(scripts).toBe(1);
    expect(problems).toEqual([]);
  });

  it("counts no script when there is no built JavaScript, so that a package that is not built does not pass", async () => {
    expect((await lintBaseline(packageWith({ "player.css": "a { color: red; }\n" }))).scripts).toBe(0);
  });
});
