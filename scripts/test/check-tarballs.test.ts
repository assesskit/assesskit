import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importAll, type Manifest, moduleSpecifiers, RESOLUTIONS, typeAll } from "../check-tarballs.ts";

const MANIFEST: Manifest = {
  name: "@scope/pkg",
  exports: {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./client": { types: "./dist/client/index.d.ts", default: "./dist/client/index.js" },
    "./style.css": "./style.css",
    "./frames/*": "./dist/frames/*",
  },
};

describe("moduleSpecifiers", () => {
  it("names the root and each subpath that has types, and leaves files and patterns out", () => {
    expect(moduleSpecifiers(MANIFEST)).toStrictEqual(["@scope/pkg", "@scope/pkg/client"]);
  });

  it("finds every module of the packages of the repository", () => {
    const root = join(import.meta.dirname, "../..");
    const player: Manifest = JSON.parse(readFileSync(join(root, "packages/player/package.json"), "utf8"));
    const specifiers = moduleSpecifiers(player);
    expect(specifiers).toContain("@assesskit/player");
    expect(specifiers).toContain("@assesskit/player/player");
    expect(specifiers).toContain("@assesskit/player/server");
    expect(specifiers).not.toContain("@assesskit/player/player.css");
  });
});

describe("importAll and typeAll", () => {
  it("import each specifier, and name the one that does not load", () => {
    const source = importAll(["@scope/pkg", "@scope/pkg/client"]);
    expect(source).toContain('await import("@scope/pkg/client")');
    expect(source).toContain("@scope/pkg/client does not load: ");
    expect(source).toContain("2 specifiers load in Node.");
  });

  it("import the types of each specifier, so that each must resolve", () => {
    expect(typeAll(["@scope/pkg", "@scope/pkg/client"])).toBe(
      'import type * as m0 from "@scope/pkg";\nimport type * as m1 from "@scope/pkg/client";\nexport type { m0, m1 };\n',
    );
  });
});

describe("RESOLUTIONS", () => {
  it("check the resolution of a bundler and the one of Node.js", () => {
    expect(RESOLUTIONS.map((each) => each.moduleResolution)).toStrictEqual(["bundler", "node16"]);
  });
});
