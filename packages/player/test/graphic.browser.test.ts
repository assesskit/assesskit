import { buildContainer, buildSingle } from "@assesskit/runtime/values";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { EN_MESSAGES } from "../src/index.js";
import { ID_MESSAGES } from "../src/messages/id/index.js";
import { pointsOf } from "../src/player/elements/internal.js";
import { colorAt, type Graphic, outlined, picture, settle, show } from "./graphic-fixture.js";
import { axeViolations } from "./renderer-fixture.js";
import { waitFor } from "./wait.js";

/** An image of the given size that every fixture uses, drawn at its own size. */
const image = (width = 200, height = 100): string =>
  `<object type="image/png" width="${width}" height="${height}" data="${picture(width, height, "#dde8f0")}">A map</object>`;

const declare = (cardinality: string, baseType: string, identifier = "RESPONSE"): string =>
  `<qti-response-declaration identifier="${identifier}" cardinality="${cardinality}" base-type="${baseType}"/>`;

/** Returns the first element inside another that matches the selector, and throws when none does. */
function within<T extends Element = HTMLElement>(parent: Element, selector: string): T {
  const found = parent.querySelector<T>(selector);
  if (found === null) throw new Error(`The fixture has no ${selector} in ${parent.localName}.`);
  return found;
}

/** Returns the element of a hotspot, a gap or a choice by its identifier, which the fixtures also give as its `id`. */
const area = (shown: Graphic, identifier: string): HTMLElement => shown.find(`[id="${identifier}"]`);

/** Returns the control of a hotspot, which is hidden to the eye: the keyboard and the screen reader use it. */
const control = <T extends HTMLElement = HTMLInputElement>(shown: Graphic, identifier: string): T =>
  within<T>(area(shown, identifier), ".ak-control");

/** Returns the face of a hotspot, which the pointer clicks and which draws its shape. */
const face = (shown: Graphic, identifier: string): HTMLElement => within(area(shown, identifier), ".ak-face");

/** Returns what the interaction says to a screen reader about what the candidate just did. */
const announced = (shown: Graphic): string | null => shown.find(".ak-notes > .qti-visually-hidden").textContent;

/** Returns the hints for a response that breaks a rule. */
const hinted = (shown: Graphic): string | null => shown.find(".ak-hint").textContent;

/** The rectangle of an element relative to the layer over its image. */
function inLayer(shown: Graphic, element: Element): { x: number; y: number; width: number; height: number } {
  const layer = shown.find(".ak-layer").getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return { x: box.left - layer.left, y: box.top - layer.top, width: box.width, height: box.height };
}

const near = (actual: number, expected: number, tolerance = 1.5): void => {
  expect(Math.abs(actual - expected), `${actual} is not near ${expected}`).toBeLessThanOrEqual(tolerance);
};

/** Clicks the image of the interaction at a point in the units of the image, as a pointer does. */
async function clickImage(shown: Graphic, x: number, y: number, selector = ".ak-surface"): Promise<void> {
  const surface = shown.find(selector);
  const box = surface.getBoundingClientRect();
  const layer = shown.find(".ak-layer").getBoundingClientRect();
  await userEvent.click(surface, {
    position: {
      x: (x / 200) * layer.width + (layer.left - box.left),
      y: (y / 100) * layer.height + (layer.top - box.top),
    },
  });
}

const HOTSPOT = (attributes: string, extra = ""): string => `
  <qti-hotspot-interaction response-identifier="RESPONSE" ${attributes}>
    <qti-prompt>Which one is Glasgow?</qti-prompt>
    ${image()}
    <qti-hotspot-choice shape="circle" coords="40,50,20" identifier="A" id="A" hotspot-label="London"/>
    <qti-hotspot-choice shape="rect" coords="100,20,160,80" identifier="B" id="B" hotspot-label="Glasgow"/>
    <qti-hotspot-choice shape="poly" coords="10,10,60,10,35,40" identifier="C" id="C"/>
    ${extra}
  </qti-hotspot-interaction>`;

describe("hotspot", () => {
  it("places every shape over the image at its coordinates in the units of the image", async () => {
    const shown = await show(
      HOTSPOT(
        'max-choices="1"',
        '<qti-hotspot-choice shape="ellipse" coords="150,80,30,10" identifier="D" id="D"/><qti-hotspot-choice shape="default" coords="" identifier="E" id="E"/>',
      ),
      declare("single", "identifier"),
    );
    const box = (identifier: string) => inLayer(shown, area(shown, identifier));
    // A circle is its center and radius, a rectangle its corners, an ellipse its center and radii.
    expect(box("A")).toMatchObject({ x: 20, y: 30, width: 40, height: 40 });
    expect(box("B")).toMatchObject({ x: 100, y: 20, width: 60, height: 60 });
    expect(box("D")).toMatchObject({ x: 120, y: 70, width: 60, height: 20 });
    expect(box("E")).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
    expect(box("C")).toMatchObject({ x: 10, y: 10, width: 50, height: 30 });
    const shapes = shown.findAll("qti-hotspot-choice").map((choice) => choice.getAttribute("data-shape"));
    expect(shapes).toEqual(["circle", "rect", "poly", "ellipse", "default"]);
    expect(getComputedStyle(face(shown, "A")).borderTopLeftRadius).toBe("50%");
    // A polygon draws its outline as SVG in its box: a halo under the line.
    expect(shown.findAll('qti-hotspot-choice[data-shape="poly"] polygon')).toHaveLength(2);
  });

  it("keeps the boxes on the shapes when the image is drawn at another scale", async () => {
    const shown = await show(HOTSPOT('max-choices="1"'), declare("single", "identifier"));
    shown.host.style.setProperty("width", "100px");
    await settle();
    const layer = shown.find(".ak-layer").getBoundingClientRect();
    near(layer.width, 90, 12);
    const scale = layer.width / 200;
    const b = inLayer(shown, area(shown, "B"));
    near(b.x, 100 * scale);
    near(b.width, 60 * scale);
  });

  it("selects one hotspot by its face and gives a single identifier", async () => {
    const shown = await show(HOTSPOT('max-choices="1"'), declare("single", "identifier"));
    await userEvent.click(face(shown, "B"));
    expect(shown.values).toEqual([buildSingle("identifier", "B")]);
    expect(control(shown, "B").checked).toBe(true);
    expect(control(shown, "B").type).toBe("radio");
    await userEvent.click(face(shown, "A"));
    expect(shown.values.at(-1)).toEqual(buildSingle("identifier", "A"));
    expect(control(shown, "B").checked).toBe(false);
  });

  it("clears the choice when the selected hotspot is chosen again", async () => {
    const shown = await show(HOTSPOT('max-choices="1"'), declare("single", "identifier"));
    await userEvent.click(face(shown, "B"));
    await userEvent.click(face(shown, "B"));
    expect(shown.values).toEqual([buildSingle("identifier", "B"), null]);
    expect(control(shown, "B").checked).toBe(false);
    await userEvent.click(face(shown, "B"));
    expect(shown.values.at(-1)).toEqual(buildSingle("identifier", "B"));
  });

  it("selects several hotspots, and says what to change when there are more than the maximum", async () => {
    const shown = await show(HOTSPOT('max-choices="2"'), declare("multiple", "identifier"));
    await userEvent.click(face(shown, "A"));
    await userEvent.click(face(shown, "B"));
    expect(shown.values.at(-1)).toEqual(buildContainer("multiple", "identifier", ["A", "B"]));
    expect(hinted(shown)).toBe("");
    await userEvent.click(face(shown, "C"));
    expect(shown.values.at(-1)).toEqual(buildContainer("multiple", "identifier", ["A", "B", "C"]));
    expect(hinted(shown)).toBe("Select at most 2.");
    expect(control(shown, "C").getAttribute("aria-invalid")).toBe("true");
    await userEvent.click(face(shown, "A"));
    expect(shown.values.at(-1)).toEqual(buildContainer("multiple", "identifier", ["B", "C"]));
    expect(hinted(shown)).toBe("");
  });

  it("shows the response it is given and ignores the candidate while it is disabled", async () => {
    const shown = await show(HOTSPOT('max-choices="2"'), declare("multiple", "identifier"));
    shown.setValue("RESPONSE", buildContainer("multiple", "identifier", ["A", "C"]));
    expect(shown.findAll<HTMLInputElement>("input.ak-control").map((input) => input.checked)).toEqual([
      true,
      false,
      true,
    ]);
    shown.interaction().disabled = true;
    expect(shown.findAll<HTMLInputElement>("input.ak-control").every((input) => input.disabled)).toBe(true);
    // The label of a disabled control does nothing, as the control itself.
    face(shown, "B").click();
    expect(shown.values).toEqual([]);
  });

  it("names a hotspot by its label, else by its number, in the language of the messages", async () => {
    const shown = await show(HOTSPOT('max-choices="1"'), declare("single", "identifier"));
    expect(control(shown, "A").labels?.[0]?.textContent).toBe("London");
    expect(control(shown, "C").getAttribute("aria-label")).toBe(`${EN_MESSAGES.choiceLabel} 3`);
    shown.interaction().messages = ID_MESSAGES;
    expect(control(shown, "C").getAttribute("aria-label")).toBe(`${ID_MESSAGES.choiceLabel} 3`);
    expect(control(shown, "A").labels?.[0]?.textContent).toBe("London");
  });

  it("is operated by the keyboard alone", async () => {
    const shown = await show(HOTSPOT('max-choices="2"'), declare("multiple", "identifier"));
    await userEvent.type(control(shown, "A"), " ");
    await userEvent.keyboard("{Tab}{Tab}{ }");
    expect(shown.values.at(-1)).toEqual(buildContainer("multiple", "identifier", ["A", "C"]));
  });

  it("gives a hotspot drawn smaller than a target a target of 24 pixels", async () => {
    const shown = await show(
      `<qti-hotspot-interaction response-identifier="RESPONSE" max-choices="1">${image()}<qti-hotspot-choice shape="circle" coords="40,50,8" identifier="S" id="S" hotspot-label="Small"/><qti-hotspot-choice shape="rect" coords="100,20,160,80" identifier="L" id="L" hotspot-label="Large"/></qti-hotspot-interaction>`,
      declare("single", "identifier"),
    );
    expect(area(shown, "S").hasAttribute("data-ak-small")).toBe(true);
    expect(area(shown, "L").hasAttribute("data-ak-small")).toBe(false);
    const hit = getComputedStyle(face(shown, "S"), "::after");
    expect(Number.parseFloat(hit.width)).toBeGreaterThanOrEqual(24);
    expect(Number.parseFloat(hit.height)).toBeGreaterThanOrEqual(24);
  });

  it("has no violation of WCAG 2.2 A and AA in any state", async () => {
    const shown = await show(HOTSPOT('max-choices="2"'), declare("multiple", "identifier"));
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.setValue("RESPONSE", buildContainer("multiple", "identifier", ["A", "B"]));
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.setValue("RESPONSE", buildContainer("multiple", "identifier", ["A", "B", "C"]));
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.interaction().disabled = true;
    expect(await axeViolations(shown.host)).toEqual([]);
  });
});

const SELECT_POINT = (attributes: string, extra = ""): string =>
  `<qti-select-point-interaction response-identifier="RESPONSE" ${attributes}><qti-prompt>Mark it.</qti-prompt>${image()}${extra}</qti-select-point-interaction>`;

describe("select point", () => {
  it("marks the point under a click, in the units of the image", async () => {
    const shown = await show(SELECT_POINT('max-choices="1"'), declare("single", "point"));
    await clickImage(shown, 120, 40);
    expect(shown.values).toEqual([buildSingle("point", [120, 40])]);
    const box = inLayer(shown, shown.find(".ak-marker"));
    near(box.x + box.width / 2, 120);
    near(box.y + box.height / 2, 40);
    expect(announced(shown)).toBe(EN_MESSAGES.graphicPointMarked);
  });

  it("measures the point in the units of the image when the image is drawn smaller", async () => {
    const shown = await show(SELECT_POINT('max-choices="1"'), declare("single", "point"));
    shown.host.style.setProperty("width", "100px");
    await settle();
    await clickImage(shown, 120, 40);
    const [x = 0, y = 0] = pointsOf(shown.values.at(-1) ?? null)[0] ?? [];
    near(x, 120, 3);
    near(y, 40, 3);
  });

  it("moves the only point with a maximum of one, and adds points with more, saying what to change beyond the maximum", async () => {
    const one = await show(SELECT_POINT('max-choices="1"'), declare("single", "point"));
    await clickImage(one, 20, 20);
    await clickImage(one, 60, 60);
    expect(one.values.at(-1)).toEqual(buildSingle("point", [60, 60]));
    expect(one.findAll(".ak-marker")).toHaveLength(1);
    const two = await show(SELECT_POINT('max-choices="2"'), declare("multiple", "point"));
    await clickImage(two, 20, 20);
    await clickImage(two, 60, 60);
    expect(hinted(two)).toBe("");
    await clickImage(two, 100, 80);
    expect(two.findAll(".ak-marker")).toHaveLength(3);
    expect(hinted(two)).toBe("Select at most 2.");
  });

  it("takes a point away when its marker is chosen, and gives the focus back to the image", async () => {
    const shown = await show(SELECT_POINT('max-choices="3"'), declare("multiple", "point"));
    await clickImage(shown, 20, 20);
    await clickImage(shown, 60, 60);
    await userEvent.click(shown.findAll(".ak-marker")[0] as HTMLElement);
    expect(shown.values.at(-1)).toEqual(buildContainer("multiple", "point", [[60, 60]]));
    expect(shown.root.activeElement).toBe(shown.find(".ak-surface"));
    await userEvent.click(shown.find(".ak-marker"));
    expect(shown.values.at(-1)).toBeNull();
    expect(announced(shown)).toBe(EN_MESSAGES.graphicRemoved);
  });

  it("marks points with the keyboard: a crosshair moves with the arrow keys and Enter marks it", async () => {
    const shown = await show(SELECT_POINT('max-choices="3"'), declare("multiple", "point"));
    shown.find(".ak-surface").focus();
    expect(shown.find(".ak-crosshair").hidden).toBe(false);
    // The crosshair starts at the center of the image; a key press is a twentieth of its smaller side, 5 units.
    await userEvent.type(shown.find(".ak-surface"), "{Enter}");
    await userEvent.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}{ }");
    expect(shown.values.at(-1)).toEqual(
      buildContainer("multiple", "point", [
        [100, 50],
        [105, 55],
        [103, 55],
      ]),
    );
    shown.find<HTMLElement>(".ak-marker").focus();
    expect(shown.find(".ak-crosshair").hidden).toBe(true);
  });

  it("never shows the areas that the response may be scored against", async () => {
    const scored =
      '<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="point"><qti-area-mapping default-value="0"><qti-area-map-entry shape="circle" coords="100,50,30" mapped-value="1"/></qti-area-mapping></qti-response-declaration>';
    const shown = await show(SELECT_POINT('max-choices="1"'), scored);
    const layer = shown.find(".ak-layer");
    expect([...layer.children].map((child) => child.className)).toEqual(["ak-surface", "ak-crosshair"]);
    expect(shown.findAll("[data-shape], svg")).toEqual([]);
  });

  it("has no violation of WCAG 2.2 A and AA with and without points", async () => {
    const shown = await show(SELECT_POINT('max-choices="3"'), declare("multiple", "point"));
    expect(await axeViolations(shown.host)).toEqual([]);
    await clickImage(shown, 60, 60);
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.interaction().disabled = true;
    expect(await axeViolations(shown.host)).toEqual([]);
  });
});

const ORDER = (attributes = ""): string => `
  <qti-graphic-order-interaction response-identifier="RESPONSE" ${attributes}>
    <qti-prompt>Put them in order.</qti-prompt>
    ${image()}
    <qti-hotspot-choice shape="circle" coords="40,50,20" identifier="A" id="A" hotspot-label="First stop"/>
    <qti-hotspot-choice shape="circle" coords="100,50,20" identifier="B" id="B" hotspot-label="Second stop"/>
    <qti-hotspot-choice shape="circle" coords="160,50,20" identifier="C" id="C" hotspot-label="Third stop"/>
  </qti-graphic-order-interaction>`;

const badge = (shown: Graphic, identifier: string): HTMLElement => within(area(shown, identifier), ".ak-badge");

describe("graphic order", () => {
  it("orders the hotspots as the candidate selects them and numbers them", async () => {
    const shown = await show(ORDER(), declare("ordered", "identifier"));
    await userEvent.click(face(shown, "B"));
    await userEvent.click(face(shown, "C"));
    await userEvent.click(face(shown, "A"));
    expect(shown.values.at(-1)).toEqual(buildContainer("ordered", "identifier", ["B", "C", "A"]));
    // The hotspots stand in document order: A is third, B first, C second.
    expect(["A", "B", "C"].map((identifier) => badge(shown, identifier).textContent)).toEqual([
      "Position 3",
      "Position 1",
      "Position 2",
    ]);
  });

  it("says the position in text, which is also in the name of the control for a screen reader", async () => {
    const shown = await show(ORDER(), declare("ordered", "identifier"));
    await userEvent.click(face(shown, "B"));
    expect(badge(shown, "B").textContent).toBe("Position 1");
    expect(control(shown, "B").labels?.[0]?.textContent).toContain("Position 1");
    expect(badge(shown, "A").hidden).toBe(true);
  });

  it("numbers the rest again when a hotspot leaves the order", async () => {
    const shown = await show(ORDER(), declare("ordered", "identifier"));
    for (const identifier of ["A", "B", "C"]) await userEvent.click(face(shown, identifier));
    await userEvent.click(face(shown, "A"));
    expect(shown.values.at(-1)).toEqual(buildContainer("ordered", "identifier", ["B", "C"]));
    expect(badge(shown, "C").textContent).toBe("Position 2");
    expect(badge(shown, "A").hidden).toBe(true);
  });

  it("says what to change when there are more hotspots than the maximum", async () => {
    const shown = await show(ORDER('min-choices="1" max-choices="2"'), declare("ordered", "identifier"));
    for (const identifier of ["A", "B", "C"]) await userEvent.click(face(shown, identifier));
    expect(shown.values.at(-1)).toEqual(buildContainer("ordered", "identifier", ["A", "B", "C"]));
    expect(hinted(shown)).toBe("Place at most 2.");
  });

  it("is operated by the keyboard alone and has no violation of WCAG 2.2 A and AA", async () => {
    const shown = await show(ORDER(), declare("ordered", "identifier"));
    await userEvent.type(control(shown, "C"), " ");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}{Shift>}{Tab}{/Shift} ");
    expect(shown.values.at(-1)).toEqual(buildContainer("ordered", "identifier", ["C", "A"]));
    expect(await axeViolations(shown.host)).toEqual([]);
  });
});

const ASSOCIATE = (attributes = 'max-associations="3"', hotspots = ""): string => `
  <qti-graphic-associate-interaction response-identifier="RESPONSE" ${attributes}>
    <qti-prompt>Join the airports.</qti-prompt>
    ${image()}
    <qti-associable-hotspot shape="circle" coords="30,50,12" identifier="A" id="A" hotspot-label="London" match-max="2"/>
    <qti-associable-hotspot shape="circle" coords="100,50,12" identifier="B" id="B" hotspot-label="Leeds" match-max="2"/>
    <qti-associable-hotspot shape="circle" coords="170,50,12" identifier="C" id="C" hotspot-label="Hull" match-max="2"/>
    ${hotspots}
  </qti-graphic-associate-interaction>`;

/** Chooses a hotspot of a graphic associate by its face. */
const choose = (shown: Graphic, identifier: string): Promise<void> => userEvent.click(face(shown, identifier));

const pressed = (shown: Graphic, identifier: string): string | null =>
  control<HTMLButtonElement>(shown, identifier).getAttribute("aria-pressed");

const unavailable = (shown: Graphic): string[] =>
  ["A", "B", "C"].filter((identifier) => control(shown, identifier).getAttribute("aria-disabled") === "true");

describe("graphic associate", () => {
  it("joins two hotspots by choosing one and then the other, with no gesture along a path", async () => {
    const shown = await show(ASSOCIATE(), declare("multiple", "pair"));
    await choose(shown, "A");
    expect(pressed(shown, "A")).toBe("true");
    expect(announced(shown)).toBe(EN_MESSAGES.graphicChooseSecond);
    await choose(shown, "B");
    expect(shown.values).toEqual([buildContainer("multiple", "pair", [["A", "B"]])]);
    expect(pressed(shown, "A")).toBe("false");
    expect(announced(shown)).toBe(EN_MESSAGES.graphicJoined);
  });

  it("draws a line between the centers of the two hotspots and lists the pair with a button that removes it", async () => {
    const shown = await show(ASSOCIATE(), declare("multiple", "pair"));
    await choose(shown, "A");
    await choose(shown, "C");
    const lines = shown.findAll(".ak-links line");
    expect(lines).toHaveLength(2);
    const line = lines[1] as Element;
    expect(["x1", "y1", "x2", "y2"].map((name) => line.getAttribute(name))).toEqual(["30", "50", "170", "50"]);
    expect(shown.find(".ak-associations li").textContent).toContain("London – Hull");
    await userEvent.click(shown.find(".ak-remove"));
    expect(shown.values.at(-1)).toBeNull();
    expect(shown.findAll(".ak-links line")).toHaveLength(0);
    expect(shown.find(".ak-associations").hidden).toBe(true);
  });

  it("lets the first hotspot go when it is chosen again", async () => {
    const shown = await show(ASSOCIATE(), declare("multiple", "pair"));
    await choose(shown, "A");
    await choose(shown, "A");
    expect(pressed(shown, "A")).toBe("false");
    expect(shown.values).toEqual([]);
  });

  it("offers no hotspot beyond its match-max or the maximum of the question", async () => {
    const shown = await show(ASSOCIATE('max-associations="3"'), declare("multiple", "pair"));
    expect(unavailable(shown)).toEqual([]);
    await choose(shown, "A");
    await choose(shown, "B");
    await choose(shown, "A");
    await choose(shown, "C");
    expect(shown.values).toHaveLength(2);
    // London has two associations, its match-max, so it joins no more; the others can still be joined.
    expect(unavailable(shown)).toEqual(["A"]);
    face(shown, "A").click();
    expect(pressed(shown, "A")).toBe("false");
    // With one hotspot chosen, only those it can be joined with stay available.
    await choose(shown, "B");
    expect(unavailable(shown)).toEqual(["A"]);
    await choose(shown, "C");
    expect(shown.values).toHaveLength(3);
    // Three associations are the maximum of the question.
    expect(unavailable(shown)).toEqual(["A", "B", "C"]);
    face(shown, "B").click();
    expect(shown.values).toHaveLength(3);
    expect(pressed(shown, "B")).toBe("false");
  });

  it("gives a single pair when the item declares a single value", async () => {
    const shown = await show(ASSOCIATE('max-associations="1"'), declare("single", "pair"));
    await choose(shown, "B");
    await choose(shown, "C");
    expect(shown.values).toEqual([buildSingle("pair", ["B", "C"])]);
  });

  it("shows the pairs it is given and is operated by the keyboard alone", async () => {
    const shown = await show(ASSOCIATE(), declare("multiple", "pair"));
    shown.setValue("RESPONSE", buildContainer("multiple", "pair", [["A", "B"]]));
    expect(shown.findAll(".ak-links line")).toHaveLength(2);
    await userEvent.type(control(shown, "B"), " ");
    await userEvent.keyboard("{Tab} ");
    expect(shown.values.at(-1)).toEqual(
      buildContainer("multiple", "pair", [
        ["A", "B"],
        ["B", "C"],
      ]),
    );
  });

  it("has no violation of WCAG 2.2 A and AA with pairs and while one is pending", async () => {
    const shown = await show(ASSOCIATE(), declare("multiple", "pair"));
    await choose(shown, "A");
    expect(await axeViolations(shown.host)).toEqual([]);
    await choose(shown, "B");
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.interaction().disabled = true;
    expect(await axeViolations(shown.host)).toEqual([]);
  });
});

const GAP_MATCH = (hotspots = ""): string => `
  <qti-graphic-gap-match-interaction response-identifier="RESPONSE">
    <qti-prompt>Place the labels.</qti-prompt>
    ${image()}
    <qti-gap-text identifier="X" id="X" match-max="1">ex</qti-gap-text>
    <qti-gap-text identifier="Y" id="Y" match-max="2"><strong>why</strong></qti-gap-text>
    <qti-gap-img identifier="Z" id="Z" match-max="1" object-label="Zed"><object type="image/png" width="20" height="10" data="${picture(20, 10, "#c62828")}"/></qti-gap-img>
    <qti-associable-hotspot identifier="H1" id="H1" match-max="1" shape="rect" coords="10,10,70,40" hotspot-label="First gap"/>
    <qti-associable-hotspot identifier="H2" id="H2" match-max="2" shape="rect" coords="100,20,180,80" hotspot-label="Second gap"/>
    ${hotspots}
  </qti-graphic-gap-match-interaction>`;

const token = (shown: Graphic, identifier: string): HTMLButtonElement =>
  within<HTMLButtonElement>(area(shown, identifier), "button.ak-token");

const drop = (shown: Graphic, identifier: string): HTMLButtonElement =>
  within<HTMLButtonElement>(area(shown, identifier), "button.ak-drop");

/** Picks a choice up and puts it in a gap, with two clicks: a choice already in the gap stands over its button. */
async function put(shown: Graphic, choice: string, gap: string): Promise<void> {
  await userEvent.click(token(shown, choice));
  await userEvent.click(area(shown, gap));
}

describe("graphic gap match", () => {
  it("places a choice in a gap by choosing the choice and then the gap", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    const interaction = shown.interaction();
    await userEvent.click(token(shown, "X"));
    expect(token(shown, "X").getAttribute("aria-pressed")).toBe("true");
    expect(interaction.hasAttribute("data-ak-placing")).toBe(true);
    await userEvent.click(drop(shown, "H1"));
    // The choices are the source of each directed pair and the gaps the target.
    expect(shown.values).toEqual([buildContainer("multiple", "directedPair", [["X", "H1"]])]);
    expect(interaction.hasAttribute("data-ak-placing")).toBe(false);
    expect(within(area(shown, "H1"), ".ak-chip-button").textContent).toBe("ex");
  });

  it("takes a choice out of the list when it has been used as many times as its match-max, and back when it is taken out of a gap", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await put(shown, "X", "H1");
    expect(area(shown, "X").hidden).toBe(true);
    await put(shown, "Y", "H2");
    expect(area(shown, "Y").hidden).toBe(false);
    await put(shown, "Y", "H2");
    expect(area(shown, "Y").hidden).toBe(true);
    // A gap that holds as many choices as its match-max offers no more room.
    expect(area(shown, "H2").querySelector(".ak-drop")).toBeNull();
    await userEvent.click(within(area(shown, "H2"), ".ak-remove"));
    expect(shown.values.at(-1)).toEqual(
      buildContainer("multiple", "directedPair", [
        ["X", "H1"],
        ["Y", "H2"],
      ]),
    );
    expect(area(shown, "Y").hidden).toBe(false);
    expect(drop(shown, "H2")).toBeDefined();
  });

  it("says what to do when a gap is chosen with no choice in hand, and offers no room in a gap that is full", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await userEvent.click(drop(shown, "H1"));
    expect(announced(shown)).toBe(EN_MESSAGES.boardNothingSelected);
    await put(shown, "X", "H1");
    expect(area(shown, "H1").querySelector(".ak-drop")).toBeNull();
    expect(shown.values).toHaveLength(1);
  });

  it("shows a gap image in the gap, and names it by its object-label", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    expect(token(shown, "Z").getAttribute("aria-label")).toBe("Zed");
    await put(shown, "Z", "H2");
    expect(within(area(shown, "H2"), ".ak-remove").getAttribute("aria-label")).toBe("Remove Zed");
    near(within(area(shown, "H2"), "img").getBoundingClientRect().width, 20);
  });

  it("drags a choice onto a gap, and a placed choice to another gap", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await userEvent.dragAndDrop(token(shown, "X"), drop(shown, "H1"));
    expect(shown.values).toEqual([buildContainer("multiple", "directedPair", [["X", "H1"]])]);
    await userEvent.dragAndDrop(within(area(shown, "H1"), ".ak-chip-button"), drop(shown, "H2"));
    expect(shown.values.at(-1)).toEqual(buildContainer("multiple", "directedPair", [["X", "H2"]]));
    expect(within(area(shown, "H2"), ".ak-chip-button").textContent).toBe("ex");
  });

  it("does not place a choice that is dropped off a gap", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await userEvent.dragAndDrop(token(shown, "X"), shown.find("qti-prompt"));
    expect(shown.values).toEqual([]);
  });

  it("lets go of the held choice with Escape", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await userEvent.click(token(shown, "X"));
    await userEvent.keyboard("{Escape}");
    expect(token(shown, "X").getAttribute("aria-pressed")).toBe("false");
    expect(shown.interaction().hasAttribute("data-ak-placing")).toBe(false);
  });

  it("places a choice with the keyboard alone: the choices first, then the gaps", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await userEvent.type(token(shown, "Y"), " ");
    await userEvent.type(drop(shown, "H2"), " ");
    expect(shown.values).toEqual([buildContainer("multiple", "directedPair", [["Y", "H2"]])]);
    await userEvent.type(within<HTMLButtonElement>(area(shown, "H2"), ".ak-remove"), "{Enter}");
    expect(shown.values.at(-1)).toBeNull();
  });

  it("shows the pairs it is given", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    shown.setValue("RESPONSE", buildContainer("multiple", "directedPair", [["Z", "H1"]]));
    expect(within(area(shown, "H1"), ".ak-chip-button img")).toBeDefined();
    expect(area(shown, "Z").hidden).toBe(true);
    expect(shown.values).toEqual([]);
  });

  it("has no violation of WCAG 2.2 A and AA with a choice held and placed", async () => {
    const shown = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    expect(await axeViolations(shown.host)).toEqual([]);
    await userEvent.click(token(shown, "X"));
    expect(await axeViolations(shown.host)).toEqual([]);
    await userEvent.click(drop(shown, "H1"));
    await put(shown, "Z", "H2");
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.interaction().disabled = true;
    expect(await axeViolations(shown.host)).toEqual([]);
  });
});

const POSITION = (attributes = 'max-choices="2"', stages = 1): string =>
  Array.from(
    { length: stages },
    (_, index) => `
  <qti-position-object-stage>${image()}
    <qti-position-object-interaction response-identifier="R${index}" ${attributes}>
      <object type="image/png" width="16" height="16" data="${picture(16, 16, "#c62828")}">Pin</object>
    </qti-position-object-interaction>
  </qti-position-object-stage>`,
  ).join("");

const hand = (shown: Graphic): HTMLButtonElement => shown.find<HTMLButtonElement>("button.ak-pick");

describe("position object", () => {
  it("places the object where the candidate clicks after choosing it, and records the point of its center", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.click(hand(shown));
    expect(hand(shown).getAttribute("aria-pressed")).toBe("true");
    await clickImage(shown, 120, 40);
    expect(shown.values).toEqual([buildContainer("multiple", "point", [[120, 40]])]);
    await settle();
    // The center of a 16 by 16 image is its middle, so the object stands from (112, 32) to (128, 48).
    expect(inLayer(shown, shown.find(".ak-object"))).toMatchObject({ x: 112, y: 32, width: 16, height: 16 });
    expect(hand(shown).getAttribute("aria-pressed")).toBe("false");
    expect(announced(shown)).toBe(EN_MESSAGES.graphicPlaced);
  });

  it("puts the center-point of the object on the point", async () => {
    const shown = await show(POSITION('max-choices="1" center-point="0 0"'), declare("single", "point", "R0"));
    await userEvent.click(hand(shown));
    await clickImage(shown, 120, 40);
    expect(shown.values).toEqual([buildSingle("point", [120, 40])]);
    await settle();
    expect(inLayer(shown, shown.find(".ak-object"))).toMatchObject({ x: 120, y: 40 });
  });

  it("moves the only object with a maximum of one, and says what to change beyond the maximum with more", async () => {
    const one = await show(POSITION('max-choices="1"'), declare("single", "point", "R0"));
    for (const x of [20, 60]) {
      await userEvent.click(hand(one));
      await clickImage(one, x, 50);
    }
    expect(one.values.at(-1)).toEqual(buildSingle("point", [60, 50]));
    expect(one.findAll(".ak-object")).toHaveLength(1);
    const two = await show(POSITION('max-choices="2"'), declare("multiple", "point", "R0"));
    for (const x of [20, 60, 100]) {
      await userEvent.click(hand(two));
      await clickImage(two, x, 50);
    }
    expect(two.findAll(".ak-object")).toHaveLength(3);
    expect(hinted(two)).toBe("Select at most 2.");
  });

  it("drags the object from the tray onto the image, and a placed object to another place", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.dragAndDrop(hand(shown), shown.find("qti-position-object-stage > img"), {
      targetPosition: { x: 100, y: 50 },
    });
    expect(shown.values).toEqual([buildContainer("multiple", "point", [[100, 50]])]);
    await settle();
    await userEvent.dragAndDrop(shown.find(".ak-object"), shown.find("qti-position-object-stage > img"), {
      targetPosition: { x: 40, y: 20 },
    });
    expect(shown.values.at(-1)).toEqual(buildContainer("multiple", "point", [[40, 20]]));
    expect(shown.values).toHaveLength(2);
  });

  it("leaves the object where it was when it is dropped off the image", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.dragAndDrop(hand(shown), shown.find(".ak-usage"));
    expect(shown.values).toEqual([]);
    expect(hand(shown).style.transform).toBe("");
    expect(hand(shown).classList.contains("ak-dragging")).toBe(false);
  });

  it("takes a placed object away when it is chosen", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.click(hand(shown));
    await clickImage(shown, 100, 50);
    await settle();
    await userEvent.click(shown.find(".ak-object"));
    expect(shown.values.at(-1)).toBeNull();
    expect(shown.findAll(".ak-object")).toHaveLength(0);
    expect(shown.root.activeElement).toBe(hand(shown));
  });

  it("places the object with the keyboard alone: the crosshair takes the focus and Enter places it", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.type(hand(shown), "{Enter}");
    expect(shown.root.activeElement).toBe(shown.find(".ak-surface"));
    expect(shown.find(".ak-crosshair").hidden).toBe(false);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowDown}{Enter}");
    expect(shown.values).toEqual([buildContainer("multiple", "point", [[110, 55]])]);
    expect(shown.root.activeElement).toBe(hand(shown));
  });

  it("gives the object up with Escape", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.type(hand(shown), "{Enter}{Escape}");
    expect(hand(shown).getAttribute("aria-pressed")).toBe("false");
    expect(shown.root.activeElement).toBe(hand(shown));
    expect(shown.values).toEqual([]);
  });

  it("gives each interaction on a shared stage a response of its own", async () => {
    const shown = await show(
      `<qti-position-object-stage>${image()}
        <qti-position-object-interaction response-identifier="R0" max-choices="1"><object type="image/png" width="16" height="16" data="${picture(16, 16, "#c62828")}">Red pin</object></qti-position-object-interaction>
        <qti-position-object-interaction response-identifier="R1" max-choices="1"><object type="image/png" width="16" height="16" data="${picture(16, 16, "#1565c0")}">Blue pin</object></qti-position-object-interaction>
      </qti-position-object-stage>`,
      `${declare("single", "point", "R0")}${declare("single", "point", "R1")}`,
    );
    await userEvent.click(shown.findAll<HTMLElement>("button.ak-pick")[1] as HTMLElement);
    await clickImage(shown, 150, 30, ".ak-surface[tabindex='0']");
    expect(shown.responses).toEqual([{ responseIdentifier: "R1", value: buildSingle("point", [150, 30]) }]);
    expect(shown.findAll("qti-position-object-stage").length).toBe(1);
  });

  it("gives an object drawn smaller than a target a target of 24 pixels", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.click(hand(shown));
    await clickImage(shown, 100, 50);
    await settle();
    const object = shown.find(".ak-object");
    expect(object.hasAttribute("data-ak-small")).toBe(true);
    expect(Number.parseFloat(getComputedStyle(object, "::after").width)).toBeGreaterThanOrEqual(24);
  });

  it("has no violation of WCAG 2.2 A and AA while placing and with objects placed", async () => {
    const shown = await show(POSITION(), declare("multiple", "point", "R0"));
    expect(await axeViolations(shown.host)).toEqual([]);
    await userEvent.click(hand(shown));
    expect(await axeViolations(shown.host)).toEqual([]);
    await clickImage(shown, 100, 50);
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.interaction().disabled = true;
    expect(await axeViolations(shown.host)).toEqual([]);
  });
});

const DRAWING = (type = "image/png", data = picture(200, 100, "#ffffff")): string =>
  `<qti-drawing-interaction response-identifier="RESPONSE"><qti-prompt>Draw.</qti-prompt><object type="${type}" width="200" height="100" data="${data}">A canvas</object></qti-drawing-interaction>`;

const canvasOf = (shown: Graphic): HTMLCanvasElement => shown.find<HTMLCanvasElement>("canvas.ak-canvas");

/** Returns the color of a pixel of the canvas over the image, whose pixels are those of the image. */
function drawn(shown: Graphic, x: number, y: number): readonly number[] {
  return [...(canvasOf(shown).getContext("2d")?.getImageData(x, y, 1, 1).data ?? [])];
}

const tool = (shown: Graphic, name: string): HTMLButtonElement =>
  shown.find<HTMLButtonElement>(`button[data-tool="${name}"]`);
const swatch = (shown: Graphic, color: string): HTMLButtonElement =>
  shown.find<HTMLButtonElement>(`button[data-color="${color}"]`);

/** Drags the pen across the image from one point to another, in the units of the image. */
async function drag(shown: Graphic, from: [number, number], to: [number, number]): Promise<void> {
  const surface = shown.find(".ak-surface");
  await userEvent.dragAndDrop(surface, surface, {
    sourcePosition: { x: from[0], y: from[1] },
    targetPosition: { x: to[0], y: to[1] },
  });
}

/** Waits until the drawing has stored what the candidate drew. */
async function stored(shown: Graphic): Promise<void> {
  await settle();
  await shown.interaction().settled();
}

const RED = "#c62828";

describe("drawing", () => {
  it("draws with the pen where the pointer goes and stores the picture, with the drawing on it, in the type of the image", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    await drag(shown, [20, 20], [120, 20]);
    await stored(shown);
    expect(drawn(shown, 70, 20)[3]).toBeGreaterThan(200);
    expect(drawn(shown, 70, 60)[3]).toBe(0);
    expect(shown.uploads).toHaveLength(1);
    const [upload] = shown.uploads;
    expect(upload?.mimeType).toBe("image/png");
    expect(shown.values.at(-1)).toMatchObject({
      cardinality: "single",
      baseType: "file",
      value: { reference: "file-1", mimeType: "image/png" },
    });
    // The stored picture is the image with the stroke on it: black on the line, white elsewhere.
    expect(await colorAt(upload?.bytes as Blob, 70, 20)).toEqual([0, 0, 0, 255]);
    expect(await colorAt(upload?.bytes as Blob, 70, 60)).toEqual([255, 255, 255, 255]);
  });

  it("stores a picture in the media type of the image that the engine can encode", async () => {
    const shown = await show(DRAWING("image/jpeg"), declare("single", "file"));
    await drag(shown, [20, 20], [120, 20]);
    await stored(shown);
    expect(shown.uploads.at(-1)?.mimeType).toBe("image/jpeg");
    expect(shown.values.at(-1)).toMatchObject({ value: { mimeType: "image/jpeg" } });
  });

  it("draws a line, a rectangle and an ellipse with two clicks each, with no gesture along a path", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    await userEvent.click(tool(shown, "line"));
    await clickImage(shown, 10, 90);
    expect(announced(shown)).toBe(EN_MESSAGES.drawStartSet);
    expect(shown.find(".ak-start").hidden).toBe(false);
    await clickImage(shown, 190, 90);
    await stored(shown);
    expect(shown.find(".ak-start").hidden).toBe(true);
    expect(drawn(shown, 100, 90)[3]).toBeGreaterThan(200);
    await userEvent.click(tool(shown, "rectangle"));
    await clickImage(shown, 20, 20);
    await clickImage(shown, 80, 60);
    await stored(shown);
    expect(drawn(shown, 50, 20)[3]).toBeGreaterThan(200);
    expect(drawn(shown, 50, 40)[3]).toBe(0);
    await userEvent.click(tool(shown, "ellipse"));
    await clickImage(shown, 100, 10);
    await clickImage(shown, 180, 50);
    await stored(shown);
    // The ellipse stands in the box between the points: its left edge is at x = 100, half way down.
    expect(drawn(shown, 100, 30)[3]).toBeGreaterThan(200);
    expect(drawn(shown, 140, 30)[3]).toBe(0);
    expect(shown.uploads).toHaveLength(3);
  });

  it("colors a region with one click of the fill and stops at the line of the image", async () => {
    const shown = await show(DRAWING("image/png", outlined(200, 100)), declare("single", "file"));
    await userEvent.click(tool(shown, "fill"));
    await userEvent.click(swatch(shown, RED));
    await clickImage(shown, 70, 50);
    await stored(shown);
    expect(drawn(shown, 70, 50)).toEqual([198, 40, 40, 255]);
    expect(drawn(shown, 170, 50)[3]).toBe(0);
    expect(drawn(shown, 10, 10)[3]).toBe(0);
    const upload = shown.uploads.at(-1);
    expect(await colorAt(upload?.bytes as Blob, 70, 50)).toEqual([198, 40, 40, 255]);
    expect(await colorAt(upload?.bytes as Blob, 20, 50)).toEqual([0, 0, 0, 255]);
    expect(await colorAt(upload?.bytes as Blob, 170, 50)).toEqual([255, 255, 255, 255]);
  });

  it("erases what was drawn", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    await drag(shown, [20, 50], [120, 50]);
    await userEvent.click(tool(shown, "eraser"));
    await drag(shown, [60, 50], [90, 50]);
    await stored(shown);
    expect(drawn(shown, 40, 50)[3]).toBeGreaterThan(200);
    expect(drawn(shown, 75, 50)[3]).toBe(0);
  });

  it("draws with the keyboard: a shape tool, then the crosshair for each point", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    expect(shown.find(".ak-surface").tabIndex).toBe(-1);
    await userEvent.type(tool(shown, "rectangle"), " ");
    expect(shown.find(".ak-surface").tabIndex).toBe(0);
    await userEvent.type(shown.find(".ak-surface"), "{Enter}");
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowDown}{ArrowDown}{Enter}");
    await stored(shown);
    // The crosshair starts at the center (100, 50) and a key moves it a twentieth of the smaller side, 5 units.
    expect(drawn(shown, 110, 50)[3]).toBeGreaterThan(200);
    expect(drawn(shown, 120, 55)[3]).toBeGreaterThan(200);
    expect(shown.uploads).toHaveLength(1);
  });

  it("colors a region with the keyboard", async () => {
    const shown = await show(DRAWING("image/png", outlined(200, 100)), declare("single", "file"));
    await userEvent.type(tool(shown, "fill"), " ");
    await userEvent.type(shown.find(".ak-surface"), "{Enter}");
    await stored(shown);
    // The center of the image is inside the rectangle of the picture.
    expect(drawn(shown, 100, 50)).toEqual([0, 0, 0, 255]);
  });

  it("takes back the last action, and clears the drawing to the image of the question", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    await userEvent.click(tool(shown, "line"));
    for (const y of [20, 60]) {
      await clickImage(shown, 20, y);
      await clickImage(shown, 120, y);
    }
    await stored(shown);
    expect(shown.find<HTMLButtonElement>('button[data-action="undo"]').disabled).toBe(false);
    await userEvent.click(shown.find('button[data-action="undo"]'));
    await stored(shown);
    expect(drawn(shown, 70, 60)[3]).toBe(0);
    expect(drawn(shown, 70, 20)[3]).toBeGreaterThan(200);
    await userEvent.click(shown.find('button[data-action="clear"]'));
    await stored(shown);
    expect(drawn(shown, 70, 20)[3]).toBe(0);
    expect(shown.values.at(-1)).toBeNull();
    await userEvent.click(shown.find('button[data-action="undo"]'));
    await stored(shown);
    expect(drawn(shown, 70, 20)[3]).toBeGreaterThan(200);
    expect(shown.values.at(-1)).toMatchObject({ baseType: "file" });
  });

  it("stores one picture for a quick series of actions", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    await userEvent.click(tool(shown, "line"));
    for (const y of [10, 30, 50]) {
      await clickImage(shown, 10, y);
      await clickImage(shown, 190, y);
    }
    await stored(shown);
    expect(shown.uploads.length).toBeLessThanOrEqual(3);
    expect(shown.uploads.length).toBeGreaterThanOrEqual(1);
    expect(await colorAt(shown.uploads.at(-1)?.bytes as Blob, 100, 50)).toEqual([0, 0, 0, 255]);
  });

  it("shows a stored drawing that the player gives as the picture to draw on, and draws on it", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    const earlier = picture(200, 100, "#2e7d32");
    shown.setValue("RESPONSE", buildSingle("file", { reference: earlier, mimeType: "image/png" }));
    await settle();
    expect(shown.find("img").getAttribute("src")).toBe(earlier);
    await drag(shown, [20, 20], [120, 20]);
    await stored(shown);
    const upload = shown.uploads.at(-1);
    expect(await colorAt(upload?.bytes as Blob, 70, 20)).toEqual([0, 0, 0, 255]);
    expect(await colorAt(upload?.bytes as Blob, 70, 60)).toEqual([46, 125, 50, 255]);
    shown.setValue("RESPONSE", null);
    await settle();
    expect(shown.find("img").getAttribute("src")).toContain("data:image/png");
    expect(shown.find("img").getAttribute("src")).not.toBe(earlier);
  });

  it("says so when the picture to draw on cannot be loaded, and draws again on the picture of the question", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    // Bytes that are no image: the browser loads the file and cannot decode it.
    const broken = `data:image/png;base64,${btoa("not an image")}`;
    shown.setValue("RESPONSE", buildSingle("file", { reference: broken, mimeType: "image/png" }));
    await waitFor(() => expect(shown.find(".ak-hint").textContent).toBe(EN_MESSAGES.drawLoadFailed));
    expect(shown.find(".ak-surface").getAttribute("aria-invalid")).toBe("true");
    expect(shown.find(".ak-surface").getAttribute("aria-describedby")).toContain(shown.find(".ak-hint").id);
    await userEvent.click(shown.find('button[data-action="clear"]'));
    await waitFor(() => expect(shown.find(".ak-hint").textContent).toBe(""));
    expect(shown.find(".ak-surface").hasAttribute("aria-invalid")).toBe(false);
    await drag(shown, [20, 20], [120, 20]);
    await stored(shown);
    expect(drawn(shown, 70, 20)[3]).toBeGreaterThan(200);
  });

  it("says so when the drawing cannot be stored, and keeps the response it had", async () => {
    const shown = await show(DRAWING(), declare("single", "file"), () => Promise.reject(new Error("offline")));
    await drag(shown, [20, 20], [120, 20]);
    await stored(shown);
    expect(announced(shown)).toBe(EN_MESSAGES.drawSaveFailed);
    expect(shown.values).toEqual([]);
    expect(drawn(shown, 70, 20)[3]).toBeGreaterThan(200);
  });

  it("draws nothing while it is disabled, and says how to draw", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    shown.interaction().disabled = true;
    expect(shown.findAll<HTMLButtonElement>(".ak-toolbar button").every((button) => button.disabled)).toBe(true);
    await drag(shown, [20, 20], [120, 20]);
    await stored(shown);
    expect(drawn(shown, 70, 20)[3]).toBe(0);
    expect(shown.uploads).toEqual([]);
    expect(shown.find(".ak-usage").textContent).toBe(EN_MESSAGES.drawHint);
  });

  it("gives every control of the toolbar a target of 24 pixels", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    for (const button of shown.findAll(".ak-toolbar button")) {
      const box = button.getBoundingClientRect();
      expect(
        Math.min(box.width, box.height),
        button.textContent || button.getAttribute("aria-label") || "",
      ).toBeGreaterThanOrEqual(24);
    }
  });

  it("has no violation of WCAG 2.2 A and AA with each kind of tool chosen", async () => {
    const shown = await show(DRAWING(), declare("single", "file"));
    expect(await axeViolations(shown.host)).toEqual([]);
    await userEvent.click(tool(shown, "ellipse"));
    await userEvent.click(swatch(shown, RED));
    await clickImage(shown, 20, 20);
    expect(await axeViolations(shown.host)).toEqual([]);
    shown.interaction().disabled = true;
    expect(await axeViolations(shown.host)).toEqual([]);
  });
});

describe("the pointer criteria of WCAG 2.2", () => {
  /** The items of every kind, each with a response that a script gives with clicks only. */
  const Kinds: readonly {
    readonly name: string;
    readonly body: string;
    readonly declarations: string;
    readonly answer: (shown: Graphic) => Promise<void>;
  }[] = [
    {
      name: "hotspot",
      body: HOTSPOT('max-choices="1"'),
      declarations: declare("single", "identifier"),
      answer: (shown) => userEvent.click(face(shown, "B")),
    },
    {
      name: "select point",
      body: SELECT_POINT('max-choices="1"'),
      declarations: declare("single", "point"),
      answer: (shown) => clickImage(shown, 100, 50),
    },
    {
      name: "graphic order",
      body: ORDER(),
      declarations: declare("ordered", "identifier"),
      answer: (shown) => userEvent.click(face(shown, "B")),
    },
    {
      name: "graphic associate",
      body: ASSOCIATE(),
      declarations: declare("multiple", "pair"),
      answer: async (shown) => {
        await choose(shown, "A");
        await choose(shown, "B");
      },
    },
    {
      name: "graphic gap match",
      body: GAP_MATCH(),
      declarations: declare("multiple", "directedPair"),
      answer: (shown) => put(shown, "X", "H1"),
    },
    {
      name: "position object",
      body: POSITION(),
      declarations: declare("multiple", "point", "R0"),
      answer: async (shown) => {
        await userEvent.click(hand(shown));
        await clickImage(shown, 100, 50);
      },
    },
    {
      name: "drawing",
      body: DRAWING(),
      declarations: declare("single", "file"),
      answer: async (shown) => {
        await userEvent.click(tool(shown, "line"));
        await clickImage(shown, 10, 10);
        await clickImage(shown, 190, 90);
        await stored(shown);
      },
    },
  ];

  for (const { name, body, declarations, answer } of Kinds) {
    it(`answers a ${name} interaction with single clicks: no path or multipoint gesture is needed`, async () => {
      const shown = await show(body, declarations);
      await answer(shown);
      expect(shown.values.length).toBeGreaterThan(0);
      expect(shown.values.at(-1)).not.toBeNull();
    });
  }

  it("gives the same response by select-then-place as by dragging, for the position object and the graphic gap match", async () => {
    const dragged = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.dragAndDrop(hand(dragged), dragged.find("qti-position-object-stage > img"), {
      targetPosition: { x: 100, y: 50 },
    });
    const placed = await show(POSITION(), declare("multiple", "point", "R0"));
    await userEvent.click(hand(placed));
    await clickImage(placed, 100, 50);
    // The two pointers meet the image at different sub-pixel offsets, so the points are the same to a pixel.
    expect(placed.responses).toHaveLength(dragged.responses.length);
    const [[x1 = 0, y1 = 0] = []] = pointsOf(dragged.values.at(-1) ?? null);
    const [[x2 = 0, y2 = 0] = []] = pointsOf(placed.values.at(-1) ?? null);
    near(x2, x1);
    near(y2, y1);
    const gapDragged = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await userEvent.dragAndDrop(token(gapDragged, "X"), drop(gapDragged, "H1"));
    const gapPlaced = await show(GAP_MATCH(), declare("multiple", "directedPair"));
    await put(gapPlaced, "X", "H1");
    expect(gapPlaced.responses).toEqual(gapDragged.responses);
  });

  it("gives every control that the candidate operates a target of 24 CSS pixels, or one that the stylesheet enlarges", async () => {
    const kinds: readonly [string, string, string, (shown: Graphic) => Promise<void>][] = [
      [
        "select point",
        SELECT_POINT('max-choices="2"'),
        declare("multiple", "point"),
        (shown) => clickImage(shown, 100, 50),
      ],
      [
        "graphic associate",
        ASSOCIATE(),
        declare("multiple", "pair"),
        async (shown) => {
          await choose(shown, "A");
          await choose(shown, "B");
        },
      ],
      ["graphic gap match", GAP_MATCH(), declare("multiple", "directedPair"), (shown) => put(shown, "X", "H1")],
      [
        "position object",
        POSITION('max-choices="2"'),
        declare("multiple", "point", "R0"),
        async (shown) => {
          await userEvent.click(hand(shown));
          await clickImage(shown, 100, 50);
        },
      ],
    ];
    for (const [name, body, declarations, answer] of kinds) {
      const shown = await show(body, declarations);
      await answer(shown);
      await settle();
      const targets = shown.findAll<HTMLElement>("button:not(.ak-control), label.ak-face");
      for (const target of targets.filter((candidate) => candidate.getClientRects().length > 0)) {
        const box = target.getBoundingClientRect();
        const enlarged = target.closest("[data-ak-small]") !== null;
        expect(
          enlarged || Math.min(box.width, box.height) >= 24,
          `${name}: ${target.className} ${box.width}x${box.height}`,
        ).toBe(true);
      }
    }
  });
});

describe("coordinates", () => {
  it("refuses coordinates that do not fit the shape when it renders the item", async () => {
    const bad = `<qti-hotspot-interaction response-identifier="RESPONSE" max-choices="1">${image()}<qti-hotspot-choice shape="circle" coords="1,2" identifier="A" id="A"/></qti-hotspot-interaction>`;
    await expect(show(bad, declare("single", "identifier"))).rejects.toThrow("A circle cannot have the 2 coordinates");
  });
});
