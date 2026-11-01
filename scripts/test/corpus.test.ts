import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CorpusSource, fetchSource, loadLock, selectFiles, sha256, stampOf } from "../corpus.ts";

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

describe("fetchSource", () => {
  const source: CorpusSource = {
    repository: "owner/repository",
    commit: "0".repeat(40),
    sha256: A,
    include: ["items/"],
  };

  it("downloads nothing when the directory of the source holds the stamp of the pinned archive and include list", async () => {
    mkdirSync(join(directory, "stamped"));
    writeFileSync(join(directory, "stamped", ".stamp"), stampOf(source));
    expect(await fetchSource(directory, "stamped", source)).toBe("current");
  });

  it("stamps a different include list or archive differently, so that a change downloads again", () => {
    expect(stampOf({ ...source, include: ["items/", "more/"] })).not.toBe(stampOf(source));
    expect(stampOf({ ...source, sha256: "f".repeat(64) })).not.toBe(stampOf(source));
  });
});

describe("the lock", () => {
  it("pins every source to a commit and to the SHA-256 of its archive", () => {
    const lock = loadLock(join(import.meta.dirname, "../.."));
    expect(Object.keys(lock)).toEqual(["qti-examples", "xsdtests"]);
    for (const source of Object.values(lock)) {
      expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(source.include.length).toBeGreaterThan(0);
    }
  });
});
