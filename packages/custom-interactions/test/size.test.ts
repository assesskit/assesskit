import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { type BundledPackage, buildModule, MODULES } from "../scripts/build-modules.js";
import { MODULE_BUDGETS } from "./size-budgets.js";

const directory = mkdtempSync(join(tmpdir(), "custom-interactions-size-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

/** The bytes of the files below a folder, together; none when there is no such folder. */
function bytesBelow(folder: string): number {
  let total = 0;
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
  }
  return total;
}

describe("the size of each module", () => {
  it("has a budget for each module, and none for a name that is not one", () => {
    expect(Object.keys(MODULE_BUDGETS).sort()).toEqual(MODULES.map(({ name }) => name).sort());
  });

  it.each(MODULES.map((source) => [source.name, source] as const))(
    "keeps %s within its budget, holding only the packages it lists",
    async (name, source) => {
      const bundled: readonly BundledPackage[] = await buildModule(source, directory);
      const budget = MODULE_BUDGETS[name] ?? expect.unreachable(`No budget for ${name}.`);
      const gzip = gzipSync(readFileSync(join(directory, `${name}.js`)), { level: 9 }).length;
      expect(gzip, `The gzipped bytes of ${name}.js`).toBeLessThan(budget.gzip);
      const files = source.assets.size === 0 ? 0 : bytesBelow(join(directory, name));
      expect(files, `The bytes of the files of ${name}`).toBeLessThanOrEqual(budget.files);
      expect(bundled.map((entry) => entry.name)).toEqual(budget.holds);
    },
  );
});
