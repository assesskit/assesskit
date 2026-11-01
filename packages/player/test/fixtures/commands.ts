import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type {} from "@vitest/browser-playwright";
import type { Frame, Page } from "playwright";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

/** An accessibility violation that axe found in a frame: the rule and the markup of each node. */
export interface FrameViolation {
  readonly id: string;
  readonly nodes: readonly string[];
}

/** What the document of a frame has of the player's presentation: the attributes of its `html` and the colors that apply. */
export interface FrameTheme {
  /** The attributes of the `html` element, by name. */
  readonly attributes: Readonly<Record<string, string>>;
  /** The custom properties `--ak-fg` and `--ak-bg`, as the stylesheet resolves them. */
  readonly properties: Readonly<Record<string, string>>;
  /** The computed `color` and `font-size` of the body. */
  readonly color: string;
  readonly fontSize: string;
}

/** An XML or CSS file of the 1EdTech examples: its path below the examples, and its text. */
export interface CorpusFile {
  readonly path: string;
  readonly text: string;
}

declare module "vitest/browser" {
  interface BrowserCommands {
    corpusFiles: () => Promise<readonly CorpusFile[]>;
    axeInFrame: (title: string, tags: readonly string[]) => Promise<readonly FrameViolation[]>;
    ariaSnapshot: () => Promise<string>;
    clickInFrame: (title: string, selector: string) => Promise<void>;
    frameTheme: (title: string) => Promise<FrameTheme>;
    watchConsole: () => Promise<void>;
    consoleErrors: () => Promise<readonly string[]>;
    throttleCpu: (rate: number) => Promise<void>;
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

/** Reads the presentation that applies in the frame of an interaction, which the test page cannot read: its origin is opaque. */
const frameTheme: BrowserCommand<[title: string], FrameTheme> = async (context, title) => {
  const frame = await frameTitled(context, title);
  return frame.evaluate(`(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      attributes: Object.fromEntries([...document.documentElement.attributes].map(({ name, value }) => [name, value])),
      properties: { "--ak-fg": style.getPropertyValue("--ak-fg").trim(), "--ak-bg": style.getPropertyValue("--ak-bg").trim() },
      color: getComputedStyle(document.body).color,
      fontSize: getComputedStyle(document.body).fontSize,
    };
  })()`);
};

/** Returns the accessibility tree of the test page, frames included, as Playwright writes it. */
const ariaSnapshot: BrowserCommand<[], string> = async (context) => {
  const tester = await context.frame();
  return tester.locator("body").ariaSnapshot({ mode: "ai" });
};

/** The errors that each page logged to its console since a test began to watch it. */
const consoleErrorsOf = new WeakMap<Page, string[]>();

/** Starts to collect the errors that the page and its frames log to the console, such as a resource that a policy refused. */
const watchConsole: BrowserCommand<[], void> = (context) => {
  const errors: string[] = [];
  consoleErrorsOf.set(context.page, errors);
  context.page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} (${message.location().url})`);
  });
};

/** Returns the errors that the page logged since `watchConsole`. */
const consoleErrors: BrowserCommand<[], readonly string[]> = (context) => consoleErrorsOf.get(context.page) ?? [];

/**
 * Slows the CPU of the page by a factor through the DevTools protocol of Chromium, so that a timing stands for a phone and
 * not for the machine of the run. A rate of 1 is full speed.
 */
const throttleCpu: BrowserCommand<[number], void> = async (context, rate) => {
  const session = await context.context.newCDPSession(context.page);
  await session.send("Emulation.setCPUThrottlingRate", { rate });
};

/** Returns the XML and CSS files of the 1EdTech examples, which a browser test cannot read: the page has no file system. */
const corpusFiles: BrowserCommand<[], readonly CorpusFile[]> = () => {
  const root = resolve(import.meta.dirname, "../../../..");
  const examples = join(root, ".cache/corpus/qti-examples/qtiv3-examples");
  if (!existsSync(examples)) throw new Error(`The corpus is not downloaded to ${examples}: run pnpm corpus first.`);
  return readdirSync(examples, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".xml") || path.endsWith(".css"))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(examples, path), "utf8") }));
};

/** The browser commands of the tests of the player. */
export const COMMANDS = {
  axeInFrame,
  ariaSnapshot,
  clickInFrame,
  frameTheme,
  watchConsole,
  consoleErrors,
  corpusFiles,
  throttleCpu,
};
