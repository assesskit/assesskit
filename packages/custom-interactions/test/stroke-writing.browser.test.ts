import { buildRecord, buildSingle, type Value } from "@assesskit/runtime/values";
import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import type {} from "../../player/test/fixtures/commands.js";
import { waitFor } from "../../player/test/wait.js";
import {
  focusOn,
  hitsOf,
  inFrame,
  type Mounted,
  mount,
  ready,
  responseOf,
  scoreOf,
  stateOf,
  surround,
  tabOut,
  tabTo,
} from "./fixtures/frame.js";
import { writeStrokeWritingItem } from "./fixtures/items.js";

/** The WCAG levels that axe checks, as the player's tests check them. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

/** The group of the drawing whose units are those of the character's data: a box of 1024 whose y axis points up. */
const CHARACTER_GROUP = ".stroke-writing-area svg > g";

/**
 * The medians of 十 in hanzi-writer-data 2.0.1, `test/fixtures/hanzi-writer-data/5341.json`: the horizontal stroke left to
 * right, then the vertical stroke top to bottom.
 */
const HORIZONTAL: readonly (readonly [number, number])[] = [
  [109, 442],
  [177, 422],
  [373, 456],
  [819, 505],
  [869, 499],
  [932, 476],
];
const VERTICAL: readonly (readonly [number, number])[] = [
  [456, 811],
  [484, 803],
  [522, 767],
  [512, 593],
  [507, -33],
];

/** A stroke drawn the wrong way: from its end to its start. */
const backwards = (stroke: readonly (readonly [number, number])[]) => [...stroke].reverse();

/** The record response of a quiz. */
const progress = (strokes: number, mistakes: number): Value | null =>
  buildRecord([
    ["strokes", buildSingle("integer", strokes)],
    ["mistakes", buildSingle("integer", mistakes)],
  ]);

const score = (value: number) => ({ cardinality: "single", baseType: "float", value });

/** Mounts the item of 十 and waits until Hanzi Writer has drawn the character's group. */
async function mountCharacter(title: string, options: Parameters<typeof mount>[1] | object = {}): Promise<Mounted> {
  const mounted = mount(writeStrokeWritingItem(title), { title, ...options });
  await ready(mounted);
  await waitFor(async () =>
    expect(await commands.readInFrame(title, `document.querySelectorAll("${CHARACTER_GROUP}").length`)).toBe(1),
  );
  return mounted;
}

describe("stroke writing with a pointer", () => {
  it("counts the strokes of a character written in order, and response processing scores it 1", async () => {
    const title = "Write 十.";
    const mounted = await mountCharacter(title);
    await commands.drawInFrame(title, CHARACTER_GROUP, [HORIZONTAL]);
    await waitFor(async () => expect(await responseOf(mounted)).toEqual(progress(1, 0)));
    await commands.drawInFrame(title, CHARACTER_GROUP, [VERTICAL]);
    await waitFor(async () => expect(await responseOf(mounted)).toEqual(progress(2, 0)));
    expect(scoreOf(writeStrokeWritingItem(title), (await responseOf(mounted)) ?? null)).toEqual(score(1));
  });

  it("counts a stroke drawn backwards or out of order as a mistake, and response processing scores it 0.5", async () => {
    const title = "Write 十 again.";
    const mounted = await mountCharacter(title);
    await commands.drawInFrame(title, CHARACTER_GROUP, [backwards(HORIZONTAL)]);
    await waitFor(async () => expect(await responseOf(mounted)).toEqual(progress(0, 1)));
    await commands.drawInFrame(title, CHARACTER_GROUP, [VERTICAL]);
    await waitFor(async () => expect(await responseOf(mounted)).toEqual(progress(0, 2)));
    await commands.drawInFrame(title, CHARACTER_GROUP, [HORIZONTAL, VERTICAL]);
    await waitFor(async () => expect(await responseOf(mounted)).toEqual(progress(2, 2)));
    expect(scoreOf(writeStrokeWritingItem(title), (await responseOf(mounted)) ?? null)).toEqual(score(0.5));
  });

  it("gives NULL before the first stroke, which response processing scores 0", async () => {
    const title = "Write nothing.";
    const mounted = await mountCharacter(title);
    expect(await responseOf(mounted)).toBeNull();
    expect(scoreOf(writeStrokeWritingItem(title), null)).toEqual(score(0));
  });
});

describe("state and status", () => {
  it("resumes a quiz at the stroke of its state, with the mistakes made before", async () => {
    const title = "Resume 十.";
    const mounted = await mountCharacter(title, { state: '{"strokes":1,"mistakes":1}' });
    await commands.drawInFrame(title, CHARACTER_GROUP, [VERTICAL]);
    await waitFor(async () => expect(await responseOf(mounted)).toEqual(progress(2, 1)));
    expect(await stateOf(mounted)).toBe('{"strokes":2,"mistakes":1}');
  });

  it("shows the character and takes no stroke in review, though a stroke is left to write", async () => {
    const title = "Review 十.";
    const mounted = await mountCharacter(title, { status: "review", value: progress(1, 0) });
    await commands.drawInFrame(title, CHARACTER_GROUP, [VERTICAL]);
    expect(await responseOf(mounted)).toEqual(progress(1, 0));
    expect(
      await commands.readInFrame(title, `document.querySelector(".stroke-writing-area").getAttribute("aria-label")`),
    ).toBe(title);
  });

  it("refuses a property that is not valid, and starts no interaction", async () => {
    const title = "Bad size.";
    const mounted = mount(writeStrokeWritingItem(title, 'data-size="large"'), { title });
    await waitFor(() => expect(mounted.events).toContainEqual({ type: "failed", reason: "instance" }));
  });
});

describe("the frame", () => {
  it("loads the module and the character from the package, and nothing else", async () => {
    await commands.watchConsole();
    const title = "Load 十.";
    const mounted = await mountCharacter(title);
    expect(await hitsOf(mounted)).toEqual(["/modules/stroke-writing.js", "/modules/characters/5341.js"]);
    expect((await commands.consoleErrors()).filter((error) => !error.includes("data:text/javascript,0"))).toEqual([]);
  });

  it("names the drawing by the prompt, and axe finds no violation of WCAG 2.2 AA", async () => {
    const title = "Name 十.";
    await mountCharacter(title);
    expect(
      await commands.readInFrame(title, `document.querySelector(".stroke-writing-area").getAttribute("aria-label")`),
    ).toBe(title);
    expect(await commands.axeInFrame(title, WCAG_TAGS)).toEqual([]);
  });

  it("holds no keyboard: Tab and Shift+Tab pass the frame, which has nothing to focus", async () => {
    const title = "Pass 十.";
    const mounted = await mountCharacter(title);
    const { before, after } = surround();
    await focusOn(before);
    await tabTo(inFrame(mounted));
    await tabOut(mounted, after);
    await tabTo(inFrame(mounted), true);
    await tabOut(mounted, before, true);
  });
});
