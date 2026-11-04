import type { AdaptiveSelection } from "@assesskit/runtime/asi";
import type { CatPort } from "@assesskit/runtime/cat";
import { DataError } from "@assesskit/runtime/errors";
import { describe, expect, it } from "vitest";
import catGuide from "../../../docs/player/cat.md?raw";
import { deployCatSections } from "../src/cat/index.js";
import {
  ASI,
  adaptiveSection,
  BANK,
  base64,
  DEPLOYABLE,
  FILES,
  IDS,
  itemRefs,
  json,
  PREFIX,
  packageOf,
  rejection,
  SETTINGS_REF,
  selectionXml,
  testXml,
  USAGE_REF,
  usageXml,
} from "./cat-fixture.js";
import { runGuideSamples } from "./guide-samples.js";

/** A CAT engine that records Create Section and Get Section, and reports the pool it was told to. */
function recordingEngine(pool: (sectionIdentifier: string) => readonly string[] = () => IDS): {
  readonly port: CatPort;
  readonly calls: string[];
  readonly signals: (AbortSignal | undefined)[];
} {
  const calls: string[] = [];
  const unused = async (): Promise<never> => {
    throw new Error("Deployment makes only Create Section and Get Section.");
  };
  const signals: (AbortSignal | undefined)[] = [];
  const port: CatPort = {
    async createSection(prefix, data, options) {
      calls.push(`create ${prefix} ${JSON.stringify(data)}`);
      signals.push(options?.signal);
      return { sectionIdentifier: `engine-${calls.length}` };
    },
    async getSection(prefix, sectionIdentifier, options) {
      calls.push(`get ${prefix} ${sectionIdentifier}`);
      signals.push(options?.signal);
      return { sectionData: { sectionConfiguration: "" }, items: { itemIdentifiers: [...pool(sectionIdentifier)] } };
    },
    createSession: unused,
    submitResults: unused,
    endSession: unused,
    endSection: unused,
  };
  return { port, calls, signals };
}

describe("deployCatSections", () => {
  it("creates the section of an adaptive selection from the files it references, and checks the pool", async () => {
    const engine = recordingEngine();
    const picked: AdaptiveSelection[] = [];
    const deployedSections = await deployCatSections(DEPLOYABLE, (selection) => {
      picked.push(selection);
      return engine.port;
    });
    const data = {
      sectionConfiguration: base64(FILES["cat/settings.json"]),
      qtiUsagedata: base64(FILES["cat/usage.xml"]),
    };
    expect(engine.calls).toEqual([`create ${PREFIX} ${JSON.stringify(data)}`, `get ${PREFIX} engine-1`]);
    expect(deployedSections).toEqual(new Map([["cat", { prefix: PREFIX, sectionIdentifier: "engine-1" }]]));
    expect(picked).toHaveLength(1);
    expect(picked[0]?.adaptiveEngineRef.href).toBe(PREFIX);
  });

  it("reads the files against the document that holds the section: a section in a document of its own", async () => {
    const pkg = packageOf({
      "test.xml": testXml('<qti-assessment-section-ref identifier="cat" href="sections/section-cat.xml"/>'),
      "sections/section-cat.xml": `<qti-assessment-section xmlns="${ASI}" identifier="cat" title="Adaptive" visible="true">${selectionXml(
        '<qti-adaptive-settings-ref identifier="settings" href="settings.json"/>',
        '<qti-usagedata-ref identifier="usage" href="../cat/usage.xml"/>',
      )}${itemRefs(IDS)}</qti-assessment-section>`,
      "sections/settings.json": '{"length":2}',
      "cat/usage.xml": usageXml(BANK),
    });
    const engine = recordingEngine();
    await deployCatSections(pkg, () => engine.port);
    expect(engine.calls[0]).toBe(
      `create ${PREFIX} ${JSON.stringify({ sectionConfiguration: base64('{"length":2}'), qtiUsagedata: base64(usageXml(BANK)) })}`,
    );
  });

  it("sends an empty settings file for a selection without qti-adaptive-settings-ref, and no usage data", async () => {
    const pkg = packageOf({ "test.xml": testXml(adaptiveSection(selectionXml("", ""), IDS)) });
    const engine = recordingEngine();
    await deployCatSections(pkg, () => engine.port);
    expect(engine.calls[0]).toBe(`create ${PREFIX} ${JSON.stringify({ sectionConfiguration: "" })}`);
  });

  it("deploys each adaptive section of each test, in document order, and nothing for a package without one", async () => {
    const second = `<qti-assessment-section identifier="cat2" title="Second" visible="true">${selectionXml(SETTINGS_REF, USAGE_REF)}${itemRefs(["x1", "x2"])}</qti-assessment-section>`;
    // Create Section is the first request of the engine, Get Section the second: the second section is engine-3.
    const engine = recordingEngine((section) => (section === "engine-3" ? ["x1", "x2"] : IDS));
    const deployedSections = await deployCatSections(
      packageOf({
        "test.xml": testXml(`${adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)}${second}`),
        ...FILES,
      }),
      () => engine.port,
    );
    expect([...deployedSections.keys()]).toEqual(["cat", "cat2"]);
    expect(deployedSections.get("cat2")?.sectionIdentifier).toBe("engine-3");
    const none = recordingEngine();
    const plain = packageOf({
      "test.xml": testXml(
        `<qti-assessment-section identifier="s" title="S" visible="true">${itemRefs(["f1"])}</qti-assessment-section>`,
      ),
    });
    expect(await deployCatSections(plain, () => none.port)).toEqual(new Map());
    expect(none.calls).toEqual([]);
  });

  it("fails when the pool of the engine and the item references disagree, and names the section at the engine", async () => {
    const engine = recordingEngine(() => [...IDS.slice(1), "stranger"]);
    const message = await rejection(deployCatSections(DEPLOYABLE, () => engine.port));
    expect(message).toMatch(
      /^The engine's section "engine-1" at "https:\/\/cat\.example\/ims\/cat\/v1p0" does not agree with the adaptive section "cat": /,
    );
    expect(message).toContain('lists the item "q1", which the item pool of the CAT engine does not contain');
    expect(message).toContain('contains the item "stranger", which the adaptive section "cat" does not list');
    expect(engine.calls).toHaveLength(2);
  });

  it("fails when a referenced file is not in the package, or two tests name a section alike", async () => {
    const missing = packageOf({
      "test.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      "cat/settings.json": "{}",
    });
    expect(await rejection(deployCatSections(missing, () => recordingEngine().port))).toBe(
      'The adaptive section "cat" references the usage data "cat/usage.xml", which is not a file of the package.',
    );
    const outside = packageOf({
      "test.xml": testXml(
        adaptiveSection(
          selectionXml('<qti-adaptive-settings-ref identifier="settings" href="../outside.json"/>', ""),
          IDS,
        ),
      ),
    });
    expect(await rejection(deployCatSections(outside, () => recordingEngine().port))).toMatch(
      /which is not a file of the package\.$/,
    );
    const twice = packageOf({
      "test.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      "test2.xml": testXml(adaptiveSection(selectionXml(SETTINGS_REF, USAGE_REF), IDS)),
      ...FILES,
    });
    expect(await rejection(deployCatSections(twice, () => recordingEngine().port))).toBe(
      'Two tests of the package have the adaptive section "cat"; the sections of the engine are named by it.',
    );
  });

  it("gives the port the signal of the caller with each request", async () => {
    const engine = recordingEngine();
    const { signal } = new AbortController();
    await deployCatSections(DEPLOYABLE, () => engine.port, { signal });
    expect(engine.signals).toEqual([signal, signal]);
  });

  it("ends the wait when the signal aborts, before a request or while one waits, and keeps the sections made", async () => {
    const reason = new Error("The deployment was cancelled.");
    const idle = recordingEngine();
    await expect(deployCatSections(DEPLOYABLE, () => idle.port, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    expect(idle.calls).toEqual([]);

    const controller = new AbortController();
    const engine = recordingEngine();
    const slow: CatPort = { ...engine.port, getSection: () => new Promise(() => undefined) };
    const pending = deployCatSections(DEPLOYABLE, () => slow, { signal: controller.signal });
    await Promise.resolve();
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(engine.calls).toHaveLength(1);
  });

  it("checks its arguments", async () => {
    await expect(deployCatSections(json("null"), () => recordingEngine().port)).rejects.toThrow(
      new DataError("The package must be an object, found null."),
    );
    await expect(deployCatSections(DEPLOYABLE, json("5"))).rejects.toThrow(
      new DataError("The port must be a function of an adaptive selection, found 5."),
    );
    await expect(deployCatSections(DEPLOYABLE, () => recordingEngine().port, json("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
    await expect(deployCatSections(DEPLOYABLE, () => recordingEngine().port, json('{"signal":5}'))).rejects.toThrow(
      new DataError("The option signal must be an AbortSignal, found 5."),
    );
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const cat = await import("../src/cat/index.js");
    const catRest = await import("../src/cat-rest/index.js");
    const player = await import("../src/index.js");
    expect(
      await runGuideSamples(catGuide, {
        "@assesskit/player": player,
        "@assesskit/player/cat": cat,
        "@assesskit/player/cat-rest": catRest,
      }),
    ).toBeGreaterThan(0);
  });
});

describe("the exports", () => {
  it("are the deployment", async () => {
    expect(Object.keys(await import("../src/cat/index.js")).sort()).toEqual(["deployCatSections"]);
  });
});
