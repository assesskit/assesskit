import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The subpaths that load code, by the folder of `src/` that holds each: the stylesheet and the static files are no module. */
const MODULES: Readonly<Record<string, () => Promise<unknown>>> = {
  ".": () => import("../src/index.js"),
  "./player": () => import("../src/player/index.js"),
  "./client": () => import("../src/client/index.js"),
  "./client/local": () => import("../src/client/local/index.js"),
  "./messages/id": () => import("../src/messages/id/index.js"),
  "./protocol": () => import("../src/protocol/index.js"),
  "./scoring": () => import("../src/scoring/index.js"),
  "./cat": () => import("../src/cat/index.js"),
  "./cat-rest": () => import("../src/cat-rest/index.js"),
  "./server": () => import("../src/server/index.js"),
};

describe("importing the player where there is no document", () => {
  it("lists every subpath of the package that holds code", () => {
    const manifest: { exports: Record<string, unknown> } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const subpaths = Object.entries(manifest.exports)
      .filter(([, target]) => typeof target === "object")
      .map(([subpath]) => subpath);
    expect(Object.keys(MODULES).sort()).toEqual(subpaths.sort());
  });

  it("loads each subpath, as a server renders a page that imports it", async () => {
    expect("document" in globalThis).toBe(false);
    for (const [subpath, load] of Object.entries(MODULES)) {
      await expect(load(), subpath).resolves.toBeTypeOf("object");
    }
  });
});
