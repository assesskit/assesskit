import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** The text of the fenced block after a heading of the README. */
function blockAfter(heading: string, fence: string): string {
  const section = README.slice(README.indexOf(`\n${heading}\n`));
  const match = new RegExp(`\`\`\`${fence}\\n([\\s\\S]*?)\`\`\``).exec(section);
  if (match?.[1] === undefined) throw new Error(`The README has no ${fence} block after "${heading}".`);
  return match[1];
}

describe("README", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the Quick start is the code of readme-example.ts and prints the output shown", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      lines.push(values.map(String).join(" "));
    });
    await import("./readme-example.js");

    const source = readFileSync(new URL("./readme-example.ts", import.meta.url), "utf8").replace(
      /from "\.\.\/src\/([a-z]+)\/index\.js"/g,
      'from "@assesskit/runtime/$1"',
    );
    expect(blockAfter("## Quick start", "ts")).toBe(source);
    expect(blockAfter("## Quick start", "text")).toBe(`${lines.join("\n")}\n`);
  });
});
