import { ReadError, SecurityError } from "@assesskit/runtime";
import { type AssessmentItem, readAsi } from "@assesskit/runtime/asi";
import { checkResponse, describeInteractions } from "@assesskit/runtime/interactions";
import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import type { InteractionElement } from "../src/player/index.js";
import { mountItem, type Scene } from "./interactions-fixture.js";
import { axeViolations } from "./renderer-fixture.js";

interface Example {
  readonly path: string;
  readonly item: AssessmentItem;
}

const examples: Example[] = [];
for (const { path, text } of await commands.corpusFiles()) {
  if (!path.endsWith(".xml")) continue;
  try {
    const document = readAsi(text, { path });
    if (document.kind === "item") examples.push({ path, item: document.item });
  } catch (error) {
    if (!(error instanceof ReadError || error instanceof SecurityError)) throw error;
  }
}

/** The kinds that the player draws; the others are placeholders. */
const DRAWN: ReadonlySet<string> = new Set([
  "associate-interaction",
  "choice-interaction",
  "custom-interaction",
  "end-attempt-interaction",
  "extended-text-interaction",
  "gap-match-interaction",
  "hottext-interaction",
  "inline-choice-interaction",
  "match-interaction",
  "media-interaction",
  "order-interaction",
  "slider-interaction",
  "text-entry-interaction",
  "upload-interaction",
]);

/** Rules that a response of the candidate's own never breaks: it names choices of the interaction, with its binding. */
const DATA_ERRORS = ["binding", "unknown-choice", "repeated-choice"];

/** Returns the elements of a selector inside an element. */
const all = (scope: ParentNode, selector: string): HTMLElement[] => [...scope.querySelectorAll<HTMLElement>(selector)];

/** Picks the first choice up and puts it in a place with room, with the buttons of a board. */
function placeFirst(element: InteractionElement): void {
  const [token] = all(element, ".ak-choices button.ak-token");
  const [drop] = all(element, "button.ak-drop");
  if (token === undefined || drop === undefined) throw new Error("The board has no choice or no place.");
  token.click();
  drop.click();
}

/** Types a text in a field, as the events of a keyboard do. */
function type(field: HTMLElement, text: string): void {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = text;
  else field.textContent = text;
  field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

/**
 * Gives one answer to an interaction through its controls: it presses what the candidate sees, such as the face of a choice,
 * so that the label that ties it to its control works too. Returns whether the interaction could be answered.
 */
function answer(element: InteractionElement): boolean {
  switch (element.kind) {
    case "choice-interaction":
    case "hottext-interaction": {
      const [face] = all(element, "label.ak-face");
      face?.click();
      return face !== undefined;
    }
    case "inline-choice-interaction": {
      const menu = element.querySelector("select");
      const option = menu?.options[1];
      if (menu === null || menu === undefined || option === undefined) return false;
      menu.value = option.value;
      menu.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    case "text-entry-interaction":
    case "extended-text-interaction": {
      const [field] = all(element, "input, textarea, [role=textbox]");
      if (field !== undefined) type(field, "1");
      return field !== undefined;
    }
    case "slider-interaction": {
      const thumb = element.querySelector("[role=slider]");
      thumb?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
      return thumb !== null;
    }
    case "order-interaction":
    case "gap-match-interaction":
      placeFirst(element);
      return true;
    case "associate-interaction":
      placeFirst(element);
      placeFirst(element);
      return true;
    case "match-interaction": {
      const [cell] = all(element, "td input");
      if (cell === undefined) placeFirst(element);
      else cell.click();
      return true;
    }
    case "end-attempt-interaction":
      all(element, "button")[0]?.click();
      return true;
    default:
      return false;
  }
}

/** Returns the interactions of a scene that the player draws, in document order. */
function drawn(scene: Scene): InteractionElement[] {
  return [...scene.descriptors.values()]
    .filter(({ kind }) => DRAWN.has(kind))
    .map(({ responseIdentifier }) => scene.interaction(responseIdentifier));
}

describe("the examples of 1EdTech", () => {
  it("[T26][T27][T28][T29][T30][T31][T32][T33][T34][T41][T45][T42][T43][X] finds items for every kind that the player draws, but the custom interaction", () => {
    const kinds = new Set<string>(examples.flatMap(({ item }) => describeInteractions(item).map(({ kind }) => kind)));
    for (const kind of DRAWN) {
      if (kind !== "custom-interaction") expect(kinds.has(kind), kind).toBe(true);
    }
  });

  it("[T26][T27][T28][T29][T30][T31][T32][T33][T34][T41][T45][X] draws every interaction of every item, as the descriptors of the runtime say, and lets the candidate answer it", async () => {
    await commands.watchConsole();
    let answered = 0;
    for (const { path, item } of examples) {
      const scene = mountItem(item, { base: path });
      const interactions = drawn(scene);
      for (const element of interactions) {
        const events = scene.responses.length;
        const ended: string[] = [];
        scene.root.addEventListener("ak-end-attempt", (event) => ended.push(event.detail.responseIdentifier));
        const could = answer(element);
        if (!could) continue;
        answered += 1;
        if (element.kind === "end-attempt-interaction") {
          expect(ended, `${path} ${element.responseIdentifier}`).toEqual([element.responseIdentifier]);
          continue;
        }
        const given = scene.responses
          .slice(events)
          .find(({ responseIdentifier }) => responseIdentifier === element.responseIdentifier);
        expect(given, `${path} ${element.kind} ${element.responseIdentifier} gave a response`).toBeDefined();
        const descriptor = scene.descriptors.get(element.responseIdentifier);
        if (descriptor === undefined) throw new Error(`${path}: no descriptor`);
        const { reasons } = checkResponse(descriptor, given?.value ?? null);
        expect(
          reasons.filter((reason) => DATA_ERRORS.includes(reason)),
          `${path} ${element.kind} ${element.responseIdentifier}`,
        ).toEqual([]);
      }
      scene.host.remove();
    }
    expect(answered).toBeGreaterThan(300);
    expect(await commands.consoleErrors()).toEqual([]);
  }, 600_000);

  it("[T26][T27][T28][T29][T30][T31][T32][T33][T34][T41][X] has no violation of WCAG 2.2 A and AA in any interaction of the examples that the player draws", async () => {
    const found: string[] = [];
    for (const { path, item } of examples) {
      const scene = mountItem(item, { base: path });
      for (const element of drawn(scene)) {
        // MathML that MathJax has not typeset has no name that axe can compute; the test of the elements checks that it has one after.
        if (element.querySelector("math") !== null) continue;
        for (const violation of await axeViolations(element))
          found.push(`${path} ${element.responseIdentifier}: ${violation}`);
      }
      scene.host.remove();
    }
    expect(found).toEqual([]);
  }, 600_000);
});
