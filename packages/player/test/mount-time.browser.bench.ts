import { ASI_NAMESPACE, readAsi } from "@assesskit/runtime/asi";
import { afterEach, describe, expect, inject, it } from "vitest";
import { commands } from "vitest/browser";
import { createLocalSession, type LocalStore } from "../src/client/index.js";
import { EN_MESSAGES } from "../src/index.js";
import { mountDelivery, mountItem, mountTools } from "../src/player/index.js";
import { PLAYER_CSS } from "./css-fixture.js";
import { examDefinition, fakeClock } from "./exam-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";
import { CPU_SLOWDOWN, HIGHLIGHT_WORDS, LESSON_ITEMS, MOUNT_BUDGETS, SAMPLES } from "./mount-budgets.js";
import { supportView } from "./supports-fixture.js";

const player = new CSSStyleSheet();
player.replaceSync(PLAYER_CSS);

const files = {
  upload: async () => ({ reference: "f", mimeType: "image/png" }),
  read: async () => new Uint8Array(),
  url: () => "",
  ...NO_RECORDING,
};
const fetcher = async () => ({ ok: false, status: 404, text: async () => "" });
const ignore = (): void => undefined;
const clock = fakeClock();

const hosts: HTMLElement[] = [];
afterEach(async () => {
  await commands.throttleCpu(1);
  for (const host of hosts.splice(0)) host.remove();
});

/** Resolves at the first frame in which the condition holds. */
function untilFrame(condition: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => (condition() ? resolve() : void requestAnimationFrame(check));
    check();
  });
}

/** A store in memory for the state of a local session. */
function memoryStore(): LocalStore {
  const saved = new Map<string, string>();
  return {
    load: async (session) => saved.get(session),
    save: async (session, { state }) => void saved.set(session, state),
  };
}

/** Whether the content root of a mount has drawn the body of its item. */
const drawn = (host: HTMLElement): boolean => {
  const content = host.shadowRoot?.querySelector<HTMLElement>(".ak-content-host");
  return (content?.shadowRoot?.querySelector(".ak-body")?.textContent ?? "") !== "";
};

/** An element in the page for a mount. */
function newHost(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  return host;
}

/** Times one `mountDelivery` over the fixture test, until its first item is on the page. */
async function timeDelivery(): Promise<number> {
  const client = await createLocalSession({
    definition: examDefinition(),
    store: memoryStore(),
    session: "bench",
    seed: 1,
    assets: (path) => `${inject("fixtures").asset}/${path}`,
    clock,
  });
  const host = newHost();
  const began = performance.now();
  const mounted = mountDelivery(host, {
    client,
    files,
    staticUrl: `${inject("fixtures").asset}/static/`,
    stylesheet: player,
    fetch: fetcher,
    hooks: { onError: ignore },
  });
  await untilFrame(() => drawn(host));
  const took = performance.now() - began;
  mounted.destroy();
  client.close();
  return took;
}

const lessonItem = (id: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-item xmlns="${ASI_NAMESPACE}" identifier="${id}" title="Item ${id}" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1">
      <qti-prompt>Choose one.</qti-prompt>
      <qti-simple-choice identifier="A">Alpha</qti-simple-choice>
      <qti-simple-choice identifier="B">Beta</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
</qti-assessment-item>`;

/** Times the mounts of a lesson page with {@link LESSON_ITEMS} items, until every item is on the page. */
async function timeLesson(): Promise<number> {
  const page = newHost();
  const slots = await Promise.all(
    Array.from({ length: LESSON_ITEMS }, async (_, index) => {
      const parsed = readAsi(lessonItem(`l${index}`));
      if (parsed.kind !== "item") throw new Error("The fixture is not an item.");
      const client = await createLocalSession({
        definition: { kind: "item", item: parsed.item, base: `items/l${index}.xml` },
        store: memoryStore(),
        session: `bench-${index}`,
        seed: 1,
        assets: (path) => `${inject("fixtures").asset}/${path}`,
        clock,
      });
      const host = document.createElement("div");
      page.append(host);
      return { host, client };
    }),
  );
  const began = performance.now();
  const mounted = slots.map(({ host, client }) =>
    mountItem(host, {
      client,
      files,
      staticUrl: `${inject("fixtures").asset}/static/`,
      stylesheet: player,
      fetch: fetcher,
      hooks: { onError: ignore },
    }),
  );
  await untilFrame(() => slots.every(({ host }) => drawn(host)));
  const took = performance.now() - began;
  for (const each of mounted) each.destroy();
  for (const { client } of slots) client.close();
  return took;
}

/** Times turning on the highlighter over a passage of {@link HIGHLIGHT_WORDS} words, until its words are found, measured and drawn. */
function timeHighlighter(): Promise<number> {
  const stage = document.createElement("div");
  stage.style.cssText = "position: relative; width: 600px; font: 16px/24px sans-serif;";
  const lengths = ["a", "word", "longer", "passage", "typeset", "of", "text", "between", "lines", "and"];
  for (let paragraph = 0; paragraph < HIGHLIGHT_WORDS / 20; paragraph += 1) {
    const words = Array.from({ length: 20 }, (_, index) => lengths[(paragraph + index) % lengths.length]);
    const element = document.createElement("p");
    element.textContent = words.join(" ");
    stage.append(element);
  }
  const host = newHost();
  document.body.append(stage);
  hosts.push(stage);
  const tools = mountTools(host, {
    messages: EN_MESSAGES,
    language: "en",
    stage,
    assets: (path) => path,
    onSupport: ignore,
  });
  const began = performance.now();
  tools.update({ companion: null, supports: [supportView("ext:highlighter", { state: "active", active: true })] });
  const took = performance.now() - began;
  tools.destroy();
  return Promise.resolve(took);
}

/** Returns the fastest of the samples of a timing. */
async function fastest(time: () => Promise<number>): Promise<number> {
  const times: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) times.push(await time());
  return Math.min(...times);
}

describe(`the mount time with the CPU slowed ${CPU_SLOWDOWN} times`, () => {
  it("brings the first item of mountDelivery onto the page within its budget", async ({ annotate }) => {
    await commands.throttleCpu(CPU_SLOWDOWN);
    const took = await fastest(timeDelivery);
    await annotate(`mountDelivery: fastest ${took.toFixed(2)} ms, budget ${MOUNT_BUDGETS.delivery} ms`);
    expect(took, "the fastest sample of mountDelivery, in milliseconds").toBeLessThan(MOUNT_BUDGETS.delivery);
  });

  it("brings the items of a lesson page of ten mountItem calls onto the page within its budget", async ({
    annotate,
  }) => {
    await commands.throttleCpu(CPU_SLOWDOWN);
    const took = await fastest(timeLesson);
    await annotate(`lesson page: fastest ${took.toFixed(2)} ms, budget ${MOUNT_BUDGETS.lesson} ms`);
    expect(took, "the fastest sample of the lesson page, in milliseconds").toBeLessThan(MOUNT_BUDGETS.lesson);
  });

  it("turns the highlighter on over a passage of 2,000 words within its budget", async ({ annotate }) => {
    await commands.throttleCpu(CPU_SLOWDOWN);
    const took = await fastest(timeHighlighter);
    await annotate(`highlighter: fastest ${took.toFixed(2)} ms, budget ${MOUNT_BUDGETS.highlighter} ms`);
    expect(took, "the fastest sample of the highlighter, in milliseconds").toBeLessThan(MOUNT_BUDGETS.highlighter);
  });
});
