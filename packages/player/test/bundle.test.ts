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

/**
 * The files of the chrome: what `mountDelivery` draws around the content, with its tools, its panel of supports and the
 * frame of an LTI item.
 */
const CHROME_FILES = [
  "player/delivery/action-row.ts",
  "player/delivery/actions.ts",
  "player/delivery/attachments.ts",
  "player/delivery/chrome.ts",
  "player/delivery/comment.ts",
  "player/delivery/confirm.ts",
  "player/delivery/duration.ts",
  "player/delivery/mount.ts",
  "player/delivery/navigation.ts",
  "player/delivery/notices.ts",
  "player/delivery/shell.ts",
  "player/delivery/styles.ts",
  "player/delivery/timers.ts",
  "player/delivery/tools.ts",
  "player/delivery/update.ts",
  "player/supports/panel.ts",
];
const CHROME_FOLDERS = ["player/tools", "player/lti-frame"];

/** Bundles a program for a browser, as a host's bundler would, and returns the files that have code in its first load. */
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
    expect(inputs.some((path) => path.includes("/client/local/"))).toBe(false);
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

  it("holds the engine in what a page that makes a local session loads on demand, which is how the check sees it", async () => {
    const { inputs, onDemand } = await bundle(`
      import { createLocalSession } from "./client/local/index.ts";
      export { createLocalSession };
    `);
    expect(engineFilesIn(onDemand)).toContain("delivery/engine.ts");
    expect(engineFilesIn(inputs)).toEqual([]);
  });

  it("holds none of the engine in the first load of a page with both sessions, and reads views with the wire module", async () => {
    const inputs = await bundled('export * from "./client/index.ts"; export * from "./client/local/index.ts";');
    expect(inputs).toContain(resolve(RUNTIME, "delivery/view-json.ts"));
    expect(inputs).toContain(resolve(RUNTIME, "delivery/action-json.ts"));
    expect(engineFilesIn(inputs)).toEqual([]);
  });
});

/** The files of the chrome that a bundle holds, as paths below `src/`. */
const chromeIn = (inputs: readonly string[]): string[] => [
  ...inputs.map((path) => path.slice(SRC.length + 1)).filter((path) => CHROME_FILES.includes(path)),
  ...CHROME_FOLDERS.flatMap((folder) => filesOf(inputs, folder)),
];

describe("the item bundle", () => {
  const item = `
    import { mountItem } from "./player/index.ts";
    import { createRemoteSession } from "./client/index.ts";
    export { mountItem, createRemoteSession };
  `;

  it("holds the content and the interactions of an item, with the supports and the reading aloud", async () => {
    const inputs = await bundled(item);
    for (const file of [
      "player/delivery/mount-item.ts",
      "player/delivery/body.ts",
      "player/roots/root.ts",
      "player/elements/renderers.ts",
      "player/pci/host.ts",
      "player/supports/spoken.ts",
    ]) {
      expect(filesOf(inputs, file.split("/").slice(0, 2).join("/")), file).toContain(file);
    }
  });

  it("holds none of the chrome, the tools, the panel of the supports or the frame of an LTI item", async () => {
    expect(chromeIn(await bundled(item))).toEqual([]);
  });

  it("holds the chrome in a bundle that mounts the delivery, which is how the check sees it", async () => {
    const inputs = await bundled('import { mountDelivery } from "./player/index.ts"; export { mountDelivery };');
    expect(chromeIn(inputs)).toEqual(expect.arrayContaining(CHROME_FILES.slice(0, 3)));
    expect(filesOf(inputs, "player/tools").length).toBeGreaterThan(0);
  });

  it("holds none of the engine, the CAT client, the server folders or the rating form", async () => {
    const inputs = await bundled(item);
    expect(engineFilesIn(inputs)).toEqual([]);
    for (const folder of ["cat-rest", "cat", "scoring", "server", "player/rating"]) {
      expect(filesOf(inputs, folder), folder).toEqual([]);
    }
  });
});

describe("the practice bundle", () => {
  const practice = bundled(`
    import { createLocalSession } from "./client/local/index.ts";
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
    const inputs = await bundled(
      'import { createRestCatPort } from "./cat-rest/index.ts"; export { createRestCatPort };',
    );
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
