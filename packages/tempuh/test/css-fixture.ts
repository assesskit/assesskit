import { afterEach } from "vitest";
import playerCss from "../player.css?inline";

/** The text of `player.css`. */
export const PLAYER_CSS = playerCss;

/** A content root: a host element whose shadow root has adopted `player.css`, as the player makes it. */
export interface ContentRoot {
  /** The host, in the page. */
  readonly host: HTMLElement;
  /** Its open shadow root, which holds the markup. */
  readonly root: ShadowRoot;
  /** Returns the first element of the markup that matches, and throws when none does. */
  find<T extends Element = HTMLElement>(selector: string): T;
  /** Returns every element of the markup that matches. */
  findAll<T extends Element = HTMLElement>(selector: string): T[];
}

const hosts: HTMLElement[] = [];

// WebKit applies a viewport change to the media queries of an adopted sheet only for the roots that hold it at the time,
// so a root that a test mounts after a resize would lay out for the old width. One root keeps the sheet for the whole run.
const keeper = document.createElement("div");
keeper.attachShadow({ mode: "open" }).adoptedStyleSheets = [stylesheet(playerCss)];
document.body.append(keeper);

/**
 * Mounts markup in a content root. The markup is a test fixture, which the tests write, so `innerHTML` is safe here.
 *
 * @param html - The markup of the root.
 * @param attributes - Attributes of the host, such as the PNP presentation attributes.
 * @param properties - Custom properties that the player sets on the host.
 * @param extraSheets - Further stylesheets that the root adopts after `player.css`, such as an item's.
 */
export function mount(
  html: string,
  attributes: Readonly<Record<string, string>> = {},
  properties: Readonly<Record<string, string>> = {},
  extraSheets: readonly CSSStyleSheet[] = [],
): ContentRoot {
  const host = document.createElement("div");
  for (const [name, value] of Object.entries(attributes)) host.setAttribute(name, value);
  for (const [name, value] of Object.entries(properties)) host.style.setProperty(name, value);
  const root = host.attachShadow({ mode: "open" });
  // A sheet of its own for each root: WebKit keeps the media queries of a sheet that no root has adopted as they were.
  root.adoptedStyleSheets = [stylesheet(playerCss), ...extraSheets];
  root.innerHTML = html;
  document.body.append(host);
  hosts.push(host);
  const find = <T extends Element>(selector: string): T => {
    const found = root.querySelector<T>(selector);
    if (found === null) throw new Error(`The fixture has no element that matches ${selector}.`);
    return found;
  };
  return {
    host,
    root,
    find,
    findAll: <T extends Element>(selector: string) => [...root.querySelectorAll<T>(selector)],
  };
}

/** Returns the item at an index, and throws when there is none, so that a fixture that lacks an element fails by name. */
export function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`The fixture has ${items.length} elements, not ${index + 1}.`);
  return item;
}

/** Builds a stylesheet from text. */
export function stylesheet(text: string): CSSStyleSheet {
  const result = new CSSStyleSheet();
  result.replaceSync(text);
  return result;
}

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** Returns a computed property of an element, or of one of its pseudo-elements. */
export function computed(element: Element, property: string, pseudo?: string): string {
  return getComputedStyle(element, pseudo).getPropertyValue(property);
}

/** The red, green, blue and alpha channels of a color, each from 0 to 255. */
export type Channels = readonly [number, number, number, number];

const canvas = document.createElement("canvas");
canvas.width = 1;
canvas.height = 1;
const context = canvas.getContext("2d", { willReadFrequently: true });

/** Returns the channels of any color that the engine parses, such as the result of `color-mix()`. */
export function channels(color: string): Channels {
  if (context === null) throw new Error("The engine has no 2D canvas.");
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue, alpha];
}

/** Returns the relative luminance of a color (WCAG 2.2, 1.4.3). */
function luminance(color: string): number {
  const [red, green, blue] = channels(color).map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
}

/** Returns the contrast ratio of two colors (WCAG 2.2, 1.4.3). */
export function contrast(first: string, second: string): number {
  const [light = 0, dark = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
