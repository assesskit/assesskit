import { describe, expect, it } from "vitest";
import { PACKAGES, SITE } from "../family.ts";
import {
  describeParagraph,
  firstParagraph,
  folderOf,
  packageUrl,
  plainText,
  repositoryUrl,
  sourcePagePath,
  titleOf,
} from "../identity.ts";

const NAME = PACKAGES[0]?.name ?? expect.unreachable("family.ts has no package.");
const FOLDER = folderOf(NAME);

describe("addresses", () => {
  it("puts a package's page and its guides below the scope's folder, as the structure-dir router does", () => {
    expect(packageUrl("@scope/name")).toBe(`${SITE}_scope/name/`);
    expect([
      sourcePagePath("README.md"),
      sourcePagePath(`packages/${FOLDER}/README.md`),
      sourcePagePath(`docs/${FOLDER}/model.md`),
      sourcePagePath("docs/unknown/model.md"),
      sourcePagePath("AGENTS.md"),
    ]).toStrictEqual(["", `_${NAME.slice(1)}/`, `_${NAME.slice(1)}/model/`, undefined, undefined]);
    expect(repositoryUrl("LICENSE")).toMatch(/\/blob\/main\/LICENSE$/);
  });
});

describe("Markdown text", () => {
  const guide =
    "# The `x` model\n\n```mermaid\nflowchart LR\n```\n\n| a | b |\n\nThe [model](model.md) of `x`.\nIt reads **plain** data.\n\nMore.\n";

  it("reads the title and the first paragraph of prose after it", () => {
    expect(titleOf(guide)).toBe("The x model");
    expect(firstParagraph(guide)).toBe("The [model](model.md) of `x`. It reads **plain** data.");
    expect(titleOf("No title.\n")).toBeUndefined();
    expect(firstParagraph("# Title\n\n## Section\n")).toBeUndefined();
  });

  it("writes Markdown and TSDoc links as their text", () => {
    expect(plainText("See {@link readEvent} and {@link https://x.org | the spec}, ![img](a.png)<br/>**now**.")).toBe(
      "See readEvent and the spec, now.",
    );
  });
});

describe("descriptions", () => {
  it("keeps the whole sentences that fit near 155 characters", () => {
    const first = "A first sentence that says what the page holds.";
    const second = "A second sentence that adds a detail to it, and goes on for a while longer than the first.";
    const third = "A third sentence that would make the description too long to show.";
    expect(describeParagraph(`${first} ${second} ${third}`)).toBe(`${first} ${second}`);
  });

  it("cuts a first sentence that alone is too long at a word, with an ellipsis", () => {
    const long = `${"word ".repeat(60).trim()}.`;
    const description = describeParagraph(long);
    expect(description.endsWith("word…")).toBe(true);
    expect(description.length).toBeLessThanOrEqual(156);
  });
});
