import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CorpusSource, differences, hashFiles, loadLock, selectFiles, sha256 } from "../corpus.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "runtime-corpus-"));
  mkdirSync(join(directory, "items/deep"), { recursive: true });
  mkdirSync(join(directory, "other"));
  writeFileSync(join(directory, "items/a.xml"), "a");
  writeFileSync(join(directory, "items/deep/b.xml"), "b");
  writeFileSync(join(directory, "items/.DS_Store"), "junk");
  writeFileSync(join(directory, "other/c.xml"), "c");
  writeFileSync(join(directory, "root.xml"), "r");
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const A = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
const B = "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d";

describe("sha256", () => {
  it("hashes the bytes of a file", () => {
    expect(sha256(join(directory, "items/a.xml"))).toBe(A);
  });
});

describe("selectFiles", () => {
  it("returns the files under the included directories and the included files, sorted, without editor leftovers", () => {
    expect(selectFiles(directory, ["items/", "root.xml"])).toEqual(["items/a.xml", "items/deep/b.xml", "root.xml"]);
  });
});

describe("hashFiles", () => {
  it("hashes the selected files by path", () => {
    expect(hashFiles(directory, ["items/"])).toEqual({ "items/a.xml": A, "items/deep/b.xml": B });
  });
});

describe("differences", () => {
  const source = (files: Record<string, string>): CorpusSource => ({
    repository: "owner/repository",
    commit: "0".repeat(40),
    include: ["items/"],
    files,
  });

  it("finds none when the files are the pinned ones", () => {
    expect(differences(directory, source({ "items/a.xml": A, "items/deep/b.xml": B }))).toEqual([]);
  });

  it("names missing, changed and unpinned files", () => {
    expect(differences(directory, source({ "items/a.xml": B, "items/missing.xml": A }))).toEqual([
      `items/a.xml has another SHA-256 than the pinned ${B}.`,
      "items/missing.xml is missing.",
      "items/deep/b.xml is not pinned.",
    ]);
  });
});

describe("the lock", () => {
  it("pins every source to a commit and the files it selects", () => {
    const lock = loadLock(join(import.meta.dirname, "../.."));
    expect(Object.keys(lock.sources)).toEqual(["qti-examples", "xsdtests"]);
    for (const source of Object.values(lock.sources)) {
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(Object.keys(source.files).length).toBeGreaterThan(0);
      expect(Object.values(source.files).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
      expect(Object.keys(source.files).every((path) => source.include.some((prefix) => path.startsWith(prefix)))).toBe(
        true,
      );
    }
  });
});
