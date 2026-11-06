import { EN_MESSAGES } from "@assesskit/player";
import { mountPciFrame, type PciEvent, type PciFrame, type PciStatus } from "../../../player/src/player/pci/index.js";
import { createRandom } from "@assesskit/runtime";
import { createScoringOperators } from "@assesskit/runtime/operators";
import { createItemVariables, runResponseProcessing } from "@assesskit/runtime/processing";
import type { Value } from "@assesskit/runtime/values";
import { afterEach, expect, inject } from "vitest";
import { commands, server, userEvent } from "vitest/browser";
import { waitFor } from "../../../player/test/wait.js";
import { interactionOf } from "./items.js";

/** The asset origin of the global setup. */
const asset = inject("assetOrigin");

/** A frame that a test mounted, with the events of the player and the token of its package's paths. */
export interface Mounted {
  readonly frame: PciFrame;
  readonly events: PciEvent[];
  readonly title: string;
  readonly token: string;
}

/** The options of {@link mount}: the frame's title, which is the item's prompt, and the response and state to restore. */
export interface MountOptions {
  readonly title: string;
  readonly status?: PciStatus;
  readonly state?: string | null;
  readonly value?: Value | null;
  readonly language?: string;
}

const mounted: { readonly frame: PciFrame; readonly host: HTMLElement }[] = [];

/** The fields of the page around the frames, which the test removes after it. */
const around: HTMLElement[] = [];

/**
 * Mounts the one interaction of an item in the player's frame, its package under a token of its own on the asset origin,
 * with the module files that `pnpm build` writes in `modules/`.
 */
export function mount(xml: string, options: MountOptions): Mounted {
  const { interaction, declaration } = interactionOf(xml);
  const token = crypto.randomUUID();
  const events: PciEvent[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const frame = mountPciFrame(host, {
    staticUrl: `${asset}/static/`,
    messages: EN_MESSAGES,
    language: options.language ?? "en",
    interaction,
    configuration: {},
    assets: (path) => `${asset}/g/${token}/${path}`,
    prompt: options.title,
    markup: "<qti-interaction-markup></qti-interaction-markup>",
    stylesheets: [],
    status: options.status ?? "interacting",
    state: options.state ?? null,
    response: {
      value: options.value ?? null,
      declaration: { cardinality: declaration.cardinality, baseType: declaration.baseType },
    },
    files: {
      read: () => Promise.reject(new Error("The interaction has no files.")),
      upload: () => Promise.reject(new Error("The interaction has no files.")),
    },
    onEvent: (event) => events.push(event),
  });
  mounted.push({ frame, host });
  return { frame, events, title: options.title, token };
}

afterEach(async () => {
  for (const { frame, host } of mounted.splice(0)) {
    await frame.destroy();
    host.remove();
  }
  for (const field of around.splice(0)) field.remove();
});

/** A text field of the page with a name, which the test removes after it. */
function pageField(label: string): HTMLInputElement {
  const input = document.createElement("input");
  input.setAttribute("aria-label", label);
  around.push(input);
  return input;
}

/**
 * Puts a text field of the page before the frames that a test mounted and one after them, which a keyboard leaves a frame
 * for: text fields, because Safari's default is to skip buttons when Tab moves the focus.
 */
export function surround(): { readonly before: HTMLInputElement; readonly after: HTMLInputElement } {
  const before = pageField("Before");
  const after = pageField("After");
  document.body.prepend(before);
  document.body.append(after);
  return { before, after };
}

/**
 * Gives a field of the page the focus and waits for it. The window of the test page takes the focus first: after a test that
 * removed a frame with the focus, the first press of the next test otherwise does not move on from the field.
 */
export async function focusOn(field: HTMLElement): Promise<void> {
  window.focus();
  field.focus();
  await waitFor(() => expect(document.hasFocus() && document.activeElement === field).toBe(true));
}

/**
 * Whether the engine has two stops of its own at a frame: Firefox stops at the frame's document when Tab comes from the page
 * before it, and at the frame with its document unfocused when Tab or Shift+Tab leaves it.
 */
export const STOPS_AT_FRAME = server.browser === "firefox";

/** Whether Tab passes the buttons of a frame: Safari's default on macOS, where Playwright's WebKit on Linux stops at them. */
export const SKIPS_BUTTONS = server.browser === "webkit" && server.platform === "darwin";

/**
 * Presses Tab, or Shift+Tab, once and waits for the stop that it leads to. The focus reaches the page and a frame at different
 * times, so a read may come before it lands: with the stop named, the read waits, where a second press would go past the stop.
 */
export async function tabTo(stop: () => Promise<boolean> | boolean, shift = false): Promise<void> {
  await userEvent.tab({ shift });
  await waitFor(async () => expect(await stop()).toBe(true));
}

/** Whether a frame's document has the focus, and the frame is the page's active element. */
export const inFrame =
  ({ frame, title }: Mounted) =>
  async (): Promise<boolean> =>
    document.activeElement === frame.element && (await commands.readInFrame(title, "document.hasFocus()")) === true;

/** Presses Tab or Shift+Tab from an element of a frame to a field of the page, past the stop of the engine at the frame. */
export async function tabOut({ frame, title }: Mounted, field: HTMLElement, shift = false): Promise<void> {
  if (STOPS_AT_FRAME) {
    const unfocused = async () =>
      document.activeElement === frame.element && (await commands.readInFrame(title, "document.hasFocus()")) === false;
    await tabTo(unfocused, shift);
  }
  await tabTo(() => document.activeElement === field, shift);
}

/** Waits until the interaction of a frame is ready, and fails at once on a frame that failed. */
export async function ready({ events }: Mounted): Promise<void> {
  await waitFor(() => expect(events[0]?.type).toBe("ready"));
}

/** The response that the interaction told last, after the frame has handed over what it holds; `undefined` for none. */
export async function responseOf({ frame, events }: Mounted): Promise<Value | null | undefined> {
  await frame.settled();
  const told = events.filter((event) => event.type === "changed" || event.type === "completed");
  const last = told.at(-1);
  return last !== undefined && "response" in last ? last.response : undefined;
}

/** The state that the interaction told last, after the frame has handed over what it holds. */
export async function stateOf({ frame, events }: Mounted): Promise<string | undefined> {
  await frame.settled();
  const told = events.filter((event) => event.type === "changed" || event.type === "ready");
  return told.at(-1)?.state;
}

/** Runs the response processing of an item on a response, with the scoring operators, and returns `SCORE`. */
export function scoreOf(xml: string, response: Value | null): Value | null | undefined {
  const { item } = interactionOf(xml);
  const variables = createItemVariables(item);
  const answered = { ...variables, responses: new Map(variables.responses).set("RESPONSE", response) };
  const context = { random: createRandom(1), customOperators: createScoringOperators() };
  return runResponseProcessing(item, answered, context).outcomes.get("SCORE");
}

/** The paths below the token of a test that the asset origin was asked for, without the token. */
export async function hitsOf({ token }: Mounted): Promise<readonly string[]> {
  const paths: readonly string[] = await (await fetch(`${asset}/__hits`, { cache: "no-store" })).json();
  return paths.filter((path) => path.startsWith(`/g/${token}/`)).map((path) => path.slice(`/g/${token}`.length));
}
