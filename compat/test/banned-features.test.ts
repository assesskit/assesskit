import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcd from "@mdn/browser-compat-data";
import { describe, expect, it } from "vitest";
import { BANNED_FEATURES, BASELINE } from "../banned-features.ts";

/** The browsers of the baseline in `@mdn/browser-compat-data`, with the version the player supports. */
const BROWSERS = [
  { name: "chrome", baseline: Number.parseFloat(BASELINE.chromium) },
  { name: "firefox", baseline: Number.parseFloat(BASELINE.firefox) },
  { name: "safari", baseline: Number.parseFloat(BASELINE.webkit) },
] as const;

/** Returns what the data says about a feature in a browser: the `version_added` of each statement, newest first. */
function versionsAdded(path: string, browser: string): (string | boolean | null)[] {
  let node: unknown = bcd;
  for (const key of path.split("."))
    node = typeof node === "object" && node !== null ? Reflect.get(node, key) : undefined;
  const support: unknown =
    typeof node === "object" && node !== null ? Reflect.get(node, "__compat")?.support?.[browser] : undefined;
  const statements: unknown[] = Array.isArray(support) ? support : [support];
  return statements.map(
    (statement) =>
      (typeof statement === "object" && statement !== null ? Reflect.get(statement, "version_added") : null) ?? null,
  );
}

/**
 * Returns whether a browser lacks a feature at the baseline: the data says `false`, or a version after it (`≤83` is read as
 * 83). A feature of unknown support is not a lack.
 */
const isAfter = (version: string | boolean | null, baseline: number): boolean =>
  version === false || (typeof version === "string" && Number.parseFloat(version.replace("≤", "")) > baseline);

describe("the banned features", () => {
  it("are each lacking in at least one browser of the baseline, by @mdn/browser-compat-data", () => {
    for (const { feature, bcd: paths } of BANNED_FEATURES) {
      for (const path of paths) {
        const lacking = BROWSERS.filter(({ name, baseline }) =>
          isAfter(versionsAdded(path, name)[0] ?? null, baseline),
        );
        expect(lacking.length, `${feature}: ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("list first versions that @mdn/browser-compat-data knows for the browser", () => {
    for (const { feature, first, bcd: paths } of BANNED_FEATURES) {
      if (!/^\d/.test(first)) continue;
      const listed = first.split(", ");
      expect(listed, feature).toHaveLength(BROWSERS.length);
      BROWSERS.forEach(({ name }, index) => {
        const known = paths.flatMap((path) => versionsAdded(path, name));
        for (const version of (listed[index] ?? "").split("–"))
          expect(known, `${feature}: ${name} ${version}`).toContain(version);
      });
    }
  });
});

describe("AGENTS.md", () => {
  const text = readFileSync(join(import.meta.dirname, "../../AGENTS.md"), "utf8");
  const start = text.indexOf("## Browser baseline");
  const section = text.slice(start, text.indexOf("\n## ", start + 1));
  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").trim()),
    );

  it("lists the banned features of the baseline, with their first versions and what to use instead", () => {
    expect(rows).toEqual(BANNED_FEATURES.map(({ feature, first, instead }) => [feature, first, instead]));
  });
});
