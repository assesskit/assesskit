import { EN_MESSAGES } from "@assesskit/player";
import { mountPciFrame, type PciEvent, type PciFrame, type PciStatus } from "../../../player/src/player/pci/index.js";
import { createRandom } from "@assesskit/runtime";
import { createScoringOperators } from "@assesskit/runtime/operators";
import { createItemVariables, runResponseProcessing } from "@assesskit/runtime/processing";
import type { Value } from "@assesskit/runtime/values";
import { afterEach, expect, inject } from "vitest";
import { userEvent } from "vitest/browser";
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
 * Presses Tab, or Shift+Tab, until a condition holds, six times at most: Firefox stops at a frame itself too, and Chromium
 * and Firefox at the buttons that Safari skips. A keyboard that a frame traps never meets it.
 */
export async function tabUntil(reached: () => Promise<boolean> | boolean, shift = false): Promise<void> {
  for (let presses = 0; presses < 6 && !(await reached()); presses++) await userEvent.tab({ shift });
  await waitFor(async () => expect(await reached()).toBe(true));
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
