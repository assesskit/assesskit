import { createRequire } from "node:module";
import type {} from "@vitest/browser-playwright";
import type { Frame } from "playwright";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

/** An accessibility violation that axe found in a frame: the rule and the markup of each node. */
export interface FrameViolation {
  readonly id: string;
  readonly nodes: readonly string[];
}

declare module "vitest/browser" {
  interface BrowserCommands {
    axeInFrame: (title: string, tags: readonly string[]) => Promise<readonly FrameViolation[]>;
    ariaSnapshot: () => Promise<string>;
    clickInFrame: (title: string, selector: string) => Promise<void>;
  }
}

const axe: { readonly source: string } = createRequire(import.meta.url)("axe-core");

/** Finds the frame of an interaction by the title of its document, which the test page cannot read: its origin is opaque. */
async function frameTitled(context: BrowserCommandContext, title: string): Promise<Frame> {
  const tester = await context.frame();
  for (const frame of tester.childFrames()) {
    if ((await frame.title()) === title) return frame;
  }
  throw new Error(`The test page has no frame titled ${JSON.stringify(title)}.`);
}

/**
 * Runs axe-core inside the frame of an interaction. The frame's policy forbids scripts from elsewhere, and Playwright
 * evaluates in the frame without the policy.
 */
const axeInFrame: BrowserCommand<[title: string, tags: readonly string[]], readonly FrameViolation[]> = async (
  context,
  title,
  tags,
) => {
  const frame = await frameTitled(context, title);
  await frame.evaluate(axe.source);
  const options = JSON.stringify({ runOnly: { type: "tag", values: tags } });
  return frame.evaluate(
    `axe.run(document, ${options}).then((results) => results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.html) })))`,
  );
};

/** Clicks an element inside the frame of an interaction with the pointer, as a candidate does. */
const clickInFrame: BrowserCommand<[title: string, selector: string], void> = async (context, title, selector) => {
  await (await frameTitled(context, title)).locator(selector).click();
};

/** Returns the accessibility tree of the test page, frames included, as Playwright writes it. */
const ariaSnapshot: BrowserCommand<[], string> = async (context) => {
  const tester = await context.frame();
  return tester.locator("body").ariaSnapshot({ mode: "ai" });
};

/** The browser commands of the tests of tempuh. */
export const COMMANDS = { axeInFrame, ariaSnapshot, clickInFrame };
