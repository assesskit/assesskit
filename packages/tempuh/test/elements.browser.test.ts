import { DataError as OlahDataError } from "@luthfanwakan/olah";
import { readAsi } from "@luthfanwakan/olah/asi";
import { describeInteractions } from "@luthfanwakan/olah/interactions";
import { container, single, type Value } from "@luthfanwakan/olah/values";
import { describe, expect, inject, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { DataError, EN_MESSAGES, ID_MESSAGES, selectMessages } from "../src/index.js";
import {
  createContentRoot,
  createInteractionRenderers,
  createMathTypesetter,
  defineElements,
  InteractionElement,
  type InteractionFiles,
} from "../src/player/index.js";
import { audioContextRuns } from "./audio.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { mountScene, type Scene } from "./interactions-fixture.js";
import { axeViolations } from "./renderer-fixture.js";

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

  it("[T26] gives a radio button for each choice where at most one may be selected, and a single value", async () => {
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

  it("[T26] gives a checkbox for each choice where several may be selected, and the identifiers in the order of the choices", async () => {
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

  it("[T26] keeps the order of the choices of the view, and puts the control before the face that names it", () => {
    const scene = mountScene(declare("single", "identifier"), Body(""));
    const choices = scene.findAll("qti-simple-choice");
    expect(choices.map((choice) => choice.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    for (const choice of choices) {
      const [control, face] = [...choice.children];
      expect(control?.classList.contains("tempuh-control")).toBe(true);
      expect(face?.classList.contains("tempuh-face")).toBe(true);
      expect(face?.getAttribute("for")).toBe(control?.id);
    }
  });

  it("[T26] shows the value that the host sets and locks the controls when it is disabled, without a response", () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="0"'));
    scene.setValue("R", container("multiple", "identifier", ["B", "C"]));
    expect(scene.findAll<HTMLInputElement>("input").map(({ checked }) => checked)).toEqual([false, true, true]);
    scene.interaction().disabled = true;
    expect(scene.findAll<HTMLInputElement>("input").every(({ disabled }) => disabled)).toBe(true);
    scene.setValue("R", null);
    expect(scene.findAll<HTMLInputElement>("input").some(({ checked }) => checked)).toBe(false);
    expect(scene.responses).toEqual([]);
  });

  it("[T26] sets the rows of a stack of several columns and the class of a horizontal orientation", () => {
    const scene = mountScene(
      declare("single", "identifier"),
      Body('class="qti-choices-stacking-2" orientation="horizontal"'),
    );
    expect(scene.interaction().style.getPropertyValue("--tempuh-rows")).toBe("2");
    expect(scene.interaction().classList.contains("qti-orientation-horizontal")).toBe(true);
  });

  it("[T47][SC 3.3.1] says in text, tied to the controls, that too many choices are selected, in the words of the item", async () => {
    const scene = mountScene(
      declare("multiple", "identifier"),
      Body('max-choices="2" data-max-selections-message="Too many!"'),
    );
    const inputs = scene.findAll<HTMLInputElement>("input");
    for (const input of inputs) await userEvent.click(input);
    const hint = scene.find(".tempuh-hint");
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

  it("[T47][SC 3.3.3] tells how many choices to select when the item has no text of its own", async () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="3" min-choices="2"'));
    await userEvent.click(scene.findAll<HTMLInputElement>("input")[0] ?? scene.host);
    expect(scene.find(".tempuh-hint").textContent).toBe("Select at least 2.");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[SC 3.3.2] tells the limits that the candidate cannot guess, and none for a radio group", () => {
    const limits = mountScene(declare("multiple", "identifier"), Body('max-choices="3" min-choices="2"'));
    expect(limits.find(".tempuh-instruction").textContent).toBe("Select at least 2. Select at most 3.");
    const radio = mountScene(declare("single", "identifier"), Body('min-choices="1"'));
    expect(radio.find(".tempuh-instruction").textContent).toBe("");
  });

  it("[T48][SC 2.1.1] is selected by the keyboard alone", async () => {
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
    }).toThrow(OlahDataError);
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

  it("[T34] makes the text of each hot text the face of its control, in the running text", async () => {
    const scene = mountScene(declare("multiple", "identifier"), Body('max-choices="2"'));
    expect(scene.find("p").textContent?.replaceAll(/\s+/gu, " ").trim()).toBe("The dog and the cat sat on the mat.");
    const inputs = scene.findAll<HTMLInputElement>("qti-hottext > input");
    expect(inputs.map(({ type }) => type)).toEqual(["checkbox", "checkbox", "checkbox"]);
    await userEvent.click(scene.find("qti-hottext + * , qti-hottext > label"));
    await userEvent.click(inputs[2] ?? scene.host);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "identifier", ["A", "C"]));
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T34] gives a single value where at most one hot text may be selected", async () => {
    const scene = mountScene(declare("single", "identifier"), Body(""));
    const inputs = scene.findAll<HTMLInputElement>("qti-hottext > input");
    expect(inputs.map(({ type }) => type)).toEqual(["radio", "radio", "radio"]);
    await userEvent.click(inputs[1] ?? scene.host);
    expect(scene.responses.at(-1)?.value).toEqual(single("identifier", "B"));
  });

  it("[T34] shows the value of the host", () => {
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

  it("[T31] offers the choices in a menu inside the sentence, with the prompt first, and gives NULL for the prompt", async () => {
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

  it("[T31] uses a prompt of the interface without data-prompt, and shows the value of the host", () => {
    const scene = mountScene(declare("single", "identifier"), Body(""));
    expect(scene.find<HTMLSelectElement>("select").options[0]?.text).toBe("Choose an answer");
    scene.setValue("R", single("identifier", "L"));
    expect(scene.find<HTMLSelectElement>("select").value).toBe("L");
  });

  it("[T31] names the menu by the label of the choice", () => {
    const scene = mountScene(
      declare("single", "identifier"),
      `<p><qti-inline-choice-interaction response-identifier="R"><qti-label>Capital</qti-label><qti-inline-choice identifier="P">Paris</qti-inline-choice></qti-inline-choice-interaction></p>`,
    );
    const label = scene.find("qti-label");
    expect(label.textContent).toBe("Capital");
    expect(scene.find("select").getAttribute("aria-labelledby")).toBe(label.id);
  });

  it("[T47][SC 3.3.1] says that an answer is required when the menu is required and the response is not valid", () => {
    const scene = mountScene(declare("single", "identifier"), Body('required="true"'));
    expect(scene.find(".tempuh-hint").textContent).toBe("");
  });
});

describe("text entry", () => {
  const Body = (attributes: string): string =>
    `<p>Type <qti-text-entry-interaction response-identifier="R" ${attributes}/> here.</p>`;

  it("[T32] gives the text as a string, and NULL for the empty text", async () => {
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

  it("[T32] gives a float or an integer from the text that the candidate typed", async () => {
    const floats = mountScene(declare("single", "float"), Body(""));
    await userEvent.fill(floats.find("input"), "3.50");
    expect(floats.responses.at(-1)?.value).toEqual(single("float", 3.5));
    expect(floats.find("input").getAttribute("inputmode")).toBe("decimal");
    const integers = mountScene(declare("single", "integer"), Body(""));
    await userEvent.fill(integers.find("input"), "42");
    expect(integers.responses.at(-1)?.value).toEqual(single("integer", 42));
  });

  it("[T32][SC 3.3.3] tells to enter a number, or a whole number, when the text is not one", async () => {
    const floats = mountScene(declare("single", "float"), Body(""));
    await userEvent.fill(floats.find("input"), "abc");
    expect(floats.responses.at(-1)?.value).toBeNull();
    expect(floats.find(".tempuh-hint").textContent).toBe("Enter a number.");
    expect(floats.find("input").getAttribute("aria-invalid")).toBe("true");
    const integers = mountScene(declare("single", "integer"), Body(""));
    await userEvent.fill(integers.find("input"), "4.5");
    expect(integers.find(".tempuh-hint").textContent).toBe("Enter a whole number.");
    await userEvent.fill(integers.find("input"), "45");
    expect(integers.find(".tempuh-hint").textContent).toBe("");
  });

  it("[T32] gives the record of olah for a text bound to a record, in the base of the interaction", async () => {
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

  it("[T32] keeps the text as typed in the variable of string-identifier, and shows it again", async () => {
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

  it("[T32][T47][SC 3.3.1] says in the words of the item that the text does not match the pattern mask", async () => {
    const scene = mountScene(
      declare("single", "string"),
      Body('pattern-mask="[0-9]{3}" data-patternmask-message="Three digits, please."'),
    );
    const input = scene.find<HTMLInputElement>("input");
    await userEvent.fill(input, "12");
    expect(scene.find(".tempuh-hint").textContent).toBe("Three digits, please.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(await axeViolations(scene.host)).toEqual([]);
    await userEvent.fill(input, "123");
    expect(scene.find(".tempuh-hint").textContent).toBe("");
  });

  it("[T32] keeps what the candidate typed when the host sends the same response back", async () => {
    const scene = mountScene(declare("single", "float"), Body(""));
    const input = scene.find<HTMLInputElement>("input");
    await userEvent.fill(input, "3.50");
    scene.setValue("R", single("float", 3.5));
    expect(input.value).toBe("3.50");
  });

  it("[T32] is read-only when disabled, so that it keeps the focus", () => {
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

  it("[T27] draws a place for each choice and the choices in the pool, in the order of the view", () => {
    const scene = mountScene(Ordered, Body('class="qti-labels-decimal"'));
    expect(scene.findAll(".tempuh-choices > qti-simple-choice").map((choice) => choice.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(scene.findAll(".tempuh-target").map((target) => target.getAttribute("aria-label"))).toEqual([
      "Position 1",
      "Position 2",
      "Position 3",
    ]);
    expect(scene.find(".tempuh-targets").getAttribute("aria-label")).toBe("Your order");
  });

  it("[T27] gives the choices in the order of the places, as an ordered container", async () => {
    const scene = mountScene(Ordered, Body(""));
    const pick = async (name: string): Promise<void> => {
      await userEvent.click(
        first(scene.findAll("qti-simple-choice > button").filter((button) => button.textContent === name)),
      );
    };
    const drops = (): HTMLElement[] => scene.findAll("button.tempuh-drop");
    await pick("Gamma");
    await userEvent.click(first(drops()));
    await pick("Alpha");
    await userEvent.click(first(drops(), 0));
    await pick("Beta");
    await userEvent.click(first(drops(), 0));
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["C", "A", "B"]));
    expect(scene.findAll(".tempuh-choices > qti-simple-choice").every((choice) => choice.hasAttribute("hidden"))).toBe(
      true,
    );
    expect(
      scene.findAll(".tempuh-choices > qti-simple-choice").map((choice) => getComputedStyle(choice).display),
    ).toEqual(["none", "none", "none"]);
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T27] puts a choice back in the pool and gives the order that remains", async () => {
    const scene = mountScene(Ordered, Body(""));
    scene.setValue("R", container("ordered", "identifier", ["B", "A", "C"]));
    expect(scene.findAll(".tempuh-target .tempuh-chip-button").map((chip) => chip.textContent)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
    ]);
    await userEvent.click(first(scene.findAll("button.tempuh-remove"), 0));
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["A", "C"]));
    expect(scene.find("qti-simple-choice:not([hidden])").textContent).toBe("Beta");
  });

  it("[T27] orders only as many choices as max-choices allows, and tells the limits", () => {
    const scene = mountScene(Ordered, Body('min-choices="2" max-choices="2"'));
    expect(scene.findAll(".tempuh-target")).toHaveLength(2);
    expect(scene.find(".tempuh-instruction").textContent).toBe("Place at least 2. Place at most 2.");
  });

  it("[T47][SC 3.3.3] tells the candidate to place more choices when an order is partly made", async () => {
    const scene = mountScene(Ordered, Body(""));
    await userEvent.click(first(scene.findAll("qti-simple-choice > button")));
    await userEvent.click(first(scene.findAll("button.tempuh-drop")));
    expect(scene.find(".tempuh-hint").textContent).toBe("Place at least 3.");
  });

  it("[T48][SC 2.1.1][SC 2.5.7] puts a choice in a place with the keyboard alone, and lets it go with Escape", async () => {
    const scene = mountScene(Ordered, Body(""));
    const pool = scene.findAll<HTMLButtonElement>("qti-simple-choice > button");
    first(pool).focus();
    await userEvent.keyboard("{Enter}");
    expect(first(pool).getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{Escape}");
    expect(first(pool).getAttribute("aria-pressed")).toBe("false");
    await userEvent.keyboard("{Enter}");
    first(scene.findAll<HTMLButtonElement>("button.tempuh-drop"), 1).focus();
    await userEvent.keyboard("{Enter}");
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["A"]));
    expect(scene.find(".qti-visually-hidden").textContent).toBe("Alpha placed in Position 2");
  });

  it("[T48][SC 2.5.7] says to choose first when a place is chosen without a choice", async () => {
    const scene = mountScene(Ordered, Body(""));
    await userEvent.click(first(scene.findAll("button.tempuh-drop")));
    expect(scene.find(".qti-visually-hidden").textContent).toBe("Select a choice first.");
    expect(scene.responses).toEqual([]);
  });

  it("[T48][SC 2.5.7] puts a choice in a place with a drag of the mouse, and back with a drag to the pool", async () => {
    const scene = mountScene(Ordered, Body(""));
    await userEvent.dragAndDrop(
      first(scene.findAll("qti-simple-choice > button"), 1),
      first(scene.findAll(".tempuh-target"), 2),
    );
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "identifier", ["B"]));
    await userEvent.dragAndDrop(first(scene.findAll(".tempuh-chip-button")), scene.find(".tempuh-choices"));
    expect(scene.responses.at(-1)?.value).toBeNull();
  });

  it("[SC 2.5.8] gives every control a target of at least 24 by 24 CSS pixels", () => {
    const scene = mountScene(Ordered, Body(""));
    scene.setValue("R", container("ordered", "identifier", ["B"]));
    // A choice that is in a place is not in the pool, where it is hidden.
    for (const control of scene.findAll("button").filter((button) => button.getClientRects().length > 0)) {
      const { width, height } = sizeOf(control);
      expect([control.className, width >= 24, height >= 24]).toEqual([control.className, true, true]);
    }
  });

  it("[T27] locks the controls for a candidate who cannot respond", () => {
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

  it("[T28] counts a pair once both its places are filled, as a pair", async () => {
    const scene = mountScene(declare("multiple", "pair"), Body);
    expect(scene.findAll(".tempuh-pair")).toHaveLength(2);
    const put = async (name: string, drop: number): Promise<void> => {
      await userEvent.click(
        first(
          scene
            .findAll("qti-simple-associable-choice:not([hidden]) > button")
            .filter((button) => button.textContent === name),
        ),
      );
      await userEvent.click(first(scene.findAll("button.tempuh-drop"), drop));
    };
    await put("Alpha", 0);
    expect(scene.responses).toEqual([{ responseIdentifier: "R", value: null }]);
    await put("Gamma", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "pair", [["A", "C"]]));
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T28] offers a choice again while it has uses left, as many as its match-max", async () => {
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

  it("[T28] names the two places of a pair, and gives a single pair where the variable is single", async () => {
    const scene = mountScene(declare("single", "pair"), Body.replace('max-associations="2"', ""));
    expect(scene.findAll(".tempuh-target").map((place) => place.getAttribute("aria-label"))).toEqual([
      "Pair 1, first",
      "Pair 1, second",
    ]);
    scene.setValue("R", single("pair", ["A", "B"]));
    expect(scene.findAll(".tempuh-chip-button").map((chip) => chip.textContent)).toEqual(["Alpha", "Beta"]);
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

  it("[T29] puts the choices of the first set in the second, as directed pairs from the first to the second", async () => {
    const scene = mountScene(Directed, Body(""));
    expect(scene.find(".tempuh-choices").tagName.toLowerCase()).toBe("qti-simple-match-set");
    await userEvent.click(first(scene.findAll("qti-simple-associable-choice > button")));
    await userEvent.click(first(scene.findAll("button.tempuh-drop"), 1));
    await userEvent.click(
      first(
        scene.findAll("qti-simple-associable-choice > button").filter((button) => button.textContent === "Demetrius"),
      ),
    );
    await userEvent.click(first(scene.findAll("button.tempuh-drop"), 1));
    expect(scene.responses.at(-1)?.value).toEqual(
      container("multiple", "directedPair", [
        ["C", "R"],
        ["D", "R"],
      ]),
    );
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T29] shows the matches that the host restores, and a single pair for a single variable", () => {
    const scene = mountScene(declare("single", "directedPair"), Body("").replace('max-associations="4"', ""));
    scene.setValue("R", single("directedPair", ["D", "M"]));
    expect(scene.findAll(".tempuh-targets .tempuh-chip-button").map((chip) => chip.textContent)).toEqual(["Demetrius"]);
  });

  it("[T29] draws a table with a checkbox for each match when the class says so", async () => {
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

  it("[T29][SC 1.3.1] names each box of the table by its row and its column", () => {
    const scene = mountScene(Directed, Body('class="qti-match-tabular"'));
    const box = first(scene.findAll("td input"), 1);
    const names = (box.getAttribute("aria-labelledby") ?? "")
      .split(" ")
      .map((id) => scene.root.getElementById(id)?.textContent);
    expect(names).toEqual(["Capulet", "Romeo and Juliet"]);
  });

  it("[T47][SC 3.3.1] says in the words of the item that too many matches were made", async () => {
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
    expect(scene.find(".tempuh-hint").textContent).toBe("That is enough.");
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

  it("[T30] puts a choice in a gap of the passage, as a directed pair from the choice to the gap", async () => {
    const scene = mountScene(Directed, Body(""));
    expect(scene.findAll("qti-gap").map((gap) => gap.getAttribute("aria-label"))).toEqual(["Gap 1", "Gap 2"]);
    await userEvent.click(first(scene.findAll("qti-gap-text > button"), 1));
    await userEvent.click(first(scene.findAll("qti-gap button.tempuh-drop"), 1));
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["S", "G2"]]));
    expect(scene.find("p").textContent?.replaceAll(/\s+/gu, " ")).toContain("then spring");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T30] keeps a choice in the pool while it has uses left, and takes it away when it has none", () => {
    const scene = mountScene(Directed, Body(""));
    scene.setValue(
      "R",
      container("multiple", "directedPair", [
        ["S", "G1"],
        ["W", "G2"],
      ]),
    );
    const visible = (): string[] =>
      scene.findAll(".tempuh-choices > :not([hidden]) > button").map((button) => button.textContent ?? "");
    expect(visible()).toEqual(["spring", ""]);
    expect(scene.findAll("qti-gap .tempuh-chip-button").map((chip) => chip.textContent)).toEqual(["spring", "winter"]);
  });

  it("[T30] gives an image choice its alternative text as its name", () => {
    const scene = mountScene(Directed, Body(""));
    expect(first(scene.findAll("qti-gap-img > button")).querySelector("img")?.getAttribute("alt")).toBe("a dot");
    scene.setValue("R", container("multiple", "directedPair", [["I", "G1"]]));
    expect(first(scene.findAll(".tempuh-remove")).getAttribute("aria-label")).toBe("Remove a dot");
  });

  it("[T30][T47] says that a required gap is empty once the response is not valid", async () => {
    const scene = mountScene(Directed, Body(""));
    await userEvent.click(first(scene.findAll("qti-gap-text > button")));
    await userEvent.click(first(scene.findAll("qti-gap button.tempuh-drop")));
    expect(scene.find(".tempuh-hint").textContent).toBe("An answer is required.");
  });

  it("[T30] replaces the choice of a gap that is full, which goes back to the pool", async () => {
    const scene = mountScene(Directed, Body(""));
    scene.setValue("R", container("multiple", "directedPair", [["W", "G1"]]));
    await userEvent.click(first(scene.findAll("qti-gap-text > button"), 1));
    await userEvent.click(first(scene.findAll("qti-gap .tempuh-chip-button")));
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["S", "G1"]]));
  });

  it("[T30] sets the width of the container of the choices", () => {
    const scene = mountScene(Directed, Body('data-choices-container-width="188"'));
    expect(scene.interaction().style.getPropertyValue("--tempuh-choices-width")).toBe("188px");
  });
});

describe("extended text", () => {
  const Body = (attributes: string): string => `<qti-extended-text-interaction response-identifier="R" ${attributes}>
    <qti-prompt>Write about it.</qti-prompt>
  </qti-extended-text-interaction>`;

  it("[T33] gives the text of a plain text area as a string, named by the prompt", async () => {
    const scene = mountScene(declare("single", "string"), Body('expected-lines="5" placeholder-text="Start here"'));
    const area = scene.find<HTMLTextAreaElement>("textarea");
    expect(area.rows).toBe(5);
    expect(area.placeholder).toBe("Start here");
    expect(area.getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
    await userEvent.fill(area, "Line one\nLine two");
    expect(scene.responses.at(-1)).toEqual({ responseIdentifier: "R", value: single("string", "Line one\nLine two") });
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T33] keeps the spaces of a preformatted text", () => {
    const scene = mountScene(declare("single", "string"), Body('format="preformatted"'));
    expect(getComputedStyle(scene.find("textarea")).whiteSpace).toBe("pre");
  });

  it("[T33] counts the characters typed or left of the expected length, as code points", async () => {
    const up = mountScene(declare("single", "string"), Body('class="qti-counter-up" expected-length="20"'));
    await userEvent.fill(up.find("textarea"), "a\u{1F600}b");
    expect(up.find(".tempuh-counter").textContent).toBe("3 / 20 characters");
    const down = mountScene(declare("single", "string"), Body('class="qti-counter-down" expected-length="20"'));
    await userEvent.fill(down.find("textarea"), "abcde");
    expect(down.find(".tempuh-counter").textContent).toBe("15 characters left");
    const none = mountScene(declare("single", "string"), Body('expected-length="20"'));
    expect(none.root.querySelector(".tempuh-counter")).toBeNull();
  });

  it("[T33] takes up to max-strings separate texts in a container, leaving out the empty ones", async () => {
    const scene = mountScene(declare("ordered", "string"), Body('max-strings="3" min-strings="2"'));
    const areas = scene.findAll<HTMLTextAreaElement>("textarea");
    expect(areas.map((area) => area.getAttribute("aria-label"))).toEqual(["Answer 1", "Answer 2", "Answer 3"]);
    await userEvent.fill(first(areas, 2), "third");
    await userEvent.fill(first(areas, 0), "first");
    expect(scene.responses.at(-1)?.value).toEqual(container("ordered", "string", ["first", "third"]));
    expect(scene.find(".tempuh-instruction").textContent).toBe("Enter at least 2. Enter at most 3.");
    scene.setValue("R", container("ordered", "string", ["x", "y"]));
    expect(areas.map((area) => area.value)).toEqual(["x", "y", ""]);
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T33][T47][SC 3.3.3] tells to enter more texts while fewer than min-strings are typed", async () => {
    const scene = mountScene(declare("multiple", "string"), Body('max-strings="3" min-strings="2"'));
    await userEvent.fill(first(scene.findAll("textarea")), "one");
    expect(scene.find(".tempuh-hint").textContent).toBe("Enter at least 2.");
  });

  it("[T33] writes the text of an XHTML answer with the kept elements only, and no attribute", async () => {
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
    expect(scene.find(".tempuh-counter").textContent).toBe("19 / 30 characters");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T33] shows an XHTML answer that the host restores, and treats one that is not well-formed as text", () => {
    const scene = mountScene(declare("single", "string"), Body('format="xhtml"'));
    scene.setValue("R", single("string", "<p>One <em>two</em></p><ul><li>three</li></ul>"));
    expect(scene.find("[role=textbox]").innerHTML).toBe("<p>One <em>two</em></p><ul><li>three</li></ul>");
    scene.setValue("R", single("string", "<p>broken"));
    expect(scene.find("[role=textbox]").textContent).toBe("<p>broken");
  });

  it("[T33] formats the selected text with the buttons of the toolbar", async () => {
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

  it("[T41] has no position until the candidate chooses one, and says so", () => {
    const scene = mountScene(declare("single", "integer"), Body(""));
    const thumb = scene.find("[role=slider]");
    expect(thumb.getAttribute("aria-valuetext")).toBe("No value chosen");
    expect(scene.find(".tempuh-slider").hasAttribute("data-tempuh-unset")).toBe(true);
    expect([thumb.getAttribute("aria-valuemin"), thumb.getAttribute("aria-valuemax")]).toEqual(["0", "10"]);
    expect(thumb.getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
  });

  it("[T41][T48][SC 2.1.1] moves in steps by the keyboard, from the lower bound when there is no value", async () => {
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

  it("[T41][SC 2.5.7] chooses the value at a click on the scale, with no drag", async () => {
    const scene = mountScene(declare("single", "integer"), Body(""));
    const track = scene.find(".tempuh-slider-track");
    const box = track.getBoundingClientRect();
    await userEvent.click(track, { position: { x: Math.round(box.width * 0.5), y: 12 } });
    expect(scene.responses.at(-1)?.value).toEqual(single("integer", 5));
  });

  it("[T41] gives a float on the scale of a hundredth of the range without a step", async () => {
    const scene = mountScene(
      declare("single", "float"),
      Body('lower-bound="0" upper-bound="1"').replace('lower-bound="0" upper-bound="10"', ""),
    );
    scene.find("[role=slider]").focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(scene.responses.at(-1)?.value).toEqual(single("float", 0.03));
  });

  it("[T41] labels the ends, the steps when asked, and reverses the scale", () => {
    const scene = mountScene(declare("single", "integer"), Body('step="5" step-label="true" reverse="true"'));
    expect(scene.findAll(".tempuh-slider-end").map((end) => end.textContent)).toEqual(["10", "0"]);
    expect(scene.findAll(".tempuh-slider-tick").map((tick) => tick.textContent)).toEqual(["0", "5", "10"]);
    const vertical = mountScene(declare("single", "integer"), Body('orientation="vertical"'));
    expect(vertical.findAll(".tempuh-slider-end").map((end) => end.textContent)).toEqual(["10", "0"]);
    expect(vertical.find("[role=slider]").getAttribute("aria-orientation")).toBe("vertical");
  });

  it("[T41] shows the value that the host sets, and is not moved when disabled", async () => {
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
  it("[T45] titles the button as the item says and tells the host which interaction was pressed", async () => {
    const scene = mountScene(
      declare("single", "boolean", "HINT"),
      `<p><qti-end-attempt-interaction response-identifier="HINT" title="Hint"/></p>`,
    );
    const events: string[] = [];
    scene.root.addEventListener("tempuh-end-attempt", (event) => events.push(event.detail.responseIdentifier));
    const button = scene.find("button");
    expect(button.textContent).toBe("Hint");
    await userEvent.click(button);
    expect(events).toEqual(["HINT"]);
    expect(scene.responses).toEqual([]);
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T45] cannot be pressed while the candidate cannot respond", () => {
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

  it("[T46] says that the kind of question is not supported when the host gives no hook", () => {
    const scene = mountScene(declare("single", "string"), Body);
    expect(scene.find("[role=note]").textContent).toBe("This kind of question is not supported here.");
  });

  it("[T46] mounts the hook of the host where it draws, hands it the response that the candidate gives, and takes it away", async () => {
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
    await userEvent.click(scene.find(".tempuh-custom button"));
    expect(scene.responses.at(-1)).toEqual({ responseIdentifier: "R", value: single("string", "hello") });
    expect(calls).toEqual(["mount custom-interaction false"]);
    scene.host.remove();
    expect(calls).toEqual(["mount custom-interaction false", "stop"]);
  });

  it("[T46] ignores a response that the hook gives while the candidate cannot respond", async () => {
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

/** Files of a test: they keep what is uploaded, and answer with the reference they give it. */
function fakeFiles(): InteractionFiles & {
  readonly uploads: { readonly bytes: Blob; readonly mimeType: string; readonly fileName?: string }[];
} {
  const uploads: { readonly bytes: Blob; readonly mimeType: string; readonly fileName?: string }[] = [];
  return {
    uploads,
    upload: async (bytes, mimeType, fileName) => {
      uploads.push({ bytes, mimeType, ...(fileName === undefined ? {} : { fileName }) });
      return { reference: `ref-${uploads.length}`, mimeType, ...(fileName === undefined ? {} : { fileName }) };
    },
    url: (file) => `https://files.example/${file.reference}`,
  };
}

/** A stream of an oscillator, which a test gives in place of the microphone. */
async function fakeMicrophone(): Promise<MediaStream> {
  const context = new AudioContext();
  await context.resume();
  const oscillator = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  return destination.stream;
}

describe("upload", () => {
  const Body = (types: string): string =>
    `<qti-upload-interaction response-identifier="R" ${types}><qti-prompt>Upload your work.</qti-prompt></qti-upload-interaction>`;
  const Declaration = declare("single", "file");

  it("[T43] offers a file picker for the accepted types, named by its label", () => {
    const scene = mountScene(Declaration, Body('type="application/pdf text/plain"'));
    const input = scene.find<HTMLInputElement>("input[type=file]");
    expect(input.accept).toBe("application/pdf,text/plain");
    expect(scene.find("label").textContent).toBe("Choose a file");
    expect(scene.find("label").getAttribute("for")).toBe(input.id);
    expect(scene.interaction().getAttribute("aria-labelledby")).toBe(scene.find("qti-prompt").id);
  });

  it("[T43] sends the chosen file to the host's storage and gives the reference as the response", async () => {
    const files = fakeFiles();
    const scene = mountScene(Declaration, Body('type="text/plain"'), { options: { files } });
    await userEvent.upload(scene.find("input[type=file]"), new File(["abc"], "notes.txt", { type: "text/plain" }));
    await vi.waitFor(() => expect(scene.responses).toHaveLength(1));
    expect(files.uploads.map(({ mimeType, fileName }) => [mimeType, fileName])).toEqual([["text/plain", "notes.txt"]]);
    expect(await files.uploads[0]?.bytes.text()).toBe("abc");
    expect(scene.responses[0]).toEqual({
      responseIdentifier: "R",
      value: single("file", { reference: "ref-1", mimeType: "text/plain", fileName: "notes.txt" }),
    });
    expect(scene.find(".tempuh-file-name").textContent).toBe("notes.txt");
    expect(await axeViolations(scene.host)).toEqual([]);
  });

  it("[T43] takes the file away without sending anything", async () => {
    const scene = mountScene(Declaration, Body(""));
    scene.setValue("R", single("file", { reference: "r", mimeType: "image/png", fileName: "a.png" }));
    await userEvent.click(scene.find(".tempuh-stored button"));
    expect(scene.responses.at(-1)?.value).toBeNull();
    expect(scene.find(".tempuh-stored").textContent).toBe("");
  });

  it("[T43][T47][SC 3.3.3] does not send a file of a type that is not accepted, and says which types are", async () => {
    const files = fakeFiles();
    const scene = mountScene(Declaration, Body('type="application/pdf"'), { options: { files } });
    await userEvent.upload(scene.find("input[type=file]"), new File(["x"], "a.png", { type: "image/png" }));
    await vi.waitFor(() =>
      expect(scene.find(".tempuh-hint").textContent).toBe(
        "This file type is not accepted. Accepted types: application/pdf",
      ),
    );
    expect(files.uploads).toEqual([]);
    expect(scene.responses).toEqual([]);
    expect(scene.find("input[type=file]").getAttribute("aria-invalid")).toBe("true");
  });

  it("[T43] says that the file could not be uploaded when the host fails, and gives no response", async () => {
    const scene = mountScene(Declaration, Body(""), {
      options: { files: { upload: () => Promise.reject(new Error("offline")), url: () => "" } },
    });
    await userEvent.upload(scene.find("input[type=file]"), new File(["x"], "a.txt", { type: "text/plain" }));
    await vi.waitFor(() =>
      expect(scene.find(".tempuh-upload-status").textContent).toBe("The file could not be uploaded. Try again."),
    );
    expect(scene.responses).toEqual([]);
  });

  it("[T43] plays a recording that the response holds, from the URL that the host gives", () => {
    const scene = mountScene(Declaration, Body(""), { options: { files: fakeFiles() } });
    scene.setValue("R", single("file", { reference: "r1", mimeType: "audio/webm", fileName: "recording.webm" }));
    expect(scene.find("audio").getAttribute("src")).toBe("https://files.example/r1");
  });

  it("[T43] locks the controls while the candidate cannot respond", () => {
    const scene = mountScene(Declaration, Body(""));
    scene.setValue("R", single("file", { reference: "r", mimeType: "image/png" }));
    scene.interaction().disabled = true;
    expect(scene.findAll<HTMLInputElement | HTMLButtonElement>("input, button").every(({ disabled }) => disabled)).toBe(
      true,
    );
  });

  it("[T43] offers no recording for a type that the browser cannot record and the interaction does not take as WAV", () => {
    const scene = mountScene(Declaration, Body('type="audio/mpeg"'));
    expect(scene.root.querySelector(".tempuh-upload button")).toBeNull();
    const without = mountScene(Declaration, Body('type="audio/wav"'), { options: { record: false } });
    expect(without.root.querySelector(".tempuh-upload button")).toBeNull();
  });

  it("[T43] records in a type that the interaction accepts, and sends the recording, asking for the microphone only when pressed", async (context) => {
    if (typeof MediaRecorder === "undefined" || !(await audioContextRuns())) context.skip();
    const microphone = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockImplementation(fakeMicrophone);
    const files = fakeFiles();
    const scene = mountScene(Declaration, Body('type="audio/webm audio/ogg audio/mp4"'), { options: { files } });
    expect(microphone).not.toHaveBeenCalled();
    const [record, stop] = scene.findAll<HTMLButtonElement>(".tempuh-upload button");
    expect([record?.textContent, stop?.textContent, stop?.disabled]).toEqual(["Record", "Stop recording", true]);
    await userEvent.click(record ?? scene.host);
    await vi.waitFor(() => expect(scene.find(".tempuh-recording").textContent).toBe("Recording"));
    expect(microphone).toHaveBeenCalledOnce();
    expect(record?.disabled).toBe(true);
    await new Promise((done) => setTimeout(done, 300));
    await userEvent.click(stop ?? scene.host);
    await vi.waitFor(() => expect(scene.responses).toHaveLength(1));
    const [upload] = files.uploads;
    expect(["audio/webm", "audio/ogg", "audio/mp4"]).toContain(upload?.mimeType);
    expect(upload?.fileName).toMatch(/^recording\.(webm|ogg|m4a)$/u);
    expect(scene.root.querySelector(".tempuh-recording")).toBeNull();
    microphone.mockRestore();
  });

  it("[T43] lets go of the microphone when the recording cannot start", async () => {
    const context = new AudioContext();
    const stream = context.createMediaStreamDestination().stream;
    const microphone = vi.spyOn(navigator.mediaDevices, "getUserMedia").mockResolvedValue(stream);
    // No worklet is served at this URL, so that a WAV recording cannot start.
    const scene = mountScene(Declaration, Body('type="audio/wav"'), {
      options: { staticUrl: `${inject("fixtures").asset}/nothing-here/` },
    });
    await userEvent.click(first(scene.findAll(".tempuh-upload button")));
    await vi.waitFor(() =>
      expect(scene.find(".tempuh-upload-status").textContent).toBe("The microphone could not be used."),
    );
    expect(stream.getTracks().map((track) => track.readyState)).toEqual(["ended"]);
    microphone.mockRestore();
    await context.close();
  });

  it("[T43][SC 3.3.1] says that the microphone could not be used, and gives no response", async () => {
    const microphone = vi
      .spyOn(navigator.mediaDevices, "getUserMedia")
      .mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const scene = mountScene(Declaration, Body('type="audio/wav"'));
    await userEvent.click(first(scene.findAll(".tempuh-upload button")));
    await vi.waitFor(() =>
      expect(scene.find(".tempuh-upload-status").textContent).toBe("The microphone could not be used."),
    );
    expect(scene.responses).toEqual([]);
    microphone.mockRestore();
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
    "[T48][SC 4.1.2] has no violation of WCAG 2.2 A and AA with controls to answer, with the answer shown, locked, and not valid: $kind",
    async ({ declarations, body, given, invalid }) => {
      const scene = mountScene(declarations, body);
      expect(await axeViolations(scene.host), "interacting").toEqual([]);
      scene.setValue("R", given);
      expect(await axeViolations(scene.host), "answered").toEqual([]);
      if (invalid !== null) {
        scene.setValue("R", invalid);
        expect(scene.find(".tempuh-hint").textContent, "has a hint").not.toBe("");
        expect(await axeViolations(scene.host), "not valid").toEqual([]);
      }
      scene.setValue("R", given);
      scene.interaction().disabled = true;
      expect(await axeViolations(scene.host), "review").toEqual([]);
    },
  );

  it.each(EVERY_KIND)(
    "[SC 2.5.8] gives every control that the candidate can press or type in a target of at least 24 by 24 CSS pixels: $kind",
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
        .findAll<HTMLButtonElement>(".tempuh-choices :not([hidden]) > button")
        .filter((button) => button.textContent === choice),
    );
    token.focus();
    await userEvent.keyboard("{Enter}");
    first(scene.findAll<HTMLButtonElement>("button.tempuh-drop"), place).focus();
    await userEvent.keyboard(" ");
  }

  it("[T48][SC 2.1.1][SC 2.5.7] makes an association without a drag, by choosing a choice and then the place", async () => {
    const scene = mountScene(
      declare("multiple", "pair"),
      `<qti-associate-interaction response-identifier="R" max-associations="1"><qti-simple-associable-choice identifier="A" match-max="1">Alpha</qti-simple-associable-choice><qti-simple-associable-choice identifier="B" match-max="1">Beta</qti-simple-associable-choice></qti-associate-interaction>`,
    );
    await putByKeyboard(scene, "Alpha", 0);
    await putByKeyboard(scene, "Beta", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "pair", [["A", "B"]]));
  });

  it("[T48][SC 2.1.1][SC 2.5.7] matches without a drag, by choosing a choice and then the choice that takes it", async () => {
    const scene = mountScene(
      declare("multiple", "directedPair"),
      `<qti-match-interaction response-identifier="R" max-associations="2"><qti-simple-match-set><qti-simple-associable-choice identifier="A" match-max="1">Alpha</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set><qti-simple-associable-choice identifier="X" match-max="1">Xi</qti-simple-associable-choice></qti-simple-match-set></qti-match-interaction>`,
    );
    await putByKeyboard(scene, "Alpha", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["A", "X"]]));
  });

  it("[T48][SC 2.1.1][SC 2.5.7] fills a gap without a drag, by choosing a choice and then the gap", async () => {
    const scene = mountScene(
      declare("multiple", "directedPair"),
      `<qti-gap-match-interaction response-identifier="R"><qti-gap-text identifier="W" match-max="1">winter</qti-gap-text><p>It is <qti-gap identifier="G1"/>.</p></qti-gap-match-interaction>`,
    );
    await putByKeyboard(scene, "winter", 0);
    expect(scene.responses.at(-1)?.value).toEqual(container("multiple", "directedPair", [["W", "G1"]]));
  });

  it("[T48][SC 2.1.1] chooses a hot text and a choice in a menu with the keyboard alone", async () => {
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

  it("[T48][SC 2.1.1] types a text and ends an attempt with the keyboard alone", async () => {
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
    hint.root.addEventListener("tempuh-end-attempt", (event) => pressed.push(event.detail.responseIdentifier));
    hint.find("button").focus();
    await userEvent.keyboard("{Enter}");
    expect(pressed).toEqual(["H"]);
  });

  it("[T48][SC 2.1.1] checks a match in the table, and plays and sends a file, with the keyboard alone", async () => {
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
  const Files = { upload: () => Promise.reject(new Error("none")), url: () => "" };
  const Static = "https://static.example/";

  it("[T26] gives a renderer for each kind that the player draws, and defines the elements once, however often it is called", () => {
    const kinds = [
      ...createInteractionRenderers({ messages: EN_MESSAGES, files: Files, staticUrl: Static }).keys(),
    ].sort();
    expect(kinds).toEqual([
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

  it("[T26][T27][T29][SC 1.1.1] names the controls and the buttons of choices that are mathematics once MathJax has typeset them", async () => {
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
  it("[T26] shows a choice interaction in a content root, gives it its descriptor, and hears the response", async () => {
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
    root.root.addEventListener("tempuh-response", (event) => {
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
  it("[T26][T27] draws the controls again in the new language when the messages change, and keeps what the candidate gave", () => {
    const scene = mountScene(
      declare("ordered", "identifier"),
      `<qti-order-interaction response-identifier="R"><qti-simple-choice identifier="A">a</qti-simple-choice><qti-simple-choice identifier="B">b</qti-simple-choice></qti-order-interaction>`,
    );
    scene.setValue("R", container("ordered", "identifier", ["B"]));
    expect(scene.find("button.tempuh-drop").textContent).toBe("Place here");
    scene.interaction().messages = ID_MESSAGES;
    expect(scene.find("button.tempuh-drop").textContent).toBe("Taruh di sini");
    expect(scene.findAll(".tempuh-chip-button").map((chip) => chip.textContent)).toEqual(["b"]);
    expect(scene.findAll(".tempuh-target").map((place) => place.getAttribute("aria-label"))).toEqual([
      "Urutan 1",
      "Urutan 2",
    ]);
  });

  it("[T26] draws the controls of a new descriptor, and leaves them and the focus where they are for one with the same data", () => {
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

  it("[T33] shows the string that the host restores in the text area, and takes it away for NULL", () => {
    const scene = mountScene(declare("single", "string"), `<qti-extended-text-interaction response-identifier="R"/>`);
    scene.setValue("R", single("string", "Restored"));
    expect(scene.find<HTMLTextAreaElement>("textarea").value).toBe("Restored");
    scene.setValue("R", null);
    expect(scene.find<HTMLTextAreaElement>("textarea").value).toBe("");
  });

  it("[T32] rejects a typed value that is not a value", () => {
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
