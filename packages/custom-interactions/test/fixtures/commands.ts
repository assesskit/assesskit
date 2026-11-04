import type {} from "@vitest/browser-playwright";
import type { Frame } from "playwright";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

declare module "vitest/browser" {
  interface BrowserCommands {
    keysInFrame: (title: string, selector: string, keys: readonly string[], press?: boolean) => Promise<void>;
    pressInFrame: (title: string, selector: string) => Promise<void>;
    readInFrame: (title: string, script: string) => Promise<unknown>;
    drawInFrame: (title: string, selector: string, strokes: readonly (readonly (readonly [number, number])[])[]) => Promise<void>;
  }
}

/** Finds the frame of an interaction by the title of its document, which the test page cannot read: its origin is opaque. */
async function frameTitled(context: BrowserCommandContext, title: string): Promise<Frame> {
  const tester = await context.frame();
  for (const frame of tester.childFrames()) {
    if ((await frame.title()) === title) return frame;
  }
  throw new Error(`The test page has no frame titled ${JSON.stringify(title)}.`);
}

/** The longest that a command waits for an element of a frame to take the focus, in milliseconds. */
const FOCUS_LIMIT_MS = 10_000;

/**
 * Waits until an element of a frame has the focus. The frame's policy refuses `eval`, which `waitForFunction` of a text
 * needs, so the command asks the frame again until it has, as Playwright evaluates outside the policy.
 */
async function waitForFocus(frame: Frame, selector: string): Promise<void> {
  const focused = `document.hasFocus() && document.activeElement?.matches(${JSON.stringify(selector)}) === true`;
  for (const started = Date.now(); !(await frame.evaluate(focused)); ) {
    if (Date.now() - started > FOCUS_LIMIT_MS) throw new Error(`${selector} did not take the focus.`);
    await new Promise((settle) => setTimeout(settle, 20));
  }
}

/** The names of the keys that Playwright presses, such as `ArrowRight`, `Enter` and `Shift+Tab`, against text to type. */
const KEY_NAME = /^(?:[A-Z][A-Za-z]+\+)*(?:[A-Z][A-Za-z0-9]+)$/;

/**
 * Presses an element in the frame of an interaction with the pointer, or with `press` false waits for it to have the focus,
 * then presses keys on the keyboard, as a candidate does: each entry is a key's name, such as `ArrowRight`, or text that is
 * typed a key at a time.
 */
const keysInFrame: BrowserCommand<
  [title: string, selector: string, keys: readonly string[], press?: boolean],
  void
> = async (context, title, selector, keys, press = true) => {
  const frame = await frameTitled(context, title);
  if (press) await frame.locator(selector).first().click();
  // MathLive gives its field the focus some milliseconds after the press: the keys wait for it, as a candidate's eyes do.
  await waitForFocus(frame, selector);
  for (const key of keys) {
    if (KEY_NAME.test(key)) await context.page.keyboard.press(key);
    else await context.page.keyboard.type(key);
  }
};

/** Presses an element in the frame of an interaction with the pointer: down and up, as a tap does. */
const pressInFrame: BrowserCommand<[title: string, selector: string], void> = async (context, title, selector) => {
  await (await frameTitled(context, title)).locator(selector).first().click();
};

/** Evaluates an expression in the frame of an interaction and returns its value, for what the test page cannot read. */
const readInFrame: BrowserCommand<[title: string, script: string], unknown> = async (context, title, script) =>
  (await frameTitled(context, title)).evaluate(script);

/**
 * Draws strokes with the pointer in the frame of an interaction, as a candidate's mouse does: each stroke is pressed at its
 * first point, moved through the others and lifted. The points are in the units of an SVG group in the frame, the one that
 * `selector` names, which the command maps to the page with the group's own transform.
 */
const drawInFrame: BrowserCommand<
  [title: string, selector: string, strokes: readonly (readonly (readonly [number, number])[])[]],
  void
> = async (context, title, selector, strokes) => {
  const frame = await frameTitled(context, title);
  const box = await (await frame.frameElement()).boundingBox();
  if (box === null) throw new Error(`The frame titled ${JSON.stringify(title)} is not shown.`);
  const toFrame = `(() => {
    const matrix = document.querySelector(${JSON.stringify(selector)}).getScreenCTM();
    return ${JSON.stringify(strokes)}.map((stroke) => stroke.map(([x, y]) => {
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return [point.x, point.y];
    }));
  })()`;
  const mapped: readonly (readonly [number, number])[][] = await frame.evaluate(toFrame);
  const { mouse } = context.page;
  for (const stroke of mapped) {
    const [first, ...rest] = stroke;
    if (first === undefined) continue;
    await mouse.move(box.x + first[0], box.y + first[1]);
    await mouse.down();
    for (const [x, y] of rest) await mouse.move(box.x + x, box.y + y, { steps: 4 });
    await mouse.up();
  }
};

/** The browser commands of the tests of the custom interactions. */
export const CUSTOM_INTERACTION_COMMANDS = { keysInFrame, pressInFrame, readInFrame, drawInFrame };
