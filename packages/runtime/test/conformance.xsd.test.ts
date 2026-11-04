import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type InputReport, runConformance } from "../../../scripts/conformance.js";
import { requireCorpus } from "../../../scripts/corpus.js";
import { requireSchemas } from "../../../scripts/schemas.js";
import * as asi from "../src/asi/index.js";
import * as cli from "../src/cli/internal.js";
import * as delivery from "../src/delivery/index.js";
import * as node from "../src/node/index.js";
import * as packages from "../src/package/index.js";
import { PNP_NAMESPACE } from "../src/pnp/index.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const SCHEMAS = requireSchemas(ROOT);
const PACKAGING = join(requireCorpus(ROOT), "qti-examples/qtiv3-examples/packaging");
const MODULES = { asi, cli, delivery, node, packages };

describe("a run over packages", () => {
  let directory = "";
  let packages = "";
  let reports = "";
  let inputs: readonly InputReport[] = [];

  const input = (path: string): InputReport | undefined => inputs.find((each) => each.path === path);

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "conformance-run-"));
    packages = join(directory, "packages");
    reports = join(directory, "reports");
    mkdirSync(join(packages, "level/linked"), { recursive: true });
    copyFileSync(join(PACKAGING, "CASE/CASE.zip"), join(packages, "level/valid.zip"));
    copyFileSync(join(PACKAGING, "BBQsTest/BBQsTest.zip"), join(packages, "level/refused.zip"));
    copyFileSync(join(PACKAGING, "items/items.zip"), join(packages, "level/invalid.zip"));
    writeFileSync(join(packages, "level/not-a-package.zip"), "PK this is no archive");
    writeFileSync(join(packages, "level/linked/imsmanifest.xml"), "<manifest/>");
    symlinkSync(join(packages, "profile.xml"), join(packages, "level/linked/link.xml"));
    writeFileSync(
      join(packages, "profile.xml"),
      `<access-for-all-pnp xmlns="${PNP_NAMESPACE}"><spoken/></access-for-all-pnp>`,
    );
    inputs = await runConformance(ROOT, { packages, reports, schemas: SCHEMAS }, MODULES);
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("reports the verdict of each input, and goes on after a package that is not valid", () => {
    expect(inputs.map(({ path, kind, valid }) => [path, kind, valid])).toEqual([
      ["profile.xml", "document", true],
      ["level/invalid.zip", "package", false],
      ["level/not-a-package.zip", "package", false],
      ["level/refused.zip", "package", true],
      ["level/valid.zip", "package", true],
      ["level/linked", "package", false],
    ]);
    expect(input("level/invalid.zip")?.validation).toMatchObject({ valid: false, summary: { errors: 7 } });
    expect(input("level/not-a-package.zip")?.validation).toMatchObject({
      issues: [{ rule: "assesskit/package/zip" }],
    });
  });

  it("says why it has no report for an input that the runtime refuses", () => {
    expect(input("level/linked")?.validation).toEqual(expect.stringContaining("symbolic link"));
  });

  it("writes the report as it returned it", () => {
    const report: unknown = JSON.parse(readFileSync(join(reports, "report.json"), "utf8"));
    expect(report).toEqual(JSON.parse(JSON.stringify({ inputs })));
  });

  it("starts each test of a valid package, and says why the engine refuses one", () => {
    expect(input("level/valid.zip")?.tests).toEqual([{ href: "testitems/-TX_G06SAMP_000.xml" }]);
    expect(input("level/refused.zip")?.tests).toEqual([
      { href: "assessment.xml", refusal: expect.stringContaining("custom-operator") },
    ]);
  });

  it("exports only a valid package, and the export is valid", async () => {
    expect(input("level/invalid.zip")?.exported).toBeUndefined();
    expect(input("profile.xml")?.exported).toBeUndefined();
    expect(input("level/valid.zip")?.exported).toBe("exports/level/valid.zip");
    const again = await runConformance(
      ROOT,
      { packages: join(reports, "exports"), reports: join(directory, "again"), schemas: SCHEMAS },
      MODULES,
    );
    expect(again.map(({ path, valid }) => [path, valid])).toEqual([
      ["level/refused.zip", true],
      ["level/valid.zip", true],
    ]);
  });

  it("refuses packages and reports inside the repository, and makes no directory there", async () => {
    const inside = join(ROOT, ".cache/conformance-reports");
    await expect(runConformance(ROOT, { packages, reports: inside, schemas: SCHEMAS }, MODULES)).rejects.toThrow(
      `The directory of the reports ${inside} is inside the repository`,
    );
    expect(existsSync(inside)).toBe(false);
    await expect(
      runConformance(ROOT, { packages: join(ROOT, "docs"), reports, schemas: SCHEMAS }, MODULES),
    ).rejects.toThrow("The directory of the packages");
  });
});
