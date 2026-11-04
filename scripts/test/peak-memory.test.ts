import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Bundle, bundleReadings, readInProcess, readingNames, removeBundle, risen } from "../peak-memory.ts";
import type { ReadingName } from "../peak-memory-readings.ts";

/** The bytes of one MiB. */
const MIB = 1024 * 1024;

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
 * the machine is. SECURITY.md lists the least heaps. The bytes of a file that `file` inflates and the central directory of an
 * archive are outside the heap, so those readings have also a bound on the resident memory they raise, `riseMiB`, which is the
 * budget of 256 MiB.
 */
const READINGS: readonly {
  readonly title: string;
  readonly name: ReadingName;
  readonly heapMiB: number;
  readonly riseMiB?: number;
  readonly outcome: string;
}[] = [
  {
    title: "reads a document of the most nodes, the limit, into a tree",
    name: "xmlNodes",
    heapMiB: 112,
    outcome: "299999 children",
  },
  {
    title: "stops the tree of a document of eight times the limit of nodes at the limit",
    name: "xmlOverNodes",
    heapMiB: 128,
    outcome: "SecurityError maxNodes",
  },
  {
    title: "reads a document of the most bytes whose elements have 256 attributes each",
    name: "xmlAttributes",
    heapMiB: 192,
    outcome: "5399 elements",
  },
  { title: "reads one text of the most bytes", name: "xmlText", heapMiB: 32, outcome: "1 node" },
  {
    title: "reads an item of the most nodes into its model",
    name: "itemNodes",
    heapMiB: 208,
    outcome: "item",
  },
  {
    title: "reads an item of the most nodes whose elements carry as many attributes as the limit of bytes allows",
    name: "itemAttributes",
    heapMiB: 400,
    outcome: "item",
  },
  {
    title: "reads an item whose choice interaction has as many choices as the limits hold",
    name: "itemChoices",
    heapMiB: 288,
    outcome: "item",
  },
  {
    title: "reads a test whose section has as many item references as the limits hold",
    name: "testReferences",
    heapMiB: 272,
    outcome: "test",
  },
  {
    title: "reads a manifest with as many resources as the limits hold",
    name: "manifestResources",
    heapMiB: 400,
    outcome: "184798 resources",
  },
  {
    title: "reads a results report with as many item results as the limits hold",
    name: "resultsItems",
    heapMiB: 288,
    outcome: "50709 item results",
  },
  {
    title: "reads the JSON of a result of the most size its limit allows, in one variable of as many values as fit",
    name: "resultsJson",
    heapMiB: 272,
    outcome: "1048551 values",
  },
  {
    title: "reads usage data with as many statistics as the limits hold",
    name: "usageStatistics",
    heapMiB: 256,
    outcome: "68679 statistics",
  },
  {
    title:
      "validates an item that is wrong at every node, and keeps the findings of the limit and one that says it stopped",
    name: "validateFindings",
    heapMiB: 240,
    outcome: "1001 issues, the last assesskit/validate/findings-stopped",
  },
  {
    title: "reads the directory of a package of 100,000 entries, the limit",
    name: "packageEntries",
    heapMiB: 64,
    outcome: "100000 files",
  },
  {
    title: "reads a package whose manifest of the most bytes is deflated at the ratio the limit allows",
    name: "packageManifest",
    heapMiB: 400,
    outcome: "184798 resources",
  },
  {
    title: "inflates a file of the most bytes an entry may hold, deflated at the ratio the limit allows",
    name: "packageEntry",
    heapMiB: 32,
    riseMiB: 256,
    outcome: "67108864 bytes",
  },
  {
    title:
      "reads a package in a ZIP file as long as a file may be, of 100,000 entries, by ranges, and inflates the file of the most bytes an entry may hold",
    name: "packageFile",
    heapMiB: 64,
    riseMiB: 256,
    outcome: "100000 files, 67108864 bytes",
  },
  {
    title: "reads a ZIP file whose central directory is the longest that its 100,000 entries allow",
    name: "packageDirectory",
    heapMiB: 160,
    riseMiB: 256,
    outcome: "100000 files, 0 bytes",
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
    title: "scores an expression and a response of the most characters, sums of 1,000 terms, at 24 points",
    name: "operatorExpression",
    heapMiB: 32,
    outcome: '{"cardinality":"single","baseType":"float","value":1}',
  },
  {
    title: "matches the most words of a text response to the most answers of a key",
    name: "operatorText",
    heapMiB: 48,
    outcome: '{"cardinality":"single","baseType":"float","value":1}',
  },
  {
    title: "matches the most points of a hotspot response to the most areas of a key, every point in every area",
    name: "operatorHotspot",
    heapMiB: 48,
    outcome: '{"cardinality":"single","baseType":"float","value":1}',
  },
  {
    title: "compiles the keys of the most responses, each an order of the most choices scored per position",
    name: "compileKeys",
    heapMiB: 112,
    outcome: "64129 rules",
  },
  {
    title: "reads a GIFT file of questions of the most answers, whose items hold the most elements",
    name: "giftAnswers",
    heapMiB: 144,
    outcome: "813 items",
  },
  {
    title: "reads a GIFT file of questions of two answers, whose items hold the most elements",
    name: "giftQuestions",
    heapMiB: 96,
    outcome: "4000 items",
  },
  {
    title: "stops a GIFT file of twice the questions that the limit of elements holds at the limit",
    name: "giftOverNodes",
    heapMiB: 96,
    outcome: "SecurityError maxNodes",
  },
  {
    title: "reads a GIFT file of essays whose HTML holds the most tags of a text, to the limit of elements",
    name: "giftTags",
    heapMiB: 96,
    outcome: "47 items",
  },
  {
    title: "checks the most lines of worked steps, each of the most characters",
    name: "mathSteps",
    heapMiB: 64,
    outcome: "199 equivalent",
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
  for (const { title, name, heapMiB, riseMiB, outcome } of READINGS) {
    it(title, async ({ annotate }) => {
      const result = await readInProcess(bundle, name, heapMiB);
      await annotate(`${name}: ${risen(result.rise)} The heap holds ${heapMiB} MiB.`);
      expect(result.outcome).toBe(outcome);
      if (riseMiB !== undefined) expect(result.rise).toBeLessThanOrEqual(riseMiB * MIB);
    });
  }

  it("has a case for every reading but the control", async () => {
    const names = await readingNames(bundle);
    expect(names.filter((name) => name !== CONTROL).sort()).toEqual(READINGS.map(({ name }) => name).sort());
  });
});

describe("the heap of a reading", () => {
  it("fails a reading that keeps more alive than the heap holds", async () => {
    await expect(readInProcess(bundle, "manifestResources", 64)).rejects.toThrow("did not end within a heap of 64 MiB");
  });

  it("runs out on a settings action read without the limit of a list, which the limit spares", async () => {
    await expect(readInProcess(bundle, CONTROL, 48)).rejects.toThrow("did not end within a heap of 48 MiB");
  });
});
