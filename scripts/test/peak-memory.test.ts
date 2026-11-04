import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, readingNames, removeBundle, risen } from "../peak-memory.ts";
import type { ReadingName } from "../peak-memory-readings.ts";

/** The reading that is read without a limit, to show that a heap fails what the limit spares. */
const CONTROL = "settingsListUnlimited";

let bundle: Bundle;

beforeAll(async () => {
  bundle = await bundleReadings();
});

afterAll(() => {
  removeBundle(bundle);
});

/**
 * Each reader of untrusted input on its worst input within its limits, in a process whose heap holds at most the heap given:
 * twice the least heap in which it ended on Node.js 22, 24 and 26, rounded up to 16 MiB. `node scripts/peak-memory.ts` finds
 * the least heap. A reading that keeps more alive at once than its heap fails, whenever the collector runs and however busy
 * the machine is. SECURITY.md lists the least heaps.
 */
const READINGS: readonly {
  readonly title: string;
  readonly name: ReadingName;
  readonly heapMiB: number;
  readonly outcome: string;
}[] = [
  {
    title: "reads a document of a million nodes, the limit, into a tree",
    name: "xmlNodes",
    heapMiB: 336,
    outcome: "999998 children",
  },
  {
    title: "stops the tree of a document of eight million nodes at the limit of nodes",
    name: "xmlOverNodes",
    heapMiB: 384,
    outcome: "SecurityError maxNodes",
  },
  {
    title: "reads a document of 32 MiB whose elements have 256 attributes each",
    name: "xmlAttributes",
    heapMiB: 576,
    outcome: "17278 elements",
  },
  { title: "reads one text of 32 MiB", name: "xmlText", heapMiB: 32, outcome: "1 node" },
  {
    title: "reads an item of a million nodes into its model",
    name: "itemNodes",
    heapMiB: 640,
    outcome: "item",
  },
  {
    title: "reads an item whose choice interaction has as many choices as 32 MiB hold",
    name: "itemChoices",
    heapMiB: 848,
    outcome: "item",
  },
  {
    title: "reads a test whose section has as many item references as 32 MiB hold",
    name: "testReferences",
    heapMiB: 816,
    outcome: "test",
  },
  {
    title: "reads a manifest with as many resources as 32 MiB hold",
    name: "manifestResources",
    heapMiB: 1088,
    outcome: "297259 resources",
  },
  {
    title: "reads a results report with as many item results as 32 MiB hold",
    name: "resultsItems",
    heapMiB: 880,
    outcome: "161853 item results",
  },
  {
    title: "reads usage data with as many statistics as 32 MiB hold",
    name: "usageStatistics",
    heapMiB: 736,
    outcome: "217913 statistics",
  },
  {
    title:
      "validates an item that is wrong at every node, and keeps the findings of the limit and one that says it stopped",
    name: "validateFindings",
    heapMiB: 736,
    outcome: "1001 issues, the last assesskit/validate/findings-stopped",
  },
  {
    title: "reads the directory of a package of 100,000 entries, the limit",
    name: "packageEntries",
    heapMiB: 80,
    outcome: "100000 files",
  },
  {
    title: "reads a package whose manifest of 32 MiB is deflated at the ratio the limit allows",
    name: "packageManifest",
    heapMiB: 1088,
    outcome: "297259 resources",
  },
  {
    title: "plans a test whose selection with replacement draws as many items as a plan holds",
    name: "planNodes",
    heapMiB: 32,
    outcome: "9999 items",
  },
  {
    title: "reads an action of the most response entries that its size limit holds",
    name: "actionEntries",
    heapMiB: 304,
    outcome: "set-responses",
  },
  {
    title: "reads an action of one response with the most integers that its size limit holds",
    name: "actionValues",
    heapMiB: 288,
    outcome: "set-responses",
  },
  {
    title: "refuses a settings action of a million font names before it builds an element of a profile for each",
    name: "settingsList",
    heapMiB: 48,
    outcome: "SecurityError maxSettingListLength",
  },
  {
    title: "compiles a pattern of the most states, and matches a text of 100,000 characters with it",
    name: "patternStates",
    heapMiB: 128,
    outcome: "true",
  },
  {
    title: "reads a module resolution file of 65,536 characters, the limit",
    name: "moduleResolution",
    heapMiB: 32,
    outcome: "2000 paths",
  },
  {
    title: "refuses a body of two million tokens of JSON at the limit of tokens, before it parses it",
    name: "catBodyTokens",
    heapMiB: 80,
    outcome: "status 413",
  },
  {
    title: "reads a body of 32 MiB and a million tokens of JSON, and refuses its shape",
    name: "catBody",
    heapMiB: 112,
    outcome: "status 400",
  },
];

describe("the peak memory of the readers of untrusted input", () => {
  for (const { title, name, heapMiB, outcome } of READINGS) {
    it(title, async ({ annotate }) => {
      const result = await readInProcess(bundle, name, heapMiB);
      await annotate(`${name}: ${risen(result.rise)} The heap holds ${heapMiB} MiB.`);
      expect(result.outcome).toBe(outcome);
    });
  }

  it("has a case for every reading but the control", async () => {
    const names = await readingNames(bundle);
    expect(names.filter((name) => name !== CONTROL).sort()).toEqual(READINGS.map(({ name }) => name).sort());
  });
});

describe("the heap of a reading", () => {
  it("fails a reading that keeps more alive than the heap holds", async () => {
    await expect(readInProcess(bundle, "xmlNodes", 64)).rejects.toThrow("did not end within a heap of 64 MiB");
  });

  it("runs out on a settings action read without the limit of a list, which the limit spares", async () => {
    await expect(readInProcess(bundle, CONTROL, 48)).rejects.toThrow("did not end within a heap of 48 MiB");
  });
});
