import type { SupportView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { CalculatorType, SupportName, SupportState } from "@assesskit/runtime/pnp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import { EN_MESSAGES, type Messages } from "../src/messages/index.js";
import {
  mountTools,
  type ToolOptions,
  type ToolSlots,
  type ToolSupportName,
  type Tools,
  type ToolsInput,
} from "../src/player/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { supportView } from "./supports-fixture.js";
import {
  calculatorXml,
  companion,
  digitalXml,
  type Materials,
  PROTRACTOR_DESCRIPTION,
  PROTRACTOR_XML,
  protractorXml,
  RULE_DESCRIPTION,
  RULE_XML,
  ruleXml,
} from "./tools-fixture.js";
import { waitFor } from "./wait.js";

// --- Fixtures ----------------------------------------------------------------------------------------------------

/** What a test says of a tool support: the settings the tools read are given as fields. */
interface ToolSupportFields {
  readonly state?: SupportState;
  readonly active?: boolean;
  readonly highlightColor?: string;
  readonly calculatorType?: CalculatorType;
}

const support = (
  name: ToolSupportName,
  { highlightColor, calculatorType, ...fields }: ToolSupportFields = {},
): SupportView => {
  if (name === "line-reader" && highlightColor !== undefined) {
    return supportView(name, { ...fields, settings: { name, replaceAccessModes: [], highlightColor } });
  }
  if (name === "calculator-on-screen" && calculatorType !== undefined) {
    return supportView(name, { ...fields, settings: { name, calculatorType } });
  }
  return supportView(name, fields);
};

/** An input with only companion materials. */
const items = (materials: Materials): ToolsInput => ({
  companion: companion(materials),
  supports: [],
});

/** An input with only supports. */
const profile = (...supports: SupportView[]): ToolsInput => ({ companion: null, supports });

/**
 * The content of a stage: three lines of text of 24 pixels each, a choice interaction, and two controls where the rule
 * and the protractor open: the rule over the corner one and the protractor over the middle one.
 */
const CONTENT = `
  <p class="passage" style="margin: 0; white-space: pre-line; line-height: 24px;">First line of the passage
Second line of the passage
Third line of the passage</p>
  <qti-choice-interaction response-identifier="RESPONSE" style="display: block;">
    <qti-prompt><p style="margin: 0;">Which line is the second?</p></qti-prompt>
    <qti-simple-choice><label><input type="radio" name="answer" value="A"> Alpha</label></qti-simple-choice>
    <qti-simple-choice><label><input type="radio" name="answer" value="B"> Beta</label></qti-simple-choice>
  </qti-choice-interaction>
  <button type="button" class="corner" style="position: absolute; left: 12px; top: 30px; width: 80px; height: 30px;">Corner</button>
  <button type="button" class="middle" style="position: absolute; left: 150px; top: 120px; width: 80px; height: 30px;">Middle</button>`;

// --- The scene ---------------------------------------------------------------------------------------------------

interface Scene {
  /** Holds the toolbar and the tray, in the document. */
  readonly host: HTMLElement;
  /** Holds the rendered item, in an open shadow root as the player has it. */
  readonly stage: HTMLElement;
  /** The control before the toolbar in the focus order. */
  readonly before: HTMLButtonElement;
  readonly tools: Tools;
  /** The requests of the tools to turn a tool of the profile on or off. */
  readonly requests: (readonly [SupportName, boolean])[];
  /** Shows the tools for an input. */
  show(input: ToolsInput): void;
}

interface SceneOptions {
  readonly messages?: Messages;
  /** Turns the path of a package file into a URL. Default: the path under `/package/`. */
  readonly assets?: (path: string) => string;
  readonly slots?: ToolSlots;
  /** Whether the session turns a tool of the profile on or off when it is asked to. Default: true. */
  readonly follow?: boolean;
  /** Whether the shadow root of the item adopts `player.css`, as a content root of the player does. Default: false. */
  readonly playerCss?: boolean;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Mounts the tools in a page as the player lays it out: the toolbar in the document, the item in a shadow root. */
function createScene({
  messages = EN_MESSAGES,
  assets = (path) => `/package/${path}`,
  slots = {},
  follow = true,
  playerCss = false,
}: SceneOptions = {}): Scene {
  const before = document.createElement("button");
  before.textContent = "Before";
  // The colors of the stage: the button of the page is the harness's, and its default colors are not a pair in every engine.
  before.style.cssText = "min-height: 44px; color: CanvasText; background: Canvas; border: 2px solid CanvasText;";
  const host = document.createElement("div");
  const container = document.createElement("div");
  const shadow = container.attachShadow({ mode: "open" });
  if (playerCss) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PLAYER_CSS);
    shadow.adoptedStyleSheets = [sheet];
  }
  const stage = document.createElement("div");
  stage.style.cssText =
    "position: relative; width: 360px; min-height: 500px; padding: 8px; font: 16px/24px sans-serif; color: CanvasText; background: Canvas;";
  stage.innerHTML = CONTENT;
  shadow.append(stage);
  document.body.append(before, host, container);
  const requests: (readonly [SupportName, boolean])[] = [];
  let input: ToolsInput = { companion: null, supports: [] };
  const tools = mountTools(host, {
    messages,
    language: "en",
    stage,
    assets,
    slots,
    onSupport: (name, active) => {
      requests.push([name, active]);
      if (!follow) return;
      input = { ...input, supports: input.supports.map((each) => (each.name === name ? { ...each, active } : each)) };
      tools.update(input);
    },
  });
  cleanups.push(() => {
    tools.destroy();
    for (const element of [before, host, container]) element.remove();
  });
  return {
    host,
    stage,
    before,
    tools,
    requests,
    show(next) {
      input = next;
      tools.update(next);
    },
  };
}

/** Replaces the item in the stage with the given markup, which leaves the layer of the tools where it is. */
function setContent(scene: Scene, markup: string): void {
  for (const child of [...scene.stage.children]) if (!child.classList.contains("ak-tool-layer")) child.remove();
  scene.stage.insertAdjacentHTML("afterbegin", markup);
}

/** Three lines of text of 24 pixels each, which the line reader follows. */
const THREE_LINES =
  '<p class="passage" style="margin: 0; white-space: pre-line; line-height: 24px;">one\ntwo\nthree</p>';

/** A tool of the host that builds a paragraph and takes it down by itself. */
function paragraphIn(host: HTMLElement): () => void {
  host.append(document.createElement("p"));
  return () => undefined;
}

/** Returns a value that must be there. */
function found<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`The page has no ${what}.`);
  return value;
}

/** Returns the button of the toolbar with the given name. */
function toolbarButton(scene: Scene, name: string): HTMLButtonElement {
  const buttons = [...scene.host.querySelectorAll<HTMLButtonElement>(".ak-tools > .ak-row > button")];
  return found(
    buttons.find((button) => button.textContent === name),
    `toolbar button ${name}`,
  );
}

const panelOf = (scene: Scene, title: string): HTMLElement | null =>
  scene.host.querySelector<HTMLElement>(`.ak-panel[aria-label="${title}"]`);

const overlayOf = (scene: Scene, title: string): HTMLElement | null =>
  scene.stage.querySelector<HTMLElement>(`.ak-placed[aria-label="${title}"]`);

/** Returns the control of a panel that has the given accessible name. */
function controlOf(panel: Element, name: string): HTMLElement {
  return found(panel.querySelector<HTMLElement>(`[aria-label="${name}"]`), `control ${name}`);
}

/** Returns the button of a panel with the given text. */
function buttonOf(panel: Element, text: string): HTMLButtonElement {
  return found(
    [...panel.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text),
    `button ${text}`,
  );
}

/** The focused element, looking through shadow roots. */
function focused(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Waits for the observers of the tools, which run before the next frame is drawn. */
const frame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** The place and angle that a placed tool has, read from its transform. */
function placementOf(tool: HTMLElement): { x: number; y: number; angle: number } {
  const match = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) rotate\((-?[\d.e-]+)deg\)/.exec(tool.style.transform);
  if (match === null) throw new Error(`The tool has no placement: ${tool.style.transform}`);
  return { x: Number(match[1]), y: Number(match[2]), angle: Number(match[3]) };
}

/** Whether none of the sampled points of an element shows it, which is how 2.4.11 finds an element hidden. */
function entirelyHidden(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const root = element.getRootNode();
  if (!(root instanceof Document || root instanceof ShadowRoot)) throw new Error("The element is not in a document.");
  const xs = [rect.left + 1, rect.left + rect.width / 2, rect.right - 1];
  const ys = [rect.top + 1, rect.top + rect.height / 2, rect.bottom - 1];
  return !xs.some((x) =>
    ys.some((y) => {
      const hit = root.elementFromPoint(x, y);
      return hit !== null && element.contains(hit);
    }),
  );
}

/** Reads a computed color as red, green and blue from 0 to 255 and the alpha from 0 to 1, in either of the forms that engines give. */
function rgbaOf(color: string): [number, number, number, number] {
  const numbers = (color.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
  const [first = 0, second = 0, third = 0, alpha = 1] =
    numbers.length === 3 && color.startsWith("color(") ? [...numbers] : numbers;
  if (color.startsWith("color(")) {
    const [r = 0, g = 0, b = 0] = numbers;
    return [r * 255, g * 255, b * 255, numbers[3] ?? 1];
  }
  return [first, second, third, alpha];
}

/** The controls that a pointer presses: the buttons and fields of the toolbar and the tray, the masks and the placed tools. */
const targetsOf = (scene: Scene): Element[] => [
  ...scene.host.querySelectorAll("button, input"),
  ...scene.stage.querySelectorAll(".ak-mask button, .ak-placed"),
];

/** Whether a control is at least 24 by 24 CSS pixels, the least size of WCAG 2.5.8. */
function bigEnough(element: Element): boolean {
  const { width, height } = element.getBoundingClientRect();
  return width >= 24 && height >= 24;
}

/** The sizes of the controls that a pointer presses and that are too small, to read in a failure. */
function tooSmall(scene: Scene): string[] {
  return targetsOf(scene)
    .filter((element) => !bigEnough(element))
    .map((element) => `${element.tagName} ${element.getAttribute("aria-label") ?? element.textContent}`);
}

/** Runs axe over the page. */
const violations = (): Promise<string[]> => axeViolations(document.body);

describe("styles", () => {
  it("adopts its stylesheet into the roots of the toolbar and of the item, and gives it back", () => {
    const scene = createScene();
    const root = scene.stage.getRootNode();
    expect(root).toBeInstanceOf(ShadowRoot);
    const sheets = (node: Node): number =>
      node instanceof ShadowRoot || node instanceof Document ? node.adoptedStyleSheets.length : 0;
    expect([sheets(document), sheets(root)]).toEqual([1, 1]);
    scene.tools.destroy();
    expect([sheets(document), sheets(root)]).toEqual([0, 0]);
  });

  it("shares the stylesheet between two mounts and takes it away with the last", () => {
    const first = createScene();
    const second = createScene();
    expect(document.adoptedStyleSheets).toHaveLength(1);
    first.tools.destroy();
    expect(document.adoptedStyleSheets).toHaveLength(1);
    second.tools.destroy();
    expect(document.adoptedStyleSheets).toHaveLength(0);
  });
});

describe("the rule", () => {
  it("shows a button, a panel with the description of the item, and a rule over the item", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    const button = toolbarButton(scene, "Ruler");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(overlayOf(scene, "Ruler")).toBeNull();
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(found(panelOf(scene, "Ruler"), "panel").textContent).toContain(RULE_DESCRIPTION);
    const rule = found(overlayOf(scene, "Ruler"), "rule");
    expect(rule.getAttribute("role")).toBe("group");
    expect(rule.getBoundingClientRect().width).toBeCloseTo(376, 0);
  });

  it("numbers the major ticks in the unit of the major increment and names the unit", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    const rule = found(overlayOf(scene, "Ruler"), "rule");
    const numbers = [...rule.querySelectorAll("text")].map((text) => text.textContent);
    expect(numbers).toEqual([..."0123456789", "10", "m"].map(String));
    const paths = [...rule.querySelectorAll("path")];
    expect(paths).toHaveLength(1);
    expect(found(paths[0], "path").getAttribute("d")?.split("M").length).toBe(11 + 10 + 1);
  });

  it("draws a rule of eight centimeters at the size of eight CSS centimeters", async () => {
    const scene = createScene();
    scene.show(
      items({
        rules: [ruleXml("A rule", 8, ["1", "Centimeter"], ["1", "Millimeter"])],
      }),
    );
    await userEvent.click(toolbarButton(scene, "Ruler"));
    const probe = document.createElement("div");
    probe.style.cssText = "width: 8cm; height: 1px; position: absolute;";
    document.body.append(probe);
    const ruler = found(overlayOf(scene, "Ruler"), "rule");
    const drawn = ruler.getBoundingClientRect().width - 32;
    expect(drawn).toBeCloseTo(probe.getBoundingClientRect().width, 0);
    probe.remove();
  });

  it("is operated by keyboard: Enter on the button opens it, arrows move it and Page Down turns it", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.type(toolbarButton(scene, "Ruler"), "{Enter}");
    const rule = found(overlayOf(scene, "Ruler"), "rule");
    expect(focused()).toBe(rule);
    const start = placementOf(rule);
    await userEvent.keyboard("{ArrowRight}");
    expect(placementOf(rule)).toEqual({ ...start, x: start.x + 10 });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(placementOf(rule).y).toBe(start.y + 20);
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(placementOf(rule).x).toBe(start.x + 9);
    await userEvent.keyboard("{PageDown}");
    expect(placementOf(rule).angle).toBe(5);
    await userEvent.keyboard("{Shift>}{PageUp}{/Shift}");
    expect(placementOf(rule).angle).toBe(4);
    expect(found(panelOf(scene, "Ruler"), "panel").querySelector("input")?.value).toBe("4");
  });

  it("moves and turns with the buttons and the angle field of the panel, without a drag", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    const rule = found(overlayOf(scene, "Ruler"), "rule");
    const panel = found(panelOf(scene, "Ruler"), "panel");
    const start = placementOf(rule);
    await userEvent.click(controlOf(panel, "Move down"));
    await userEvent.click(controlOf(panel, "Move down"));
    await userEvent.click(controlOf(panel, "Move left"));
    expect(placementOf(rule)).toEqual({ ...start, x: start.x - 10, y: start.y + 20 });
    await userEvent.click(controlOf(panel, "Move up"));
    await userEvent.click(controlOf(panel, "Move right"));
    expect(placementOf(rule)).toEqual({ ...start, y: start.y + 10 });
    await userEvent.click(controlOf(panel, "Rotate clockwise"));
    await userEvent.click(controlOf(panel, "Rotate clockwise"));
    await userEvent.click(controlOf(panel, "Rotate counterclockwise"));
    expect(placementOf(rule).angle).toBe(5);
    await userEvent.fill(found(panel.querySelector("input"), "angle field"), "45");
    expect(placementOf(rule).angle).toBe(45);
    await userEvent.fill(found(panel.querySelector("input"), "angle field"), "190");
    expect(placementOf(rule).angle).toBe(-170);
  });

  it("moves by dragging the rule", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    const rule = found(overlayOf(scene, "Ruler"), "rule");
    const start = placementOf(rule);
    const from = rule.getBoundingClientRect();
    const target = document.createElement("div");
    target.style.cssText = `position: fixed; left: ${from.left + from.width / 2 - 70}px; top: ${from.top + from.height / 2 + 40}px; width: 20px; height: 20px;`;
    document.body.append(target);
    await userEvent.dragAndDrop(rule, target);
    const moved = placementOf(rule);
    expect(moved.x - start.x).toBeCloseTo(-60, -1);
    expect(moved.y - start.y).toBeCloseTo(50, -1);
    target.remove();
  });

  it("moves out of the way of an element that takes the focus and that it would hide", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    const corner = found(scene.stage.querySelector<HTMLElement>(".corner"), "corner control");
    expect(entirelyHidden(corner)).toBe(true);
    corner.focus();
    expect(focused()).toBe(corner);
    expect(entirelyHidden(corner)).toBe(false);
    const rule = found(overlayOf(scene, "Ruler"), "rule").getBoundingClientRect();
    const layer = found(scene.stage.querySelector(".ak-tool-layer"), "layer").getBoundingClientRect();
    expect(rule.top).toBeGreaterThanOrEqual(layer.top);
    expect(rule.bottom).toBeLessThanOrEqual(layer.bottom + 1);
  });

  it("has controls of at least 24 by 24 CSS pixels", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    expect(targetsOf(scene).length).toBeGreaterThan(8);
    expect(tooSmall(scene)).toEqual([]);
  });

  it("passes axe at WCAG 2.2 A and AA", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    expect(await violations()).toEqual([]);
  });

  it("closes with the button of its panel and gives the focus back to the toolbar", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    await userEvent.click(controlOf(found(panelOf(scene, "Ruler"), "panel"), "Close Ruler"));
    expect(overlayOf(scene, "Ruler")).toBeNull();
    expect(panelOf(scene, "Ruler")).toBeNull();
    expect(focused()).toBe(toolbarButton(scene, "Ruler"));
    expect(toolbarButton(scene, "Ruler").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the protractor", () => {
  it("shows the description of the item and a protractor of the size that the item has room for", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    expect(found(panelOf(scene, "Protractor"), "panel").textContent).toContain(PROTRACTOR_DESCRIPTION);
    const protractor = found(overlayOf(scene, "Protractor"), "protractor");
    expect(protractor.getBoundingClientRect().width).toBeCloseTo(2 * 172 + 32, 0);
    expect(getComputedStyle(protractor).transformOrigin).toBe("188px 188px");
  });

  it("draws a tick for each degree and for each five, and numbers every third major tick on both rings", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    const protractor = found(overlayOf(scene, "Protractor"), "protractor");
    const ticks = found(protractor.querySelector(".ak-ticks"), "ticks").getAttribute("d") ?? "";
    // The base line and the two strokes of the center mark, then the 37 major and the 144 minor ticks.
    expect(ticks.split("M").length - 1).toBe(3 + 37 + 144);
    const numbers = [...protractor.querySelectorAll("text")].map((text) => text.textContent);
    const every15 = Array.from({ length: 13 }, (_, index) => String(index * 15));
    expect(numbers.filter((text) => text !== "°").sort()).toEqual([...every15, ...every15].sort());
    expect(numbers).toContain("°");
  });

  it("measures in radians when the item says so", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [protractorXml("Radians", ["0.5", "Radian"], undefined, "si")] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    const numbers = [...found(overlayOf(scene, "Protractor"), "protractor").querySelectorAll("text")].map(
      (text) => text.textContent,
    );
    expect(numbers).toContain("rad");
    expect(numbers).toContain("0.5");
    expect(numbers).toContain("3");
  });

  it("is operated by keyboard: the arrows move it and the Page keys turn it about the base line", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.type(toolbarButton(scene, "Protractor"), "{Enter}");
    const protractor = found(overlayOf(scene, "Protractor"), "protractor");
    expect(focused()).toBe(protractor);
    const start = placementOf(protractor);
    await userEvent.keyboard("{ArrowUp}{ArrowLeft}");
    expect(placementOf(protractor)).toEqual({ ...start, x: start.x - 10, y: start.y - 10 });
    await userEvent.keyboard("{PageDown}{PageDown}");
    expect(placementOf(protractor).angle).toBe(10);
    await userEvent.keyboard("{PageUp}");
    expect(placementOf(protractor).angle).toBe(5);
  });

  it("moves and turns with the buttons of its panel, without a drag", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    const protractor = found(overlayOf(scene, "Protractor"), "protractor");
    const panel = found(panelOf(scene, "Protractor"), "panel");
    const start = placementOf(protractor);
    await userEvent.click(controlOf(panel, "Move right"));
    await userEvent.click(controlOf(panel, "Move down"));
    await userEvent.click(controlOf(panel, "Rotate counterclockwise"));
    expect(placementOf(protractor)).toEqual({ x: start.x + 10, y: start.y + 10, angle: -5 });
  });

  it("moves out of the way of an element in its half circle that takes the focus", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    const middle = found(scene.stage.querySelector<HTMLElement>(".middle"), "middle control");
    expect(entirelyHidden(middle)).toBe(true);
    middle.focus();
    expect(entirelyHidden(middle)).toBe(false);
  });

  it("leaves an element outside the half circle reachable by the pointer, and does not move for it", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    const protractor = found(overlayOf(scene, "Protractor"), "protractor");
    const before = placementOf(protractor);
    const corner = found(scene.stage.querySelector<HTMLElement>(".corner"), "corner control");
    expect(entirelyHidden(corner)).toBe(false);
    corner.focus();
    expect(placementOf(protractor)).toEqual(before);
  });

  it("has controls of at least 24 by 24 CSS pixels", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    expect(tooSmall(scene)).toEqual([]);
  });

  it("passes axe at WCAG 2.2 A and AA", async () => {
    const scene = createScene();
    scene.show(items({ protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    expect(await violations()).toEqual([]);
  });
});

describe("the line reader", () => {
  const optional = (overrides: ToolSupportFields = {}): ToolsInput =>
    profile(support("line-reader", { state: "option", ...overrides }));

  it("asks to turn it on from the button, and follows the next input, not the request", async () => {
    const scene = createScene({ follow: false });
    scene.show(optional());
    const button = toolbarButton(scene, "Line reader");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(button);
    expect(scene.requests).toEqual([["line-reader", true]]);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(panelOf(scene, "Line reader")).toBeNull();
    scene.show(optional({ active: true }));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(found(panelOf(scene, "Line reader"), "panel")).toBeTruthy();
    expect(focused()).toBe(found(scene.stage.querySelector("[role=slider]"), "band"));
  });

  it("puts the band over the first line and moves it line by line with the arrows, Home and End", async () => {
    const scene = createScene();
    setContent(scene, THREE_LINES);
    scene.show(optional({ active: true }));
    const band = found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band");
    const passage = found(scene.stage.querySelector(".passage"), "passage").getBoundingClientRect();
    const lineOf = (): number =>
      Math.floor((band.getBoundingClientRect().top + band.getBoundingClientRect().height / 2 - passage.top) / 24);
    expect([lineOf(), band.getAttribute("aria-valuenow"), band.getAttribute("aria-valuemax")]).toEqual([0, "1", "3"]);
    await userEvent.type(band, "{ArrowDown}");
    expect([lineOf(), band.getAttribute("aria-valuetext")]).toEqual([1, "Line 2 of 3"]);
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect([lineOf(), band.getAttribute("aria-valuenow")]).toEqual([2, "3"]);
    await userEvent.keyboard("{ArrowUp}");
    expect(lineOf()).toBe(1);
    await userEvent.keyboard("{Home}");
    expect(lineOf()).toBe(0);
    await userEvent.keyboard("{End}");
    expect(lineOf()).toBe(2);
  });

  it("moves with the buttons of its panel, without a drag", async () => {
    const scene = createScene();
    setContent(scene, THREE_LINES);
    scene.show(optional({ active: true }));
    const band = found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band");
    const panel = found(panelOf(scene, "Line reader"), "panel");
    await userEvent.click(buttonOf(panel, "Next line"));
    await userEvent.click(buttonOf(panel, "Next line"));
    expect(band.getAttribute("aria-valuenow")).toBe("3");
    await userEvent.click(buttonOf(panel, "Next line"));
    expect(band.getAttribute("aria-valuenow")).toBe("3");
    await userEvent.click(buttonOf(panel, "Previous line"));
    expect(band.getAttribute("aria-valuenow")).toBe("2");
  });

  it("gives the band the color of the profile, with the text showing through", () => {
    const scene = createScene();
    setContent(scene, THREE_LINES);
    scene.show(optional({ active: true, highlightColor: "#336699" }));
    const band = found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band");
    const [red, green, blue, alpha] = rgbaOf(getComputedStyle(band).backgroundColor);
    expect([red, green, blue].map(Math.round)).toEqual([0x33, 0x66, 0x99]);
    expect(alpha).toBeCloseTo(0.4, 2);
    expect(getComputedStyle(band).pointerEvents).toBe("none");
  });

  it("has a color of its own when the profile gives none", () => {
    const scene = createScene();
    setContent(scene, THREE_LINES);
    scene.show(optional({ active: true }));
    const band = found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band");
    const [red, green, blue] = rgbaOf(getComputedStyle(band).backgroundColor);
    expect([red, green, blue].map(Math.round)).toEqual([0xff, 0xd4, 0x00]);
  });

  it("follows the text when it changes and when it wraps", async () => {
    const scene = createScene();
    setContent(scene, THREE_LINES);
    scene.show(optional({ active: true }));
    const band = found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band");
    scene.stage.querySelector(".passage")?.append(document.createTextNode("\nfour"));
    await frame();
    expect(band.getAttribute("aria-valuemax")).toBe("4");
    setContent(
      scene,
      '<p class="wrap" style="margin: 0; width: 600px; line-height: 24px;">alpha beta gamma delta epsilon</p>',
    );
    await frame();
    expect(band.getAttribute("aria-valuemax")).toBe("1");
    found(scene.stage.querySelector<HTMLElement>(".wrap"), "paragraph").style.width = "60px";
    await frame();
    expect(Number(band.getAttribute("aria-valuemax"))).toBeGreaterThan(3);
  });

  it("says that there is no text to follow, and has no band, for an item without text", async () => {
    const scene = createScene();
    setContent(scene, '<div style="height: 50px"></div>');
    scene.show(optional({ active: true }));
    expect(found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band").hidden).toBe(true);
    const panel = found(panelOf(scene, "Line reader"), "panel");
    expect(panel.textContent).toContain("There is no text to follow.");
    await userEvent.click(buttonOf(panel, "Next line"));
    expect(found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band").hidden).toBe(true);
  });

  it("is not offered when the profile prohibits it", () => {
    const scene = createScene();
    scene.show(profile(support("line-reader", { state: "prohibited", active: true })));
    expect(scene.host.querySelectorAll(".ak-tools > .ak-row > button")).toHaveLength(0);
    expect(scene.stage.querySelector("[role=slider]")).toBeNull();
  });

  it("is operated by keyboard: Enter on the button turns it on, the arrows move it, Enter on Close turns it off", async () => {
    const scene = createScene();
    setContent(scene, THREE_LINES);
    scene.show(optional());
    await userEvent.type(toolbarButton(scene, "Line reader"), "{Enter}");
    const band = found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band");
    expect(focused()).toBe(band);
    await userEvent.keyboard("{ArrowDown}");
    expect(band.getAttribute("aria-valuenow")).toBe("2");
    await userEvent.type(controlOf(found(panelOf(scene, "Line reader"), "panel"), "Close Line reader"), "{Enter}");
    expect(scene.requests).toEqual([
      ["line-reader", true],
      ["line-reader", false],
    ]);
    expect(scene.stage.querySelector("[role=slider]")).toBeNull();
    expect(focused()).toBe(toolbarButton(scene, "Line reader"));
  });

  it("hides no element: the text and the controls under it stay in view and reachable", () => {
    const scene = createScene();
    scene.show(optional({ active: true }));
    const corner = found(scene.stage.querySelector<HTMLElement>(".corner"), "corner control");
    const band = found(scene.stage.querySelector<HTMLElement>("[role=slider]"), "band");
    expect(band.getBoundingClientRect().height).toBeGreaterThan(0);
    corner.focus();
    expect(focused()).toBe(corner);
    expect(entirelyHidden(corner)).toBe(false);
    expect(rgbaOf(getComputedStyle(band).backgroundColor)[3]).toBeLessThan(1);
  });

  it("has controls of at least 24 by 24 CSS pixels", () => {
    const scene = createScene();
    scene.show(optional({ active: true }));
    expect(tooSmall(scene)).toEqual([]);
  });

  it("passes axe at WCAG 2.2 A and AA", async () => {
    const scene = createScene();
    scene.show(optional({ active: true }));
    expect(await violations()).toEqual([]);
  });
});

describe("answer masking", () => {
  const masking = (active: boolean): ToolsInput => profile(support("answer-masking", { state: "option", active }));
  const choices = (scene: Scene): HTMLElement[] => [...scene.stage.querySelectorAll<HTMLElement>("qti-simple-choice")];
  const isHidden = (element: HTMLElement): boolean => getComputedStyle(element).display === "none";

  it("hides the choices of a choice interaction, visually and to assistive technology, with a mask in their place", () => {
    const scene = createScene();
    scene.show(masking(true));
    expect(choices(scene)).toHaveLength(2);
    expect(choices(scene).every(isHidden)).toBe(true);
    const mask = found(scene.stage.querySelector<HTMLElement>(".ak-mask"), "mask");
    expect(mask.textContent).toContain("The answer choices are hidden.");
    expect(mask.querySelector("button")?.textContent).toBe("Show answer choices");
    expect(mask.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(getComputedStyle(found(scene.stage.querySelector("qti-prompt"), "prompt")).display).not.toBe("none");
    expect(mask.nextElementSibling).toBe(choices(scene)[0]);
  });

  it("gives focus to no hidden choice", () => {
    const scene = createScene();
    scene.show(masking(true));
    const input = found(scene.stage.querySelector<HTMLInputElement>("input"), "choice input");
    input.focus();
    expect(focused()).not.toBe(input);
  });

  it("takes the mask off at the candidate's choice, and puts it back", async () => {
    const scene = createScene();
    scene.show(masking(true));
    const button = found(scene.stage.querySelector<HTMLButtonElement>(".ak-mask button"), "mask button");
    await userEvent.click(button);
    expect(choices(scene).some(isHidden)).toBe(false);
    expect(button.textContent).toBe("Hide answer choices");
    expect(found(scene.stage.querySelector<HTMLElement>(".ak-mask-notice"), "notice").hidden).toBe(true);
    await userEvent.click(button);
    expect(choices(scene).every(isHidden)).toBe(true);
    expect(button.textContent).toBe("Show answer choices");
  });

  it("is operated by keyboard, and keeps the focus on the button that the candidate pressed", async () => {
    const scene = createScene();
    scene.show(masking(true));
    const button = found(scene.stage.querySelector<HTMLButtonElement>(".ak-mask button"), "mask button");
    await userEvent.type(button, "{Enter}");
    expect(choices(scene).some(isHidden)).toBe(false);
    expect(focused()).toBe(button);
    await userEvent.keyboard(" ");
    expect(choices(scene).every(isHidden)).toBe(true);
    expect(focused()).toBe(button);
  });

  it("is on at the start of the session for a candidate who has it, and off for one who has not", () => {
    const scene = createScene();
    scene.show(masking(false));
    expect(scene.stage.querySelector(".ak-mask")).toBeNull();
    expect(choices(scene).some(isHidden)).toBe(false);
    expect(scene.stage.querySelector("[data-ak-masked]")).toBeNull();
  });

  it("asks to turn masking on from the toolbar, and masks when the next input says it is on", async () => {
    const scene = createScene();
    scene.show(masking(false));
    const button = toolbarButton(scene, "Answer masking");
    await userEvent.click(button);
    expect(scene.requests).toEqual([["answer-masking", true]]);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(choices(scene).every(isHidden)).toBe(true);
    await userEvent.click(button);
    expect(scene.requests.at(-1)).toEqual(["answer-masking", false]);
    expect(scene.stage.querySelector(".ak-mask")).toBeNull();
    expect(scene.stage.querySelector("[data-ak-masked]")).toBeNull();
  });

  it("masks an interaction that the renderer adds, and the mask that the renderer removes comes back", async () => {
    const scene = createScene();
    scene.show(masking(true));
    scene.stage.insertAdjacentHTML(
      "afterbegin",
      "<qti-choice-interaction><qti-simple-choice>Gamma</qti-simple-choice><qti-simple-choice>Delta</qti-simple-choice></qti-choice-interaction>",
    );
    await frame();
    expect(scene.stage.querySelectorAll(".ak-mask")).toHaveLength(2);
    expect(choices(scene).every(isHidden)).toBe(true);
    scene.stage.querySelector(".ak-mask")?.remove();
    await frame();
    expect(scene.stage.querySelectorAll(".ak-mask")).toHaveLength(2);
  });

  it("leaves an interaction without choices alone", () => {
    const scene = createScene();
    setContent(scene, "<qti-choice-interaction><qti-prompt>Empty</qti-prompt></qti-choice-interaction>");
    scene.show(masking(true));
    expect(scene.stage.querySelector(".ak-mask")).toBeNull();
  });

  it("takes every mask away with the tool", () => {
    const scene = createScene();
    scene.show(masking(true));
    scene.tools.destroy();
    expect(scene.stage.querySelector(".ak-mask")).toBeNull();
    expect(scene.stage.querySelector("[data-ak-masked]")).toBeNull();
    expect(choices(scene).some(isHidden)).toBe(false);
  });

  it("leaves the button that shows the choices in view, since the choices cannot take focus", async () => {
    const scene = createScene();
    scene.show(masking(true));
    const button = found(scene.stage.querySelector<HTMLButtonElement>(".ak-mask button"), "mask button");
    button.focus();
    expect(focused()).toBe(button);
    expect(entirelyHidden(button)).toBe(false);
  });

  it("has controls of at least 24 by 24 CSS pixels", () => {
    const scene = createScene();
    scene.show(masking(true));
    expect(targetsOf(scene).length).toBeGreaterThan(1);
    expect(tooSmall(scene)).toEqual([]);
  });

  it("passes axe at WCAG 2.2 A and AA, masked and unmasked", async () => {
    const scene = createScene();
    scene.show(masking(true));
    expect(await violations()).toEqual([]);
    await userEvent.click(found(scene.stage.querySelector<HTMLButtonElement>(".ak-mask button"), "mask button"));
    expect(await violations()).toEqual([]);
  });
});

/** Returns the box in the page of a word of the text below an element, found with a range. */
function wordBox(scope: Element, word: string): DOMRect {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node instanceof Text; node = walker.nextNode()) {
    const at = node.data.indexOf(word);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + word.length);
    return range.getBoundingClientRect();
  }
  throw new Error(`The stage has no word ${word}.`);
}

/** The position of the middle of a word in the box of the stage, for a pointer. */
function middleOf(scene: Scene, word: string): { x: number; y: number } {
  const box = wordBox(scene.stage, word);
  const stage = scene.stage.getBoundingClientRect();
  return { x: box.left + box.width / 2 - stage.left, y: box.top + box.height / 2 - stage.top };
}

const pressWord = (scene: Scene, word: string): Promise<void> =>
  userEvent.click(scene.stage, { position: middleOf(scene, word) });

const dragWords = (scene: Scene, from: string, to: string): Promise<void> =>
  userEvent.dragAndDrop(scene.stage, scene.stage, {
    sourcePosition: middleOf(scene, from),
    targetPosition: middleOf(scene, to),
  });

describe("the highlighter", () => {
  const highlighter = (extra: Partial<ToolsInput> = {}, overrides: ToolSupportFields = {}): ToolsInput => ({
    ...profile(support("ext:highlighter", { state: "option", active: true, ...overrides })),
    ...extra,
  });
  const Text = '<p class="passage" style="margin: 0; line-height: 24px;">Bright light falls on green leaves</p>';
  /** Three lines of words of equal width, so that a column is the same on every line. */
  const Grid =
    '<p class="passage" style="margin: 0; font: 16px/24px monospace; white-space: pre-line;">aaa bbb\nccc ddd\neee fff</p>';
  const bands = (scene: Scene, pending = false): DOMRect[] =>
    [...scene.stage.querySelectorAll(pending ? ".ak-mark-pending" : ".ak-mark:not(.ak-mark-pending)")].map((each) =>
      each.getBoundingClientRect(),
    );
  const listed = (scene: Scene): string[] =>
    [...found(panelOf(scene, "Highlighter"), "panel").querySelectorAll(".ak-mark-item span")].map(
      (each) => each.textContent ?? "",
    );
  const caretOf = (scene: Scene): HTMLElement => found(scene.stage.querySelector<HTMLElement>(".ak-caret"), "caret");
  const said = (scene: Scene): string =>
    found(scene.stage.querySelector(".ak-highlights [role=status]"), "status").textContent ?? "";
  const near = (actual: DOMRect | undefined, expected: DOMRect): void => {
    expect(Math.abs((actual?.left ?? -99) - expected.left)).toBeLessThan(2);
    expect(Math.abs((actual?.top ?? -99) - expected.top)).toBeLessThan(2);
    expect(Math.abs((actual?.width ?? -99) - expected.width)).toBeLessThan(2);
  };

  it("has a button in the toolbar and a panel with the marks, and puts the focus on the caret when it opens", async () => {
    const scene = createScene();
    setContent(scene, Text);
    scene.show(highlighter({}, { active: false }));
    await userEvent.click(toolbarButton(scene, "Highlighter"));
    expect(scene.requests).toEqual([["ext:highlighter", true]]);
    scene.show(highlighter());
    const panel = found(panelOf(scene, "Highlighter"), "panel");
    expect(panel.textContent).toContain("No words are marked.");
    expect(focused()).toBe(caretOf(scene));
    expect(caretOf(scene).getAttribute("aria-label")).toBe("Highlighter");
  });

  it("marks a word with a press and takes the mark away with a second press", async () => {
    const scene = createScene();
    setContent(scene, Text);
    scene.show(highlighter());
    await pressWord(scene, "green");
    expect(listed(scene)).toEqual(["green"]);
    expect(bands(scene)).toHaveLength(1);
    near(bands(scene)[0], wordBox(scene.stage, "green"));
    expect(said(scene)).toBe("green marked");
    await pressWord(scene, "green");
    expect(listed(scene)).toEqual([]);
    expect(bands(scene)).toHaveLength(0);
    expect(found(panelOf(scene, "Highlighter"), "panel").textContent).toContain("No words are marked.");
    expect(said(scene)).toBe("green mark removed");
  });

  it("marks the words from where a drag begins to where it ends, as one band for a line", async () => {
    const scene = createScene();
    setContent(scene, Text);
    scene.show(highlighter());
    await dragWords(scene, "light", "green");
    expect(listed(scene)).toEqual(["light falls on green"]);
    expect(bands(scene)).toHaveLength(1);
    const [light, green] = [wordBox(scene.stage, "light"), wordBox(scene.stage, "green")];
    near(bands(scene)[0], new DOMRect(light.left, light.top, green.right - light.left, light.height));
  });

  it("leaves a press on a control to the control, and the text of controls out of the words", async () => {
    const scene = createScene();
    setContent(
      scene,
      '<p style="margin: 0; line-height: 24px;">Open <a href="#x">the link</a> then <label>pick <input type="text" value="typed"></label> ok <button type="button">press me</button></p><textarea>typed words</textarea>',
    );
    scene.show(highlighter());
    await userEvent.click(found(scene.stage.querySelector("a"), "link"));
    await userEvent.click(found(scene.stage.querySelector("label"), "label"));
    expect(listed(scene)).toEqual([]);
    const caret = caretOf(scene);
    const seen: string[] = [];
    for (let step = 0; step < 8; step++) {
      await userEvent.type(caret, "{ArrowRight}");
      seen.push(said(scene));
    }
    expect([...new Set(seen)]).toEqual(["the", "link", "then", "pick", "ok"]);
  });

  it("moves the caret by word and by line with the arrow keys, and marks with Enter", async () => {
    const scene = createScene();
    setContent(scene, Grid);
    scene.show(highlighter());
    const caret = caretOf(scene);
    caret.focus();
    near(caret.getBoundingClientRect(), wordBox(scene.stage, "aaa"));
    await userEvent.type(caret, "{ArrowRight}");
    near(caret.getBoundingClientRect(), wordBox(scene.stage, "bbb"));
    expect(said(scene)).toBe("bbb");
    await userEvent.keyboard("{ArrowDown}");
    near(caret.getBoundingClientRect(), wordBox(scene.stage, "ddd"));
    await userEvent.keyboard("{ArrowLeft}");
    near(caret.getBoundingClientRect(), wordBox(scene.stage, "ccc"));
    await userEvent.keyboard("{ArrowUp}");
    near(caret.getBoundingClientRect(), wordBox(scene.stage, "aaa"));
    await userEvent.keyboard("{ArrowUp}{ArrowLeft}");
    near(caret.getBoundingClientRect(), wordBox(scene.stage, "aaa"));
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(listed(scene)).toEqual(["ccc"]);
    expect(said(scene)).toBe("ccc marked");
    await userEvent.keyboard("{Enter}");
    expect(listed(scene)).toEqual([]);
  });

  it("extends from where the caret was with Shift, shows the extension, and marks it with Enter or lets go of it with Escape", async () => {
    const scene = createScene();
    setContent(scene, Grid);
    scene.show(highlighter());
    await userEvent.type(caretOf(scene), "{ArrowDown}{ArrowRight}{Shift>}{ArrowDown}{/Shift}");
    expect(bands(scene, true)).toHaveLength(2);
    expect(listed(scene)).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(bands(scene, true)).toHaveLength(0);
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}{Enter}");
    expect(listed(scene)).toEqual(["eee fff"]);
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}{Enter}");
    expect(listed(scene)).toEqual(["ddd eee fff"]);
    expect(bands(scene)).toHaveLength(2);
    // When every word of the extension is marked already, Enter takes the marks away.
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}{Enter}");
    expect(listed(scene)).toEqual(["fff"]);
  });

  it("removes one mark or all of them from the panel, and names a button after the mark it removes", async () => {
    const scene = createScene();
    setContent(scene, Text);
    scene.show(highlighter());
    await pressWord(scene, "Bright");
    await pressWord(scene, "falls");
    await pressWord(scene, "leaves");
    const panel = found(panelOf(scene, "Highlighter"), "panel");
    expect(listed(scene)).toEqual(["Bright", "falls", "leaves"]);
    await userEvent.click(controlOf(panel, "Remove mark falls"));
    expect(listed(scene)).toEqual(["Bright", "leaves"]);
    expect(bands(scene)).toHaveLength(2);
    expect(focused()).toBe(controlOf(panel, "Remove mark leaves"));
    await userEvent.click(buttonOf(panel, "Clear all marks"));
    expect(listed(scene)).toEqual([]);
    expect(bands(scene)).toHaveLength(0);
  });

  it("keeps the marks of the item and of a stimulus with them: a stimulus that the next item shares keeps its marks", async () => {
    const scene = createScene();
    const parts = (stimulus: string, body: string): string =>
      `<div class="ak-main"><div class="ak-stimuli"><section class="ak-stimulus"><p style="margin: 0;">${stimulus}</p></section></div><div class="ak-body"><p style="margin: 0;">${body}</p></div></div>`;
    const content = (item: string) => ({ item, stimuli: ["passage"] });
    setContent(scene, parts("Roots drink water", "First question here"));
    scene.show(highlighter({ content: content("q1") }));
    await pressWord(scene, "water");
    await pressWord(scene, "question");
    expect(listed(scene)).toEqual(["water", "question"]);
    setContent(scene, parts("Roots drink water", "Second question here"));
    scene.show(highlighter({ content: content("q2") }));
    expect(listed(scene)).toEqual(["water"]);
    expect(bands(scene)).toHaveLength(1);
    near(bands(scene)[0], wordBox(scene.stage, "water"));
    await pressWord(scene, "here");
    setContent(scene, parts("Roots drink water", "First question here"));
    scene.show(highlighter({ content: content("q1") }));
    expect(listed(scene)).toEqual(["water", "question"]);
    expect(bands(scene)).toHaveLength(2);
  });

  it("takes a mark away when the content under it has fewer words", async () => {
    const scene = createScene();
    const body = (text: string): string => `<div class="ak-body"><p style="margin: 0;">${text}</p></div>`;
    setContent(scene, body("one two three four five"));
    scene.show(highlighter({ content: { item: "q1", stimuli: [] } }));
    await pressWord(scene, "five");
    await pressWord(scene, "one");
    expect(listed(scene)).toEqual(["one", "five"]);
    setContent(scene, body("one two three"));
    scene.show(highlighter({ content: { item: "q1", stimuli: [] } }));
    expect(listed(scene)).toEqual(["one"]);
    expect(bands(scene)).toHaveLength(1);
  });

  it("draws no mark over content that was drawn again, until the mount hears which content it is", async () => {
    const scene = createScene();
    const body = (text: string): string => `<div class="ak-body"><p style="margin: 0;">${text}</p></div>`;
    // The stage takes the height of its content, as the stage of a root does.
    scene.stage.style.minHeight = "0";
    setContent(scene, body("one two"));
    scene.show(highlighter({ content: { item: "q1", stimuli: [] } }));
    await pressWord(scene, "two");
    expect(bands(scene)).toHaveLength(1);
    setContent(scene, body("one<br><br><br>two"));
    await frame();
    expect(bands(scene)).toHaveLength(0);
    scene.show(highlighter({ content: { item: "q2", stimuli: [] } }));
    expect(bands(scene)).toHaveLength(0);
    setContent(scene, body("one two"));
    scene.show(highlighter({ content: { item: "q1", stimuli: [] } }));
    expect(bands(scene)).toHaveLength(1);
  });

  it("forgets the marks at the next update when the content has no names", async () => {
    const scene = createScene();
    setContent(scene, Text);
    scene.show(highlighter());
    await pressWord(scene, "green");
    expect(listed(scene)).toEqual(["green"]);
    scene.show(highlighter());
    expect(listed(scene)).toEqual([]);
  });

  it("keeps the marks when the tool is turned off and on again", async () => {
    const scene = createScene();
    setContent(scene, Text);
    scene.show(highlighter({ content: { item: "q1", stimuli: [] } }));
    await pressWord(scene, "green");
    scene.show(highlighter({ content: { item: "q1", stimuli: [] } }, { active: false }));
    expect(scene.stage.querySelector(".ak-mark")).toBeNull();
    expect(scene.stage.querySelector(".ak-highlights")).toBeNull();
    scene.show(highlighter({ content: { item: "q1", stimuli: [] } }));
    expect(listed(scene)).toEqual(["green"]);
    expect(bands(scene)).toHaveLength(1);
  });

  it("draws the marks again where the words are after the stage changes size", async () => {
    const scene = createScene();
    setContent(scene, Text);
    scene.show(highlighter());
    await pressWord(scene, "leaves");
    near(bands(scene)[0], wordBox(scene.stage, "leaves"));
    scene.stage.style.width = "150px";
    await frame();
    near(bands(scene)[0], wordBox(scene.stage, "leaves"));
    scene.stage.style.width = "360px";
    await frame();
    near(bands(scene)[0], wordBox(scene.stage, "leaves"));
  });

  it("marks a run that spans lines with a band for each line", async () => {
    const scene = createScene();
    setContent(scene, '<p style="margin: 0; width: 70px; line-height: 24px;">one two three four five</p>');
    scene.show(highlighter());
    await dragWords(scene, "two", "five");
    expect(listed(scene)).toEqual(["two three four five"]);
    expect(bands(scene).length).toBeGreaterThan(1);
  });

  it("takes each CJK character as a word, and a run of the other characters as one", async () => {
    const scene = createScene();
    setContent(scene, '<p style="margin: 0; line-height: 24px;">日本語 and 文字</p>');
    scene.show(highlighter());
    const caret = caretOf(scene);
    const seen: string[] = [];
    for (let step = 0; step < 6; step++) {
      await userEvent.type(caret, "{ArrowRight}");
      seen.push(said(scene));
    }
    expect(seen).toEqual(["本", "語", "and", "文", "字", "字"]);
  });

  it("works for a screen reader: the caret has a role and a description, the words are announced, and axe finds nothing", async () => {
    const scene = createScene({ playerCss: true });
    setContent(scene, Text);
    scene.show(highlighter());
    const caret = caretOf(scene);
    expect(caret.getAttribute("role")).toBe("application");
    const hint = scene.stage.querySelector(`#${caret.getAttribute("aria-describedby")}`);
    expect(hint?.textContent).toContain("Shift with an arrow extends");
    await pressWord(scene, "light");
    await dragWords(scene, "falls", "green");
    expect(await violations()).toEqual([]);
  });

  it("is named in Indonesian", () => {
    const scene = createScene({ messages: ID_MESSAGES });
    setContent(scene, Text);
    scene.show(highlighter());
    expect(panelOf(scene, "Penanda teks")).not.toBeNull();
  });
});

describe("the answer eliminator", () => {
  const eliminator = (extra: Partial<ToolsInput> = {}, overrides: ToolSupportFields = {}): ToolsInput => ({
    ...profile(support("ext:eliminator", { state: "option", active: true, ...overrides })),
    ...extra,
  });
  const Choices = `<qti-choice-interaction response-identifier="RESPONSE" style="display: block;">
    <qti-prompt><p style="margin: 0;">Which line is the second?</p></qti-prompt>
    <qti-simple-choice identifier="A"><input class="ak-control" type="radio" name="answer" id="a"><label class="ak-face" for="a">Alpha</label></qti-simple-choice>
    <qti-simple-choice identifier="B"><input class="ak-control" type="radio" name="answer" id="b"><label class="ak-face" for="b">Beta</label></qti-simple-choice>
  </qti-choice-interaction>`;
  const choices = (scene: Scene): HTMLElement[] => [...scene.stage.querySelectorAll<HTMLElement>("qti-simple-choice")];
  const crossOut = (scene: Scene, name: string, action = "Cross out"): HTMLButtonElement =>
    found(scene.stage.querySelector<HTMLButtonElement>(`button[aria-label="${action} ${name}"]`), `button for ${name}`);
  const struck = (scene: Scene): (string | null)[] =>
    choices(scene).flatMap((choice) =>
      choice.hasAttribute("data-ak-struck") ? [choice.getAttribute("identifier")] : [],
    );

  it("puts a toggle button beside each choice, named with the choice", () => {
    const scene = createScene({ playerCss: true });
    setContent(scene, Choices);
    scene.show(eliminator());
    expect(choices(scene).map((choice) => choice.querySelector("button")?.getAttribute("aria-label"))).toEqual([
      "Cross out Alpha",
      "Cross out Beta",
    ]);
    const button = crossOut(scene, "Alpha");
    expect(button.textContent).toBe("Cross out");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.parentElement).toBe(choices(scene)[0]);
    expect(toolbarButton(scene, "Answer eliminator").getAttribute("aria-pressed")).toBe("true");
  });

  it("crosses a choice out with a press and takes the cross-out away with a second press, and leaves it selectable", async () => {
    const scene = createScene({ playerCss: true });
    setContent(scene, Choices);
    scene.show(eliminator());
    const events: string[] = [];
    for (const type of ["change", "input"]) scene.stage.addEventListener(type, () => events.push(type));
    const alpha = found(scene.stage.querySelector<HTMLInputElement>("#a"), "input a");
    await userEvent.click(alpha);
    expect(alpha.checked).toBe(true);
    events.length = 0;
    await userEvent.click(crossOut(scene, "Alpha"));
    expect(struck(scene)).toEqual(["A"]);
    expect(getComputedStyle(found(choices(scene)[0]?.querySelector(".ak-face"), "face")).textDecorationLine).toBe(
      "line-through",
    );
    expect(crossOut(scene, "Alpha").getAttribute("aria-pressed")).toBe("true");
    expect(alpha.checked).toBe(true);
    expect(events).toEqual([]);
    await userEvent.click(found(scene.stage.querySelector("#b"), "input b"));
    expect(alpha.checked).toBe(false);
    await userEvent.click(crossOut(scene, "Alpha"));
    expect(struck(scene)).toEqual([]);
    expect(crossOut(scene, "Alpha").getAttribute("aria-pressed")).toBe("false");
  });

  it("is operated by keyboard", async () => {
    const scene = createScene();
    setContent(scene, Choices);
    scene.show(eliminator());
    const button = crossOut(scene, "Beta");
    await userEvent.type(button, "{Enter}");
    expect(choices(scene)[1]?.hasAttribute("data-ak-struck")).toBe(true);
    expect(focused()).toBe(button);
    await userEvent.keyboard(" ");
    expect(choices(scene)[1]?.hasAttribute("data-ak-struck")).toBe(false);
  });

  it("gives a choice that is drawn later a button, and crosses out again what the item had crossed out", async () => {
    const scene = createScene();
    const input = (item: string) => eliminator({ content: { item, stimuli: [] } });
    setContent(scene, Choices);
    scene.show(input("q1"));
    await userEvent.click(crossOut(scene, "Beta"));
    setContent(scene, Choices);
    await frame();
    expect(crossOut(scene, "Beta").getAttribute("aria-pressed")).toBe("false");
    expect(choices(scene).some((choice) => choice.hasAttribute("data-ak-struck"))).toBe(false);
    scene.show(input("q1"));
    expect(choices(scene).map((choice) => choice.hasAttribute("data-ak-struck"))).toEqual([false, true]);
    setContent(scene, Choices);
    scene.show(input("q2"));
    expect(choices(scene).some((choice) => choice.hasAttribute("data-ak-struck"))).toBe(false);
    setContent(scene, Choices);
    scene.show(input("q1"));
    expect(crossOut(scene, "Beta").getAttribute("aria-pressed")).toBe("true");
  });

  it("takes the buttons and the cross-outs away when the tool is turned off, and brings them back when it is turned on", async () => {
    const scene = createScene();
    const input = (overrides: ToolSupportFields = {}) =>
      eliminator({ content: { item: "q1", stimuli: [] } }, overrides);
    setContent(scene, Choices);
    scene.show(input());
    await userEvent.click(crossOut(scene, "Alpha"));
    scene.show(input({ active: false }));
    expect(scene.stage.querySelector("button")).toBeNull();
    expect(scene.stage.querySelector("[data-ak-struck]")).toBeNull();
    scene.show(input());
    expect(choices(scene).map((choice) => choice.hasAttribute("data-ak-struck"))).toEqual([true, false]);
  });

  it("names a choice that has no text after its control", () => {
    const scene = createScene();
    setContent(
      scene,
      Choices.replace(">Alpha<", "><img alt='' src=''><").replace(
        'class="ak-control" type="radio" name="answer" id="a"',
        'class="ak-control" type="radio" name="answer" id="a" aria-label="Choice 1"',
      ),
    );
    scene.show(eliminator());
    expect(choices(scene)[0]?.querySelector("button")?.getAttribute("aria-label")).toBe("Cross out Choice 1");
  });

  it("passes axe with the buttons and a crossed-out choice", async () => {
    const scene = createScene({ playerCss: true });
    setContent(scene, Choices);
    scene.show(eliminator());
    await userEvent.click(crossOut(scene, "Alpha"));
    expect(await violations()).toEqual([]);
  });

  it("is named in Indonesian", () => {
    const scene = createScene({ messages: ID_MESSAGES });
    setContent(scene, Choices);
    scene.show(eliminator());
    expect(toolbarButton(scene, "Pencoret pilihan jawaban")).toBeTruthy();
    expect(crossOut(scene, "Alpha", "Coret")).toBeTruthy();
  });
});

describe("the calculators", () => {
  const calculators = (...types: ("basic" | "standard" | "scientific")[]): ToolsInput =>
    items({ calculators: types.map((type) => calculatorXml(type, `The ${type} calculator of the item.`)) });
  const display = (panel: Element): string => found(panel.querySelector("output"), "display").textContent ?? "";
  const key = (panel: Element, name: string): HTMLElement => {
    const labelled = panel.querySelector<HTMLElement>(`[aria-label="${name}"]`);
    return labelled ?? buttonOf(panel, name);
  };
  const press = async (panel: Element, ...names: string[]): Promise<void> => {
    for (const name of names) await userEvent.click(key(panel, name));
  };

  it("opens the basic calculator for an item that asks for one, with its description", async () => {
    const scene = createScene();
    scene.show(calculators("basic"));
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    const panel = found(panelOf(scene, "Basic calculator"), "panel");
    expect(panel.textContent).toContain("The basic calculator of the item.");
    expect(display(panel)).toBe("0");
    expect(panel.querySelectorAll(".ak-keys button")).toHaveLength(17);
    expect(panel.querySelector('[aria-label="Square root"]')).toBeNull();
    expect(panel.querySelector('[aria-label="MC, clear memory"]')).toBeNull();
  });

  it("adds, subtracts, multiplies and divides with the keys, and clears", async () => {
    const scene = createScene();
    scene.show(calculators("basic"));
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    const panel = found(panelOf(scene, "Basic calculator"), "panel");
    await press(panel, "7", "Add", "8", "Equals");
    expect(display(panel)).toBe("15");
    await press(panel, "Multiply", "3", "Equals");
    expect(display(panel)).toBe("45");
    await press(panel, "Subtract", "5", "Equals", "Divide", "4", "Equals");
    expect(display(panel)).toBe("10");
    await press(panel, "C, clear");
    expect(display(panel)).toBe("0");
    await press(panel, "0", "Decimal point", "1", "Add", "0", "Decimal point", "2", "Equals");
    expect(display(panel)).toBe("0.3");
  });

  it("shows an error for a division by zero, in the language of the interface", async () => {
    const english = createScene();
    english.show(calculators("basic"));
    await userEvent.click(toolbarButton(english, "Basic calculator"));
    const panel = found(panelOf(english, "Basic calculator"), "panel");
    await press(panel, "7", "Divide", "0", "Equals");
    expect(display(panel)).toBe("Error");
    await press(panel, "5");
    expect(display(panel)).toBe("Error");
    await press(panel, "C, clear", "5");
    expect(display(panel)).toBe("5");
    const indonesian = createScene({ messages: ID_MESSAGES });
    indonesian.show(calculators("basic"));
    await userEvent.click(toolbarButton(indonesian, "Kalkulator dasar"));
    const panelId = found(panelOf(indonesian, "Kalkulator dasar"), "panel");
    await press(panelId, "7", "Bagi", "0", "Sama dengan");
    expect(display(panelId)).toBe("Galat");
  });

  it("opens the standard calculator with the memory, percent, square root and sign that the best practices guide lists", async () => {
    const scene = createScene();
    scene.show(calculators("standard"));
    await userEvent.click(toolbarButton(scene, "Standard calculator"));
    const panel = found(panelOf(scene, "Standard calculator"), "panel");
    expect(panel.querySelectorAll(".ak-keys button")).toHaveLength(24);
    const memory = found(panel.querySelector<HTMLElement>(".ak-memory"), "memory sign");
    expect(memory.hidden).toBe(true);
    await press(panel, "9", "Square root");
    expect(display(panel)).toBe("3");
    await press(panel, "M+, add to memory", "C, clear");
    expect(memory.hidden).toBe(false);
    expect(memory.getAttribute("aria-label")).toBe("Memory in use");
    await press(panel, "MR, recall memory");
    expect(display(panel)).toBe("3");
    await press(panel, "M−, subtract from memory", "MC, clear memory");
    expect(memory.hidden).toBe(true);
    await press(panel, "C, clear", "2", "0", "0", "Add", "1", "0", "Percent", "Equals");
    expect(display(panel)).toBe("220");
    await press(panel, "C, clear", "5", "Change sign");
    expect(display(panel)).toBe("-5");
  });

  it("opens the scientific calculator that the profile names, with the keys of the best practices guide in their order", async () => {
    const scene = createScene();
    scene.show(
      profile(support("calculator-on-screen", { calculatorType: "scientific", state: "active", active: true })),
    );
    const panel = found(panelOf(scene, "Scientific calculator"), "panel");
    expect(panel.querySelectorAll(".ak-keys button")).toHaveLength(46);
    await press(
      panel,
      "2",
      "Add",
      "3",
      "Multiply",
      "Open parenthesis",
      "4",
      "Subtract",
      "1",
      "Close parenthesis",
      "Equals",
    );
    expect(display(panel)).toBe("11");
    await press(panel, "C, clear", "2", "xʸ, power", "1", "0", "Equals");
    expect(display(panel)).toBe("1024");
    await press(panel, "C, clear", "5", "nCr, combinations", "2", "Equals", "x!, factorial");
    expect(display(panel)).toBe("3628800");
    await press(panel, "C, clear", "1", "0", "0", "0", "log, logarithm to base 10");
    expect(display(panel)).toBe("3");
  });

  it("works in degrees, radians and gradians, with the inverse and hyperbolic functions shown as pressed while they wait", async () => {
    const scene = createScene();
    scene.show(calculators("scientific"));
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    const panel = found(panelOf(scene, "Scientific calculator"), "panel");
    const unit = found(panel.querySelector("select"), "angle unit");
    expect(unit.labels?.[0]?.firstChild?.textContent).toBe("Angle unit");
    expect(unit.value).toBe("degree");
    await press(panel, "3", "0", "sin, sine");
    expect(display(panel)).toBe("0.5");
    const inverse = key(panel, "Inv, inverse function");
    expect(inverse.getAttribute("aria-pressed")).toBe("false");
    await press(panel, "C, clear", "Inv, inverse function");
    expect(inverse.getAttribute("aria-pressed")).toBe("true");
    await press(panel, "1", "tan, tangent");
    expect(display(panel)).toBe("45");
    expect(inverse.getAttribute("aria-pressed")).toBe("false");
    await userEvent.selectOptions(unit, "radian");
    await press(panel, "π, pi", "cos, cosine");
    expect(display(panel)).toBe("-1");
    await press(panel, "Hyp, hyperbolic function", "0", "cos, cosine");
    expect(display(panel)).toBe("1");
    await press(panel, "C, clear");
    expect(unit.value).toBe("radian");
  });

  it("shows the operations that wait above the display", async () => {
    const scene = createScene();
    scene.show(calculators("scientific"));
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    const panel = found(panelOf(scene, "Scientific calculator"), "panel");
    const line = found(panel.querySelector(".ak-calculation"), "calculation");
    await press(panel, "2", "Add", "3", "Multiply", "Open parenthesis");
    expect(line.textContent).toBe("2 + 3 × (");
    await press(panel, "4", "Close parenthesis", "Equals");
    expect(line.textContent).toBe("");
    expect(display(panel)).toBe("14");
  });

  it("types the keys of the scientific calculator from the keyboard: the focus goes to the display", async () => {
    const scene = createScene();
    scene.show(calculators("scientific"));
    await userEvent.type(toolbarButton(scene, "Scientific calculator"), "{Enter}");
    const panel = found(panelOf(scene, "Scientific calculator"), "panel");
    expect(focused()).toBe(found(panel.querySelector("output"), "display"));
    await userEvent.keyboard("2+3*4=");
    expect(display(panel)).toBe("14");
    await userEvent.keyboard("{Escape}2^(1+2)=");
    expect(display(panel)).toBe("8");
    await userEvent.keyboard("4!");
    expect(display(panel)).toBe("24");
  });

  it("gives the Indonesian names of the keys and the units", async () => {
    const scene = createScene({ messages: ID_MESSAGES });
    scene.show(calculators("scientific"));
    await userEvent.click(toolbarButton(scene, "Kalkulator ilmiah"));
    const panel = found(panelOf(scene, "Kalkulator ilmiah"), "panel");
    expect(key(panel, "x², kuadrat")).toBeTruthy();
    const unit = found(panel.querySelector("select"), "angle unit");
    expect([...unit.options].map(({ textContent }) => textContent)).toEqual(["Derajat", "Radian", "Gradian"]);
  });

  it("is operated by keyboard: the focus goes to the display, and typing works there", async () => {
    const scene = createScene();
    scene.show(calculators("standard"));
    await userEvent.type(toolbarButton(scene, "Standard calculator"), "{Enter}");
    const panel = found(panelOf(scene, "Standard calculator"), "panel");
    expect(focused()).toBe(found(panel.querySelector("output"), "display"));
    await userEvent.keyboard("12*3{Enter}");
    expect(display(panel)).toBe("36");
    await userEvent.keyboard("{Escape}");
    expect(display(panel)).toBe("0");
    await userEvent.keyboard("1.5+.5=");
    expect(display(panel)).toBe("2");
    await userEvent.keyboard("50%");
    expect(display(panel)).toBe("0.5");
    await userEvent.keyboard("{Delete}9");
    expect(display(panel)).toBe("9");
  });

  it("presses the focused button with Enter and types on any other control of the calculator", async () => {
    const scene = createScene();
    scene.show(calculators("basic"));
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    const panel = found(panelOf(scene, "Basic calculator"), "panel");
    await userEvent.type(key(panel, "7"), "{Enter}");
    expect(display(panel)).toBe("7");
    await userEvent.keyboard("5");
    expect(display(panel)).toBe("75");
    await userEvent.type(key(panel, "Add"), "{Enter}");
    await userEvent.keyboard("1=");
    expect(display(panel)).toBe("76");
  });

  it("has no one-key shortcut that works while the focus is outside the calculator", async () => {
    const scene = createScene();
    scene.show(calculators("basic"));
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    const panel = found(panelOf(scene, "Basic calculator"), "panel");
    await userEvent.type(scene.before, "123");
    expect(display(panel)).toBe("0");
    await userEvent.type(key(panel, "Equals"), "{Control>}5{/Control}");
    expect(display(panel)).toBe("0");
  });

  it("types a standard-only key only into the standard calculator", async () => {
    const scene = createScene();
    scene.show(calculators("basic"));
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    const panel = found(panelOf(scene, "Basic calculator"), "panel");
    await userEvent.keyboard("{Enter}");
    await userEvent.type(found(panel.querySelector("output"), "display"), "50%");
    expect(display(panel)).toBe("50");
  });

  it("names every key that shows letters with a name that starts with them, so that the label is in the name, as WCAG asks", async () => {
    const scene = createScene();
    scene.show(calculators("standard", "scientific"));
    await userEvent.click(toolbarButton(scene, "Standard calculator"));
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    const scientific = found(panelOf(scene, "Scientific calculator"), "panel");
    for (const button of scientific.querySelectorAll(".ak-keys button")) {
      const name = button.getAttribute("aria-label") ?? button.textContent ?? "";
      if (/[\p{L}\p{N}]/u.test(button.textContent ?? ""))
        expect(name.startsWith(button.textContent ?? ""), name).toBe(true);
    }
    const panel = found(panelOf(scene, "Standard calculator"), "panel");
    const lettered = [...panel.querySelectorAll(".ak-keys button")].filter((button) =>
      /[\p{L}\p{N}]/u.test(button.textContent ?? ""),
    );
    expect(lettered.map((button) => button.textContent)).toEqual([
      "MC",
      "MR",
      "M+",
      "M−",
      "C",
      ..."789456123".split(""),
      "0",
    ]);
    for (const button of lettered) {
      const name = button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(name.startsWith(button.textContent ?? ""), name).toBe(true);
    }
  });

  it("shows the file of a calculator below the keys of the built-in calculator, as the viewer shows a file", async () => {
    const scene = createScene();
    scene.show(
      items({
        calculators: [
          calculatorXml("basic", "Basic", {
            href: "tools/basic.pdf",
            label: "The calculator of the item",
            mimeType: "application/pdf",
          }),
        ],
      }),
    );
    expect(scene.host.querySelectorAll(".ak-tools > .ak-row > button")).toHaveLength(1);
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    const panel = found(panelOf(scene, "Basic calculator"), "panel");
    const group = found(
      panel.querySelector<HTMLElement>('[role=group][aria-label="The calculator of the item"]'),
      "file",
    );
    const link = found(group.querySelector("a"), "link");
    expect(link.getAttribute("href")).toBe("/package/tools/basic.pdf");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(
      group.compareDocumentPosition(found(panel.querySelector(".ak-keys"), "keys")) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    await press(panel, "7", "Add", "8", "Equals");
    expect(display(panel)).toBe("15");
  });

  it("shows no file for a calculator that has none, and loads nothing from a path with a scheme", async () => {
    const assets = vi.fn((path: string) => `/package/${path}`);
    const scene = createScene({ assets });
    scene.show(
      items({
        calculators: [
          calculatorXml("basic", "Basic", { href: "https://example.org/calc.html", mimeType: "text/html" }),
          calculatorXml("standard", "Standard"),
        ],
      }),
    );
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    const basic = found(panelOf(scene, "Basic calculator"), "panel");
    expect(basic.querySelector("iframe, a")).toBeNull();
    expect(basic.textContent).toContain("This tool is not available.");
    await userEvent.click(toolbarButton(scene, "Standard calculator"));
    expect(found(panelOf(scene, "Standard calculator"), "panel").textContent).not.toContain("not available");
    expect(assets).not.toHaveBeenCalled();
  });

  it("makes one tool of the calculator that the item and the profile both ask for, and turns it on by the profile", async () => {
    const scene = createScene();
    const input = (active: boolean): ToolsInput => ({
      companion: companion({ calculators: [calculatorXml("standard", "Standard of the item.")] }),
      supports: [support("calculator-on-screen", { calculatorType: "standard", state: "option", active })],
    });
    scene.show(input(false));
    expect(scene.host.querySelectorAll(".ak-tools > .ak-row > button")).toHaveLength(1);
    await userEvent.click(toolbarButton(scene, "Standard calculator"));
    expect(scene.requests).toEqual([["calculator-on-screen", true]]);
    expect(found(panelOf(scene, "Standard calculator"), "panel").textContent).toContain("Standard of the item.");
  });

  it("puts the calculator of the profile on the screen for an item that has none, whatever the type of calculator", async () => {
    const scene = createScene();
    scene.show(profile(support("calculator-on-screen", { state: "active", active: true })));
    expect(found(panelOf(scene, "Basic calculator"), "panel")).toBeTruthy();
    const other = createScene();
    other.show(profile(support("calculator-on-screen", { calculatorType: "standard", state: "active", active: true })));
    expect(found(panelOf(other, "Standard calculator"), "panel")).toBeTruthy();
  });

  it("leaves no calculator to a candidate whose profile prohibits it, though the item asks for one", () => {
    const scene = createScene();
    scene.show({
      companion: companion({ calculators: [calculatorXml("basic", "Basic")], rules: [RULE_XML] }),
      supports: [support("calculator-on-screen", { state: "prohibited" })],
    });
    const names = [...scene.host.querySelectorAll(".ak-tools > .ak-row > button")].map((button) => button.textContent);
    expect(names).toEqual(["Ruler"]);
  });

  it("shows every key: the panel is in the tray, where nothing lies over it", async () => {
    const scene = createScene();
    scene.show(calculators("standard"));
    await userEvent.click(toolbarButton(scene, "Standard calculator"));
    const panel = found(panelOf(scene, "Standard calculator"), "panel");
    for (const button of panel.querySelectorAll<HTMLElement>("button")) {
      button.focus();
      expect(entirelyHidden(button), button.textContent ?? "").toBe(false);
    }
  });

  it("has keys of at least 24 by 24 CSS pixels", async () => {
    const scene = createScene();
    scene.show(calculators("basic", "standard", "scientific"));
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    await userEvent.click(toolbarButton(scene, "Standard calculator"));
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    expect(targetsOf(scene).length).toBeGreaterThan(80);
    expect(tooSmall(scene)).toEqual([]);
  });

  it("passes axe at WCAG 2.2 A and AA, the three calculators open, a mode of the scientific one pressed", async () => {
    const scene = createScene();
    scene.show(calculators("basic", "standard", "scientific"));
    await userEvent.click(toolbarButton(scene, "Basic calculator"));
    await userEvent.click(toolbarButton(scene, "Standard calculator"));
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    await press(found(panelOf(scene, "Scientific calculator"), "panel"), "Inv, inverse function", "2", "Add");
    expect(await violations()).toEqual([]);
  });

  it("exposes the keys of the scientific calculator to a screen reader by their names", async () => {
    const scene = createScene();
    scene.show(calculators("scientific"));
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    await waitFor(async () => {
      const tree = await commands.ariaSnapshot();
      expect(tree).toMatch(/- group "Scientific calculator"/u);
      expect(tree).toMatch(/- button "sin, sine"/u);
      expect(tree).toMatch(/- button "Inv, inverse function"/u);
      expect(tree).toMatch(/- combobox "Angle unit"/u);
    });
  });
});

describe("digital and physical materials", () => {
  const material = (attributes: { label?: string; mimeType?: string; icon?: string } = {}): string =>
    digitalXml("files/periodic.png", attributes);
  const open = async (scene: Scene, name: string): Promise<HTMLElement> => {
    await userEvent.click(toolbarButton(scene, name));
    return found(panelOf(scene, name), "panel");
  };

  it("shows an image of the package in the viewer, by the URL that the package paths map to", async () => {
    const scene = createScene();
    scene.show(items({ digital: [material({ label: "Periodic table", mimeType: "image/png" })] }));
    const panel = await open(scene, "Periodic table");
    const image = found(panel.querySelector("img"), "image");
    expect(image.getAttribute("src")).toBe("/package/files/periodic.png");
    expect(image.getAttribute("alt")).toBe("Periodic table");
  });

  it("names a material without a label by its file", async () => {
    const scene = createScene();
    scene.show(items({ digital: [material({ mimeType: "image/png" })] }));
    expect(await open(scene, "periodic.png")).toBeTruthy();
  });

  it("shows audio and video with their controls", async () => {
    const scene = createScene();
    scene.show(
      items({
        digital: [
          digitalXml("a.mp3", { label: "Sound", mimeType: "audio/mpeg" }),
          digitalXml("v.mp4", { label: "Film", mimeType: "video/mp4; codecs=avc1" }),
        ],
      }),
    );
    expect((await open(scene, "Sound")).querySelector("audio")?.hasAttribute("controls")).toBe(true);
    expect((await open(scene, "Film")).querySelector("video")?.getAttribute("src")).toBe("/package/v.mp4");
  });

  it("puts a page in a frame with an empty sandbox, which runs nothing of it", async () => {
    const scene = createScene();
    scene.show(items({ digital: [digitalXml("table.html", { label: "Table", mimeType: "text/html" })] }));
    const frameElement = found((await open(scene, "Table")).querySelector("iframe"), "frame");
    expect(frameElement.getAttribute("sandbox")).toBe("");
    expect(frameElement.getAttribute("src")).toBe("/package/table.html");
    expect(frameElement.getAttribute("title")).toBe("Table");
  });

  it("offers any other file as a link that opens in a tab of its own", async () => {
    const scene = createScene();
    scene.show(
      items({
        digital: [
          digitalXml("files/sheet.pdf", { label: "Sheet", mimeType: "application/pdf" }),
          digitalXml("files/tool.exe", { label: "Tool" }),
        ],
      }),
    );
    for (const name of ["Sheet", "Tool"]) {
      const link = found((await open(scene, name)).querySelector("a"), "link");
      expect(link.textContent).toBe("Open the file");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(found(panelOf(scene, "Sheet"), "panel").querySelector("a")?.getAttribute("href")).toBe(
      "/package/files/sheet.pdf",
    );
  });

  it("loads nothing from a path with a scheme, which is not a package path, and says that the material is not available", async () => {
    const assets = vi.fn((path: string) => `/package/${path}`);
    const scene = createScene({ assets });
    scene.show(
      items({
        digital: [
          digitalXml("javascript:alert(1)", { label: "Script", mimeType: "text/html" }),
          digitalXml("https://example.org/a.png", {
            label: "Remote",
            mimeType: "image/png",
            icon: "data:image/png;base64,AAAA",
          }),
        ],
      }),
    );
    for (const name of ["Script", "Remote"]) {
      const panel = await open(scene, name);
      expect(panel.textContent).toContain("This tool is not available.");
      expect(panel.querySelector("img, iframe, a, audio, video")).toBeNull();
    }
    expect(assets).not.toHaveBeenCalled();
    expect(toolbarButton(scene, "Remote").querySelector("img")).toBeNull();
  });

  it("shows the icon of a material in its button, as a picture that the name of the button already names", () => {
    const scene = createScene();
    scene.show(items({ digital: [material({ label: "Periodic table", icon: "files/table.svg" })] }));
    const icon = found(toolbarButton(scene, "Periodic table").querySelector("img"), "icon");
    expect(icon.getAttribute("src")).toBe("/package/files/table.svg");
    expect(icon.getAttribute("alt")).toBe("");
  });

  it("lists the physical materials in a notice, and has none when the item names none", () => {
    const scene = createScene();
    scene.show(items({ physical: ["Supply scissors.", "Supply 2 sheets of 8.5 x 11 inch white paper."] }));
    const notice = found(scene.host.querySelector<HTMLElement>(".ak-physical"), "notice");
    expect(notice.hidden).toBe(false);
    expect(notice.getAttribute("aria-label")).toBe("Materials to have ready");
    expect(notice.querySelector("h3")?.textContent).toBe("Materials to have ready");
    expect([...notice.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Supply scissors.",
      "Supply 2 sheets of 8.5 x 11 inch white paper.",
    ]);
    scene.show(items({ rules: [RULE_XML] }));
    expect(notice.hidden).toBe(true);
  });

  it("shows the text of a physical material as text, never as markup", () => {
    const scene = createScene();
    scene.show(items({ physical: ["<img src=x onerror=alert(1)>"] }));
    expect(scene.host.querySelector(".ak-physical img")).toBeNull();
    expect(scene.host.querySelector(".ak-physical li")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("is operated by keyboard: Enter opens the viewer, with the focus on its heading, and Enter on Close closes it", async () => {
    const scene = createScene();
    scene.show(items({ digital: [material({ label: "Periodic table", mimeType: "image/png" })] }));
    await userEvent.type(toolbarButton(scene, "Periodic table"), "{Enter}");
    const panel = found(panelOf(scene, "Periodic table"), "panel");
    expect(focused()).toBe(found(panel.querySelector("h3"), "heading"));
    await userEvent.type(controlOf(panel, "Close Periodic table"), "{Enter}");
    expect(panelOf(scene, "Periodic table")).toBeNull();
    expect(focused()).toBe(toolbarButton(scene, "Periodic table"));
  });

  it("has controls of at least 24 by 24 CSS pixels", async () => {
    const scene = createScene();
    scene.show(
      items({ digital: [digitalXml("a.pdf", { label: "Sheet", mimeType: "application/pdf" })], physical: ["Paper."] }),
    );
    await open(scene, "Sheet");
    expect(tooSmall(scene)).toEqual([]);
  });

  it("passes axe at WCAG 2.2 A and AA", async () => {
    const scene = createScene();
    scene.show(
      items({
        digital: [
          digitalXml("files/periodic.png", { label: "Periodic table", mimeType: "image/png", icon: "files/table.svg" }),
          digitalXml("a.pdf", { label: "Sheet", mimeType: "application/pdf" }),
        ],
        physical: ["Supply scissors."],
      }),
    );
    await open(scene, "Periodic table");
    await open(scene, "Sheet");
    expect(await violations()).toEqual([]);
  });
});

describe("the tools of the host", () => {
  const SlotNames = [
    ["dictionary-on-screen", "dictionary", "Dictionary"],
    ["thesaurus-on-screen", "thesaurus", "Thesaurus"],
    ["homophone-checker-on-screen", "homophone-checker", "Homophone checker"],
    ["note-taking-on-screen", "note-taking", "Notes"],
    ["visual-organizer-on-screen", "visual-organizer", "Visual organizer"],
    ["outliner-on-screen", "outliner", "Outliner"],
    ["peer-interaction-on-screen", "peer-interaction", "Peer interaction"],
    ["spell-checker-on-screen", "spell-checker", "Spell checker"],
  ] as const;

  it("builds each on-screen tool of the profile in its panel with the function of the host, and takes it down when it goes", async () => {
    const built: { name: string; language: string }[] = [];
    const unmounted: string[] = [];
    const slots: ToolSlots = {};
    for (const [, tool] of SlotNames) {
      slots[tool] = (host, options) => {
        built.push(options);
        host.textContent = `The ${options.name} of the host`;
        return () => unmounted.push(options.name);
      };
    }
    const scene = createScene({ slots });
    const input = (active: boolean): ToolsInput =>
      profile(...SlotNames.map(([name]) => support(name, { state: "option", active })));
    scene.show(input(true));
    for (const [, tool, title] of SlotNames) {
      expect(found(panelOf(scene, title), "panel").textContent).toContain(`The ${tool} of the host`);
    }
    expect(built).toEqual(SlotNames.map(([, name]) => ({ name, language: "en", file: null })));
    scene.show(input(false));
    expect(unmounted).toEqual(SlotNames.map(([, name]) => name));
    expect(scene.host.querySelectorAll(".ak-panel")).toHaveLength(0);
  });

  it("builds the scientific calculator of the host in place of the built-in one, and the graphing calculator, with the functions of the host", async () => {
    const slots: ToolSlots = {
      "scientific-calculator": (host) => {
        host.textContent = "Scientific";
        return () => undefined;
      },
    };
    const scene = createScene({ slots });
    scene.show(
      items({
        calculators: [calculatorXml("scientific", "S"), calculatorXml("graphing", "G")],
      }),
    );
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    expect(found(panelOf(scene, "Scientific calculator"), "panel").textContent).toContain("Scientific");
    await userEvent.click(toolbarButton(scene, "Graphing calculator"));
    expect(found(panelOf(scene, "Graphing calculator"), "panel").textContent).toContain("This tool is not available.");
  });

  it("gives the file of a calculator to the tool of the host that builds the calculator", async () => {
    const options: ToolOptions[] = [];
    const scene = createScene({
      slots: {
        "scientific-calculator": (host, given) => {
          options.push(given);
          host.textContent = "Scientific of the host";
          return () => undefined;
        },
      },
    });
    scene.show(
      items({
        calculators: [
          calculatorXml("scientific", "Scientific", {
            href: "tools/sci.html",
            label: "Scientific file",
            mimeType: "text/html",
          }),
        ],
      }),
    );
    expect(scene.host.querySelectorAll(".ak-tools > .ak-row > button")).toHaveLength(1);
    await userEvent.click(toolbarButton(scene, "Scientific calculator"));
    expect(options).toEqual([
      {
        name: "scientific-calculator",
        language: "en",
        file: { url: "/package/tools/sci.html", mimeType: "text/html", label: "Scientific file" },
      },
    ]);
    const panel = found(panelOf(scene, "Scientific calculator"), "panel");
    expect(panel.textContent).toContain("Scientific of the host");
    expect(panel.querySelector("iframe")).toBeNull();
  });

  it("shows the file of a calculator that the host does not provide, below the notice", async () => {
    const scene = createScene();
    scene.show(
      items({
        calculators: [
          calculatorXml("graphing", "Graphing", {
            href: "tools/graph.html",
            label: "Graphing file",
            mimeType: "text/html",
          }),
        ],
      }),
    );
    await userEvent.click(toolbarButton(scene, "Graphing calculator"));
    const panel = found(panelOf(scene, "Graphing calculator"), "panel");
    expect(panel.textContent).toContain("This tool is not available.");
    const frameElement = found(panel.querySelector("iframe"), "frame");
    expect(frameElement.getAttribute("sandbox")).toBe("");
    expect(frameElement.getAttribute("src")).toBe("/package/tools/graph.html");
    expect(frameElement.getAttribute("title")).toBe("Graphing file");
  });

  it("says that a tool is not available when the host gives none", () => {
    const scene = createScene();
    scene.show(profile(support("dictionary-on-screen", { state: "active", active: true })));
    expect(found(panelOf(scene, "Dictionary"), "panel").textContent).toContain("This tool is not available.");
  });

  it("leaves out a tool that the profile prohibits", () => {
    const scene = createScene();
    scene.show(profile(support("dictionary-on-screen", { state: "prohibited" }), support("thesaurus-on-screen")));
    const names = [...scene.host.querySelectorAll(".ak-tools > .ak-row > button")].map((button) => button.textContent);
    expect(names).toEqual(["Thesaurus"]);
  });

  it("refuses a function of the host that returns no function, and takes the panel down", () => {
    const scene = createScene({ slots: { dictionary: () => JSON.parse("1") } });
    expect(() => scene.show(profile(support("dictionary-on-screen", { state: "active", active: true })))).toThrow(
      new DataError("The function of the slot dictionary must return a function, found 1."),
    );
    expect(scene.host.querySelectorAll(".ak-panel")).toHaveLength(0);
  });

  it("takes the panel down and passes on the error of a function of the host that throws", () => {
    const scene = createScene({
      slots: {
        dictionary: () => {
          throw new Error("The dictionary is down.");
        },
      },
    });
    expect(() => scene.show(profile(support("dictionary-on-screen", { state: "active", active: true })))).toThrow(
      "The dictionary is down.",
    );
    expect(scene.host.querySelectorAll(".ak-panel")).toHaveLength(0);
  });

  it("shows the other tools when the function of one tool of the host fails", () => {
    const scene = createScene({
      slots: {
        dictionary: () => {
          throw new Error("The dictionary is down.");
        },
        thesaurus: (host) => {
          host.textContent = "The thesaurus of the host";
          return () => undefined;
        },
      },
    });
    expect(() =>
      scene.show(
        profile(
          support("dictionary-on-screen", { state: "active", active: true }),
          support("thesaurus-on-screen", { state: "active", active: true }),
        ),
      ),
    ).toThrow("The dictionary is down.");
    expect(found(panelOf(scene, "Thesaurus"), "panel").textContent).toContain("The thesaurus of the host");
    expect(
      [...scene.host.querySelectorAll(".ak-tools > .ak-row > button")].map((button) => button.textContent),
    ).toEqual(["Dictionary", "Thesaurus"]);
  });

  it("is operated by keyboard: Enter on the button turns it on and puts the focus on the heading of its panel", async () => {
    const scene = createScene({ slots: { dictionary: () => () => undefined } });
    scene.show(profile(support("dictionary-on-screen", { state: "option" })));
    await userEvent.type(toolbarButton(scene, "Dictionary"), "{Enter}");
    expect(scene.requests).toEqual([["dictionary-on-screen", true]]);
    expect(focused()).toBe(found(panelOf(scene, "Dictionary"), "panel").querySelector("h3"));
  });

  it("has controls of at least 24 by 24 CSS pixels", () => {
    const scene = createScene();
    scene.show(profile(support("dictionary-on-screen", { state: "active", active: true })));
    expect(tooSmall(scene)).toEqual([]);
  });

  it("passes axe at WCAG 2.2 A and AA", async () => {
    const scene = createScene({
      slots: { dictionary: paragraphIn },
    });
    scene.show(
      profile(
        support("dictionary-on-screen", { state: "active", active: true }),
        support("thesaurus-on-screen", { state: "active", active: true }),
      ),
    );
    expect(await violations()).toEqual([]);
  });
});

describe("mountTools", () => {
  const buttonNames = (scene: Scene): (string | null)[] =>
    [...scene.host.querySelectorAll(".ak-tools > .ak-row > button")].map((button) => button.textContent);

  it("puts the tools of the item before those of the profile, in a region named Tools", () => {
    const scene = createScene();
    scene.show({
      companion: companion({
        rules: [RULE_XML],
        protractors: [PROTRACTOR_XML],
        calculators: [calculatorXml("basic", "B")],
        digital: [digitalXml("a.pdf", { label: "Sheet", mimeType: "application/pdf" })],
      }),
      supports: [support("line-reader"), support("answer-masking"), support("dictionary-on-screen")],
    });
    expect(buttonNames(scene)).toEqual([
      "Ruler",
      "Protractor",
      "Basic calculator",
      "Sheet",
      "Line reader",
      "Answer masking",
      "Dictionary",
    ]);
    const region = found(scene.host.querySelector(".ak-tools"), "region");
    expect(region.tagName).toBe("SECTION");
    expect(region.getAttribute("aria-label")).toBe("Tools");
  });

  it("numbers the buttons of tools that share a name", () => {
    const scene = createScene();
    scene.show(
      items({
        rules: [RULE_XML, ruleXml("Shorter", 5, ["1.0", "Meter"], ["0.5", "Meter"])],
        protractors: [PROTRACTOR_XML],
      }),
    );
    expect(buttonNames(scene)).toEqual(["Ruler 1", "Ruler 2", "Protractor"]);
  });

  it("names the tools in the language of the interface", () => {
    const scene = createScene({ messages: ID_MESSAGES });
    scene.show(items({ rules: [RULE_XML], protractors: [PROTRACTOR_XML] }));
    expect(buttonNames(scene)).toEqual(["Penggaris", "Busur derajat"]);
    expect(found(scene.host.querySelector(".ak-tools"), "region").getAttribute("aria-label")).toBe("Alat bantu");
  });

  it("hides the region when there is nothing to show, and shows it again", () => {
    const scene = createScene();
    scene.show({ companion: null, supports: [] });
    expect(found(scene.host.querySelector<HTMLElement>(".ak-tools"), "region").hidden).toBe(true);
    scene.show(items({ rules: [RULE_XML] }));
    expect(found(scene.host.querySelector<HTMLElement>(".ak-tools"), "region").hidden).toBe(false);
    scene.show(items({ physical: ["Paper."] }));
    expect(found(scene.host.querySelector<HTMLElement>(".ak-tools"), "region").hidden).toBe(false);
  });

  it("keeps a tool open, where it was put, when the next item asks for the same tool", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    await userEvent.keyboard("{ArrowDown}");
    const rule = found(overlayOf(scene, "Ruler"), "rule");
    const placement = placementOf(rule);
    scene.show(
      items({
        rules: [ruleXml("Another description", 10, ["1.0", "Meter"], ["0.5", "Meter"])],
        calculators: [calculatorXml("basic", "B")],
      }),
    );
    expect(overlayOf(scene, "Ruler")).toBe(rule);
    expect(placementOf(rule)).toEqual(placement);
    expect(buttonNames(scene)).toEqual(["Ruler", "Basic calculator"]);
  });

  it("takes down a tool that the next item does not ask for, and the focus goes to the toolbar's button", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML], protractors: [PROTRACTOR_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    await userEvent.click(toolbarButton(scene, "Protractor"));
    controlOf(found(panelOf(scene, "Protractor"), "panel"), "Move up").focus();
    scene.show(items({ rules: [RULE_XML] }));
    expect(panelOf(scene, "Protractor")).toBeNull();
    expect(overlayOf(scene, "Protractor")).toBeNull();
    expect(found(panelOf(scene, "Ruler"), "panel")).toBeTruthy();
    expect(buttonNames(scene)).toEqual(["Ruler"]);
  });

  it("does not move the button that has the focus when it adds another", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    toolbarButton(scene, "Ruler").focus();
    scene.show(items({ rules: [RULE_XML], calculators: [calculatorXml("basic", "B")] }));
    expect(focused()).toBe(toolbarButton(scene, "Ruler"));
  });

  it("follows the profile, not the candidate, for the tools that the profile puts on the screen", async () => {
    const scene = createScene({ follow: false });
    scene.show(profile(support("calculator-on-screen", { state: "option", active: true })));
    const button = toolbarButton(scene, "Basic calculator");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.type(
      controlOf(found(panelOf(scene, "Basic calculator"), "panel"), "Close Basic calculator"),
      "{Enter}",
    );
    expect(scene.requests).toEqual([["calculator-on-screen", false]]);
    expect(focused()).toBe(button);
    expect(panelOf(scene, "Basic calculator")).not.toBeNull();
    scene.show(profile(support("calculator-on-screen", { state: "option", active: false })));
    expect(panelOf(scene, "Basic calculator")).toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("does not move the focus into a tool that an input opens without the candidate asking", () => {
    const scene = createScene();
    scene.before.focus();
    scene.show(profile(support("line-reader", { state: "active", active: true })));
    expect(focused()).toBe(scene.before);
  });

  it("takes everything down on destroy and leaves the item as it was", async () => {
    const scene = createScene();
    const markup = scene.stage.innerHTML.replace('<div class="ak-tool-layer"></div>', "");
    scene.show({
      companion: companion({ rules: [RULE_XML], physical: ["Paper."] }),
      supports: [support("line-reader", { active: true }), support("answer-masking", { active: true })],
    });
    await userEvent.click(toolbarButton(scene, "Ruler"));
    scene.tools.destroy();
    expect(scene.host.children).toHaveLength(0);
    expect(scene.stage.innerHTML).toBe(markup);
  });

  it("puts the physical materials in one place whatever the tools in force", () => {
    const scene = createScene();
    scene.show(items({ physical: ["A", "B"] }));
    expect(scene.host.querySelectorAll(".ak-physical li")).toHaveLength(2);
    scene.show(items({ physical: ["C"] }));
    expect([...scene.host.querySelectorAll(".ak-physical li")].map((item) => item.textContent)).toEqual(["C"]);
  });

  it("passes axe at WCAG 2.2 A and AA with every kind of tool in force and open", async () => {
    const scene = createScene({
      slots: { dictionary: paragraphIn },
    });
    scene.show({
      companion: companion({
        rules: [RULE_XML],
        protractors: [PROTRACTOR_XML],
        calculators: [calculatorXml("standard", "S")],
        digital: [digitalXml("a.pdf", { label: "Sheet", mimeType: "application/pdf" })],
        physical: ["Paper."],
      }),
      supports: [
        support("line-reader", { state: "active", active: true }),
        support("answer-masking", { state: "active", active: true }),
        support("dictionary-on-screen", { state: "active", active: true }),
      ],
    });
    for (const name of ["Ruler", "Protractor", "Standard calculator", "Sheet"])
      await userEvent.click(toolbarButton(scene, name));
    expect(await violations()).toEqual([]);
  });
});

describe("a content root with player.css", () => {
  it("shows and operates the tools in a content root that adopts player.css, with the contrast and the sizes that they have without it", async () => {
    const scene = createScene({ playerCss: true });
    scene.show({
      companion: companion({
        rules: [RULE_XML],
        protractors: [PROTRACTOR_XML],
        calculators: [calculatorXml("standard", "S")],
        physical: ["Paper."],
      }),
      supports: [
        support("line-reader", { state: "active", active: true }),
        support("answer-masking", { state: "active", active: true }),
      ],
    });
    for (const name of ["Ruler", "Protractor", "Standard calculator"])
      await userEvent.click(toolbarButton(scene, name));
    const rule = found(overlayOf(scene, "Ruler"), "rule");
    const start = placementOf(rule);
    await userEvent.type(rule, "{ArrowRight}");
    expect(placementOf(rule).x).toBe(start.x + 10);
    expect(scene.stage.querySelector<HTMLElement>("qti-simple-choice")?.getBoundingClientRect().height).toBe(0);
    expect(tooSmall(scene)).toEqual([]);
    expect(await violations()).toEqual([]);
  });
});

describe("color schemes", () => {
  it("keeps the contrast of every tool in a dark color scheme, since the stylesheet uses system colors", async () => {
    const scene = createScene();
    scene.show({
      companion: companion({
        rules: [RULE_XML],
        protractors: [PROTRACTOR_XML],
        calculators: [calculatorXml("standard", "S")],
        physical: ["Paper."],
      }),
      supports: [
        support("line-reader", { state: "active", active: true }),
        support("answer-masking", { state: "active", active: true }),
      ],
    });
    for (const name of ["Ruler", "Protractor", "Standard calculator"])
      await userEvent.click(toolbarButton(scene, name));
    for (const scheme of ["light", "dark"]) {
      document.documentElement.style.colorScheme = scheme;
      cleanups.push(() => document.documentElement.style.removeProperty("color-scheme"));
      expect(await violations(), scheme).toEqual([]);
    }
  });
});

describe("input of other types", () => {
  const options = (scene: Scene) => ({
    messages: EN_MESSAGES,
    language: "en",
    stage: scene.stage,
    assets: (path: string) => path,
    onSupport: () => undefined,
  });
  it("rejects a host that is not an element in a document", () => {
    const scene = createScene();
    const detached = document.createElement("div");
    expect(() => mountTools(detached, options(scene))).toThrow(
      new DataError("The host must be an element in a document, found an object."),
    );
    expect(() => mountTools(JSON.parse("null"), options(scene))).toThrow(
      new DataError("The host must be an element in a document, found null."),
    );
  });

  it("rejects options that are not an object, and properties that are not options", () => {
    const scene = createScene();
    expect(() => mountTools(scene.host, JSON.parse("null"))).toThrow(
      new DataError("The options must be an object, found null."),
    );
    expect(() => mountTools(scene.host, { ...options(scene), extra: 1 } as never)).toThrow(
      new DataError(
        'The options has the properties "messages", "language", "stage", "assets", "slots" and "onSupport", found "extra".',
      ),
    );
  });

  it("rejects an option of the wrong type with a sentence that names it", () => {
    const scene = createScene();
    const mount = (overrides: Record<string, unknown>) => () =>
      mountTools(scene.host, { ...options(scene), ...overrides } as never);
    expect(mount({ messages: JSON.parse("null") })).toThrow(
      new DataError("The option messages is invalid: expected an object, found null."),
    );
    expect(mount({ messages: { ...EN_MESSAGES, toolRule: 5 } })).toThrow(
      new DataError("The option messages is invalid at toolRule: expected a string, found 5."),
    );
    expect(mount({ language: 5 })).toThrow(new DataError("The option language must be a string, found 5."));
    expect(mount({ stage: JSON.parse("{}") })).toThrow(
      new DataError("The option stage must be an element in a document, found an object."),
    );
    expect(mount({ assets: "x" })).toThrow(new DataError('The option assets must be a function, found "x".'));
    expect(mount({ onSupport: JSON.parse("null") })).toThrow(
      new DataError("The option onSupport must be a function, found null."),
    );
    expect(mount({ slots: JSON.parse("null") })).toThrow(
      new DataError("The option slots must be an object, found null."),
    );
    expect(mount({ slots: { dictionary: 1 } })).toThrow(
      new DataError("The slot dictionary of the option slots must be a function, found 1."),
    );
    expect(mount({ slots: { lexicon: () => undefined } })).toThrow(DataError);
  });

  it("rejects a stage that is not positioned, which the layer of the tools could not lie over", () => {
    const scene = createScene();
    const plain = document.createElement("div");
    document.body.append(plain);
    cleanups.push(() => plain.remove());
    expect(() => mountTools(scene.host, { ...options(scene), stage: plain })).toThrow(
      new DataError("The option stage must be positioned: its position must not be static."),
    );
  });

  it("rejects an input that is not valid, and leaves the tools that are shown", async () => {
    const scene = createScene();
    scene.show(items({ rules: [RULE_XML] }));
    await userEvent.click(toolbarButton(scene, "Ruler"));
    expect(() => scene.tools.update(JSON.parse('{"companion": 1, "supports": []}'))).toThrow(
      new DataError("The tools input is invalid at companion: expected an object, found 1."),
    );
    expect(() => scene.tools.update(JSON.parse("null"))).toThrow(
      new DataError("The tools input is invalid: expected an object, found null."),
    );
    expect(overlayOf(scene, "Ruler")).not.toBeNull();
  });
});
