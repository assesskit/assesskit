import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isCurrent, loadList, requireSchemas, type SchemaFile, schemaDirectory, sha256 } from "../schemas.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "olah-schemas-"));
  writeFileSync(join(directory, "x.xsd"), "x");
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const X = "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881";
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("sha256", () => {
  it("hashes bytes", () => {
    expect(sha256(new TextEncoder().encode("x"))).toBe(X);
    expect(sha256(new Uint8Array())).toBe(EMPTY);
  });
});

describe("isCurrent", () => {
  const schema = (sha: string, file = "x.xsd"): SchemaFile => ({
    url: `https://example.org/${file}`,
    file,
    sha256: sha,
  });

  it("is true for a file with its pinned hash", () => {
    expect(isCurrent(directory, schema(X))).toBe(true);
  });

  it("is false for a file with another hash, and for a missing file", () => {
    expect(isCurrent(directory, schema(EMPTY))).toBe(false);
    expect(isCurrent(directory, schema(X, "missing.xsd"))).toBe(false);
  });
});

describe("the list", () => {
  it("pins every schema of the package to a purl address, a file name and a SHA-256", () => {
    const list = loadList(join(import.meta.dirname, "../.."));
    expect(list.length).toBeGreaterThan(30);
    for (const { url, file, sha256: hash } of list) {
      expect(url.startsWith("https://purl.imsglobal.org/spec/")).toBe(true);
      expect(url.endsWith(`/${file}`)).toBe(true);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("requireSchemas", () => {
  it("returns the schema directory below the root when it exists", () => {
    mkdirSync(join(directory, ".cache/schemas"), { recursive: true });
    expect(requireSchemas(directory)).toBe(join(directory, ".cache/schemas"));
  });

  it("says how to download the schemas when the directory is missing", () => {
    const root = join(directory, "none");
    expect(() => requireSchemas(root)).toThrow(
      `The schemas are not downloaded to ${schemaDirectory(root)}: run pnpm schemas first.`,
    );
  });
});
