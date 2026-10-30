import { ReadError, SecurityError } from "@luthfanwakan/olah";
import { type AssessmentItem, readAsi } from "@luthfanwakan/olah/asi";
import { checkResponse, describeInteractions, type InteractionKind } from "@luthfanwakan/olah/interactions";
import { afterEach, describe, expect, inject, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { EN_MESSAGES } from "../src/index.js";
import { createContentRoot, createInteractionRenderers, InteractionElement } from "../src/player/index.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { memoryFiles, settle } from "./graphic-fixture.js";
import { STATIC_URL } from "./interactions-fixture.js";
import { axeViolations } from "./renderer-fixture.js";

const { asset } = inject("fixtures");

/** The kinds of interaction that TB8 draws. */
const GRAPHIC: ReadonlySet<InteractionKind> = new Set([
  "hotspot-interaction",
  "select-point-interaction",
  "graphic-order-interaction",
  "graphic-associate-interaction",
  "graphic-gap-match-interaction",
  "position-object-interaction",
  "drawing-interaction",
]);

interface Example {
  readonly path: string;
  readonly item: AssessmentItem;
  readonly kinds: readonly InteractionKind[];
}

const examples: Example[] = [];
for (const { path, text } of await commands.corpusFiles()) {
  if (!path.endsWith(".xml")) continue;
  try {
    const document = readAsi(text, { path });
    if (document.kind !== "item") continue;
    const kinds = describeInteractions(document.item).flatMap(({ kind }) => (GRAPHIC.has(kind) ? [kind] : []));
    if (kinds.length > 0) examples.push({ path, item: document.item, kinds });
  } catch (error) {
    if (!(error instanceof ReadError || error instanceof SecurityError)) throw error;
  }
}

/** Returns whether a node is the element of one of the graphic interactions. */
const isGraphic = (node: Element): node is InteractionElement =>
  node instanceof InteractionElement && GRAPHIC.has(node.kind);

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe("the graphic items of the examples of 1EdTech", () => {
  it("[T35][T36][T37][T38][T39][T40][T44] finds a graphic item of each kind among the examples", () => {
    const kinds = new Set(examples.flatMap(({ kinds: found }) => found));
    expect([...kinds].sort()).toEqual([...GRAPHIC].sort());
    expect(examples.length).toBeGreaterThanOrEqual(20);
  });

  it("[T35][T36][T37][T38][T39][T40][T44][X] renders every graphic item, accepts an answer in each interaction, and logs no error", async () => {
    await commands.watchConsole();
    const token = crypto.randomUUID();
    let answered = 0;
    for (const { path, item } of examples) {
      const { files } = memoryFiles();
      const host = document.createElement("div");
      document.body.append(host);
      hosts.push(host);
      const content = createContentRoot(host, {
        messages: EN_MESSAGES,
        assets: (file) => `${asset}/c/${token}/corpus/${file}`,
        fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
        stylesheet: stylesheet(PLAYER_CSS),
        interactions: createInteractionRenderers({ messages: EN_MESSAGES, files, staticUrl: STATIC_URL }),
      });
      await content.show({ body: { nodes: item.body?.children ?? [], base: path } });
      const descriptors = describeInteractions(item);
      const graphic = descriptors.filter(({ kind }) => GRAPHIC.has(kind));
      const elements = [...content.root.querySelectorAll("*")].filter(isGraphic);
      expect(elements, path).toHaveLength(graphic.length);
      elements.forEach((element, index) => {
        element.descriptor = graphic[index] ?? expect.fail(`${path}: no descriptor`);
      });
      // The pictures come from the package: a picture that fails to load is a missing file, which the console reports.
      await Promise.all(
        [...content.root.querySelectorAll("img")].map((image) =>
          image.decode().catch(() => expect.fail(`${path}: ${image.src} did not load`)),
        ),
      );
      await settle();
      for (const [index, element] of elements.entries()) {
        const descriptor = graphic[index];
        if (descriptor === undefined) throw new Error(`${path}: no descriptor`);
        await answerWith(element, descriptor.kind, path);
        await element.settled();
        expect(element.value, `${path}: ${descriptor.kind} took no answer`).not.toBeNull();
        const { reasons } = checkResponse(descriptor, element.value);
        expect(reasons, `${path}: ${descriptor.kind}`).not.toContain("binding");
        expect(reasons, `${path}: ${descriptor.kind}`).not.toContain("unknown-choice");
        answered += 1;
      }
      expect(await axeViolations(host), path).toEqual([]);
    }
    expect(answered).toBeGreaterThanOrEqual(20);
    expect(await commands.consoleErrors()).toEqual([]);
  }, 120_000);
});

/** Gives an answer the way a candidate does with a pointer: a few clicks on what the interaction shows. */
async function answerWith(element: InteractionElement, kind: InteractionKind, path: string): Promise<void> {
  const faces = [...element.querySelectorAll<HTMLElement>("label.tempuh-face")].filter(
    (face) => !face.closest("[hidden]"),
  );
  const surface = element.querySelector<HTMLElement>(".tempuh-surface");
  const pick = (index: number): HTMLElement => faces[index] ?? expect.fail(`${path}: ${kind} has no hotspot ${index}`);
  switch (kind) {
    case "hotspot-interaction":
      await userEvent.click(pick(0));
      break;
    case "graphic-order-interaction":
      for (const face of faces) await userEvent.click(face);
      break;
    case "graphic-associate-interaction":
      await userEvent.click(pick(0));
      await userEvent.click(pick(1));
      break;
    case "graphic-gap-match-interaction":
      await userEvent.click(
        element.querySelector<HTMLElement>("button.tempuh-token:not(:disabled)") ?? expect.fail(`${path}: no choice`),
      );
      await userEvent.click(element.querySelector<HTMLElement>("button.tempuh-drop") ?? expect.fail(`${path}: no gap`));
      break;
    case "select-point-interaction":
      await userEvent.click(surface ?? expect.fail(`${path}: no surface`));
      break;
    case "position-object-interaction":
      await userEvent.click(
        element.querySelector<HTMLElement>("button.tempuh-pick") ?? expect.fail(`${path}: no object`),
      );
      await userEvent.click(surface ?? expect.fail(`${path}: no surface`));
      break;
    default:
      await userEvent.click(
        element.querySelector<HTMLElement>('button[data-tool="line"]') ?? expect.fail(`${path}: no tool`),
      );
      await userEvent.click(surface ?? expect.fail(`${path}: no surface`), { position: { x: 5, y: 5 } });
      await userEvent.click(surface ?? expect.fail(`${path}: no surface`), { position: { x: 60, y: 60 } });
  }
}
