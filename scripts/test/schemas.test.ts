import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadList, requireSchemas, schemaDirectory } from "../schemas.ts";

let directory = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "olah-schemas-"));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
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
