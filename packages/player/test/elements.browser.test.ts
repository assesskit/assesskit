import { readAsi } from "@assesskit/runtime/asi";
import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import { describeInteractions } from "@assesskit/runtime/interactions";
import { INTERACTION_TYPES } from "@assesskit/runtime/metadata";
import { container, type FileValue, single, type Value } from "@assesskit/runtime/values";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { EN_MESSAGES, ID_MESSAGES, selectMessages } from "../src/index.js";
import { ExtendedTextInteractionElement, readRecordAttributes } from "../src/player/elements/internal.js";
import {
  createContentRoot,
  createInteractionRenderers,
  createMathTypesetter,
  defineElements,
  InteractionElement,
  type InteractionFiles,
  type InteractionOptions,
  MAX_RECORDING_SECONDS,
} from "../src/player/index.js";
import { RECORDER_START_LIMIT_MS } from "../src/player/recording/index.js";
import {
  audioContextRuns,
  fakeMicrophone,
  heardFor,
  needsAudio,
  suspendedAudioContext,
  trackAudioContexts,
} from "./audio.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";
import { mountScene, type Scene } from "./interactions-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { waitFor } from "./wait.js";

/** The declaration of a response variable. */
const declare = (cardinality: string, baseType: string, identifier = "R"): string =>
  `<qti-response-declaration identifier="${identifier}" cardinality="${cardinality}" base-type="${baseType}"/>`;

describe("choice", () => {
  const Body = (attributes: string): string => `<qti-choice-interaction response-identifier="R" ${attributes}>
    <qti-prompt>Which?</qti-prompt>
    <qti-simple-choice identifier="A">Alpha</qti-simple-choice>
    <qti-simple-choice identifier="B">Beta</qti-simple-choice>
    <qti-simple-choice identifier="C">Gamma</qti-simple-choice>
  </qti-choice-interaction>`;

  it("gives a radio button for each choice where at most one may be selected, and a single value", async () => {
    const scene = mountScene(declare("single", "identifier"), Body(""));
    const inputs = scene.findAll<HTMLInputElement>("input");
    expect(inputs.map(({ type }) => type)).toEqual(["radio", "radio", "radio"]);
    expect(scene.interaction().getAttribute("role")).toBe("radiogroup");
    await userEvent.click(inputs[1] ?? scene.host);
    expect(scene.responses.at(-1)).toEqual({ responseIdentifier: "R", value: single("identifier", "B") });
    await userEvent.click(inputs[2] ?? scene.host);
    expect(scene.responses.at(-1)?.value).toEqual(single("identifier", "C"));
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("gives a checkbox for each choice where several may be selected, and the identifiers in the order of the choices", async () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="0"'));
    const inputs = scene.findAll<HTMLInputElement>("input");
    expect(inputs.map(({ type }) => type)).toEqual(["checkbox", "checkbox", "checkbox"]);
    expect(scene.interaction().getAttribute("role")).toBe("group");
    await userEvent.click(inputs[2] ?? scene.host);
    await userEvent.click(inputs[0] ?? scene.host);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "identifier", ["A", "C"]));
    await userEvent.click(inputs[0] ?? scene.host);
    await userEvent.click(inputs[2] ?? scene.host);
    expect(scene.responses.at(-1)?.value).toBeNull();
  });

  it("keeps the order of the choices of the view, and puts the control before the face that names it", () => {
    const scene = mountScene(declare("single", "identifier"), Body(""));
    const choices = scene.findAll("qti-simple-choice");
    expect(choices.map((choice) => choice.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    for (const choice of choices) {
      const [control, face] = [...choice.children];
      expect(control?.classList.contains("ak-control")).toBe(true);
      expect(face?.classList.contains("ak-face")).toBe(true);
      expect(face?.getAttribute("for")).toBe(control?.id);
    }
  });

  it("shows the value that the host sets and locks the controls when it is disabled, without a response", () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="0"'));
    scene.setValue("R", container("multiple", "identifier", ["B", "C"]));
    expect(scene.findAll<HTMLInputElement>("input").map(({ checked }) => checked)).toEqual([false, true, true]);
    scene.interaction().disabled = true;
    expect(scene.findAll<HTMLInputElement>("input").every(({ disabled }) => disabled)).toBe(true);
    scene.setValue("R", null);
    expect(scene.findAll<HTMLInputElement>("input").some(({ checked }) => checked)).toBe(false);
    expect(scene.responses).toEqual([]);
  });

  it("sets the rows of a stack of several columns and the class of a horizontal orientation", () => {
    const scene = mountScene(
      declare("single", "identifier"),
      Body('class="qti-choices-stacking-2" orientation="horizontal"'),
    );
    expect(scene.interaction().style.getPropertyValue("--ak-rows")).toBe("2");
    expect(scene.interaction().classList.contains("qti-orientation-horizontal")).toBe(true);
  });

  it("says in text, tied to the controls, that too many choices are selected, in the words of the item", async () => {
    const scene = mountScene(
      declare("multiple", "identifier"),
      Body('max-choices="2" data-max-selections-message="Too many!"'),
    );
    const inputs = scene.findAll<HTMLInputElement>("input");
    for (const input of inputs) await userEvent.click(input);
    const hint = scene.find(".ak-hint");
    expect(hint.textContent).toBe("Too many!");
    expect(hint.getAttribute("role")).toBe("status");
    for (const input of inputs) {
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(hint.id);
    }
    expect(await axeViolations(scene.host)).toEqual([]);
    await userEvent.click(inputs[2] ?? scene.host);
    expect(hint.textContent).toBe("");
    expect(inputs[0]?.hasAttribute("aria-invalid")).toBe(false);
  });

  it("tells how many choices to select when the item has no text of its own", async () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="3" min-choices="2"'));
    await userEvent.click(scene.findAll<HTMLInputElement>("input")[0] ?? scene.host);
    expect(scene.find(".ak-hint").textContent).toBe("Select at least 2.");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("tells the limits that the candidate cannot guess, and none for a radio group", () => {
    const limits = mountScene(declare("multiple", "identifier"), Body('max-choices="3" min-choices="2"'));
    expect(limits.find(".ak-instruction").textContent).toBe("Select at least 2. Select at most 3.");
    const radio = mountScene(declare("single", "identifier"), Body('min-choices="1"'));
    expect(radio.find(".ak-instruction").textContent).toBe("");
  });

  it("is selected by the keyboard alone", async () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="0"'));
    const inputs = scene.findAll<HTMLInputElement>("input");
    // Safari on macOS leaves the form controls out of the tab order unless the person turns that on, so the test moves the
    // focus itself and checks that the keyboard operates what has it.
    first(inputs).focus();
    await userEvent.keyboard(" ");
    first(inputs, 2).focus();
    await userEvent.keyboard(" ");
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "identifier", ["A", "C"]));
    expect(inputs.every((input) => input.tabIndex === 0)).toBe(true);
  });

  it("rejects a descriptor of another interaction, a value that is not one, and a disabled that is not a boolean", () => {
    const scene = mountScene(declare("single", "identifier"), Body(""), { describe: false });
    const other = mountScene(declare("single", "identifier", "S"), Body("").replace('"R"', '"S"'));
    const element = scene.interaction();
    const foreign = other.descriptors.get("S");
    expect(() => {
      if (foreign !== undefined) element.descriptor = foreign;
    }).toThrow(DataError);
    expect(() => {
      element.value = JSON.parse('{"cardinality":"single"}');
    }).toThrow(DataError);
    expect(() => {
      element.disabled = JSON.parse('"yes"');
    }).toThrow(DataError);
    expect(() => {
      element.messages = JSON.parse("null");
    }).toThrow(DataError);
  });
});

describe("hottext", () => {
  const Body = (attributes: string): string => `<qti-hottext-interaction response-identifier="R" ${attributes}>
    <qti-prompt>Find the errors.</qti-prompt>
    <p>The <qti-hottext identifier="A">dog</qti-hottext> and the <qti-hottext identifier="B">cat</qti-hottext> sat on
    <em>the <qti-hottext identifier="C">mat</qti-hottext></em>.</p>
  </qti-hottext-interaction>`;

  it("makes the text of each hot text the face of its control, in the running text", async () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="2"'));
    expect(scene.find("p").textContent?.replaceAll(/\s+/gu, " ").trim()).toBe("The dog and the cat sat on the mat.");
    const inputs = scene.findAll<HTMLInputElement>("qti-hottext > input");
    expect(inputs.map(({ type }) => type)).toEqual(["checkbox", "checkbox", "checkbox"]);
    await userEvent.click(scene.find("qti-hottext + * , qti-hottext > label"));
    await userEvent.click(inputs[2] ?? scene.host);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "identifier", ["A", "C"]));
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("gives a single value where at most one hot text may be selected", async () => {
    const scene = mountScene(declare("single", "identifier"), Body(""));
    const inputs = scene.findAll<HTMLInputElement>("qti-hottext > input");
    expect(inputs.map(({ type }) => type)).toEqual(["radio", "radio", "radio"]);
    await userEvent.click(inputs[1] ?? scene.host);
    expect(scene.responses.at(-1)?.value).toEqual(single("identifier", "B"));
  });

  it("shows the value of the host", () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="2"'));
    scene.setValue("R", container("multiple", "identifier", ["C"]));
    expect(scene.findAll<HTMLInputElement>("qti-hottext > input").map(({ checked }) => checked)).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe("inline choice", () => {
  const Body = (
    attributes: string,
  ): string => `<p>The capital of France is <qti-inline-choice-interaction response-identifier="R" ${attributes}>
    <qti-inline-choice identifier="L">London</qti-inline-choice>
    <qti-inline-choice identifier="P">Paris</qti-inline-choice>
  </qti-inline-choice-interaction>.</p>`;

  it("offers the choices in a menu inside the sentence, with the prompt first, and gives NULL for the prompt", async () => {
    const scene = mountScene(
      declare("single", "identifier"),
      Body('data-prompt="Pick one" class="qti-input-width-10"'),
    );
    const menu = scene.find<HTMLSelectElement>("select");
    expect([...menu.options].map(({ text }) => text)).toEqual(["Pick one", "London", "Paris"]);
    expect(menu.getAttribute("aria-label")).toBe("Pick one");
    await userEvent.selectOptions(menu, "P");
    expect(scene.responses.at(-1)?.value).toEqual(single("identifier", "P"));
    await userEvent.selectOptions(menu, "");
    expect(scene.responses.at(-1)?.value).toBeNull();
    expect(scene.find("p").textContent).toContain("The capital of France is ");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("uses a prompt of the interface without data-prompt, and shows the value of the host", () => {
    const scene = mountScene(declare("single", "identifier"), Body(""));
    expect(scene.find<HTMLSelectElement>("select").options[0]?.text).toBe("Choose an answer");
    scene.setValue("R", single("identifier", "L"));
    expect(scene.find<HTMLSelectElement>("select").value).toBe("L");
  });

  it("names the menu by the label of the choice", () => {
    const scene = mountScene(
      declare("single", "identifier"),
      `<p><qti-inline-choice-interaction response-identifier="R"><qti-label>Capital</qti-label><qti-inline-choice identifier="P">Paris</qti-inline-choice></qti-inline-choice-interaction></p>`,
    );
    const label = scene.find("qti-label");
    expect(label.textContent).toBe("Capital");
    expect(scene.find("select").getAttribute("aria-labelledby")).toBe(label.id);
  });

  it("says that an answer is required when the menu is required and the response is not valid", () => {
    const scene = mountScene(declare("single", "identifier"), Body('required="true"'));
    expect(scene.find(".ak-hint").textContent).toBe("");
  });
});

describe("text entry", () => {
  const Body = (attributes: string): string =>
    `<p>Type <qti-text-entry-interaction response-identifier="R" ${attributes}/> here.</p>`;

  it("gives the text as a string, and NULL for the empty text", async () => {
    const scene = mountScene(declare("single", "string"), Body('placeholder-text="Your name" expected-length="12"'));
    const input = scene.find<HTMLInputElement>("input");
    expect(input.placeholder).toBe("Your name");
    expect(input.size).toBe(12);
    expect(input.getAttribute("aria-label")).toBe("Your name");
    await userEvent.fill(input, "Ada");
    expect(scene.responses.at(-1)).toEqual({ responseIdentifier: "R", value: single("string", "Ada") });
    await userEvent.clear(input);
    expect(scene.responses.at(-1)?.value).toBeNull();
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("gives a float or an integer from the text that the candidate typed", async () => {
    const floats = mountScene(declare("single", "float"), Body(""));
    await userEvent.fill(floats.find("input"), "3.50");
    expect(floats.responses.at(-1)?.value).toEqual(single("float", 3.5));
    expect(floats.find("input").getAttribute("inputmode")).toBe("decimal");
    const integers = mountScene(declare("single", "integer"), Body(""));
    await userEvent.fill(integers.find("input"), "42");
    expect(integers.responses.at(-1)?.value).toEqual(single("integer", 42));
  });

  it("tells to enter a number, or a whole number, when the text is not one", async () => {
    const floats = mountScene(declare("single", "float"), Body(""));
    await userEvent.fill(floats.find("input"), "abc");
    expect(floats.responses.at(-1)?.value).toBeNull();
    expect(floats.find(".ak-hint").textContent).toBe("Enter a number.");
    expect(floats.find("input").getAttribute("aria-invalid")).toBe("true");
    const integers = mountScene(declare("single", "integer"), Body(""));
    await userEvent.fill(integers.find("input"), "4.5");
    expect(integers.find(".ak-hint").textContent).toBe("Enter a whole number.");
    await userEvent.fill(integers.find("input"), "45");
    expect(integers.find(".ak-hint").textContent).toBe("");
  });

  it("gives the record of the runtime for a text bound to a record, in the base of the interaction", async () => {
    const scene = mountScene(declare("record", "string").replace(' base-type="string"', ""), Body(""));
    await userEvent.fill(scene.find("input"), "12.50");
    const value = scene.responses.at(-1)?.value;
    expect(value?.cardinality).toBe("record");
    if (value?.cardinality !== "record") return;
    expect([...value.fields].map(([name, field]) => [name, field.value])).toEqual([
      ["stringValue", "12.50"],
      ["floatValue", 12.5],
      ["leftDigits", 2],
      ["rightDigits", 2],
      ["ndp", 2],
      ["nsf", 4],
    ]);
  });

  it("keeps the text as typed in the variable of string-identifier, and shows it again", async () => {
    const scene = mountScene(
      `${declare("single", "float")}${declare("single", "string", "T")}`,
      Body('string-identifier="T"'),
    );
    await userEvent.fill(scene.find("input"), "3.50");
    expect(scene.responses.slice(-2)).toEqual([
      { responseIdentifier: "R", value: single("float", 3.5) },
      { responseIdentifier: "T", value: single("string", "3.50") },
    ]);
    const restored = mountScene(
      `${declare("single", "float")}${declare("single", "string", "T")}`,
      Body('string-identifier="T"'),
    );
    restored.setValue("R", single("float", 3.5));
    expect(restored.find<HTMLInputElement>("input").value).toBe("3.5");
    const element = restored.interaction();
    if ("typed" in element) element.typed = single("string", "3.50");
    expect(restored.find<HTMLInputElement>("input").value).toBe("3.50");
  });

  it("says in the words of the item that the text does not match the pattern mask", async () => {
    const scene = mountScene(
      declare("single", "string"),
      Body('pattern-mask="[0-9]{3}" data-patternmask-message="Three digits, please."'),
    );
    const input = scene.find<HTMLInputElement>("input");
    await userEvent.fill(input, "12");
    expect(scene.find(".ak-hint").textContent).toBe("Three digits, please.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(await axeViolations(scene.host)).toEqual([]);
    await userEvent.fill(input, "123");
    expect(scene.find(".ak-hint").textContent).toBe("");
  });

  it("keeps what the candidate typed when the host sends the same response back", async () => {
    const scene = mountScene(declare("single", "float"), Body(""));
    const input = scene.find<HTMLInputElement>("input");
    await userEvent.fill(input, "3.50");
    scene.setValue("R", single("float", 3.5));
    expect(input.value).toBe("3.50");
  });

  it("is read-only when disabled, so that it keeps the focus", () => {
    const scene = mountScene(declare("single", "string"), Body(""));
    scene.interaction().disabled = true;
    expect(scene.find<HTMLInputElement>("input").readOnly).toBe(true);
  });
});

/** Returns the visible size of an element in CSS pixels. */
function sizeOf(element: Element): { readonly width: number; readonly height: number } {
  const { width, height } = element.getBoundingClientRect();
  return { width, height };
}

/** Returns the first item of a list that the test knows is there. */
function first<T>(items: readonly T[], index = 0): T {
  const found = items[index];
  if (found === undefined) throw new Error(`The test expected ${index + 1} items, found ${items.length}.`);
  return found;
}

describe("order", () => {
  const Body = (attributes: string): string => `<qti-order-interaction response-identifier="R" ${attributes}>
    <qti-prompt>Put the drivers in order.</qti-prompt>
    <qti-simple-choice identifier="A">Alpha</qti-simple-choice>
    <qti-simple-choice identifier="B">Beta</qti-simple-choice>
    <qti-simple-choice identifier="C">Gamma</qti-simple-choice>
  </qti-order-interaction>`;
  const Ordered = declare("ordered", "identifier");

  it("draws a place for each choice and the choices in the pool, in the order of the view", () => {
    const scene = mountScene(Ordered, Body('class="qti-labels-decimal"'));
    expect(scene.findAll(".ak-choices > qti-simple-choice").map((choice) => choice.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(scene.findAll(".ak-target").map((target) => target.getAttribute("aria-label"))).toEqual([
      "Position 1",
      "Position 2",
      "Position 3",
    ]);
    expect(scene.find(".ak-targets").getAttribute("aria-label")).toBe("Your order");
  });

  it("gives the choices in the order of the places, as an ordered container", async () => {
    const scene = mountScene(Ordered, Body(""));
    const pick = async (name: string): Promise<void> => {
      await userEvent.click(
        first(scene.findAll("qti-simple-choice > button").filter((button) => button.textContent === name)),
      );
    };
    const drops = (): HTMLElement[] => scene.findAll("button.ak-drop");
    await pick("Gamma");
    await userEvent.click(first(drops()));
    await pick("Alpha");
    await userEvent.click(first(drops(), 0));
    await pick("Beta");
    await userEvent.click(first(drops(), 0));
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["C", "A", "B"]));
    expect(scene.findAll(".ak-choices > qti-simple-choice").every((choice) => choice.hasAttribute("hidden"))).toBe(
      true,
    );
    expect(scene.findAll(".ak-choices > qti-simple-choice").map((choice) => getComputedStyle(choice).display)).toEqual([
      "none",
      "none",
      "none",
    ]);
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("puts a choice back in the pool and gives the order that remains", async () => {
    const scene = mountScene(Ordered, Body(""));
    scene.setValue("R", container("ordered", "identifier", ["B", "A", "C"]));
    expect(scene.findAll(".ak-target .ak-chip-button").map((chip) => chip.textContent)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
    ]);
    await userEvent.click(first(scene.findAll("button.ak-remove"), 0));
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["A", "C"]));
    expect(scene.find("qti-simple-choice:not([hidden])").textContent).toBe("Beta");
  });

  it("orders only as many choices as max-choices allows, and tells the limits", () => {
    const scene = mountScene(Ordered, Body('min-choices="2" max-choices="2"'));
    expect(scene.findAll(".ak-target")).toHaveLength(2);
    expect(scene.find(".ak-instruction").textContent).toBe("Place at least 2. Place at most 2.");
  });

  it("tells the candidate to place more choices when an order is partly made", async () => {
    const scene = mountScene(Ordered, Body(""));
    await userEvent.click(first(scene.findAll("qti-simple-choice > button")));
    await userEvent.click(first(scene.findAll("button.ak-drop")));
    expect(scene.find(".ak-hint").textContent).toBe("Place at least 3.");
  });

  it("puts a choice in a place with the keyboard alone, and lets it go with Escape", async () => {
    const scene = mountScene(Ordered, Body(""));
    const pool = scene.findAll<HTMLButtonElement>("qti-simple-choice > button");
    first(pool).focus();
    await userEvent.keyboard("{Enter}");
    expect(first(pool).getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{Escape}");
    expect(first(pool).getAttribute("aria-pressed")).toBe("false");
    await userEvent.keyboard("{Enter}");
    first(scene.findAll<HTMLButtonElement>("button.ak-drop"), 1).focus();
    await userEvent.keyboard("{Enter}");
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["A"]));
    expect(scene.find(".qti-visually-hidden").textContent).toBe("Alpha placed in Position 2");
  });

  it("says to choose first when a place is chosen without a choice", async () => {
    const scene = mountScene(Ordered, Body(""));
    await userEvent.click(first(scene.findAll("button.ak-drop")));
    expect(scene.find(".qti-visually-hidden").textContent).toBe("Select a choice first.");
    expect(scene.responses).toEqual([]);
  });

  it("puts a choice in a place with a drag of the mouse, and back with a drag to the pool", async () => {
    const scene = mountScene(Ordered, Body(""));
    await userEvent.dragAndDrop(
      first(scene.findAll("qti-simple-choice > button"), 1),
      first(scene.findAll(".ak-target"), 2),
    );
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["B"]));
    await userEvent.dragAndDrop(first(scene.findAll(".ak-chip-button")), scene.find(".ak-choices"));
    expect(scene.responses.at(-1)?.value).toBeNull();
  });

  it("gives every control a target of at least 24 by 24 CSS pixels", () => {
    const scene = mountScene(Ordered, Body(""));
    scene.setValue("R", container("ordered", "identifier", ["B"]));
    // A choice that is in a place is not in the pool, where it is hidden.
    for (const control of scene.findAll("button").filter((button) => button.getClientRects().length > 0)) {
      const { width, height } = sizeOf(control);
      expect([control.className, width >= 24, height >= 24]).toEqual([control.className, true, true]);
    }
  });

  it("locks the controls for a candidate who cannot respond", () => {
    const scene = mountScene(Ordered, Body(""));
    scene.setValue("R", container("ordered", "identifier", ["B"]));
    scene.interaction().disabled = true;
    expect(scene.findAll<HTMLButtonElement>("button").every((button) => button.disabled)).toBe(true);
  });
});

describe("associate", () => {
  const Body = `<qti-associate-interaction response-identifier="R" max-associations="2">
    <qti-prompt>Pair them.</qti-prompt>
    <qti-simple-associable-choice identifier="A" match-max="1">Alpha</qti-simple-associable-choice>
    <qti-simple-associable-choice identifier="B" match-max="1">Beta</qti-simple-associable-choice>
    <qti-simple-associable-choice identifier="C" match-max="2">Gamma</qti-simple-associable-choice>
  </qti-associate-interaction>`;

  it("counts a pair once both its places are filled, as a pair", async () => {
    const scene = mountScene(declare("multiple", "pair"), Body);
    expect(scene.findAll(".ak-pair")).toHaveLength(2);
    const put = async (name: string, drop: number): Promise<void> => {
      await userEvent.click(
        first(
          scene
            .findAll("qti-simple-associable-choice:not([hidden]) > button")
            .filter((button) => button.textContent === name),
        ),
      );
      await userEvent.click(first(scene.findAll("button.ak-drop"), drop));
    };
    await put("Alpha", 0);
    expect(scene.responses).toEqual([{ responseIdentifier: "R", value: null }]);
    await put("Gamma", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "pair", [["A", "C"]]));
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("offers a choice again while it has uses left, as many as its match-max", async () => {
    const scene = mountScene(declare("multiple", "pair"), Body);
    scene.setValue("R", container("multiple", "pair", [["A", "C"]]));
    const visible = (): string[] =>
      scene.findAll("qti-simple-associable-choice:not([hidden]) > button").map((button) => button.textContent ?? "");
    expect(visible()).toEqual(["Beta", "Gamma"]);
    scene.setValue(
      "R",
      container("multiple", "pair", [
        ["A", "C"],
        ["B", "C"],
      ]),
    );
    expect(visible()).toEqual([]);
  });

  it("names the two places of a pair, and gives a single pair where the variable is single", async () => {
    const scene = mountScene(declare("single", "pair"), Body.replace('max-associations="2"', ""));
    expect(scene.findAll(".ak-target").map((place) => place.getAttribute("aria-label"))).toEqual([
      "Pair 1, first",
      "Pair 1, second",
    ]);
    scene.setValue("R", single("pair", ["A", "B"]));
    expect(scene.findAll(".ak-chip-button").map((chip) => chip.textContent)).toEqual(["Alpha", "Beta"]);
  });
});

describe("match", () => {
  const Sets = `<qti-simple-match-set>
      <qti-simple-associable-choice identifier="C" match-max="1">Capulet</qti-simple-associable-choice>
      <qti-simple-associable-choice identifier="D" match-max="1">Demetrius</qti-simple-associable-choice>
    </qti-simple-match-set>
    <qti-simple-match-set>
      <qti-simple-associable-choice identifier="M" match-max="2">A Midsummer Night's Dream</qti-simple-associable-choice>
      <qti-simple-associable-choice identifier="R" match-max="2">Romeo and Juliet</qti-simple-associable-choice>
    </qti-simple-match-set>`;
  const Body = (
    attributes: string,
  ): string => `<qti-match-interaction response-identifier="R" max-associations="4" ${attributes}>
    <qti-prompt>Match.</qti-prompt>${Sets}</qti-match-interaction>`;
  const Directed = declare("multiple", "directedPair");

  it("puts the choices of the first set in the second, as directed pairs from the first to the second", async () => {
    const scene = mountScene(Directed, Body(""));
    expect(scene.find(".ak-choices").tagName.toLowerCase()).toBe("qti-simple-match-set");
    await userEvent.click(first(scene.findAll("qti-simple-associable-choice > button")));
    await userEvent.click(first(scene.findAll("button.ak-drop"), 1));
    await userEvent.click(
      first(
        scene.findAll("qti-simple-associable-choice > button").filter((button) => button.textContent === "Demetrius"),
      ),
    );
    await userEvent.click(first(scene.findAll("button.ak-drop"), 1));
    expect(scene.responses.at(-1)?.value).toEqual(
      container("multiple", "directedPair", [
        ["C", "R"],
        ["D", "R"],
      ]),
    );
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("shows the matches that the host restores, and a single pair for a single variable", () => {
    const scene = mountScene(declare("single", "directedPair"), Body("").replace('max-associations="4"', ""));
    scene.setValue("R", single("directedPair", ["D", "M"]));
    expect(scene.findAll(".ak-targets .ak-chip-button").map((chip) => chip.textContent)).toEqual(["Demetrius"]);
  });

  it("draws a table with a checkbox for each match when the class says so", async () => {
    const scene = mountScene(Directed, Body('class="qti-match-tabular" data-first-column-header="Characters"'));
    expect(scene.findAll("thead th").map((cell) => cell.textContent)).toEqual([
      "Characters",
      "A Midsummer Night's Dream",
      "Romeo and Juliet",
    ]);
    expect(scene.findAll("tbody th[scope=row]").map((cell) => cell.textContent)).toEqual(["Capulet", "Demetrius"]);
    const boxes = scene.findAll<HTMLInputElement>("td input");
    await userEvent.click(first(boxes, 1));
    await userEvent.click(first(boxes, 2));
    expect(scene.responses.at(-1)?.value).toEqual(
      container("multiple", "directedPair", [
        ["C", "R"],
        ["D", "M"],
      ]),
    );
    expect(boxes.map((box) => box.checked)).toEqual([false, true, true, false]);
    scene.setValue("R", container("multiple", "directedPair", [["D", "R"]]));
    expect(boxes.map((box) => box.checked)).toEqual([false, false, false, true]);
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("names each box of the table by its row and its column", () => {
    const scene = mountScene(Directed, Body('class="qti-match-tabular"'));
    const box = first(scene.findAll("td input"), 1);
    const names = (box.getAttribute("aria-labelledby") ?? "")
      .split(" ")
      .map((id) => scene.root.getElementById(id)?.textContent);
    expect(names).toEqual(["Capulet", "Romeo and Juliet"]);
  });

  it("says in the words of the item that too many matches were made", async () => {
    const scene = mountScene(
      Directed,
      Body('class="qti-match-tabular" data-max-selections-message="That is enough."').replace(
        'max-associations="4"',
        'max-associations="1"',
      ),
    );
    const boxes = scene.findAll("td input");
    await userEvent.click(first(boxes, 0));
    await userEvent.click(first(boxes, 3));
    expect(scene.find(".ak-hint").textContent).toBe("That is enough.");
  });
});

describe("gap match", () => {
  const Body = (attributes: string): string => `<qti-gap-match-interaction response-identifier="R" ${attributes}>
    <qti-prompt>Fill the gaps.</qti-prompt>
    <qti-gap-text identifier="W" match-max="1">winter</qti-gap-text>
    <qti-gap-text identifier="S" match-max="2">spring</qti-gap-text>
    <qti-gap-img identifier="I" match-max="1"><img src="images/dot.png" alt="a dot" width="8" height="8"/></qti-gap-img>
    <p>Shakespeare wrote <qti-gap identifier="G1"/> and <em>then <qti-gap identifier="G2" required="true"/></em>.</p>
  </qti-gap-match-interaction>`;
  const Directed = declare("multiple", "directedPair");

  it("puts a choice in a gap of the passage, as a directed pair from the choice to the gap", async () => {
    const scene = mountScene(Directed, Body(""));
    expect(scene.findAll("qti-gap").map((gap) => gap.getAttribute("aria-label"))).toEqual(["Gap 1", "Gap 2"]);
    await userEvent.click(first(scene.findAll("qti-gap-text > button"), 1));
    await userEvent.click(first(scene.findAll("qti-gap button.ak-drop"), 1));
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["S", "G2"]]));
    expect(scene.find("p").textContent?.replaceAll(/\s+/gu, " ")).toContain("then spring");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("keeps a choice in the pool while it has uses left, and takes it away when it has none", () => {
    const scene = mountScene(Directed, Body(""));
    scene.setValue(
      "R",
      container("multiple", "directedPair", [
        ["S", "G1"],
        ["W", "G2"],
      ]),
    );
    const visible = (): string[] =>
      scene.findAll(".ak-choices > :not([hidden]) > button").map((button) => button.textContent ?? "");
    expect(visible()).toEqual(["spring", ""]);
    expect(scene.findAll("qti-gap .ak-chip-button").map((chip) => chip.textContent)).toEqual(["spring", "winter"]);
  });

  it("gives an image choice its alternative text as its name", () => {
    const scene = mountScene(Directed, Body(""));
    expect(first(scene.findAll("qti-gap-img > button")).querySelector("img")?.getAttribute("alt")).toBe("a dot");
    scene.setValue("R", container("multiple", "directedPair", [["I", "G1"]]));
    expect(first(scene.findAll(".ak-remove")).getAttribute("aria-label")).toBe("Remove a dot");
  });

  it("says that a required gap is empty once the response is not valid", async () => {
    const scene = mountScene(Directed, Body(""));
    await userEvent.click(first(scene.findAll("qti-gap-text > button")));
    await userEvent.click(first(scene.findAll("qti-gap button.ak-drop")));
    expect(scene.find(".ak-hint").textContent).toBe("An answer is required.");
  });

  it("replaces the choice of a gap that is full, which goes back to the pool", async () => {
    const scene = mountScene(Directed, Body(""));
    scene.setValue("R", container("multiple", "directedPair", [["W", "G1"]]));
    await userEvent.click(first(scene.findAll("qti-gap-text > button"), 1));
    await userEvent.click(first(scene.findAll("qti-gap .ak-chip-button")));
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["S", "G1"]]));
  });

  it("sets the width of the container of the choices", () => {
    const scene = mountScene(Directed, Body('data-choices-container-width="188"'));
    expect(scene.interaction().style.getPropertyValue("--ak-choices-width")).toBe("188px");
  });
});

describe("extended text", () => {
  const Body = (attributes: string): string => `<qti-extended-text-interaction response-identifier="R" ${attributes}>
    <qti-prompt>Write about it.</qti-prompt>
  </qti-extended-text-interaction>`;

  it("gives the text of a plain text area as a string, named by the prompt", async () => {
    const scene = mountScene(declare("single", "string"), Body('expected-lines="5" placeholder-text="Start here"'));
    const area = scene.find<HTMLTextAreaElement>("textarea");
    expect(area.rows).toBe(5);
    expect(area.placeholder).toBe("Start here");
    expect(area.getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
    await userEvent.fill(area, "Line one\nLine two");
    expect(scene.responses.at(-1)).toEqual({ responseIdentifier: "R", value: single("string", "Line one\nLine two") });
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("keeps the spaces of a preformatted text", () => {
    const scene = mountScene(declare("single", "string"), Body('format="preformatted"'));
    expect(getComputedStyle(scene.find("textarea")).whiteSpace).toBe("pre");
  });

  it("counts the characters typed or left of the expected length, as code points", async () => {
    const up = mountScene(declare("single", "string"), Body('class="qti-counter-up" expected-length="20"'));
    await userEvent.fill(up.find("textarea"), "a\u{1F600}b");
    expect(up.find(".ak-counter").textContent).toBe("Characters: 3 / 20");
    const down = mountScene(declare("single", "string"), Body('class="qti-counter-down" expected-length="20"'));
    await userEvent.fill(down.find("textarea"), "abcde");
    expect(down.find(".ak-counter").textContent).toBe("Characters left: 15");
    const none = mountScene(declare("single", "string"), Body('expected-length="20"'));
    expect(none.root.querySelector(".ak-counter")).toBeNull();
  });

  it("counts the words typed with data-ak-count, in every format, as the runs of characters that are not white space", async () => {
    const wordsIn = (text: string): number => text.split(/\s+/u).filter((word) => word !== "").length;
    const typed = "  one  two\nthree\tfour ";
    for (const attributes of ['data-ak-count="words"', 'data-ak-count="words" format="preformatted"']) {
      const scene = mountScene(declare("single", "string"), Body(attributes));
      await userEvent.fill(scene.find("textarea"), typed);
      expect(scene.find(".ak-counter").textContent).toBe(`Words: ${wordsIn(typed)}`);
    }
    const editor = mountScene(declare("single", "string"), Body('data-ak-count="words" format="xhtml"'));
    editor.find("[role=textbox]").innerHTML =
      "<p>one  two</p><p>three</p>four<br>five<ul><li>six</li><li>seven</li></ul>";
    editor.find("[role=textbox]").dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(editor.find(".ak-counter").textContent).toBe(`Words: ${wordsIn("one two three four five six seven")}`);
    // The words need neither a counter class nor an expected length, and an expected length stays in characters.
    const sized = mountScene(
      declare("single", "string"),
      Body('data-ak-count="words" class="qti-counter-up" expected-length="20"'),
    );
    await userEvent.fill(sized.find("textarea"), "two words");
    expect(sized.find(".ak-counter").textContent).toBe("Words: 2");
    const indonesian = mountScene(declare("single", "string"), Body('data-ak-count="words"'), {
      options: { messages: ID_MESSAGES },
    });
    await userEvent.fill(indonesian.find("textarea"), "dua kata");
    expect(indonesian.find(".ak-counter").textContent).toBe("Kata: 2");
    // The message is a label before the number, so that one word and one character need no singular.
    const one = mountScene(declare("single", "string"), Body('data-ak-count="words"'));
    await userEvent.fill(one.find("textarea"), "one");
    expect(one.find(".ak-counter").textContent).toBe("Words: 1");
    const left = mountScene(declare("single", "string"), Body('class="qti-counter-down" expected-length="4"'));
    await userEvent.fill(left.find("textarea"), "abc");
    expect(left.find(".ak-counter").textContent).toBe("Characters left: 1");
    const characters = mountScene(declare("single", "string"), Body('data-ak-count="characters"'));
    expect(characters.root.querySelector(".ak-counter")).toBeNull();
  });

  it("asks the browser for no spell check, correction, capital letters or completion, and for the spell check when it is turned on", () => {
    const off = { spellcheck: "false", autocorrect: "off", autocapitalize: "off", autocomplete: "off" };
    const attributesOf = (element: Element): Record<string, string | null> =>
      Object.fromEntries(Object.keys(off).map((name) => [name, element.getAttribute(name)]));
    for (const attributes of ["", 'format="xhtml"']) {
      const scene = mountScene(declare("single", "string"), Body(attributes));
      const control = scene.find(attributes === "" ? "textarea" : "[role=textbox]");
      expect(attributesOf(control)).toEqual(off);
      const interaction = scene.interaction();
      if (!(interaction instanceof ExtendedTextInteractionElement)) throw new Error("Not an extended text.");
      expect(interaction.spellChecked).toBe(false);
      interaction.spellChecked = true;
      expect(control.getAttribute("spellcheck")).toBe("true");
      // The texts that the interaction draws again keep the setting.
      interaction.messages = ID_MESSAGES;
      expect(scene.find(attributes === "" ? "textarea" : "[role=textbox]").getAttribute("spellcheck")).toBe("true");
      interaction.spellChecked = false;
      expect(scene.find(attributes === "" ? "textarea" : "[role=textbox]").getAttribute("spellcheck")).toBe("false");
    }
    const entry = mountScene(
      declare("single", "string"),
      '<p><qti-text-entry-interaction response-identifier="R"/></p>',
    );
    expect(attributesOf(entry.find("input"))).toEqual(off);
  });

  it("takes up to max-strings separate texts in a container, leaving out the empty ones", async () => {
    const scene = mountScene(declare("ordered", "string"), Body('max-strings="3" min-strings="2"'));
    const areas = scene.findAll<HTMLTextAreaElement>("textarea");
    expect(areas.map((area) => area.getAttribute("aria-label"))).toEqual(["Answer 1", "Answer 2", "Answer 3"]);
    await userEvent.fill(first(areas, 2), "third");
    await userEvent.fill(first(areas, 0), "first");
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "string", ["first", "third"]));
    expect(scene.find(".ak-instruction").textContent).toBe("Enter at least 2. Enter at most 3.");
    scene.setValue("R", container("ordered", "string", ["x", "y"]));
    expect(areas.map((area) => area.value)).toEqual(["x", "y", ""]);
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("tells to enter more texts while fewer than min-strings are typed", async () => {
    const scene = mountScene(declare("multiple", "string"), Body('max-strings="3" min-strings="2"'));
    await userEvent.fill(first(scene.findAll("textarea")), "one");
    expect(scene.find(".ak-hint").textContent).toBe("Enter at least 2.");
  });

  it("writes the text of an XHTML answer with the kept elements only, and no attribute", async () => {
    const scene = mountScene(
      declare("single", "string"),
      Body('format="xhtml" class="qti-counter-up" expected-length="30"'),
    );
    const area = scene.find("[role=textbox]");
    expect(scene.find("[role=toolbar]").getAttribute("aria-label")).toBe("Formatting");
    expect(scene.findAll("[role=toolbar] button").map((button) => button.textContent)).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Bulleted list",
      "Numbered list",
    ]);
    area.append(
      document.createTextNode("Hello "),
      Object.assign(document.createElement("b"), { textContent: "bold", title: "t", onclick: () => undefined }),
      Object.assign(document.createElement("style"), { textContent: "p {}" }),
      Object.assign(document.createElement("span"), { textContent: " & <more>" }),
    );
    area.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(scene.responses.at(-1)?.value).toEqual(
      single("string", "<p>Hello <strong>bold</strong> &amp; &lt;more&gt;</p>"),
    );
    expect(scene.find(".ak-counter").textContent).toBe("Characters: 19 / 30");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("shows an XHTML answer that the host restores, and treats one that is not well-formed as text", () => {
    const scene = mountScene(declare("single", "string"), Body('format="xhtml"'));
    scene.setValue("R", single("string", "<p>One <em>two</em></p><ul><li>three</li></ul>"));
    expect(scene.find("[role=textbox]").innerHTML).toBe("<p>One <em>two</em></p><ul><li>three</li></ul>");
    scene.setValue("R", single("string", "<p>broken"));
    expect(scene.find("[role=textbox]").textContent).toBe("<p>broken");
  });

  it("formats the selected text with the buttons of the toolbar", async () => {
    const scene = mountScene(declare("single", "string"), Body('format="xhtml"'));
    const area = scene.find("[role=textbox]");
    area.textContent = "plain";
    // A selection that script makes cannot cross into a shadow root in every engine, so the test selects with the pointer.
    await userEvent.tripleClick(area);
    await userEvent.click(first(scene.findAll("[role=toolbar] button")));
    expect(scene.responses.at(-1)?.value).toEqual(single("string", "<p><strong>plain</strong></p>"));
  });
});

describe("slider", () => {
  const Body = (
    attributes: string,
  ): string => `<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="10" ${attributes}>
    <qti-prompt>How much?</qti-prompt></qti-slider-interaction>`;

  it("has no position until the candidate chooses one, and says so", () => {
    const scene = mountScene(declare("single", "integer"), Body(""));
    const thumb = scene.find("[role=slider]");
    expect(thumb.getAttribute("aria-valuetext")).toBe("No value chosen");
    expect(scene.find(".ak-slider").hasAttribute("data-ak-unset")).toBe(true);
    expect([thumb.getAttribute("aria-valuemin"), thumb.getAttribute("aria-valuemax")]).toEqual(["0", "10"]);
    expect(thumb.getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
  });

  it("moves in steps by the keyboard, from the lower bound when there is no value", async () => {
    const scene = mountScene(declare("single", "integer"), Body('step="2"'));
    const thumb = scene.find("[role=slider]");
    thumb.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(scene.responses.at(-1)?.value).toEqual(single("integer", 2));
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowLeft}");
    expect(scene.responses.at(-1)?.value).toEqual(single("integer", 4));
    await userEvent.keyboard("{End}");
    expect(scene.responses.at(-1)?.value).toEqual(single("integer", 10));
    await userEvent.keyboard("{Home}");
    expect(scene.responses.at(-1)?.value).toEqual(single("integer", 0));
    await userEvent.keyboard("{PageUp}");
    expect(scene.responses.at(-1)?.value).toEqual(single("integer", 10));
    expect(thumb.getAttribute("aria-valuenow")).toBe("10");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("chooses the value at a click on the scale, with no drag", async () => {
    const scene = mountScene(declare("single", "integer"), Body(""));
    const track = scene.find(".ak-slider-track");
    const box = track.getBoundingClientRect();
    await userEvent.click(track, { position: { x: Math.round(box.width * 0.5), y: 12 } });
    expect(scene.responses.at(-1)?.value).toEqual(single("integer", 5));
  });

  it("gives a float on the scale of a hundredth of the range without a step", async () => {
    const scene = mountScene(
      declare("single", "float"),
      Body('lower-bound="0" upper-bound="1"').replace('lower-bound="0" upper-bound="10"', ""),
    );
    scene.find("[role=slider]").focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(scene.responses.at(-1)?.value).toEqual(single("float", 0.03));
  });

  it("labels the ends, the steps when asked, and reverses the scale", () => {
    const scene = mountScene(declare("single", "integer"), Body('step="5" step-label="true" reverse="true"'));
    expect(scene.findAll(".ak-slider-end").map((end) => end.textContent)).toEqual(["10", "0"]);
    expect(scene.findAll(".ak-slider-tick").map((tick) => tick.textContent)).toEqual(["0", "5", "10"]);
    const vertical = mountScene(declare("single", "integer"), Body('orientation="vertical"'));
    expect(vertical.findAll(".ak-slider-end").map((end) => end.textContent)).toEqual(["10", "0"]);
    expect(vertical.find("[role=slider]").getAttribute("aria-orientation")).toBe("vertical");
  });

  it("shows the value that the host sets, and is not moved when disabled", async () => {
    const scene = mountScene(declare("single", "integer"), Body(""));
    scene.setValue("R", single("integer", 7));
    const thumb = scene.find("[role=slider]");
    expect([thumb.getAttribute("aria-valuenow"), thumb.getAttribute("aria-valuetext")]).toEqual(["7", "7"]);
    scene.interaction().disabled = true;
    thumb.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(scene.responses).toEqual([]);
    expect(thumb.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("end attempt", () => {
  it("titles the button as the item says and tells the host which interaction was pressed", async () => {
    const scene = mountScene(
      declare("single", "boolean", "HINT"),
      `<p><qti-end-attempt-interaction response-identifier="HINT" title="Hint"/></p>`,
    );
    const events: string[] = [];
    scene.root.addEventListener("ak-end-attempt", (event) => events.push(event.detail.responseIdentifier));
    const button = scene.find("button");
    expect(button.textContent).toBe("Hint");
    await userEvent.click(button);
    expect(events).toEqual(["HINT"]);
    expect(scene.responses).toEqual([]);
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("cannot be pressed while the candidate cannot respond", () => {
    const scene = mountScene(
      declare("single", "boolean", "HINT"),
      `<p><qti-end-attempt-interaction response-identifier="HINT" title="Hint"/></p>`,
    );
    scene.interaction().disabled = true;
    expect(scene.find<HTMLButtonElement>("button").disabled).toBe(true);
  });
});

describe("custom interaction", () => {
  const Body = `<qti-custom-interaction response-identifier="R" class="my-widget"/>`;

  it("says that the kind of question is not supported when the host gives no hook", () => {
    const scene = mountScene(declare("single", "string"), Body);
    expect(scene.find("[role=note]").textContent).toBe("This kind of question is not supported here.");
  });

  it("mounts the hook of the host where it draws, hands it the response that the candidate gives, and takes it away", async () => {
    const calls: string[] = [];
    const scene = mountScene(declare("single", "string"), Body, {
      options: {
        customInteraction: (interaction, host, set, state) => {
          calls.push(`mount ${interaction.kind} ${String(state.disabled)}`);
          const button = document.createElement("button");
          button.textContent = "Say hello";
          button.addEventListener("click", () => set(single("string", "hello")));
          host.append(button);
          return () => calls.push("stop");
        },
      },
    });
    await new Promise<void>((done) => queueMicrotask(done));
    await userEvent.click(scene.find(".ak-custom button"));
    expect(scene.responses.at(-1)).toEqual({ responseIdentifier: "R", value: single("string", "hello") });
    expect(calls).toEqual(["mount custom-interaction false"]);
    scene.host.remove();
    expect(calls).toEqual(["mount custom-interaction false", "stop"]);
  });

  it("ignores a response that the hook gives while the candidate cannot respond", async () => {
    let give: (() => void) | undefined;
    const scene = mountScene(declare("single", "string"), Body, {
      options: {
        customInteraction: (_interaction, _host, set) => {
          give = () => set(single("string", "late"));
          return () => undefined;
        },
      },
    });
    await new Promise<void>((done) => queueMicrotask(done));
    scene.interaction().disabled = true;
    give?.();
    expect(scene.responses).toEqual([]);
  });
});

/** What a test did to its files, and the means to hold the store of a recording's bytes. */
interface FakeFiles extends InteractionFiles {
  readonly uploads: { readonly bytes: Blob; readonly mimeType: string; readonly fileName?: string }[];
  /** The files that were reserved, in order. */
  readonly reserved: FileValue[];
  /** The bytes of reserved files that were stored, in order. */
  readonly filled: { readonly file: FileValue; readonly bytes: Blob }[];
  /** The calls of `fill` that are held, until `release` lets them go or `fail` rejects them. */
  holding: boolean;
  /** How many stores wait to be let go. */
  waiting(): number;
  /** Lets the held stores go. */
  release(): void;
}

/** Files of a test: they keep what is uploaded and reserved, and answer with the reference they give it. */
function fakeFiles(failures: { readonly reserve?: boolean; readonly fill?: boolean } = {}): FakeFiles {
  const uploads: FakeFiles["uploads"] = [];
  const reserved: FileValue[] = [];
  const filled: { file: FileValue; bytes: Blob }[] = [];
  const held: (() => void)[] = [];
  const files: FakeFiles = {
    uploads,
    reserved,
    filled,
    holding: false,
    waiting: () => held.length,
    release: () => {
      for (const go of held.splice(0)) go();
    },
    upload: async (bytes, mimeType, fileName) => {
      uploads.push({ bytes, mimeType, ...(fileName === undefined ? {} : { fileName }) });
      return { reference: `ref-${uploads.length}`, mimeType, ...(fileName === undefined ? {} : { fileName }) };
    },
    url: (file) => `https://files.example/${file.reference}`,
    reserve: async (mimeType, fileName) => {
      if (failures.reserve === true) throw new Error("The host is down.");
      const file = {
        reference: `reserved-${reserved.length + 1}`,
        mimeType,
        ...(fileName === undefined ? {} : { fileName }),
      };
      reserved.push(file);
      return file;
    },
    fill: async (file, bytes) => {
      if (files.holding) await new Promise<void>((go) => held.push(go));
      if (failures.fill === true) throw new Error("The store is down.");
      filled.push({ file, bytes });
    },
  };
  return files;
}

/** The status of a recording that could not start. */
const NOT_STARTED = "The recording could not start. Check that the sound device works, then press Record.";

const realSetTimeout = globalThis.setTimeout;

/** Waits on the real clock until the host has named a file, and returns how many it named. */
async function waitForReservation(files: { readonly reserved: readonly unknown[] }): Promise<number> {
  while (files.reserved.length === 0) await new Promise((done) => realSetTimeout(done, 10));
  return files.reserved.length;
}

describe("upload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const Body = (types: string): string =>
    `<qti-upload-interaction response-identifier="R" ${types}><qti-prompt>Upload your work.</qti-prompt></qti-upload-interaction>`;
  const Declaration = declare("single", "file");

  it("offers a file picker for the accepted types, named by its label", () => {
    const scene = mountScene(Declaration, Body('type="application/pdf text/plain"'));
    const input = scene.find<HTMLInputElement>("input[type=file]");
    expect(input.accept).toBe("application/pdf,text/plain");
    expect(scene.find("label").textContent).toBe("Choose a file");
    expect(scene.find("label").getAttribute("for")).toBe(input.id);
    expect(scene.interaction().getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
  });

  it("sends the chosen file to the host's storage and gives the reference as the response", async () => {
    const files = fakeFiles();
    const scene = mountScene(Declaration, Body('type="text/plain"'), { options: { files } });
    await userEvent.upload(scene.find("input[type=file]"), new File(["abc"], "notes.txt", { type: "text/plain" }));
    await waitFor(() => expect(scene.responses).toHaveLength(1));
    expect(files.uploads.map(({ mimeType, fileName }) => [mimeType, fileName])).toEqual([["text/plain", "notes.txt"]]);
    expect(await files.uploads[0]?.bytes.text()).toBe("abc");
    expect(scene.responses[0]).toEqual({
      responseIdentifier: "R",
      value: single("file", { reference: "ref-1", mimeType: "text/plain", fileName: "notes.txt" }),
    });
    expect(scene.find(".ak-file-name").textContent).toBe("notes.txt");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("takes the file away without sending anything", async () => {
    const scene = mountScene(Declaration, Body(""));
    scene.setValue("R", single("file", { reference: "r", mimeType: "image/png", fileName: "a.png" }));
    await userEvent.click(scene.find(".ak-stored button"));
    expect(scene.responses.at(-1)?.value).toBeNull();
    expect(scene.find(".ak-stored").textContent).toBe("");
  });

  it("does not send a file of a type that is not accepted, and says which types are", async () => {
    const files = fakeFiles();
    const scene = mountScene(Declaration, Body('type="application/pdf"'), { options: { files } });
    await userEvent.upload(scene.find("input[type=file]"), new File(["x"], "a.png", { type: "image/png" }));
    await waitFor(() =>
      expect(scene.find(".ak-hint").textContent).toBe(
        "This file type is not accepted. Accepted types: application/pdf",
      ),
    );
    expect(files.uploads).toEqual([]);
    expect(scene.responses).toEqual([]);
    expect(scene.find("input[type=file]").getAttribute("aria-invalid")).toBe("true");
  });

  it("says that the file could not be uploaded when the host fails, and gives no response", async () => {
    const scene = mountScene(Declaration, Body(""), {
      options: { files: { upload: () => Promise.reject(new Error("offline")), url: () => "", ...NO_RECORDING } },
    });
    await userEvent.upload(scene.find("input[type=file]"), new File(["x"], "a.txt", { type: "text/plain" }));
    await waitFor(() =>
      expect(scene.find(".ak-upload-status").textContent).toBe("The file could not be uploaded. Try again."),
    );
    expect(scene.responses).toEqual([]);
  });

  it("plays a recording that the response holds, from the URL that the host gives", () => {
    const scene = mountScene(Declaration, Body(""), { options: { files: fakeFiles() } });
    scene.setValue("R", single("file", { reference: "r1", mimeType: "audio/webm", fileName: "recording.webm" }));
    expect(scene.find("audio").getAttribute("src")).toBe("https://files.example/r1");
  });

  it("locks the controls while the candidate cannot respond", () => {
    const scene = mountScene(Declaration, Body(""));
    scene.setValue("R", single("file", { reference: "r", mimeType: "image/png" }));
    scene.interaction().disabled = true;
    expect(scene.findAll<HTMLInputElement | HTMLButtonElement>("input, button").every(({ disabled }) => disabled)).toBe(
      true,
    );
  });

  it("offers no recording for a type that the browser cannot record and the interaction does not take as WAV", () => {
    const scene = mountScene(Declaration, Body('type="audio/mpeg"'));
    expect(scene.root.querySelector(".ak-upload button")).toBeNull();
    const without = mountScene(Declaration, Body('type="audio/wav"'), { options: { record: false } });
    expect(without.root.querySelector(".ak-upload button")).toBeNull();
  });

  it("records in a type that the interaction accepts, naming the file as it starts and storing the bytes when it stops", async (context) => {
    // The WebKit of Playwright on Linux has no MediaRecorder.
    if (typeof MediaRecorder === "undefined") context.skip();
    await needsAudio(context, audioContextRuns());
    trackAudioContexts();
    const microphone = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(fakeMicrophone);
    const files = fakeFiles();
    const scene = mountScene(Declaration, Body('type="audio/webm audio/ogg audio/mp4"'), { options: { files } });
    expect(microphone).not.toHaveBeenCalled();
    const [record, stop] = scene.findAll<HTMLButtonElement>(".ak-upload button");
    expect([record?.textContent, stop?.textContent, stop?.disabled]).toEqual(["Record", "Stop recording", true]);
    await userEvent.click(record ?? scene.host);
    await waitFor(() => expect(scene.find(".ak-recording").textContent).toBe("Recording"));
    expect(microphone).toHaveBeenCalledOnce();
    expect(record?.disabled).toBe(true);
    // The response names the reserved file at once, and the part that plays it waits for the bytes.
    const reserved = first(files.reserved);
    expect(["audio/webm", "audio/ogg", "audio/mp4"]).toContain(reserved.mimeType);
    expect(reserved.fileName).toMatch(/^recording\.(webm|ogg|m4a)$/u);
    expect(scene.responses).toEqual([{ responseIdentifier: "R", value: single("file", reserved) }]);
    expect(scene.find(".ak-stored").textContent).toBe("");
    await heardFor(0.3);
    await userEvent.click(stop ?? scene.host);
    await waitFor(() => expect(files.filled).toHaveLength(1));
    expect(first(files.filled).file).toEqual(reserved);
    expect(first(files.filled).bytes.size).toBeGreaterThan(0);
    expect(files.uploads).toEqual([]);
    expect(scene.root.querySelector(".ak-recording")).toBeNull();
    expect(scene.responses).toHaveLength(1);
    await waitFor(() =>
      expect(scene.find(".ak-stored audio").getAttribute("src")).toBe(`https://files.example/${reserved.reference}`),
    );
    microphone.mockRestore();
  });

  it("lets go of the microphone when the recording cannot start", async () => {
    const context = new AudioContext();
    const stream = context.createMediaStreamDestination().stream;
    const microphone = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(stream);
    // No worklet is served at this URL, so that a WAV recording cannot start.
    const errors: unknown[] = [];
    const scene = mountScene(Declaration, Body('type="audio/wav"'), {
      options: {
        staticUrl: `${inject("fixtures").asset}/nothing-here/`,
        files: fakeFiles(),
        onError: (error) => errors.push(error),
      },
    });
    await userEvent.click(first(scene.findAll(".ak-upload button")));
    await waitFor(() => expect(scene.find(".ak-upload-status").textContent).toBe(NOT_STARTED));
    expect(stream.getTracks().map((track) => track.readyState)).toEqual(["ended"]);
    expect(scene.responses).toEqual([]);
    expect(errors).toHaveLength(1);
    microphone.mockRestore();
    await context.close();
  });

  it("says that the microphone could not be used, reports it, and gives no response", async () => {
    const microphone = vi
      .spyOn(navigator.mediaDevices, "getUserMedia")
      .mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const errors: unknown[] = [];
    const scene = mountScene(Declaration, Body('type="audio/wav"'), {
      options: { files: fakeFiles(), onError: (error) => errors.push(error) },
    });
    await userEvent.click(first(scene.findAll(".ak-upload button")));
    await waitFor(() => expect(scene.find(".ak-upload-status").textContent).toBe("The microphone could not be used."));
    expect(scene.responses).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(first(scene.findAll<HTMLButtonElement>(".ak-upload button")).disabled).toBe(false);
    microphone.mockRestore();
  });
});

describe("a recording that starts by itself and is kept", () => {
  const Declaration = declare("single", "file");
  /** The types that every engine records in: the types of its recorder, else WAV. */
  const Types = "audio/webm audio/ogg audio/mp4 audio/wav";
  const Body = (attributes: string): string =>
    `<qti-upload-interaction response-identifier="R" type="${Types}" ${attributes}><qti-prompt>Say it.</qti-prompt></qti-upload-interaction>`;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Intervals that a test moves by hand, so that a countdown waits for it and for nothing else. */
  function manualIntervals(): { tick(times?: number): void } {
    const active = new Map<number, () => void>();
    let next = 0;
    vi.stubGlobal("setInterval", (callback: () => void) => {
      next += 1;
      active.set(next, callback);
      return next;
    });
    vi.stubGlobal("clearInterval", (id: number) => void active.delete(id));
    return {
      tick: (times = 1) => {
        for (let count = 0; count < times; count += 1) for (const callback of [...active.values()]) callback();
      },
    };
  }

  /** A scene that records, with the microphone an oscillator whose streams the test keeps, and the errors it reports. */
  function open(attributes: string, files: FakeFiles = fakeFiles(), options: Partial<InteractionOptions> = {}) {
    const intervals = manualIntervals();
    const streams: MediaStream[] = [];
    const microphone = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(async () => {
      const stream = await fakeMicrophone();
      streams.push(stream);
      return stream;
    });
    const errors: unknown[] = [];
    const scene = mountScene(Declaration, Body(attributes), {
      options: { files, onError: (error) => errors.push(error), ...options },
    });
    const clock = (): string => scene.find(".ak-upload-clock").textContent ?? "";
    const status = (): string => scene.find(".ak-upload-status").textContent ?? "";
    const record = (): HTMLButtonElement => first(scene.findAll<HTMLButtonElement>(".ak-upload button"), 0);
    const stop = (): HTMLButtonElement => first(scene.findAll<HTMLButtonElement>(".ak-upload button"), 1);
    const recording = (): Promise<void> =>
      waitFor(() => expect(scene.root.querySelector(".ak-recording")).not.toBeNull());
    return { ...intervals, scene, files, microphone, streams, errors, clock, status, record, stop, recording };
  }

  it("reads whole seconds, caps the limit, and counts a value that is not whole as absent", () => {
    const read = (attributes: Readonly<Record<string, string>>) => {
      const element = document.createElement("div");
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return readRecordAttributes(element);
    };
    expect(read({})).toEqual({ start: undefined, limit: MAX_RECORDING_SECONDS, once: false });
    expect(read({ "data-ak-record-start": "0", "data-ak-record-limit": "45", "data-ak-record-once": "true" })).toEqual({
      start: 0,
      limit: 45,
      once: true,
    });
    expect(read({ "data-ak-record-limit": "100000" }).limit).toBe(MAX_RECORDING_SECONDS);
    for (const text of ["", "1.5", "-1", "abc", " 3", "1e3"]) {
      expect(read({ "data-ak-record-start": text, "data-ak-record-limit": text }), text).toMatchObject({
        start: undefined,
        limit: MAX_RECORDING_SECONDS,
      });
    }
    expect(read({ "data-ak-record-limit": "0" }).limit).toBe(MAX_RECORDING_SECONDS);
    for (const text of ["", "True", "yes", "1"]) expect(read({ "data-ak-record-once": text }).once, text).toBe(false);
  });

  it("prepares at the start of the countdown, shows the clock, and records by itself when it ends", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, microphone, tick, clock, status, recording } = open('data-ak-record-start="3"');
    await waitFor(() => expect(files.reserved).toHaveLength(1));
    await waitFor(() => expect(microphone).toHaveBeenCalledOnce());
    expect(status()).toBe("Recording starts by itself when the countdown ends.");
    expect(clock()).toBe("Starts in 0:03");
    expect(scene.find(".ak-upload-clock").hasAttribute("hidden")).toBe(false);
    expect(scene.responses).toEqual([]);
    tick(2);
    expect(clock()).toBe("Starts in 0:01");
    expect(scene.responses).toEqual([]);
    tick();
    await recording();
    expect(status()).toBe("Recording");
    expect(scene.responses).toEqual([{ responseIdentifier: "R", value: single("file", first(files.reserved)) }]);
    expect(clock()).toBe("Time left 10:00");
    expect(files.filled).toEqual([]);
    tick(60);
    expect(clock()).toBe("Time left 9:00");
  });

  it("does not make the clock a live region, so that a screen reader hears the countdown once", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files } = open('data-ak-record-start="3"');
    await waitFor(() => expect(files.reserved).toHaveLength(1));
    expect(scene.find(".ak-upload-status").getAttribute("role")).toBe("status");
    expect(scene.find(".ak-upload-clock").closest("[role=status], [aria-live]")).toBeNull();
  });

  it("starts at once when the start is 0, with no countdown to show", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, recording, clock } = open('data-ak-record-start="0"');
    await recording();
    expect(files.reserved).toHaveLength(1);
    expect(scene.responses).toHaveLength(1);
    expect(clock()).toBe("Time left 10:00");
  });

  it("starts early at a press of Record, and the countdown stops", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, microphone, tick, clock, record, recording } = open('data-ak-record-start="30"');
    await waitFor(() => expect(microphone).toHaveBeenCalledOnce());
    expect(record().disabled).toBe(false);
    await userEvent.click(record());
    await recording();
    expect(scene.responses).toHaveLength(1);
    expect(files.reserved).toHaveLength(1);
    expect(microphone).toHaveBeenCalledOnce();
    tick(10);
    expect(clock()).toBe("Time left 9:50");
  });

  it("ends the recording at its limit, as Stop does, and stores the bytes", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, tick, status, recording } = open('data-ak-record-start="0" data-ak-record-limit="2"');
    await recording();
    tick(2);
    await waitFor(() => expect(files.filled).toHaveLength(1));
    expect(first(files.filled).file).toEqual(first(files.reserved));
    expect(status()).toBe("");
    expect(scene.root.querySelector(".ak-recording")).toBeNull();
    await waitFor(() => expect(scene.root.querySelector(".ak-stored audio")).not.toBeNull());
  });

  it("records again with a new reservation, and takes the recording away, unless it is once", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, record, stop, recording } = open("");
    await userEvent.click(record());
    await recording();
    await userEvent.click(stop());
    await waitFor(() => expect(files.filled).toHaveLength(1));
    await waitFor(() => expect(scene.root.querySelector(".ak-stored button")).not.toBeNull());
    await userEvent.click(record());
    await recording();
    expect(files.reserved.map(({ reference }) => reference)).toEqual(["reserved-1", "reserved-2"]);
    expect(scene.responses.at(-1)?.value).toEqual(single("file", first(files.reserved, 1)));
  });

  it("allows no second recording and no Remove once a recording has started, when it is once", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, record, stop, recording } = open('data-ak-record-start="0" data-ak-record-once="true"');
    await recording();
    await userEvent.click(stop());
    await waitFor(() => expect(files.filled).toHaveLength(1));
    await waitFor(() => expect(scene.root.querySelector(".ak-stored audio")).not.toBeNull());
    expect(scene.root.querySelector(".ak-stored button")).toBeNull();
    expect(record().disabled).toBe(true);
    expect(scene.find<HTMLInputElement>("input[type=file]").disabled).toBe(true);
  });

  it("keeps the part that plays the file hidden until its bytes are stored", async (context) => {
    await needsAudio(context, audioContextRuns());
    const files = fakeFiles();
    files.holding = true;
    const { scene, stop, recording } = open('data-ak-record-start="0"', files);
    await recording();
    expect(scene.find(".ak-stored").textContent).toBe("");
    await userEvent.click(stop());
    await waitFor(() => expect(files.waiting()).toBe(1));
    expect(scene.root.querySelector(".ak-recording")).toBeNull();
    expect(scene.find(".ak-stored").textContent).toBe("");
    files.release();
    await waitFor(() => expect(scene.root.querySelector(".ak-stored audio")).not.toBeNull());
    expect(scene.find(".ak-stored").textContent).toContain("recording.");
  });

  it("settles when the recording has stopped and not when the bytes are stored, so that Next never waits for the upload", async (context) => {
    await needsAudio(context, audioContextRuns());
    const files = fakeFiles();
    files.holding = true;
    const { scene, recording } = open('data-ak-record-start="0"', files);
    await recording();
    await scene.interaction().settled();
    expect(files.filled).toEqual([]);
    expect(scene.responses).toEqual([{ responseIdentifier: "R", value: single("file", first(files.reserved)) }]);
    files.release();
    await waitFor(() => expect(files.filled).toHaveLength(1));
  });

  it("ends a countdown when it settles: nothing is recorded, the microphone is let go of, and there is no response", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, streams, status } = open('data-ak-record-start="30"');
    await waitFor(() => expect(streams).toHaveLength(1));
    await scene.interaction().settled();
    await waitFor(() =>
      expect(streams.flatMap((stream) => stream.getTracks().map(({ readyState }) => readyState))).toEqual(["ended"]),
    );
    expect(scene.find(".ak-upload-clock").hasAttribute("hidden")).toBe(true);
    expect(status()).toBe("");
    expect(scene.responses).toEqual([]);
    expect(files.filled).toEqual([]);
    expect(files.reserved).toHaveLength(1);
  });

  it("stops and stores the recording when the interaction locks", async (context) => {
    await needsAudio(context, audioContextRuns());
    const { scene, files, recording } = open('data-ak-record-start="0"');
    await recording();
    scene.interaction().disabled = true;
    await waitFor(() => expect(files.filled).toHaveLength(1));
    expect(scene.responses).toEqual([{ responseIdentifier: "R", value: single("file", first(files.reserved)) }]);
  });

  it("lets go of the microphone and stores the recording when the element leaves the page, and keeps nothing of a countdown", async (context) => {
    await needsAudio(context, audioContextRuns());
    const recorded = open('data-ak-record-start="0"');
    await recorded.recording();
    recorded.scene.interaction().remove();
    await waitFor(() => expect(recorded.files.filled).toHaveLength(1));
    await waitFor(() =>
      expect(recorded.streams.flatMap((stream) => stream.getTracks().map(({ readyState }) => readyState))).toEqual([
        "ended",
      ]),
    );
    const counting = open('data-ak-record-start="30"');
    await waitFor(() => expect(counting.streams).toHaveLength(1));
    counting.scene.interaction().remove();
    await waitFor(() =>
      expect(counting.streams.flatMap((stream) => stream.getTracks().map(({ readyState }) => readyState))).toEqual([
        "ended",
      ]),
    );
    expect(counting.files.filled).toEqual([]);
    expect(counting.scene.responses).toEqual([]);
  });

  it("starts nothing when the item is shown with a response, is locked, or offers no recording", async () => {
    const answered = open('data-ak-record-start="0"');
    answered.scene.setValue("R", single("file", { reference: "r", mimeType: "audio/webm" }));
    const locked = open('data-ak-record-start="0"');
    locked.scene.interaction().disabled = true;
    const off = open('data-ak-record-start="0"', fakeFiles(), { record: false });
    await new Promise<void>((done) => queueMicrotask(done));
    await new Promise<void>((done) => queueMicrotask(done));
    for (const each of [answered, locked, off]) {
      expect(each.files.reserved).toEqual([]);
      expect(each.microphone).not.toHaveBeenCalled();
      expect(each.scene.find(".ak-upload-status").textContent).toBe("");
    }
    expect(off.scene.root.querySelector(".ak-upload button")).toBeNull();
  });

  it("starts nothing without a start attribute, which leaves the recording to Record", async () => {
    const { files, microphone } = open("");
    await new Promise<void>((done) => queueMicrotask(done));
    expect(files.reserved).toEqual([]);
    expect(microphone).not.toHaveBeenCalled();
  });

  describe("failures", () => {
    it("shows that the file could not be named, reports it, and starts nothing, with Record there to try again", async () => {
      const { scene, microphone, errors, status, record } = open(
        'data-ak-record-start="5"',
        fakeFiles({ reserve: true }),
      );
      await waitFor(() => expect(status()).toBe("The file could not be uploaded. Try again."));
      expect(errors).toHaveLength(1);
      expect(microphone).not.toHaveBeenCalled();
      expect(scene.responses).toEqual([]);
      expect(record().disabled).toBe(false);
      expect(scene.find(".ak-upload-clock").hasAttribute("hidden")).toBe(true);
    });

    it("shows that the microphone could not be used at a timed start, reports it, and gives no response", async () => {
      const { scene, files, errors, status, record } = open('data-ak-record-start="0"');
      vi.spyOn(navigator.mediaDevices, "getUserMedia").mockRejectedValue(new DOMException("denied", "NotAllowedError"));
      await waitFor(() => expect(status()).toBe("The microphone could not be used."));
      expect(errors).toHaveLength(1);
      expect(scene.responses).toEqual([]);
      expect(record().disabled).toBe(false);
      expect(files.filled).toEqual([]);
    });

    it("ends a recording whose microphone went away, keeps the bytes, says so, and lets the candidate go on", async (context) => {
      await needsAudio(context, audioContextRuns());
      // The tracks that the element listens to, which Firefox does not give again from getTracks of the stream.
      const listened = vi.spyOn(MediaStreamTrack.prototype, "addEventListener");
      const { scene, files, status, recording } = open('data-ak-record-start="0"');
      await recording();
      for (const track of listened.mock.contexts) {
        if (!(track instanceof MediaStreamTrack)) continue;
        track.stop();
        // A browser fires it when the device goes; a stop by the page does not.
        track.dispatchEvent(new Event("ended"));
      }
      expect(status()).toBe("The microphone could not be used.");
      await scene.interaction().settled();
      await waitFor(() => expect(files.filled).toHaveLength(1));
      expect(scene.responses).toEqual([{ responseIdentifier: "R", value: single("file", first(files.reserved)) }]);
      expect(status()).toBe("The microphone could not be used.");
    });

    it("takes the response away and offers Record again when the bytes cannot be stored while the candidate can act", async (context) => {
      await needsAudio(context, audioContextRuns());
      const { scene, stop, record, status, recording } = open('data-ak-record-start="0"', fakeFiles({ fill: true }));
      await recording();
      await userEvent.click(stop());
      await waitFor(() => expect(status()).toBe("The file could not be uploaded. Try again."));
      expect(scene.responses.at(-1)?.value).toBeNull();
      expect(record().disabled).toBe(false);
    });

    it("offers no Record when the bytes cannot be stored and the recording is once", async (context) => {
      await needsAudio(context, audioContextRuns());
      const { scene, stop, record, status, recording } = open(
        'data-ak-record-start="0" data-ak-record-once="true"',
        fakeFiles({ fill: true }),
      );
      await recording();
      await userEvent.click(stop());
      await waitFor(() => expect(status()).toBe("The file could not be uploaded. Try again."));
      expect(scene.responses.at(-1)?.value).toBeNull();
      expect(record().disabled).toBe(true);
    });

    it("tells the candidate and reports it when the audio context of a WAV recording never runs, and starts nothing", async (context) => {
      await needsAudio(context, audioContextRuns());
      const stream = await fakeMicrophone();
      vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(stream);
      const contexts = suspendedAudioContext();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
      const files = fakeFiles();
      const errors: unknown[] = [];
      const scene = mountScene(
        Declaration,
        `<qti-upload-interaction response-identifier="R" type="audio/wav" data-ak-record-start="1"><qti-prompt>Say it.</qti-prompt></qti-upload-interaction>`,
        { options: { files, onError: (error) => errors.push(error) } },
      );
      const status = (): string => scene.find(".ak-upload-status").textContent ?? "";
      expect(await waitForReservation(files)).toBe(1);
      expect(status()).toBe("Recording starts by itself when the countdown ends.");
      // The countdown ends, and the recorder asks the context to run.
      await vi.advanceTimersByTimeAsync(1000);
      while (contexts.made() === 0) await new Promise((done) => realSetTimeout(done, 10));
      expect(status()).toBe("Recording starts by itself when the countdown ends.");
      await vi.advanceTimersByTimeAsync(RECORDER_START_LIMIT_MS - 1);
      expect([status(), errors]).toEqual(["Recording starts by itself when the countdown ends.", []]);
      await vi.advanceTimersByTimeAsync(1);
      expect(status()).toBe(NOT_STARTED);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toBeInstanceOf(AssesskitError);
      // The reservation is named and never referenced: no response, no recording, nothing to store.
      expect(files.reserved).toHaveLength(1);
      expect([scene.responses, files.filled]).toEqual([[], []]);
      expect(scene.root.querySelector(".ak-recording")).toBeNull();
      expect(scene.find(".ak-upload-clock").hasAttribute("hidden")).toBe(true);
      expect(scene.find(".ak-stored").textContent).toBe("");
      expect(contexts.closed()).toBe(1);
      expect(stream.getTracks().map((track) => track.readyState)).toEqual(["ended"]);
      const record = first(scene.findAll<HTMLButtonElement>(".ak-upload button"));
      expect(record.disabled).toBe(false);

      // Record starts a recording with a new reservation once the device runs.
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(fakeMicrophone);
      await userEvent.click(record);
      await waitFor(() => expect(scene.root.querySelector(".ak-recording")).not.toBeNull());
      expect(files.reserved).toHaveLength(2);
      expect(scene.responses).toEqual([{ responseIdentifier: "R", value: single("file", first(files.reserved, 1)) }]);
    });

    it("reports that the bytes cannot be stored after the lock, and leaves the response naming the file", async (context) => {
      await needsAudio(context, audioContextRuns());
      const { scene, files, errors, recording } = open('data-ak-record-start="0"', fakeFiles({ fill: true }));
      await recording();
      scene.interaction().disabled = true;
      await waitFor(() => expect(errors).toHaveLength(1));
      expect(scene.responses).toEqual([{ responseIdentifier: "R", value: single("file", first(files.reserved)) }]);
    });
  });
});

/** An interaction of each kind, with a response that the candidate gave and one that is not valid. */
const EVERY_KIND: readonly {
  readonly kind: string;
  readonly declarations: string;
  readonly body: string;
  readonly given: Value | null;
  readonly invalid: Value | null;
}[] = [
  {
    kind: "choice",
    declarations: declare("multiple", "identifier"),
    body: `<qti-choice-interaction response-identifier="R" max-choices="2" min-choices="2"><qti-prompt>P</qti-prompt><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice><qti-simple-choice identifier="C">c</qti-simple-choice></qti-choice-interaction>`,
    given: container("multiple", "identifier", ["A", "B"]),
    invalid: container("multiple", "identifier", ["A"]),
  },
  {
    kind: "hottext",
    declarations: declare("multiple", "identifier"),
    body: `<qti-hottext-interaction response-identifier="R" max-choices="2" min-choices="2"><p>x <qti-hottext identifier="A">a</qti-hottext> y <qti-hottext identifier="B">b</qti-hottext></p></qti-hottext-interaction>`,
    given: container("multiple", "identifier", ["A", "B"]),
    invalid: container("multiple", "identifier", ["A"]),
  },
  {
    kind: "inline choice",
    declarations: declare("single", "identifier"),
    body: `<p>x <qti-inline-choice-interaction response-identifier="R"><qti-inline-choice identifier="A">a</qti-inline-choice></qti-inline-choice-interaction></p>`,
    given: single("identifier", "A"),
    invalid: single("identifier", "Z"),
  },
  {
    kind: "text entry",
    declarations: declare("single", "string"),
    body: `<p>x <qti-text-entry-interaction response-identifier="R" pattern-mask="[a-z]+"/></p>`,
    given: single("string", "abc"),
    invalid: single("string", "123"),
  },
  {
    kind: "extended text",
    declarations: declare("single", "string"),
    body: `<qti-extended-text-interaction response-identifier="R" pattern-mask="[a-z]+"><qti-prompt>P</qti-prompt></qti-extended-text-interaction>`,
    given: single("string", "abc"),
    invalid: single("string", "123"),
  },
  {
    kind: "slider",
    declarations: declare("single", "integer"),
    body: `<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="10" step-label="true"><qti-prompt>P</qti-prompt></qti-slider-interaction>`,
    given: single("integer", 4),
    invalid: single("integer", 40),
  },
  {
    kind: "order",
    declarations: declare("ordered", "identifier"),
    body: `<qti-order-interaction response-identifier="R"><qti-prompt>P</qti-prompt><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-order-interaction>`,
    given: container("ordered", "identifier", ["B", "A"]),
    invalid: container("ordered", "identifier", ["B"]),
  },
  {
    kind: "associate",
    declarations: declare("multiple", "pair"),
    body: `<qti-associate-interaction response-identifier="R" max-associations="2" min-associations="2"><qti-prompt>P</qti-prompt><qti-simple-associable-choice identifier="A" match-max="2">a</qti-simple-associable-choice><qti-simple-associable-choice identifier="B" match-max="2">b</qti-simple-associable-choice></qti-associate-interaction>`,
    given: container("multiple", "pair", [
      ["A", "B"],
      ["B", "A"],
    ]),
    invalid: container("multiple", "pair", [["A", "B"]]),
  },
  {
    kind: "match",
    declarations: declare("multiple", "directedPair"),
    body: `<qti-match-interaction response-identifier="R" max-associations="2" min-associations="2"><qti-prompt>P</qti-prompt><qti-simple-match-set><qti-simple-associable-choice identifier="A" match-max="1">a</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set><qti-simple-associable-choice identifier="X" match-max="2">x</qti-simple-associable-choice></qti-simple-match-set></qti-match-interaction>`,
    given: container("multiple", "directedPair", [["A", "X"]]),
    invalid: null,
  },
  {
    kind: "gap match",
    declarations: declare("multiple", "directedPair"),
    body: `<qti-gap-match-interaction response-identifier="R"><qti-prompt>P</qti-prompt><qti-gap-text identifier="W" match-max="1">w</qti-gap-text><p>x <qti-gap identifier="G1" required="true"/> y <qti-gap identifier="G2"/></p></qti-gap-match-interaction>`,
    given: container("multiple", "directedPair", [["W", "G1"]]),
    invalid: container("multiple", "directedPair", [["W", "G2"]]),
  },
  {
    kind: "upload",
    declarations: declare("single", "file"),
    body: `<qti-upload-interaction response-identifier="R" type="application/pdf"><qti-prompt>P</qti-prompt></qti-upload-interaction>`,
    given: single("file", { reference: "r", mimeType: "application/pdf", fileName: "a.pdf" }),
    invalid: single("file", { reference: "r", mimeType: "image/png", fileName: "a.png" }),
  },
  {
    kind: "media",
    declarations: declare("single", "integer"),
    body: `<qti-media-interaction response-identifier="R" autostart="false" min-plays="2"><qti-prompt>P</qti-prompt><audio><source src="media/tone.wav" type="audio/wav"/></audio></qti-media-interaction>`,
    given: single("integer", 2),
    invalid: single("integer", 1),
  },
];

describe("every interaction", () => {
  it.each(EVERY_KIND)(
    "has no violation of WCAG 2.2 A and AA with controls to answer, with the answer shown, locked, and not valid: $kind",
    async ({ declarations, body, given, invalid }) => {
      const scene = mountScene(declarations, body);
      expect(await axeViolations(scene.host), "interacting").toEqual([]);
      scene.setValue("R", given);
      expect(await axeViolations(scene.host), "answered").toEqual([]);
      if (invalid !== null) {
        scene.setValue("R", invalid);
        expect(scene.find(".ak-hint").textContent, "has a hint").not.toBe("");
        expect(await axeViolations(scene.host), "not valid").toEqual([]);
      }
      scene.setValue("R", given);
      scene.interaction().disabled = true;
      expect(await axeViolations(scene.host), "review").toEqual([]);
    },
  );

  it.each(EVERY_KIND)(
    "gives every control that the candidate can press or type in a target of at least 24 by 24 CSS pixels: $kind",
    ({ declarations, body, given }) => {
      const scene = mountScene(declarations, body);
      scene.setValue("R", given);
      const controls = scene.findAll("button, input, select, textarea, [role=slider], [role=textbox]");
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls.filter((candidate) => candidate.getClientRects().length > 0)) {
        const { width, height } = sizeOf(control);
        expect([control.localName, control.className, width >= 24, height >= 24]).toEqual([
          control.localName,
          control.className,
          true,
          true,
        ]);
      }
    },
  );
});

describe("keyboard operation", () => {
  /** Picks a choice up and puts it in a place with the keyboard alone. */
  async function putByKeyboard(scene: Scene, choice: string, place: number): Promise<void> {
    const token = first(
      scene
        .findAll<HTMLButtonElement>(".ak-choices :not([hidden]) > button")
        .filter((button) => button.textContent === choice),
    );
    token.focus();
    await userEvent.keyboard("{Enter}");
    first(scene.findAll<HTMLButtonElement>("button.ak-drop"), place).focus();
    await userEvent.keyboard(" ");
  }

  it("makes an association without a drag, by choosing a choice and then the place", async () => {
    const scene = mountScene(
      declare("multiple", "pair"),
      `<qti-associate-interaction response-identifier="R" max-associations="1"><qti-simple-associable-choice identifier="A" match-max="1">Alpha</qti-simple-associable-choice><qti-simple-associable-choice identifier="B" match-max="1">Beta</qti-simple-associable-choice></qti-associate-interaction>`,
    );
    await putByKeyboard(scene, "Alpha", 0);
    await putByKeyboard(scene, "Beta", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "pair", [["A", "B"]]));
  });

  it("matches without a drag, by choosing a choice and then the choice that takes it", async () => {
    const scene = mountScene(
      declare("multiple", "directedPair"),
      `<qti-match-interaction response-identifier="R" max-associations="2"><qti-simple-match-set><qti-simple-associable-choice identifier="A" match-max="1">Alpha</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set><qti-simple-associable-choice identifier="X" match-max="1">Xi</qti-simple-associable-choice></qti-simple-match-set></qti-match-interaction>`,
    );
    await putByKeyboard(scene, "Alpha", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["A", "X"]]));
  });

  it("fills a gap without a drag, by choosing a choice and then the gap", async () => {
    const scene = mountScene(
      declare("multiple", "directedPair"),
      `<qti-gap-match-interaction response-identifier="R"><qti-gap-text identifier="W" match-max="1">winter</qti-gap-text><p>It is <qti-gap identifier="G1"/>.</p></qti-gap-match-interaction>`,
    );
    await putByKeyboard(scene, "winter", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["W", "G1"]]));
  });

  it("chooses a hot text and a choice in a menu with the keyboard alone", async () => {
    const hot = mountScene(
      declare("single", "identifier"),
      `<qti-hottext-interaction response-identifier="R"><p><qti-hottext identifier="A">one</qti-hottext> <qti-hottext identifier="B">two</qti-hottext></p></qti-hottext-interaction>`,
    );
    first(hot.findAll<HTMLInputElement>("qti-hottext > input"), 1).focus();
    await userEvent.keyboard(" ");
    expect(hot.responses.at(-1)?.value).toEqual(single("identifier", "B"));
    const menu = mountScene(
      declare("single", "identifier"),
      `<p><qti-inline-choice-interaction response-identifier="R"><qti-inline-choice identifier="L">London</qti-inline-choice><qti-inline-choice identifier="P">Paris</qti-inline-choice></qti-inline-choice-interaction></p>`,
    );
    menu.find("select").focus();
    // The arrow keys open the menu in some systems, and the first letters choose an entry in all of them.
    await userEvent.keyboard("Pa");
    expect(menu.responses.at(-1)?.value).toEqual(single("identifier", "P"));
  });

  it("types a text and ends an attempt with the keyboard alone", async () => {
    const text = mountScene(
      declare("single", "string"),
      `<p><qti-text-entry-interaction response-identifier="R"/></p>`,
    );
    text.find("input").focus();
    await userEvent.keyboard("yes");
    expect(text.responses.at(-1)?.value).toEqual(single("string", "yes"));
    const hint = mountScene(
      declare("single", "boolean", "H"),
      `<p><qti-end-attempt-interaction response-identifier="H" title="Hint"/></p>`,
    );
    const pressed: string[] = [];
    hint.root.addEventListener("ak-end-attempt", (event) => pressed.push(event.detail.responseIdentifier));
    hint.find("button").focus();
    await userEvent.keyboard("{Enter}");
    expect(pressed).toEqual(["H"]);
  });

  it("checks a match in the table, and plays and sends a file, with the keyboard alone", async () => {
    const table = mountScene(
      declare("multiple", "directedPair"),
      `<qti-match-interaction response-identifier="R" class="qti-match-tabular" max-associations="2"><qti-simple-match-set><qti-simple-associable-choice identifier="A" match-max="1">a</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set><qti-simple-associable-choice identifier="X" match-max="1">x</qti-simple-associable-choice></qti-simple-match-set></qti-match-interaction>`,
    );
    table.find("td input").focus();
    await userEvent.keyboard(" ");
    expect(table.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["A", "X"]]));
  });
});

describe("createInteractionRenderers", () => {
  const Files = { upload: () => Promise.reject(new Error("none")), url: () => "", ...NO_RECORDING };
  const Static = "https://static.example/";

  it("gives a renderer for every interaction type of the QTI metadata vocabulary but the portable one, which the PCI host draws, and defines the elements once, however often it is called", () => {
    const kinds = [
      ...createInteractionRenderers({ messages: EN_MESSAGES, files: Files, staticUrl: Static }).keys(),
    ].sort();
    const listed = INTERACTION_TYPES.map((type) => type.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`))
      .filter((kind) => kind !== "portable-custom-interaction")
      .sort();
    expect(kinds).toEqual(listed);
    expect(() => {
      defineElements();
      defineElements();
    }).not.toThrow();
    expect(customElements.get("qti-choice-interaction")).toBeDefined();
  });

  it("rejects options of other types as JavaScript or JSON gives them", () => {
    expect(() => createInteractionRenderers(JSON.parse("null"))).toThrow(
      new DataError("The options must be an object, found null."),
    );
    expect(() => createInteractionRenderers(JSON.parse('{"messages": {}}'))).toThrow(DataError);
    expect(() => createInteractionRenderers({ messages: EN_MESSAGES, files: Files, staticUrl: "static" })).toThrow(
      DataError,
    );
  });

  it("rejects a node of another kind, which only a forged tree could give", () => {
    const renderers = createInteractionRenderers({ messages: EN_MESSAGES, files: Files, staticUrl: Static });
    const render = renderers.get("choice-interaction");
    expect(() => render?.(JSON.parse('{"kind":"slider-interaction"}'), JSON.parse("{}"))).toThrow(
      new DataError('The renderer of choice-interaction got "slider-interaction".'),
    );
  });
});

describe("mathematics in choices", () => {
  const Mathml = 'xmlns="http://www.w3.org/1998/Math/MathML"';
  const fraction = (n: string): string => `<math ${Mathml}><mfrac><mi>x</mi><mn>${n}</mn></mfrac></math>`;
  const typesetter = createMathTypesetter(`${inject("fixtures").asset}/mathjax/${crypto.randomUUID()}/mml-chtml.js`);

  it("names the controls and the buttons of choices that are mathematics once MathJax has typeset them", async () => {
    const choice = mountScene(
      declare("single", "identifier"),
      `<qti-choice-interaction response-identifier="R"><qti-simple-choice identifier="A">${fraction("2")}</qti-simple-choice><qti-simple-choice identifier="B">${fraction("3")}</qti-simple-choice></qti-choice-interaction>`,
    );
    const order = mountScene(
      declare("ordered", "identifier"),
      `<qti-order-interaction response-identifier="R"><qti-simple-choice identifier="A">${fraction("2")}</qti-simple-choice><qti-simple-choice identifier="B">${fraction("3")}</qti-simple-choice></qti-order-interaction>`,
    );
    order.setValue("R", container("ordered", "identifier", ["B"]));
    for (const scene of [choice, order]) {
      await typesetter.typeset(scene.root);
      expect(scene.root.querySelector("math")).toBeNull();
      expect(await axeViolations(scene.host)).toEqual([]);
    }
  });
});

describe("the example of the guide", () => {
  it("shows a choice interaction in a content root, gives it its descriptor, and hears the response", async () => {
    const parsed = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="cities" title="Cities" adaptive="false" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="multiple" base-type="identifier"/>
  <qti-item-body>
    <qti-choice-interaction response-identifier="RESPONSE" max-choices="2">
      <qti-prompt>Which are in France?</qti-prompt>
      <qti-simple-choice identifier="A">Paris</qti-simple-choice>
      <qti-simple-choice identifier="B">Lyon</qti-simple-choice>
      <qti-simple-choice identifier="C">Turin</qti-simple-choice>
    </qti-choice-interaction>
  </qti-item-body>
</qti-assessment-item>`);
    if (parsed.kind !== "item" || parsed.item.body === undefined) throw new Error("The document is not an item.");
    const messages = selectMessages("en");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createContentRoot(host, {
      messages,
      assets: (path) => `https://assets.example/g/token/${path}`,
      fetch: (url, request) => fetch(url, request),
      stylesheet: stylesheet(PLAYER_CSS),
      interactions: createInteractionRenderers({
        messages,
        files: {
          upload: async () => {
            throw new Error("This item has no upload.");
          },
          url: () => "",
          ...NO_RECORDING,
        },
        staticUrl: "https://assets.example/static/",
      }),
    });
    await root.show({ body: { nodes: parsed.item.body.children, base: "items/cities/item.xml" } });
    const descriptors = new Map(describeInteractions(parsed.item).map((d) => [d.responseIdentifier, d]));
    for (const element of root.root.querySelectorAll("*")) {
      const descriptor =
        element instanceof InteractionElement ? descriptors.get(element.responseIdentifier) : undefined;
      if (element instanceof InteractionElement && descriptor !== undefined) element.descriptor = descriptor;
    }
    const heard: unknown[] = [];
    root.root.addEventListener("ak-response", (event) => {
      heard.push(event.detail);
    });
    const lyon = [...root.root.querySelectorAll("label")].find((label) => label.textContent === "Lyon");
    await userEvent.click(lyon ?? host);
    expect(heard).toEqual([{ responseIdentifier: "RESPONSE", value: container("multiple", "identifier", ["B"]) }]);
    expect(JSON.stringify(heard)).toBe(
      '[{"responseIdentifier":"RESPONSE","value":{"cardinality":"multiple","baseType":"identifier","values":["B"]}}]',
    );
    root.destroy();
    host.remove();
  });
});

describe("the properties of an element", () => {
  it("draws the controls again in the new language when the messages change, and keeps what the candidate gave", () => {
    const scene = mountScene(
      declare("ordered", "identifier"),
      `<qti-order-interaction response-identifier="R"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-order-interaction>`,
    );
    scene.setValue("R", container("ordered", "identifier", ["B"]));
    expect(scene.find("button.ak-drop").textContent).toBe("Place here");
    scene.interaction().messages = ID_MESSAGES;
    expect(scene.find("button.ak-drop").textContent).toBe("Taruh di sini");
    expect(scene.findAll(".ak-chip-button").map((chip) => chip.textContent)).toEqual(["b"]);
    expect(scene.findAll(".ak-target").map((place) => place.getAttribute("aria-label"))).toEqual([
      "Urutan 1",
      "Urutan 2",
    ]);
  });

  it("draws the controls of a new descriptor, and leaves them and the focus where they are for one with the same data", () => {
    const scene = mountScene(
      declare("multiple", "identifier"),
      `<qti-choice-interaction response-identifier="R" max-choices="2"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-choice-interaction>`,
    );
    const element = scene.interaction();
    const input = first(scene.findAll<HTMLInputElement>("input"));
    input.focus();
    const descriptor = element.descriptor;
    if (descriptor === undefined) throw new Error("The fixture has no descriptor.");
    element.descriptor = JSON.parse(JSON.stringify(descriptor));
    expect(first(scene.findAll("input"))).toBe(input);
    expect(scene.root.activeElement).toBe(input);
    element.descriptor = { ...descriptor, constraints: { maxChoices: 1 } };
    expect(scene.findAll<HTMLInputElement>("input").map(({ type }) => type)).toEqual(["radio", "radio"]);
  });

  it("shows the string that the host restores in the text area, and takes it away for NULL", () => {
    const scene = mountScene(declare("single", "string"), `<qti-extended-text-interaction response-identifier="R"/>`);
    scene.setValue("R", single("string", "Restored"));
    expect(scene.find<HTMLTextAreaElement>("textarea").value).toBe("Restored");
    scene.setValue("R", null);
    expect(scene.find<HTMLTextAreaElement>("textarea").value).toBe("");
  });

  it("rejects a typed value that is not a value", () => {
    const scene = mountScene(
      declare("single", "float"),
      `<p><qti-text-entry-interaction response-identifier="R"/></p>`,
    );
    const element = scene.interaction();
    expect("typed" in element).toBe(true);
    expect(() => {
      Reflect.set(element, "typed", JSON.parse('{"cardinality":"single"}'));
    }).toThrow();
  });
});
