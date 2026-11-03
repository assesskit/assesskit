import { type ItemSessionControl, readAsi } from "@assesskit/runtime/asi";
import type { DeliveryEvent } from "@assesskit/runtime/delivery";
import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import { createLocalSession } from "../src/client/local/index.js";
import { mountDelivery } from "../src/player/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { fakeClock } from "./exam-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";
import { waitFor } from "./wait.js";

/** A second in milliseconds. */
export const SECOND = 1000;

const player = new CSSStyleSheet();
player.replaceSync(PLAYER_CSS);

const pages: HTMLElement[] = [];

/** Removes the pages that the tests mounted. */
export function removeHintPages(): void {
  for (const page of pages.splice(0)) page.remove();
}

/** The player on an item with hints, over a session of the device whose engine puts the outcomes in its events. */
export interface HintPlayer {
  /** The session client that the player drives. */
  readonly client: Awaited<ReturnType<typeof createLocalSession>>;
  /** The clock of the session, which a test moves. */
  readonly clock: ReturnType<typeof fakeClock>;
  /** The events of the steps that the session saved, in order. */
  readonly events: DeliveryEvent[];
  /** The element the player is mounted in. */
  readonly page: HTMLElement;
  /** The chrome of the player. */
  readonly ui: ShadowRoot;
}

/** Mounts the player on an item delivered alone, with `eventOutcomes` on, and collects the events of its steps. */
export async function startHints(itemXml: string, control?: ItemSessionControl): Promise<HintPlayer> {
  const parsed = readAsi(itemXml);
  if (parsed.kind !== "item") throw new Error("The fixture is not an item.");
  const clock = fakeClock();
  const saved = new Map<string, string>();
  const client = await createLocalSession({
    definition: {
      kind: "item",
      item: parsed.item,
      base: `items/${parsed.item.identifier}.xml`,
      ...(control === undefined ? {} : { control }),
    },
    engine: { eventOutcomes: true },
    store: {
      load: async (session) => saved.get(session),
      save: async (session, { state }) => void saved.set(session, state),
    },
    session: "hints-1",
    seed: 1,
    assets: (path) => `https://assets.example/${path}`,
    clock,
  });
  const events: DeliveryEvent[] = [];
  client.host.subscribeSteps((step) => events.push(...step));
  const page = document.createElement("div");
  document.body.append(page);
  pages.push(page);
  mountDelivery(page, {
    client,
    files: {
      upload: async () => ({ reference: "f", mimeType: "image/png" }),
      read: async () => new Uint8Array(),
      url: () => "",
      ...NO_RECORDING,
    },
    staticUrl: "https://assets.example/static/",
    stylesheet: player,
    fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
  });
  return { client, clock, events, page, ui: page.shadowRoot as ShadowRoot };
}

/** The shadow root of the content of the item. */
const contentOf = (ui: ShadowRoot): ShadowRoot =>
  (ui.querySelector(".ak-content-host") as HTMLElement).shadowRoot as ShadowRoot;

/** Waits until the player shows the choices of the item. */
export const shown = (hints: HintPlayer): Promise<void> =>
  waitFor(() => expect(contentOf(hints.ui).querySelector("qti-choice-interaction")).not.toBeNull());

/** Finds the button with the name, in the body of the item or in the chrome. */
function buttonNamed(hints: HintPlayer, name: string): HTMLButtonElement {
  const buttons = [...hints.ui.querySelectorAll("button"), ...contentOf(hints.ui).querySelectorAll("button")];
  const found = buttons.find((button) => button.textContent?.trim() === name);
  if (found === undefined) throw new Error(`The page has no button ${JSON.stringify(name)}.`);
  return found;
}

/** The text of each feedback block that the item shows. */
export const hintsShown = (hints: HintPlayer): string[] =>
  [...contentOf(hints.ui).querySelectorAll("qti-feedback-block")]
    .filter((block) => (block as HTMLElement).checkVisibility())
    .map((block) => block.textContent?.trim() ?? "");

/** Presses the button with the name and waits until the session has taken the action: its view is another. */
export async function press(hints: HintPlayer, name: string): Promise<void> {
  const before = hints.client.view;
  buttonNamed(hints, name).click();
  await waitFor(() => expect(hints.client.view).not.toBe(before));
}

/** Gives the answer that is the choice with the text. */
export async function choose(hints: HintPlayer, text: string): Promise<void> {
  const input = [...contentOf(hints.ui).querySelectorAll<HTMLInputElement>("input.ak-control")].find((each) =>
    each.closest("qti-simple-choice")?.textContent?.includes(text),
  );
  if (input === undefined) throw new Error(`The item has no choice ${JSON.stringify(text)}.`);
  await userEvent.click(input);
  await waitFor(() => expect(input.checked).toBe(true));
}

/** The events with which response processing ran, one for each attempt. */
export const processed = (hints: HintPlayer): DeliveryEvent[] =>
  hints.events.filter(({ type }) => type === "response-processed");

/** The wire form of a single integer outcome. */
export const wireInteger = (value: number) => ({
  cardinality: "single",
  baseType: "integer",
  value: { base: { integer: value } },
});

/** The wire form of a single float outcome. */
export const wireFloat = (value: number) => ({
  cardinality: "single",
  baseType: "float",
  value: { base: { float: value } },
});

/** The wire form of a single identifier outcome. */
export const wireIdentifier = (value: string) => ({
  cardinality: "single",
  baseType: "identifier",
  value: { base: { identifier: value } },
});
