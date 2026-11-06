import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { examplesIn, runExample } from "../../../scripts/tsdoc-examples.js";
import { PLAYER_CSS } from "./css-fixture.js";

/** The files whose examples need a page: `tsdoc.test.ts` runs the examples of the others in Node, and leaves these out. */
const FILES = ["client/remote.ts", "player/delivery/mount.ts"];

// The command reads a file by its path from the root of the repository.
const examples = examplesIn(
  Object.fromEntries(
    await Promise.all(
      FILES.map(async (file) => [
        `packages/player/src/${file}`,
        await commands.readFile(`packages/player/src/${file}`),
      ]),
    ),
  ),
);

/** The modules that the examples import, by address. */
const MODULES: Record<string, () => Promise<object>> = {
  "@assesskit/player/client": () => import("../src/client/index.js"),
  "@assesskit/player/client/local": () => import("../src/client/local/index.js"),
  "@assesskit/player/player": () => import("../src/player/index.js"),
  "@assesskit/player/player.css?inline": async () => ({ default: PLAYER_CSS }),
  "@assesskit/runtime/asi": () => import("@assesskit/runtime/asi"),
  "@assesskit/runtime/delivery": () => import("@assesskit/runtime/delivery"),
  "@assesskit/runtime/delivery/wire": () => import("@assesskit/runtime/delivery/wire"),
};

/** Imports a module that an example names. */
async function load(specifier: string): Promise<object> {
  const module = MODULES[specifier];
  if (module === undefined) throw new Error(`An example imports ${specifier}, which this test does not load.`);
  return module();
}

describe("the examples of the TSDoc comments that need a page", () => {
  it("has an example for the remote session and for the mounted delivery", () => {
    expect(examples.map(({ file }) => file)).toStrictEqual([
      "packages/player/src/client/remote.ts",
      "packages/player/src/player/delivery/mount.ts",
    ]);
  });

  it.each(examples)("shows the results that the example of $file from line $line gives", async (example) => {
    expect(await runExample(example, load)).toBeGreaterThan(0);
  });
});
