import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ConformanceFeature,
  type ConformanceLevel,
  checkOutsideRepository,
  discoverInputs,
  parseFeatures,
} from "../conformance.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const PAGE_PATH = "docs/runtime/conformance.md";
const page = readFileSync(join(ROOT, PAGE_PATH), "utf8");
const features: readonly ConformanceFeature[] = JSON.parse(
  readFileSync(join(ROOT, "scripts/conformance-features.json"), "utf8"),
);

/** A row of the tables of the page. */
interface Row {
  readonly id: string;
  readonly feature: string;
  readonly required: string;
  readonly status: string;
  readonly guides: readonly string[];
  readonly tests: readonly string[];
}

const cellsOf = (line: string): string[] =>
  line
    .slice(1, -1)
    .split(" | ")
    .map((cell) => cell.trim());

const rows: readonly Row[] = page
  .split("\n")
  .filter((line) => /^\| [A-Z]-\d+[a-z]? +\|/.test(line))
  .map((line) => {
    const [id = "", feature = "", required = "", status = "", guides = "", tests = ""] = cellsOf(line);
    return { id, feature, required, status, guides: guides.split("<br>"), tests: tests.split("<br>") };
  });

/** Returns what the column `Required at` says of a feature. */
function requiredAt({ required }: ConformanceFeature): string {
  const levels: ConformanceLevel[] = required.includes("Basic") ? ["Basic"] : required.filter((l) => l === "Advanced");
  const named = [...levels, ...required.filter((level) => level === "Elevated")];
  return named.length === 0 ? "Elective" : named.join(", ");
}

/** Returns the anchors of the headings of a guide, as GitHub and TypeDoc write them. */
function anchorsOf(text: string): Set<string> {
  const headings = text.replace(/^```[\s\S]*?^```$/gm, "").matchAll(/^#{1,6} (.+)$/gm);
  return new Set(
    Array.from(headings, ([, title = ""]) =>
      title
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .replaceAll(" ", "-"),
    ),
  );
}

/** Returns whether a test file holds a test or a block of a title that runs: not skipped, not a todo. */
function runs(source: string, title: string): boolean {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(describe|it|test)(\\.(for|each))?(\\([^)]*\\))?\\(\\s*["'\`]${escaped}["'\`]`).test(source);
}

describe("parseFeatures", () => {
  const document = `
    <h3 id="a"><bdi class="secno">3.1.1</bdi> INTERACTIONS</h3>
    <table><tr><th>Feature ID</th><th>Feature Name</th><th>Basic</th><th>Advanced</th></tr>
      <tr><td>Q-2</td><td>Choice</td><td>R</td><td>R</td></tr>
      <tr><td>Q-6</td><td>Gap Match</td><td></td><td>R (full)</td></tr></table>
    <h3>3.3 Elevated Accessibility Conformance Requirements</h3>
    <table><tr><td>Feature ID</td><td>Feature Name</td></tr><tr><td>A-6</td><td>additional-testing-time - Delivery</td></tr></table>
    <h3>3.4 PNP Conformance Requirements</h3>
    <table><tr><td>A-40a</td><td>Spoken</td></tr></table>
    <h3>B.1 Version History</h3>
    <table><tr><td>V-1</td><td>Not a feature</td></tr></table>
    <h3><bdi class="secno">A.4</bdi> QTI 3.0 Interactions</h3>
    <table><tr><th>ID</th><th>Feature Name</th><th>Feature Description</th></tr>
      <tr><td>Q-2</td><td> Choice
        Interaction </td><td>Choose.</td></tr>
      <tr><td>Q-6</td><td>Gap <em>Match</em> &amp; more</td><td>Fill.</td></tr>
      <tr><td>Q-7</td><td>Elective</td><td></td></tr></table>
    <h3>A.5 QTI 3.0 Accessibility</h3>
    <table><tr><td></td><td>Feature Name</td><td></td></tr><tr><td>A-6</td><td>additional-testing-time</td><td></td></tr>
      <tr><td>A-40a</td><td>Spoken (reading-type = screen-reader)</td><td></td></tr></table>`;

  it("takes the names of Appendix A and the levels of sections 3.1, 3.3 and 3.4", () => {
    expect(parseFeatures(document)).toEqual([
      { id: "Q-2", name: "Choice Interaction", required: ["Basic", "Advanced"] },
      { id: "Q-6", name: "Gap Match & more", required: ["Advanced"] },
      { id: "Q-7", name: "Elective", required: [] },
      { id: "A-6", name: "additional-testing-time", required: ["Elevated"] },
      { id: "A-40a", name: "Spoken (reading-type = screen-reader)", required: ["Elevated"] },
    ]);
  });

  it("refuses a page without the tables of Appendix A", () => {
    expect(() => parseFeatures("<h3>A.1 Tests</h3><p>Moved.</p>")).toThrow("no tables of Appendix A");
  });
});

describe("the list of features", () => {
  it("holds each feature of the appendix once, in the areas of its seven tables", () => {
    expect(new Set(features.map(({ id }) => id)).size).toBe(features.length);
    expect(features.length).toBe(150);
    expect([...new Set(features.map(({ id }) => id.charAt(0)))]).toEqual(["T", "S", "I", "Q", "A", "M", "P"]);
  });
});

describe("checkOutsideRepository", () => {
  let directory = "";

  beforeAll(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "conformance-")));
    mkdirSync(join(directory, "repo/inside"), { recursive: true });
    mkdirSync(join(directory, "repo-beside"));
    symlinkSync(join(directory, "repo/inside"), join(directory, "link"));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("refuses the repository, a path inside it and one that does not exist yet", () => {
    const root = join(directory, "repo");
    for (const path of [root, join(root, "inside"), join(root, "reports/new")]) {
      expect(() => checkOutsideRepository(root, path, "The directory")).toThrow(
        `The directory ${path} is inside the repository; keep member-only material outside it.`,
      );
    }
  });

  it("refuses a symbolic link that leads inside it", () => {
    const root = join(directory, "repo");
    expect(() => checkOutsideRepository(root, join(directory, "link"), "The directory")).toThrow(
      "inside the repository",
    );
  });

  it("takes a directory beside it, whose name starts alike, and one that does not exist yet", () => {
    const root = join(directory, "repo");
    expect(() => checkOutsideRepository(root, join(directory, "repo-beside"), "The directory")).not.toThrow();
    expect(() => checkOutsideRepository(root, join(directory, "new/reports"), "The directory")).not.toThrow();
  });
});

describe("discoverInputs", () => {
  let directory = "";

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "conformance-inputs-"));
    const files = [
      "basic/a.zip",
      "basic/notes.txt",
      "basic/profile.xml",
      "advanced/unpacked/imsmanifest.xml",
      "advanced/unpacked/item.xml",
      "advanced/both/imsmanifest.xml",
      "advanced/both/item.xml",
      "advanced/both/both.zip",
      ".git/config.xml",
    ];
    for (const file of files) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), "");
    }
    symlinkSync(join(directory, "basic"), join(directory, "link"));
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("finds ZIP files, unpacked packages and documents, and no part of a package", () => {
    expect(discoverInputs(directory)).toEqual([
      { path: "advanced/both/both.zip", kind: "package" },
      { path: "advanced/unpacked", kind: "package" },
      { path: "basic/a.zip", kind: "package" },
      { path: "basic/profile.xml", kind: "document" },
    ]);
  });
});

describe("the page of conformance", () => {
  it("has a row for each feature of Appendix A, in its order, and no other", () => {
    expect(rows.map(({ id }) => id)).toEqual(features.map(({ id }) => id));
  });

  it("gives each feature the name and the level of the document", () => {
    expect(rows.map(({ id, feature, required }) => [id, feature, required])).toEqual(
      features.map((each) => [each.id, each.name, requiredAt(each)]),
    );
  });

  it("links each row to a guide and to a heading of it that exist", () => {
    const anchors = new Map<string, Set<string>>();
    for (const { id, guides } of rows) {
      expect(guides.length, id).toBeGreaterThan(0);
      for (const guide of guides) {
        const [, link = ""] = /^\[[^\]]+\]\(([^)]+)\)$/.exec(guide) ?? [];
        const [path = "", anchor] = link.split("#");
        const file = resolve(ROOT, dirname(PAGE_PATH), path);
        expect(path, `${id} ${guide}`).toMatch(/\.md$/);
        const known = anchors.get(file) ?? anchorsOf(readFileSync(file, "utf8"));
        anchors.set(file, known);
        if (anchor !== undefined) expect(known.has(anchor), `${id} ${guide}`).toBe(true);
      }
    }
  });

  it("cites for each row a test that exists and runs", () => {
    const sources = new Map<string, string>();
    for (const { id, tests } of rows) {
      expect(tests.length, id).toBeGreaterThan(0);
      for (const test of tests) {
        const [, pack = "", file = "", title = ""] = /^`(runtime|player)\/([^`]+)`: (.+)$/.exec(test) ?? [];
        expect(title, `${id} ${test}`).not.toBe("");
        const path = join(ROOT, "packages", pack, "test", file);
        const source = sources.get(path) ?? readFileSync(path, "utf8");
        sources.set(path, source);
        expect(runs(source, title), `${id} ${test}`).toBe(true);
      }
    }
  });

  it("does not take a test that is skipped, or a title that only looks like one", () => {
    expect(runs('it.skip("works", () => {});', "works")).toBe(false);
    expect(runs('it.todo("works");', "works")).toBe(false);
    expect(runs('const text = "works";', "works")).toBe(false);
    expect(runs('it(\n  "works",\n  () => {},\n);', "works")).toBe(true);
    expect(runs('it.for([1])("works", () => {});', "works")).toBe(true);
  });

  it("says what is missing in each row that does not implement its feature", () => {
    for (const { id, status } of rows) {
      expect(status, id).toMatch(/^(Implements|(Partly|Host): \S.*)$/);
    }
  });

  it("sums the rows in the table of the levels", () => {
    const line = (label: string): string[] =>
      cellsOf(page.split("\n").find((each) => each.startsWith(`| ${label} `)) ?? "");
    for (const level of ["Basic", "Advanced", "Elevated", "Elective"]) {
      const held = features.filter(({ required }) =>
        level === "Elective" ? required.length === 0 : required.some((each) => each === level),
      );
      const statuses = held.map(({ id }) => rows.find((row) => row.id === id)?.status ?? "");
      const count = (status: string): string => String(statuses.filter((each) => each.startsWith(status)).length);
      const rest = held.flatMap(({ id }, index) => (statuses[index] === "Implements" ? [] : [`\`${id}\``]));
      expect(line(level), level).toEqual([
        level,
        String(held.length),
        count("Implements"),
        count("Partly"),
        count("Host"),
        rest.length === 0 ? "None" : rest.join(", "),
      ]);
    }
  });
});

describe("the claim", () => {
  const documents = (): string[] => [
    "README.md",
    "packages/runtime/README.md",
    "packages/player/README.md",
    ...["docs/runtime", "docs/player"].flatMap((folder) =>
      readdirSync(join(ROOT, folder))
        .filter((name) => name.endsWith(".md"))
        .map((name) => `${folder}/${name}`),
    ),
  ];

  it("says that assesskit implements the specification, and never that it is certified or conformant", () => {
    for (const document of documents()) {
      const text = readFileSync(join(ROOT, document), "utf8");
      expect(text.match(/(?<!not )\bcertified\b|\b(non)?conformant\b|\bcompliant\b/gi) ?? [], document).toEqual([]);
    }
  });
});
