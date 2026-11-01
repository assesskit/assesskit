import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bundle } from "./bundle.js";

const SRC = resolve(import.meta.dirname, "../src");
const RUNTIME = resolve(import.meta.dirname, "../../runtime/src");

/** The files of the runtime's delivery engine, which hold answer keys, processing and the state of a session. */
const ENGINE_FILES = [
  "delivery/engine.ts",
  "delivery/course.ts",
  "delivery/session-step.ts",
  "delivery/step-context.ts",
  "delivery/step-outcomes.ts",
  "delivery/step-entry.ts",
  "delivery/step-adaptive.ts",
  "delivery/step-walk.ts",
  "delivery/step-moves.ts",
  "delivery/step-host.ts",
  "delivery/step-time.ts",
  "delivery/step-session.ts",
  "delivery/item-action.ts",
  "delivery/navigation.ts",
  "delivery/scoring.ts",
  "delivery/results-assembly.ts",
  "delivery/state-json.ts",
  "delivery/stamp.ts",
  "processing/index.ts",
];

/** Bundles a program for a browser, as a host's bundler would, and returns the files that have code in the output. */
const bundled = async (program: string): Promise<readonly string[]> => (await bundle(program)).inputs;

const engineFilesIn = (inputs: readonly string[]): string[] =>
  ENGINE_FILES.filter((file) => inputs.includes(resolve(RUNTIME, file)));

/** The files of a folder of the player that a bundle holds, as paths below `src/`. */
const filesOf = (inputs: readonly string[], folder: string): string[] =>
  inputs.filter((path) => path.startsWith(`${SRC}/${folder}/`)).map((path) => path.slice(SRC.length + 1));

describe("the exam bundle", () => {
  it("holds none of the runtime's engine: the player and the remote session read views and write actions only", async () => {
    const inputs = await bundled(`
      import { mountDelivery } from "./player/index.ts";
      import { createRemoteSession } from "./client/index.ts";
      export { mountDelivery, createRemoteSession };
    `);
    expect(inputs.some((path) => path.endsWith("client/remote.ts"))).toBe(true);
    expect(inputs.some((path) => path.endsWith("player/delivery/mount.ts"))).toBe(true);
    expect(inputs.some((path) => path.endsWith("delivery/view-json.ts"))).toBe(true);
    expect(inputs.some((path) => path.endsWith("client/local.ts"))).toBe(false);
    expect(engineFilesIn(inputs)).toEqual([]);
  });

  it("holds none of the CAT client, which keeps the secret of a CAT engine, or of the server folders", async () => {
    const inputs = await bundled(`
      import { mountDelivery } from "./player/index.ts";
      import { createRemoteSession } from "./client/index.ts";
      export { mountDelivery, createRemoteSession };
    `);
    for (const folder of ["cat-rest", "cat", "scoring", "server"]) {
      expect(filesOf(inputs, folder), folder).toEqual([]);
    }
  });

  it("holds none of the rating form, which only a rater's page needs", async () => {
    const inputs = await bundled(`
      import { mountDelivery } from "./player/index.ts";
      import { createRemoteSession } from "./client/index.ts";
      export { mountDelivery, createRemoteSession };
    `);
    expect(filesOf(inputs, "player/rating")).toEqual([]);
  });

  it("holds the engine in a bundle that makes a local session, which is how the check sees it", async () => {
    const inputs = await bundled(`
      import { createLocalSession } from "./client/index.ts";
      export { createLocalSession };
    `);
    expect(engineFilesIn(inputs)).toContain("delivery/engine.ts");
  });
});

describe("the practice bundle", () => {
  const practice = bundled(`
    import { createLocalSession } from "./client/index.ts";
    import { toSubmission, toSupplyScores } from "./scoring/index.ts";
    import { deployCatSections } from "./cat/index.ts";
    export { createLocalSession, toSubmission, toSupplyScores, deployCatSections };
  `);

  it("holds the scoring and the deployment of a page that runs practice on a device", async () => {
    const inputs = await practice;
    expect(filesOf(inputs, "scoring")).toContain("scoring/supply-scores.ts");
    expect(filesOf(inputs, "cat")).toContain("cat/deploy.ts");
  });

  it("holds none of the CAT client, which keeps the secret of a CAT engine, or of the server folders", async () => {
    const inputs = await practice;
    for (const folder of ["cat-rest", "server"]) {
      expect(filesOf(inputs, folder), folder).toEqual([]);
    }
  });

  it("holds the CAT client in a bundle that makes one, which is how the check sees it", async () => {
    const inputs = await bundled('import { restCatPort } from "./cat-rest/index.ts"; export { restCatPort };');
    expect(filesOf(inputs, "cat-rest")).toContain("cat-rest/rest-port.ts");
  });
});

describe("the rater bundle", () => {
  const rater = bundled(`
    import { mountRatingForm } from "./player/index.ts";
    import { toSupplyScores } from "./scoring/index.ts";
    export { mountRatingForm, toSupplyScores };
  `);

  it("holds the rating form and the action that supplies a score", async () => {
    const inputs = await rater;
    expect(filesOf(inputs, "player/rating")).toContain("player/rating/mount.ts");
    expect(filesOf(inputs, "scoring")).toContain("scoring/supply-scores.ts");
  });

  it("holds no file of the engine and no element table of the runtime", async () => {
    const inputs = await rater;
    expect(engineFilesIn(inputs)).toEqual([]);
    expect(inputs.filter((path) => path.endsWith("asi/element-table.ts"))).toEqual([]);
  });

  it("holds none of the CAT client or of the server folders", async () => {
    const inputs = await rater;
    for (const folder of ["cat-rest", "server"]) {
      expect(filesOf(inputs, folder), folder).toEqual([]);
    }
  });
});
