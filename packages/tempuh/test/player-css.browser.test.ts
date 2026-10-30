import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { channels, computed, contrast, mount, nth, PLAYER_CSS, stylesheet } from "./css-fixture.js";

/** The style of every rule of `player.css` with its selectors, to check the declared values of the large scales against the specification. */
const rules: { readonly selector: string; readonly style: CSSStyleDeclaration }[] = [];
for (const rule of stylesheet(PLAYER_CSS).cssRules) {
  if (rule instanceof CSSStyleRule) {
    for (const selector of rule.selectorText.split(",")) rules.push({ selector: selector.trim(), style: rule.style });
  }
}

/** Returns the value that the stylesheet declares for a property of a class, or the empty string. */
function declared(className: string, property: string): string {
  const style = rules.find(
    ({ selector, style }) => selector === `.${className}` && style.getPropertyValue(property) !== "",
  );
  return style?.style.getPropertyValue(property) ?? "";
}

/** Returns the percentage that a class declares for a property, as a number. */
function declaredPercent(className: string, property: string): number {
  return Number.parseFloat(declared(className, property));
}

const nextFrame = (): Promise<unknown> => new Promise((done) => requestAnimationFrame(done));

/** Resizes the viewport and waits until the engine applies it to the layout and to the media queries, which WebKit does a few frames later. */
async function resize(width: number, height = 800): Promise<void> {
  await page.viewport(width, height);
  for (let frame = 0; frame < 60 && window.innerWidth !== width; frame++) await nextFrame();
  await nextFrame();
  await nextFrame();
}

beforeEach(async () => {
  await resize(1280);
});

describe("themes", () => {
  const Paragraph = "<p>Text <a href='#x'>link</a></p>";

  it("[T13] shows dark text on white by default", () => {
    const { host, find } = mount(Paragraph);
    expect(channels(computed(find("p"), "color")).slice(0, 3)).toEqual([26, 26, 26]);
    expect(channels(computed(host, "background-color")).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("[T87] inverts the polarity: light text on a dark background", () => {
    const { host, find } = mount(Paragraph, { "data-tempuh-polarity": "inverted" });
    expect(channels(computed(find("p"), "color")).slice(0, 3)).toEqual([242, 242, 242]);
    expect(channels(computed(host, "background-color")).slice(0, 3)).toEqual([18, 18, 18]);
  });

  it("[T87] takes the foreground and the background that the candidate's profile gives", () => {
    const { host, find } = mount(
      Paragraph,
      { "data-tempuh-polarity": "inverted" },
      { "--tempuh-fg": "#ffff00", "--tempuh-bg": "#000080" },
    );
    expect(channels(computed(find("p"), "color")).slice(0, 3)).toEqual([255, 255, 0]);
    expect(channels(computed(host, "background-color")).slice(0, 3)).toEqual([0, 0, 128]);
  });

  it("[T79] shows black on white with thicker borders and rings for high contrast", () => {
    const { host, find } = mount("<input type='text' aria-label='x'>", { "data-tempuh-contrast": "high" });
    expect(channels(computed(host, "color")).slice(0, 3)).toEqual([0, 0, 0]);
    expect(computed(find("input"), "border-top-width")).toBe("2px");
    expect(channels(computed(find("input"), "border-top-color")).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("[T79][T87] shows white on black for high contrast with inverted polarity", () => {
    const { host } = mount(Paragraph, { "data-tempuh-contrast": "high", "data-tempuh-polarity": "inverted" });
    expect(channels(computed(host, "color")).slice(0, 3)).toEqual([255, 255, 255]);
    expect(channels(computed(host, "background-color")).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("[T89] derives the border from the colors of the candidate's profile", () => {
    const plain = mount("<input type='text' aria-label='x'>");
    const colored = mount(
      "<input type='text' aria-label='x'>",
      {},
      { "--tempuh-fg": "#ffffff", "--tempuh-bg": "#000000" },
    );
    expect(channels(computed(plain.find("input"), "border-top-color"))).not.toEqual(
      channels(computed(colored.find("input"), "border-top-color")),
    );
  });
});

describe("the content root", () => {
  it("[T13] contains layout and paint and isolates its stacking, so that item CSS cannot cover the chrome", () => {
    const { host, find } = mount("<div id='cover' style='position: fixed; inset: 0'>x</div>");
    host.style.margin = "50px 0 0 40px";
    expect(computed(host, "contain")).toBe("layout paint");
    expect(computed(host, "isolation")).toBe("isolate");
    const rect = find("#cover").getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(40);
    expect(rect.top).toBeGreaterThanOrEqual(50);
  });

  it("[T88] multiplies the text by the zoom of the candidate's profile", () => {
    const base = mount("<p>x</p>");
    const zoomed = mount("<p>x</p>", {}, { "--tempuh-text-zoom": "2" });
    const both = mount("<p>x</p>", {}, { "--tempuh-text-zoom": "2", "--tempuh-font-scale": "1.5" });
    const size = (element: Element): number => Number.parseFloat(computed(element, "font-size"));
    expect(size(zoomed.find("p"))).toBe(size(base.find("p")) * 2);
    expect(size(both.find("p"))).toBe(size(base.find("p")) * 3);
  });

  it("[T88] applies the zoom once to a root that holds a root", () => {
    const outer = mount("<div id='inner'></div>", {}, { "--tempuh-text-zoom": "2" });
    const inner = outer.find("#inner");
    const nested = inner.attachShadow({ mode: "open" });
    nested.innerHTML = "<p>x</p>";
    nested.adoptedStyleSheets = outer.root.adoptedStyleSheets;
    expect(computed(nth([...nested.querySelectorAll("p")], 0), "font-size")).toBe("32px");
  });

  it("[T89] sets the line height, spacings and face of the candidate's profile", () => {
    const base = mount("<p>x</p>");
    const text = mount(
      "<p>x</p>",
      {},
      {
        "--tempuh-line-height": "2",
        "--tempuh-letter-spacing": "2px",
        "--tempuh-word-spacing": "0.4em",
        "--tempuh-font-family": "Georgia, serif",
      },
    );
    const lineHeight = (element: Element): number => Number.parseFloat(computed(element, "line-height"));
    expect(lineHeight(text.find("p"))).toBe(lineHeight(base.find("p")) * 2);
    expect(computed(text.find("p"), "letter-spacing")).toBe("2px");
    expect(Number.parseFloat(computed(text.find("p"), "word-spacing"))).toBeCloseTo(6.4, 1);
    expect(computed(text.find("p"), "font-family")).toContain("Georgia");
    expect(computed(base.find("p"), "letter-spacing")).toBe("normal");
  });

  it("[T89] adds the line spacing to the base line height, and multiplies by the line height", () => {
    const spaced = mount("<p>x</p>", {}, { "--tempuh-line-spacing": "0.5" });
    expect(Number.parseFloat(computed(spaced.find("p"), "line-height"))).toBe(32);
  });

  it("[T89] gives every size the body size when the candidate wants uniform font sizes", () => {
    const html = "<h1>head</h1><p>text <small>small</small></p>";
    const plain = mount(html);
    const uniform = mount(html, { "data-tempuh-uniform-font": "" });
    expect(computed(plain.find("h1"), "font-size")).not.toBe(computed(plain.find("p"), "font-size"));
    expect(computed(uniform.find("h1"), "font-size")).toBe(computed(uniform.find("p"), "font-size"));
    expect(computed(uniform.find("small"), "font-size")).toBe(computed(uniform.find("p"), "font-size"));
  });

  it("[T89] wraps text that the item does not let wrap, and keeps preformatted lines", () => {
    const html = "<p style='white-space: nowrap'>one two</p><pre>a  b</pre>";
    const plain = mount(html);
    const wrapped = mount(html, { "data-tempuh-wrapping": "" });
    expect(computed(plain.find("p"), "white-space")).toBe("nowrap");
    expect(computed(wrapped.find("p"), "white-space")).toBe("normal");
    expect(computed(wrapped.find("p"), "overflow-wrap")).toBe("anywhere");
    expect(computed(wrapped.find("pre"), "white-space")).toBe("pre-wrap");
  });

  it("[T91] emphasizes the keywords only for a candidate with the support, and not by color alone", () => {
    const html = "<p>Pick <span class='qti-keyword-emphasis'>this</span> word.</p>";
    const plain = mount(html);
    const emphasized = mount(html, { "data-tempuh-keyword-emphasis": "" });
    expect(computed(plain.find("span"), "font-weight")).toBe("400");
    expect(computed(emphasized.find("span"), "font-weight")).toBe("700");
    expect(channels(computed(emphasized.find("span"), "background-color"))[3]).toBeGreaterThan(0);
  });

  it("[T13] styles the document of a PCI frame as it styles a root", async () => {
    const frame = document.createElement("iframe");
    frame.srcdoc = `<!doctype html><html data-tempuh-contrast="high"><head><style>${PLAYER_CSS}</style></head><body><p>x</p></body></html>`;
    document.body.append(frame);
    await new Promise((done) => frame.addEventListener("load", done, { once: true }));
    const view = frame.contentWindow;
    const paragraph = frame.contentDocument?.querySelector("p");
    if (view === null || !paragraph) throw new Error("The frame has no document.");
    const style = view.getComputedStyle(paragraph);
    expect(channels(style.color).slice(0, 3)).toEqual([0, 0, 0]);
    expect(
      channels(view.getComputedStyle(paragraph.ownerDocument.documentElement).backgroundColor).slice(0, 3),
    ).toEqual([255, 255, 255]);
    frame.remove();
  });
});

describe("the shared vocabulary", () => {
  it("[T13] hides an element from the eye and from assistive technology with qti-hidden", () => {
    const { find } = mount("<p class='qti-hidden'>x</p>");
    expect(computed(find("p"), "display")).toBe("none");
  });

  it("[T13] hides an element from the eye only with qti-visually-hidden: one pixel, clipped, still rendered", () => {
    const { find } = mount("<span class='qti-visually-hidden'>25 dollars</span>");
    const rect = find("span").getBoundingClientRect();
    expect(rect.width).toBe(1);
    expect(rect.height).toBe(1);
    expect(computed(find("span"), "overflow")).toBe("hidden");
    expect(computed(find("span"), "display")).not.toBe("none");
    expect(computed(find("span"), "visibility")).toBe("visible");
  });

  it("[T13] underlines and italicizes", () => {
    const { find } = mount("<span class='qti-underline'>a</span><span class='qti-italic'>b</span>");
    expect(computed(find(".qti-underline"), "text-decoration-line")).toBe("underline");
    expect(computed(find(".qti-italic"), "font-style")).toBe("italic");
  });

  it("[T13] draws a border with qti-bordered and a well with qti-well", () => {
    const { find } = mount("<p class='qti-bordered'>a</p><p class='qti-well'>b</p>");
    expect(computed(find(".qti-bordered"), "border-top-width")).toBe("1px");
    expect(computed(find(".qti-bordered"), "padding-top")).toBe("2px");
    expect(computed(find(".qti-well"), "padding-top")).toBe("19px");
    expect(computed(find(".qti-well"), "margin-bottom")).toBe("20px");
    expect(channels(computed(find(".qti-well"), "background-color"))).not.toEqual(
      channels(computed(find(".qti-bordered"), "background-color")),
    );
  });

  it("[T13] aligns horizontally and vertically", () => {
    const { find } = mount(
      "<p class='qti-align-left'>a</p><p class='qti-align-center'>b</p><p class='qti-align-right'>c</p>" +
        ["top", "middle", "baseline", "bottom"].map((name) => `<img class='qti-valign-${name}' alt=''>`).join(""),
    );
    expect(computed(find(".qti-align-left"), "text-align")).toBe("left");
    expect(computed(find(".qti-align-center"), "text-align")).toBe("center");
    expect(computed(find(".qti-align-right"), "text-align")).toBe("right");
    for (const name of ["top", "middle", "baseline", "bottom"]) {
      expect(computed(find(`.qti-valign-${name}`), "vertical-align")).toBe(name);
    }
  });

  it("[T13] sets the display and the flex properties", () => {
    const names = [
      "inline",
      "inline-block",
      "block",
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
      "table",
      "table-cell",
      "table-row",
      "list-item",
    ];
    const { find } = mount(names.map((name) => `<div class='qti-display-${name}'>x</div>`).join(""));
    for (const name of names) expect(computed(find(`.qti-display-${name}`), "display")).toBe(name);
    const flex = mount(
      "<div class='qti-display-flex qti-flex-direction-column'><i class='qti-flex-grow-1'></i><b class='qti-flex-grow-0'></b></div>",
    );
    expect(computed(flex.find(".qti-flex-direction-column"), "flex-direction")).toBe("column");
    expect(computed(flex.find(".qti-flex-grow-1"), "flex-grow")).toBe("1");
    expect(computed(flex.find(".qti-flex-grow-0"), "flex-grow")).toBe("0");
  });

  it("[T13] sets margins and paddings on the scale of the specification, and the start and end of the line", () => {
    const scale = new Map([
      ["0", "0px"],
      ["1", "4px"],
      ["2", "8px"],
      ["3", "16px"],
      ["4", "24px"],
      ["5", "48px"],
    ]);
    const sides = new Map([
      ["t", ["top"]],
      ["b", ["bottom"]],
      ["s", ["left"]],
      ["e", ["right"]],
      ["x", ["left", "right"]],
      ["y", ["top", "bottom"]],
      ["", ["top", "right", "bottom", "left"]],
    ]);
    const classes: string[] = [];
    for (const kind of ["margin", "padding"]) {
      for (const side of sides.keys())
        for (const step of scale.keys()) classes.push(`qti-${kind}${side ? `-${side}` : ""}-${step}`);
    }
    const { findAll } = mount(classes.map((name) => `<div class='${name}'>x</div>`).join(""));
    for (const element of findAll("div")) {
      const [, kind = "", side = "", step = ""] =
        /^qti-(margin|padding)(?:-([a-z]))?-(\d)$/.exec(element.className) ?? [];
      for (const physical of sides.get(side) ?? []) {
        expect(computed(element, `${kind}-${physical}`), element.className).toBe(scale.get(step));
      }
    }
    const auto = mount("<div class='qti-margin-x-auto' style='width: 100px'>x</div>");
    expect(computed(auto.find("div"), "margin-left")).toBe(computed(auto.find("div"), "margin-right"));
    expect(computed(auto.find("div"), "margin-left")).not.toBe("0px");
  });

  it("[T13] sets the heights, widths and text indents of the scales of the specification", () => {
    const steps = [
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60,
      64, 72, 80, 96,
    ];
    const name = (step: number): string => (step === 0 ? "0" : String(step).replace(".5", "p5"));
    for (const property of ["height", "width"]) {
      expect(declared(`qti-${property}-px`, property)).toBe("1px");
      for (const step of steps) {
        expect(declared(`qti-${property}-${name(step)}`, property), `${property} ${step}`).toBe(
          step === 0 ? "0px" : `${step / 4}rem`,
        );
      }
      expect(declared(`qti-${property}-auto`, property)).toBe("auto");
      expect(declaredPercent(`qti-${property}-1-3`, property)).toBeCloseTo(33.333333, 3);
      expect(declaredPercent(`qti-${property}-2-3`, property)).toBeCloseTo(66.666667, 3);
      expect(declaredPercent(`qti-${property}-3-4`, property)).toBe(75);
      expect(declaredPercent(`qti-${property}-5-6`, property)).toBeCloseTo(83.333333, 3);
    }
    expect(declared("qti-height-full", "height")).toBe("100%");
    expect(declared("qti-width-full", "width")).toBe("100%");
    expect(declared("qti-fullwidth", "width")).toBe("100%");
    expect(declaredPercent("qti-width-11-12", "width")).toBeCloseTo(91.666667, 3);
    for (const step of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 12, 16, 20, 24, 28, 32]) {
      expect(declared(`qti-text-indent-${name(step)}`, "text-indent"), `indent ${step}`).toBe(
        step === 0 ? "0px" : `${step / 4}rem`,
      );
    }
    expect(declared("qti-text-indent-px", "text-indent")).toBe("1px");
  });

  it("[T13] never lets a width class overflow the root", () => {
    const { host, find } = mount("<div class='qti-width-96'>x</div><div class='qti-fullwidth'>y</div>");
    host.style.width = "200px";
    expect(find(".qti-width-96").getBoundingClientRect().width).toBeLessThanOrEqual(200);
    expect(computed(find(".qti-width-96"), "width")).not.toBe("384px");
  });

  it("[T13] lays out a row of twelve columns, with spans and offsets", () => {
    const { host, find } = mount(
      "<div class='qti-layout-row'><div class='qti-layout-col3 qti-layout-offset3' id='a'>a</div><div class='qti-layout-col3' id='b'>b</div></div>" +
        "<div class='qti-layout-row'><div class='qti-layout-col8' id='c'>c</div><div class='qti-layout-col4' id='d'>d</div></div>",
    );
    host.style.width = "1000px";
    const row = find(".qti-layout-row").getBoundingClientRect();
    const gutter = 16;
    const column = (row.width - 11 * gutter) / 12;
    const a = find("#a").getBoundingClientRect();
    const b = find("#b").getBoundingClientRect();
    expect(a.left - row.left).toBeCloseTo(3 * (column + gutter), 0);
    expect(a.width).toBeCloseTo(3 * column + 2 * gutter, 0);
    expect(b.left - a.right).toBeCloseTo(gutter, 0);
    expect(find("#c").getBoundingClientRect().width).toBeCloseTo(8 * column + 7 * gutter, 0);
    expect(find("#d").getBoundingClientRect().width).toBeCloseTo(4 * column + 3 * gutter, 0);
  });

  it("[T13] floats, clears and clears a float with the clearfix", () => {
    const { find } = mount(
      "<div class='qti-float-clearfix' id='box'><img class='qti-float-left' id='l' alt='' width='10' height='50'></div>" +
        "<p class='qti-float-clear-both' id='below'>x</p><img class='qti-float-right qti-float-none' id='none' alt=''>",
    );
    expect(computed(find("#l"), "float")).toBe("left");
    expect(computed(find("#below"), "clear")).toBe("both");
    expect(computed(find("#none"), "float")).toBe("none");
    expect(find("#box").getBoundingClientRect().height).toBeGreaterThanOrEqual(50);
    expect(computed(find("#box"), "display")).not.toBe("none");
  });

  it("[T13] sets the list style types of both sections of the specification", () => {
    const common = [
      "none",
      "disc",
      "circle",
      "square",
      "decimal",
      "decimal-leading-zero",
      "lower-alpha",
      "upper-alpha",
      "lower-roman",
      "upper-roman",
      "lower-latin",
      "upper-latin",
      "lower-greek",
    ];
    const { find } = mount(common.map((name) => `<ol class='qti-list-style-type-${name}'><li>x</li></ol>`).join(""));
    for (const name of common)
      expect(computed(find(`.qti-list-style-type-${name}`), "list-style-type"), name).toBe(name);
    for (const name of [
      "kannada",
      "katakana",
      "katakana-iroha",
      "ethiopic-halehame",
      "hangul",
      "urdu",
      "korean-hangul-formal",
    ]) {
      expect(declared(`qti-list-style-type-${name}`, "list-style-type"), name).toBe(name);
    }
  });
});

describe("vertical writing", () => {
  it("[T116] sets the writing mode with both spellings of the horizontal class", () => {
    const { find } = mount(
      "<p class='qti-writing-mode-vertical-rl'>a</p><p class='qti-writing-mode-vertical-lr'>b</p><p class='qti-writing-mode-horizontal-tb'>c</p><p class='qti-writing-mode-vertical-tb'>d</p>",
    );
    expect(computed(find(".qti-writing-mode-vertical-rl"), "writing-mode")).toBe("vertical-rl");
    expect(computed(find(".qti-writing-mode-vertical-lr"), "writing-mode")).toBe("vertical-lr");
    expect(computed(find(".qti-writing-mode-horizontal-tb"), "writing-mode")).toBe("horizontal-tb");
    expect(computed(find(".qti-writing-mode-vertical-tb"), "writing-mode")).toBe("horizontal-tb");
  });

  it("[T116] sets upright text and combined upright digits", () => {
    const { find } = mount(
      "<p class='qti-writing-mode-vertical-rl'><span class='qti-text-orientation-upright'>AB</span><span class='qti-text-combine-upright-all'>5012</span></p>",
    );
    expect(computed(find(".qti-text-orientation-upright"), "text-orientation")).toBe("upright");
    expect(computed(find(".qti-text-combine-upright-all"), "text-combine-upright")).toBe("all");
  });

  it("[T116] lays the blocks of a vertical right-to-left division from right to left", () => {
    const { find } = mount(
      "<div class='qti-writing-mode-vertical-rl qti-height-24'><p id='first'>一</p><p id='second'>二</p></div>",
    );
    expect(find("#first").getBoundingClientRect().left).toBeGreaterThan(find("#second").getBoundingClientRect().left);
  });
});

/** The markup of one choice: its control, and its face with the text. */
const choice = (index: number, type = "radio"): string =>
  `<qti-simple-choice><input class="tempuh-control" type="${type}" name="r" aria-label="Choice ${index}"><div class="tempuh-face">Choice ${index}</div></qti-simple-choice>`;

/** The markup of a choice interaction with a prompt and `count` choices. */
const choiceInteraction = (classes: string, count = 3, type = "radio"): string =>
  `<qti-choice-interaction class="${classes}"><qti-prompt>Prompt</qti-prompt>${Array.from({ length: count }, (_, i) => choice(i + 1, type)).join("")}</qti-choice-interaction>`;

/**
 * Returns the counter style and the suffix of the label that an element generates before its text, or null when it
 * generates none. An engine resolves a counter when it paints, so the computed content still names the counter.
 */
function labelOf(element: Element): { readonly style: string; readonly suffix: string } | null {
  const match = /^counter\(tempuh-label(?:, ([\w-]+))?\) "(.*)"$/.exec(computed(element, "content", "::before"));
  return match ? { style: match[1] ?? "decimal", suffix: match[2] ?? "" } : null;
}

/** Focuses an element after a key press, so that `:focus-visible` matches as it does for a keyboard user. */
async function focusByKeyboard(element: HTMLElement): Promise<void> {
  await userEvent.keyboard("{Shift}");
  element.focus();
}

const rectOf = (element: Element): DOMRect => element.getBoundingClientRect();

describe("choice interaction", () => {
  it("[T26] labels the choices with the counter of a decimal, lower or upper alphabetic or ideographic style", () => {
    const styles = new Map([
      ["qti-labels-decimal", "decimal"],
      ["qti-labels-lower-alpha", "lower-alpha"],
      ["qti-labels-upper-alpha", "upper-alpha"],
      ["qti-labels-cjk-ideographic", "cjk-ideographic"],
    ]);
    for (const [name, style] of styles) {
      const { find, findAll } = mount(choiceInteraction(name));
      expect(
        findAll(".tempuh-face").map((face) => labelOf(face)?.style),
        name,
      ).toEqual([style, style, style]);
      expect(computed(find("qti-choice-interaction"), "counter-reset")).toContain("tempuh-label");
      for (const element of findAll("qti-simple-choice")) {
        expect(computed(element, "counter-increment"), name).toBe("tempuh-label 1");
      }
    }
  });

  it("[T26] shows no label for qti-labels-none and without a labels class", () => {
    for (const classes of ["qti-labels-none", "", "qti-labels-suffix-period"]) {
      expect(labelOf(mount(choiceInteraction(classes)).find(".tempuh-face")), classes).toBeNull();
    }
  });

  it("[T26] follows the label with no suffix, a period or a parenthesis", () => {
    const suffixes = new Map([
      ["qti-labels-suffix-none", ""],
      ["qti-labels-suffix-period", "."],
      ["qti-labels-suffix-parenthesis", ")"],
    ]);
    for (const [name, suffix] of suffixes) {
      const { find } = mount(choiceInteraction(`qti-labels-lower-alpha ${name}`));
      expect(labelOf(find(".tempuh-face")), name).toEqual({ style: "lower-alpha", suffix });
    }
  });

  it("[T26] stacks the choices in one column by default and with qti-orientation-vertical", () => {
    for (const classes of ["", "qti-orientation-vertical", "qti-choices-stacking-1"]) {
      const { findAll } = mount(choiceInteraction(classes));
      const [first, second, third] = findAll("qti-simple-choice").map(rectOf);
      expect(second?.left, classes).toBe(first?.left);
      expect(second?.top, classes).toBeGreaterThanOrEqual(first?.bottom ?? 0);
      expect(third?.top, classes).toBeGreaterThanOrEqual(second?.bottom ?? 0);
    }
  });

  it("[T26] puts the choices in a row with qti-orientation-horizontal, and no more than five in a row", () => {
    const row = mount(choiceInteraction("qti-orientation-horizontal", 3));
    const [first, second, third] = row.findAll("qti-simple-choice").map(rectOf);
    expect(second?.top).toBe(first?.top);
    expect(third?.top).toBe(first?.top);
    expect(second?.left).toBeGreaterThan(first?.right ?? 0);
    const wrapped = mount(choiceInteraction("qti-orientation-horizontal", 7));
    const tops = wrapped.findAll("qti-simple-choice").map((element) => rectOf(element).top);
    expect(tops.filter((top) => top === tops[0])).toHaveLength(5);
    expect(tops[5]).toBeGreaterThan(tops[0] ?? 0);
  });

  it("[T26] reads a horizontal stack across, in a Z", () => {
    const { findAll } = mount(choiceInteraction("qti-choices-stacking-3 qti-orientation-horizontal", 7));
    const rects = findAll("qti-simple-choice").map(rectOf);
    expect(rects[1]?.top).toBe(rects[0]?.top);
    expect(rects[2]?.top).toBe(rects[0]?.top);
    expect(rects[3]?.left).toBe(rects[0]?.left);
    expect(rects[3]?.top).toBeGreaterThan(rects[0]?.bottom ?? 0);
    expect(rects[6]?.left).toBe(rects[0]?.left);
  });

  it("[T26] reads a vertical stack down each column, in a reverse N, with the rows that the player sets", () => {
    const { findAll } = mount(
      choiceInteraction("qti-choices-stacking-3 qti-orientation-vertical", 7),
      {},
      { "--tempuh-rows": "3" },
    );
    const rects = findAll("qti-simple-choice").map(rectOf);
    expect(rects[1]?.left).toBe(rects[0]?.left);
    expect(rects[2]?.left).toBe(rects[0]?.left);
    expect(rects[1]?.top).toBeGreaterThan(rects[0]?.top ?? 0);
    expect(rects[3]?.top).toBe(rects[0]?.top);
    expect(rects[3]?.left).toBeGreaterThan(rects[0]?.left ?? 0);
    expect(rects[6]?.left).toBeGreaterThan(rects[3]?.left ?? 0);
  });

  it("[T26] stacks in two, four and five columns", () => {
    for (const columns of [2, 4, 5]) {
      const { findAll } = mount(choiceInteraction(`qti-choices-stacking-${columns} qti-orientation-horizontal`, 10));
      const lefts = new Set(findAll("qti-simple-choice").map((element) => rectOf(element).left));
      expect(lefts.size, `stacking ${columns}`).toBe(columns);
    }
  });

  it("[T26] hides the controls of the choices visually and keeps them in the tab order", async () => {
    const { root, find, findAll } = mount(choiceInteraction("qti-input-control-hidden", 3, "checkbox"));
    const control = find<HTMLInputElement>(".tempuh-control");
    expect(rectOf(control).width).toBe(1);
    expect(rectOf(control).height).toBe(1);
    expect(computed(control, "display")).not.toBe("none");
    await focusByKeyboard(control);
    expect(root.activeElement).toBe(control);
    expect(computed(nth(findAll(".tempuh-face"), 1), "box-shadow")).not.toBe("none");
  });

  it("[T26][SC 1.4.1] reverses a selected face and thickens its border when the control is hidden", () => {
    const { find, findAll } = mount(choiceInteraction("qti-input-control-hidden", 3, "checkbox"));
    const face = nth(findAll(".tempuh-face"), 1);
    const unselected = { shadow: computed(face, "box-shadow"), background: computed(face, "background-color") };
    find<HTMLInputElement>("qti-simple-choice:nth-of-type(2) .tempuh-control").checked = true;
    const spread = (shadow: string): string =>
      /(\d+)px\s+inset|inset\s+\S+\s+\S+\s+\S+\s+(\d+)px/.exec(shadow)?.[0] ?? shadow;
    expect(computed(face, "box-shadow")).not.toBe(unselected.shadow);
    expect(spread(computed(face, "box-shadow"))).not.toBe(spread(unselected.shadow));
    expect(computed(face, "background-color")).not.toBe(unselected.background);
    expect(contrast(computed(face, "color"), computed(face, "background-color"))).toBeGreaterThanOrEqual(4.5);
  });

  it("[T26] marks a selected choice with a border when the control shows", () => {
    const { find } = mount(choiceInteraction("", 2));
    const face = find(".tempuh-face");
    expect(computed(face, "box-shadow")).toBe("none");
    find<HTMLInputElement>(".tempuh-control").checked = true;
    expect(computed(face, "box-shadow")).not.toBe("none");
  });
});

describe("vertical writing of the interactions", () => {
  it("[T116] flows the choices from right to left with qti-writing-orientation-vertical-rl, and the labels upright", () => {
    const { find, findAll } = mount(
      choiceInteraction("qti-writing-orientation-vertical-rl qti-labels-cjk-ideographic", 3),
    );
    expect(computed(find("qti-choice-interaction"), "writing-mode")).toBe("vertical-rl");
    const [first, second] = findAll("qti-simple-choice").map(rectOf);
    expect(second?.left).toBeLessThan(first?.left ?? 0);
    expect(computed(find(".tempuh-face"), "text-orientation", "::before")).toBe("upright");
    expect(computed(find(".tempuh-face"), "text-combine-upright", "::before")).toBe("all");
  });

  it("[T116] flows the choices from left to right with qti-writing-orientation-vertical-lr", () => {
    const { find, findAll } = mount(choiceInteraction("qti-writing-orientation-vertical-lr", 3));
    expect(computed(find("qti-choice-interaction"), "writing-mode")).toBe("vertical-lr");
    const [first, second] = findAll("qti-simple-choice").map(rectOf);
    expect(second?.left).toBeGreaterThan(first?.left ?? 0);
  });

  it("[T116] stacks the choices of a vertical writing along the lines, as the figure of the specification does", () => {
    const { findAll } = mount(choiceInteraction("qti-writing-orientation-vertical-rl qti-choices-stacking-3", 5));
    const rects = findAll("qti-simple-choice").map(rectOf);
    expect(rects[1]?.left).toBe(rects[0]?.left);
    expect(rects[2]?.left).toBe(rects[0]?.left);
    expect(rects[1]?.top).toBeGreaterThan(rects[0]?.top ?? 0);
    expect(rects[3]?.top).toBe(rects[0]?.top);
    expect(rects[3]?.left).toBeLessThan(rects[0]?.left ?? 0);
  });

  it("[T116] writes the text entry, the inline choice and the extended text vertically, controls included", () => {
    const { findAll } = mount(
      "<p><qti-text-entry-interaction class='qti-writing-orientation-vertical-rl'><input aria-label='a'></qti-text-entry-interaction>" +
        "<qti-inline-choice-interaction class='qti-writing-orientation-vertical-rl'><select aria-label='b'><option>x</option></select></qti-inline-choice-interaction></p>" +
        "<qti-extended-text-interaction class='qti-writing-orientation-vertical-lr'><textarea aria-label='c'></textarea></qti-extended-text-interaction>",
    );
    const interactions = findAll("[class*='qti-writing-orientation']");
    expect(computed(nth(interactions, 0), "writing-mode")).toBe("vertical-rl");
    expect(computed(nth(interactions, 1), "writing-mode")).toBe("vertical-rl");
    expect(computed(nth(interactions, 2), "writing-mode")).toBe("vertical-lr");
    for (const control of findAll("input, select, textarea")) {
      expect(computed(control, "writing-mode"), control.localName).toMatch(/^vertical-/);
    }
  });
});

describe("text entry, inline choice and gap", () => {
  const Widths = [1, 2, 3, 4, 6, 10, 15, 20, 25, 30, 35, 40, 45, 50, 72];

  it("[T32] makes a text entry at least as wide as N characters, and about that wide", () => {
    const { findAll } = mount(
      "<span id='ch' style='display: inline-block; width: 1ch'></span>" +
        Widths.map(
          (width) =>
            `<p><qti-text-entry-interaction class='qti-input-width-${width}'><input aria-label='${width}'></qti-text-entry-interaction></p>`,
        ).join(""),
    );
    const ch = rectOf(nth(findAll("#ch"), 0)).width;
    const widths = findAll("qti-text-entry-interaction").map((element) => rectOf(element).width);
    widths.forEach((width, i) => {
      const count = Widths[i] ?? 0;
      expect(width, `width ${count}`).toBeGreaterThanOrEqual(count * ch);
      expect(width, `width ${count}`).toBeLessThanOrEqual((count + 3) * ch);
    });
    expect(widths).toEqual([...widths].sort((a, b) => a - b));
    const input = nth(findAll("input"), 3);
    expect(rectOf(input).width).toBe(widths[3]);
  });

  it("[T31] makes an inline choice and a gap at least as wide as N characters", () => {
    const { findAll } = mount(
      "<span id='ch' style='display: inline-block; width: 1ch'></span>" +
        "<p><qti-inline-choice-interaction class='qti-input-width-10'><select aria-label='a'><option>x</option></select></qti-inline-choice-interaction></p>" +
        "<p><qti-gap class='qti-input-width-20' data-identifier='G1'></qti-gap></p>",
    );
    const ch = rectOf(nth(findAll("#ch"), 0)).width;
    expect(rectOf(nth(findAll("qti-inline-choice-interaction"), 0)).width).toBeGreaterThanOrEqual(10 * ch);
    expect(rectOf(nth(findAll("qti-gap"), 0)).width).toBeGreaterThanOrEqual(20 * ch);
  });

  it("[T33] makes an extended text 3, 6 or 15 lines tall, and as wide as its interaction", () => {
    const { host, findAll } = mount(
      [3, 6, 15]
        .map(
          (n) =>
            `<qti-extended-text-interaction class='qti-height-lines-${n}'><textarea aria-label='${n}'></textarea></qti-extended-text-interaction>`,
        )
        .join(""),
    );
    const line = Number.parseFloat(computed(host, "line-height"));
    const [three, six, fifteen] = findAll("textarea").map((element) => rectOf(element).height);
    for (const [height, count] of [
      [three, 3],
      [six, 6],
      [fifteen, 15],
    ] as const) {
      expect(height, `${count} lines`).toBeGreaterThanOrEqual(count * line);
      expect(height, `${count} lines`).toBeLessThan((count + 1) * line);
    }
    const interaction = rectOf(nth(findAll("qti-extended-text-interaction"), 0));
    expect(rectOf(nth(findAll("textarea"), 0)).width).toBe(interaction.width);
  });

  it("[T33] follows the line height of the candidate's profile", () => {
    const html =
      "<qti-extended-text-interaction class='qti-height-lines-6'><textarea aria-label='x'></textarea></qti-extended-text-interaction>";
    const base = mount(html);
    const spaced = mount(html, {}, { "--tempuh-line-height": "2" });
    expect(rectOf(spaced.find("textarea")).height).toBeGreaterThan(rectOf(base.find("textarea")).height * 1.5);
  });
});

/** The markup of an interaction that has a container of choices and one of targets. */
const containers = new Map([
  [
    "qti-gap-match-interaction",
    "<qti-prompt>P</qti-prompt><div class='tempuh-choices'><qti-gap-text>one</qti-gap-text><qti-gap-text>two</qti-gap-text></div><div class='tempuh-targets'><p>Text <qti-gap></qti-gap> more</p></div>",
  ],
  [
    "qti-graphic-gap-match-interaction",
    "<qti-prompt>P</qti-prompt><div class='tempuh-choices'><qti-gap-img>one</qti-gap-img><qti-gap-img>two</qti-gap-img></div><div class='tempuh-targets'><div style='height: 120px; width: 200px'>image</div></div>",
  ],
  [
    "qti-order-interaction",
    "<qti-prompt>P</qti-prompt><div class='tempuh-choices'><qti-simple-choice>one</qti-simple-choice><qti-simple-choice>two</qti-simple-choice></div><div class='tempuh-targets'><div class='tempuh-target'></div><div class='tempuh-target'></div></div>",
  ],
  [
    "qti-match-interaction",
    "<qti-prompt>P</qti-prompt><qti-simple-match-set class='tempuh-choices'><qti-simple-associable-choice>one</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set class='tempuh-targets'><qti-simple-associable-choice>two</qti-simple-associable-choice></qti-simple-match-set>",
  ],
]);

describe("the choices and the targets", () => {
  it("[T27][T29][T30][T39] puts the choices above, below, left of or right of the targets", () => {
    for (const [tag, content] of containers) {
      for (const position of ["top", "bottom", "left", "right"]) {
        const { find } = mount(`<${tag} class='qti-choices-${position}'>${content}</${tag}>`);
        const choices = rectOf(find(".tempuh-choices"));
        const targets = rectOf(find(".tempuh-targets"));
        const label = `${tag} ${position}`;
        if (position === "top") expect(choices.bottom, label).toBeLessThanOrEqual(targets.top);
        if (position === "bottom") expect(targets.bottom, label).toBeLessThanOrEqual(choices.top);
        if (position === "left") expect(choices.right, label).toBeLessThanOrEqual(targets.left);
        if (position === "right") expect(targets.right, label).toBeLessThanOrEqual(choices.left);
        if (position === "left" || position === "right") expect(choices.top, label).toBe(targets.top);
      }
    }
  });

  it("[T27][T29][T30][T39] puts the choices above the targets without a class, and keeps the choices first in the markup", () => {
    for (const [tag, content] of containers) {
      const { find } = mount(`<${tag}>${content}</${tag}>`);
      expect(rectOf(find(".tempuh-choices")).bottom, tag).toBeLessThanOrEqual(rectOf(find(".tempuh-targets")).top);
      for (const position of ["bottom", "right"]) {
        const placed = mount(`<${tag} class='qti-choices-${position}'>${content}</${tag}>`);
        const order = placed.find(".tempuh-choices").compareDocumentPosition(placed.find(".tempuh-targets"));
        expect(order & Node.DOCUMENT_POSITION_FOLLOWING, `${tag} ${position}`).toBeTruthy();
      }
    }
  });

  it("[T30][T39] sets the width of the choices container from the player's property", () => {
    for (const tag of ["qti-gap-match-interaction", "qti-graphic-gap-match-interaction"]) {
      for (const position of ["left", "right", "top"]) {
        const { find } = mount(
          `<${tag} class='qti-choices-${position}'>${containers.get(tag)}</${tag}>`,
          {},
          { "--tempuh-choices-width": "188px" },
        );
        expect(rectOf(find(".tempuh-choices")).width, `${tag} ${position}`).toBe(188);
      }
    }
  });

  it("[T27][T30] keeps the prompt above both containers", () => {
    for (const position of ["left", "right", "bottom"]) {
      const { find } = mount(
        `<qti-order-interaction class='qti-choices-${position}'>${containers.get("qti-order-interaction")}</qti-order-interaction>`,
      );
      const prompt = rectOf(find("qti-prompt"));
      expect(prompt.bottom, position).toBeLessThanOrEqual(rectOf(find(".tempuh-choices")).top);
      expect(prompt.bottom, position).toBeLessThanOrEqual(rectOf(find(".tempuh-targets")).top);
    }
  });

  it("[T27] runs the choices and the targets of an order down or across with its orientation", () => {
    const content = containers.get("qti-order-interaction");
    const vertical = mount(
      `<qti-order-interaction class='qti-orientation-vertical'>${content}</qti-order-interaction>`,
    );
    const [first, second] = vertical.findAll(".tempuh-target").map(rectOf);
    expect(second?.left).toBe(first?.left);
    expect(second?.top).toBeGreaterThan(first?.top ?? 0);
    const horizontal = mount(
      `<qti-order-interaction class='qti-orientation-horizontal'>${content}</qti-order-interaction>`,
    );
    const [left, right] = horizontal.findAll(".tempuh-target").map(rectOf);
    expect(right?.top).toBe(left?.top);
    expect(right?.left).toBeGreaterThan(left?.left ?? 0);
  });
});

describe("order target labels", () => {
  const order = (classes: string): string =>
    `<qti-order-interaction class='${classes}'>${containers.get("qti-order-interaction")}</qti-order-interaction>`;

  it("[T117] numbers the targets with the counter of a decimal, lower or upper alphabetic style", () => {
    const styles = new Map([
      ["qti-labels-decimal", "decimal"],
      ["qti-labels-lower-alpha", "lower-alpha"],
      ["qti-labels-upper-alpha", "upper-alpha"],
    ]);
    for (const [name, style] of styles) {
      const { find, findAll } = mount(order(`qti-choices-top ${name}`));
      expect(
        findAll(".tempuh-target").map((target) => labelOf(target)?.style),
        name,
      ).toEqual([style, style]);
      expect(computed(find(".tempuh-targets"), "counter-reset")).toContain("tempuh-label");
      for (const target of findAll(".tempuh-target"))
        expect(computed(target, "counter-increment")).toBe("tempuh-label 1");
    }
  });

  it("[T117] follows the label of a target with no suffix, a period or a parenthesis", () => {
    const suffixes = new Map([
      ["qti-labels-suffix-none", ""],
      ["qti-labels-suffix-period", "."],
      ["qti-labels-suffix-parenthesis", ")"],
    ]);
    for (const [name, suffix] of suffixes) {
      const { find } = mount(order(`qti-choices-left qti-labels-decimal ${name}`));
      expect(labelOf(find(".tempuh-target")), name).toEqual({ style: "decimal", suffix });
    }
  });

  it("[T117] shows no label on the targets by default, and none on the choices", () => {
    for (const classes of ["qti-choices-top", "qti-choices-top qti-labels-none"]) {
      expect(labelOf(mount(order(classes)).find(".tempuh-target")), classes).toBeNull();
    }
    expect(labelOf(mount(order("qti-labels-decimal")).find("qti-simple-choice"))).toBeNull();
  });
});

describe("tabular match", () => {
  const Table =
    "<qti-prompt>P</qti-prompt><table><thead><tr><th>Characters</th><th>Play</th></tr></thead><tbody><tr><th>Capulet</th><td>x</td></tr></tbody></table>";

  it("[T29] draws the table with borders and shows its header row", () => {
    const { find } = mount(`<qti-match-interaction class='qti-match-tabular'>${Table}</qti-match-interaction>`);
    expect(computed(find("td"), "border-top-width")).toBe("1px");
    expect(rectOf(find("thead")).height).toBeGreaterThan(1);
  });

  it("[T29] hides the header row from the eye and keeps it for a screen reader with qti-header-hidden", () => {
    const { find } = mount(
      `<qti-match-interaction class='qti-match-tabular qti-header-hidden'>${Table}</qti-match-interaction>`,
    );
    expect(rectOf(find("thead")).height).toBeLessThanOrEqual(1);
    expect(computed(find("thead"), "display")).not.toBe("none");
    expect(find("thead").textContent).toContain("Play");
  });
});

/** A hotspot interaction with two hotspots over a stage. */
const hotspots = (classes: string, tag = "qti-hotspot-interaction", choiceTag = "qti-hotspot-choice"): string =>
  `<${tag} class='${classes}'><div style='position: relative; width: 300px; height: 200px'>` +
  ["A", "B"]
    .map(
      (name, i) =>
        `<${choiceTag} style='position: absolute; left: ${20 + i * 100}px; top: 20px; width: 40px; height: 40px'><input class='tempuh-control' type='checkbox' aria-label='${name}'><span class='tempuh-face'></span></${choiceTag}>`,
    )
    .join("") +
  `</div></${tag}>`;

/** A hot text interaction with two hot texts. */
const hottext = (classes: string): string =>
  `<qti-hottext-interaction class='${classes}'><p>Sponsors <qti-hottext><input class='tempuh-control' type='radio' name='h' aria-label='one'><span class='tempuh-face'>who</span></qti-hottext> bought <qti-hottext><input class='tempuh-control' type='radio' name='h' aria-label='two'><span class='tempuh-face'>includes</span></qti-hottext> time.</p></qti-hottext-interaction>`;

describe("selections on graphics and in text", () => {
  it("[T35] draws the selections white for a dark image and black for a light one", () => {
    const light = mount(hotspots("qti-selections-light"));
    const dark = mount(hotspots("qti-selections-dark"));
    expect(channels(computed(light.find(".tempuh-face"), "border-top-color")).slice(0, 3)).toEqual([255, 255, 255]);
    expect(channels(computed(dark.find(".tempuh-face"), "border-top-color")).slice(0, 3)).toEqual([0, 0, 0]);
  });

  it("[T35] draws a hotspot with a line and a halo of the theme without a class", () => {
    const { find } = mount(hotspots(""));
    const face = find(".tempuh-face");
    expect(computed(face, "border-top-width")).toBe("2px");
    expect(channels(computed(face, "border-top-color"))[3]).toBe(255);
    expect(channels(computed(face, "outline-color"))[3]).toBe(255);
  });

  it("[T35][SC 1.4.1] fills a selected hotspot and thickens its line", () => {
    const { find } = mount(hotspots(""));
    const face = find(".tempuh-face");
    expect(channels(computed(face, "background-color"))[3]).toBe(0);
    find<HTMLInputElement>(".tempuh-control").checked = true;
    expect(computed(face, "border-top-width")).toBe("4px");
    expect(channels(computed(face, "background-color"))[3]).toBeGreaterThan(0);
  });

  it("[T35] hides the unselected hotspots until they have focus or are selected, with qti-unselected-hidden", async () => {
    const { find, findAll } = mount(hotspots("qti-unselected-hidden"));
    const first = nth(findAll(".tempuh-face"), 0);
    const second = nth(findAll(".tempuh-face"), 1);
    expect(channels(computed(first, "border-top-color"))[3]).toBe(0);
    expect(channels(computed(first, "outline-color"))[3]).toBe(0);
    find<HTMLInputElement>(".tempuh-control").checked = true;
    expect(channels(computed(first, "border-top-color"))[3]).toBe(255);
    await focusByKeyboard(nth(findAll<HTMLInputElement>(".tempuh-control"), 1));
    expect(channels(computed(second, "border-top-color"))[3]).toBe(255);
    expect(computed(second, "outline-style")).toBe("solid");
  });

  it("[T39] shows the associable hotspots of a graphic gap match only while the candidate places a choice", () => {
    const { find } = mount(
      hotspots("qti-unselected-hidden", "qti-graphic-gap-match-interaction", "qti-associable-hotspot"),
    );
    const face = find(".tempuh-face");
    expect(channels(computed(face, "border-top-color"))[3]).toBe(0);
    find("qti-graphic-gap-match-interaction").setAttribute("data-tempuh-placing", "");
    expect(channels(computed(face, "border-top-color"))[3]).toBe(255);
  });

  it("[T118] shows no mark on the unselected hot texts with qti-unselected-hidden", () => {
    const { findAll } = mount(hottext("qti-unselected-hidden"));
    for (const face of findAll(".tempuh-face")) {
      expect(channels(computed(face, "background-color"))[3]).toBe(0);
      expect(computed(face, "box-shadow")).toBe("none");
      expect(computed(face, "outline-style")).toBe("none");
    }
    expect(rectOf(nth(findAll(".tempuh-control"), 0)).width).toBe(1);
  });

  it("[T118] shows a line around the hot text that has focus", async () => {
    const { findAll } = mount(hottext("qti-unselected-hidden"));
    await focusByKeyboard(nth(findAll<HTMLInputElement>(".tempuh-control"), 0));
    expect(computed(nth(findAll(".tempuh-face"), 0), "outline-style")).toBe("solid");
    expect(computed(nth(findAll(".tempuh-face"), 1), "outline-style")).toBe("none");
  });

  it("[T118][SC 1.4.1] reverses the selected hot text and boxes it", () => {
    const { find, findAll } = mount(hottext("qti-unselected-hidden"));
    nth(findAll<HTMLInputElement>(".tempuh-control"), 1).checked = true;
    const face = nth(findAll(".tempuh-face"), 1);
    expect(contrast(computed(face, "color"), computed(face, "background-color"))).toBeGreaterThanOrEqual(4.5);
    expect(computed(face, "box-shadow")).not.toBe("none");
    expect(computed(find(".tempuh-face"), "box-shadow")).toBe("none");
  });

  it("[T118] shows both the focus and the selection of a hot text", async () => {
    const { findAll } = mount(hottext("qti-unselected-hidden"));
    const second = nth(findAll<HTMLInputElement>(".tempuh-control"), 1);
    second.checked = true;
    await focusByKeyboard(second);
    const face = nth(findAll(".tempuh-face"), 1);
    expect(computed(face, "outline-style")).toBe("solid");
    expect(channels(computed(face, "background-color"))[3]).toBe(255);
  });

  it("[T34] shows the controls of the hot texts by default, and hides them with qti-input-control-hidden", () => {
    const shown = mount(hottext(""));
    expect(rectOf(shown.find(".tempuh-control")).width).toBeGreaterThanOrEqual(24);
    const hidden = mount(hottext("qti-input-control-hidden"));
    expect(rectOf(hidden.find(".tempuh-control")).width).toBe(1);
    expect(computed(hidden.find(".tempuh-face"), "box-shadow")).not.toBe("none");
  });
});

/** An image of the size that an item would give a graphic, as a data URI. */
const SAMPLE_IMAGE = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='600' height='100'><rect width='600' height='100' fill='#ccc'/></svg>")}`;

/** Markup that uses the vocabulary the way an item does: a layout, interactions of every shape, and a wide class. */
const REPRESENTATIVE = `
  <h1>Title</h1>
  <div class='qti-layout-row'>
    <div class='qti-layout-col6' id='stimulus'>
      <p>Stimulus with a <a href='#x'>link</a> and a <span class='qti-keyword-emphasis'>keyword</span>.</p>
      <img alt='Sample' width='600' height='100' src="${SAMPLE_IMAGE}">
    </div>
    <div class='qti-layout-col6'>
      <qti-choice-interaction class='qti-choices-stacking-3 qti-orientation-horizontal qti-labels-upper-alpha qti-labels-suffix-period'>
        <qti-prompt>Choose</qti-prompt>
        ${[1, 2, 3, 4, 5, 6].map((index) => choice(index)).join("")}
      </qti-choice-interaction>
      <qti-choice-interaction class='qti-input-control-hidden qti-labels-decimal'>
        ${[1, 2].map((index) => choice(index, "checkbox")).join("")}
      </qti-choice-interaction>
    </div>
  </div>
  <p>Fill <qti-text-entry-interaction class='qti-input-width-72'><input aria-label='Answer'></qti-text-entry-interaction> in.</p>
  <qti-extended-text-interaction class='qti-height-lines-6'><textarea aria-label='Essay'></textarea></qti-extended-text-interaction>
  <qti-gap-match-interaction class='qti-choices-left'>
    <qti-prompt>Fill the gap</qti-prompt>
    <div class='tempuh-choices'><qti-gap-text>one</qti-gap-text><qti-gap-text>two</qti-gap-text></div>
    <div class='tempuh-targets'><p>Text <qti-gap></qti-gap> more text.</p></div>
  </qti-gap-match-interaction>
  <qti-match-interaction class='qti-match-tabular'>
    <qti-prompt>Match</qti-prompt>
    <table><thead><tr><th>Characters</th><th>Play one</th><th>Play two</th></tr></thead>
    <tbody><tr><th>Capulet</th><td>x</td><td>y</td></tr></tbody></table>
  </qti-match-interaction>
  <qti-hottext-interaction class='qti-unselected-hidden'>
    <p>Sponsors <qti-hottext><input class='tempuh-control' type='radio' name='h' aria-label='who'><span class='tempuh-face'>who</span></qti-hottext> bought time.</p>
  </qti-hottext-interaction>
  <div class='qti-width-96 qti-bordered'>A wide class</div>
  <p><input type='text' aria-label='Plain' aria-invalid='true'> <button type='button'>Button</button></p>`;

/** The four themes: default, inverted, high contrast, and both. */
const THEMES = new Map<string, Readonly<Record<string, string>>>([
  ["default", {}],
  ["inverted", { "data-tempuh-polarity": "inverted" }],
  ["high contrast", { "data-tempuh-contrast": "high" }],
  ["high contrast inverted", { "data-tempuh-contrast": "high", "data-tempuh-polarity": "inverted" }],
]);

/** Runs axe on a content root, at WCAG 2.2 A and AA, and returns what it reports as a violation. `region` is the page's. */
async function violations(host: HTMLElement, rules: readonly string[] = []): Promise<string[]> {
  const result = await axe.run(host, {
    runOnly:
      rules.length > 0
        ? { type: "rule", values: [...rules] }
        : { type: "tag", values: ["wcag2a", "wcag2aa", "wcag22aa"] },
    rules: { region: { enabled: false } },
  });
  return result.violations.map(({ id, nodes }) => `${id}: ${nodes.map((node) => node.target.join(" ")).join(", ")}`);
}

/** Returns the color that a token has in a content root, as the engine resolves it. */
function tokenColor(host: HTMLElement, token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(--${token})`;
  host.shadowRoot?.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** Returns the elements of a content root whose content is cut off by their own box, which are the content that WCAG 1.4.4, 1.4.10 and 1.4.12 must not lose. */
function clipped(host: HTMLElement): string[] {
  const found: string[] = [];
  for (const element of host.shadowRoot?.querySelectorAll("*") ?? []) {
    if (element.matches(".qti-visually-hidden, .tempuh-control, thead") || element.closest(".qti-visually-hidden"))
      continue;
    const style = getComputedStyle(element);
    if (!["hidden", "clip"].includes(style.overflowX) && !["hidden", "clip"].includes(style.overflowY)) continue;
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      found.push(element.localName);
  }
  if (host.scrollWidth > host.clientWidth + 1) found.push("host");
  return found;
}

describe("the PNP single column", () => {
  const columns = `<div class='qti-layout-row'><div class='qti-layout-col6' id='a'>a</div><div class='qti-layout-col6' id='b'>b</div></div>`;

  it("[T90] stacks the columns of a layout row for a candidate who wants a single column", () => {
    const side = mount(columns);
    expect(rectOf(side.find("#b")).left).toBeGreaterThan(rectOf(side.find("#a")).left);
    const stacked = mount(columns, { "data-tempuh-single-column": "" });
    expect(rectOf(stacked.find("#b")).left).toBe(rectOf(stacked.find("#a")).left);
    expect(rectOf(stacked.find("#b")).top).toBeGreaterThanOrEqual(rectOf(stacked.find("#a")).bottom);
  });

  it("[T90] puts the stacks and the rows of choices in one column, and the choices above the targets", () => {
    const attributes = { "data-tempuh-single-column": "" };
    const stacked = mount(choiceInteraction("qti-choices-stacking-3 qti-orientation-horizontal", 6), attributes);
    expect(new Set(stacked.findAll("qti-simple-choice").map((element) => rectOf(element).left)).size).toBe(1);
    const row = mount(choiceInteraction("qti-orientation-horizontal", 3), attributes);
    expect(new Set(row.findAll("qti-simple-choice").map((element) => rectOf(element).left)).size).toBe(1);
    for (const position of ["left", "right"]) {
      const { find } = mount(
        `<qti-gap-match-interaction class='qti-choices-${position}'>${containers.get("qti-gap-match-interaction")}</qti-gap-match-interaction>`,
        attributes,
      );
      expect(rectOf(find(".tempuh-choices")).bottom, position).toBeLessThanOrEqual(rectOf(find(".tempuh-targets")).top);
    }
  });

  it("[T90] does the same below 48rem, whatever the profile says", async () => {
    await resize(600, 800);
    const { find, findAll } = mount(
      `${columns}${choiceInteraction("qti-choices-stacking-3", 6)}<qti-gap-match-interaction class='qti-choices-left'>${containers.get("qti-gap-match-interaction")}</qti-gap-match-interaction>`,
    );
    expect(rectOf(find("#b")).left).toBe(rectOf(find("#a")).left);
    expect(new Set(findAll("qti-simple-choice").map((element) => rectOf(element).left)).size).toBe(1);
    expect(rectOf(find(".tempuh-choices")).bottom).toBeLessThanOrEqual(rectOf(find(".tempuh-targets")).top);
  });
});

describe("accessibility of the presentation", () => {
  it("[T118] passes axe for hot texts with qti-unselected-hidden", async () => {
    const { host, find } = mount(hottext("qti-unselected-hidden"));
    find<HTMLInputElement>(".tempuh-control").checked = true;
    expect(await violations(host)).toEqual([]);
  });

  it("[T79] passes axe in high contrast", async () => {
    const { host } = mount(REPRESENTATIVE, { "data-tempuh-contrast": "high" });
    expect(await violations(host)).toEqual([]);
  });

  it("[T88][T89] passes axe with magnified text and the text appearance of a profile", async () => {
    const { host } = mount(
      REPRESENTATIVE,
      { "data-tempuh-uniform-font": "", "data-tempuh-wrapping": "", "data-tempuh-keyword-emphasis": "" },
      {
        "--tempuh-text-zoom": "2",
        "--tempuh-font-scale": "1.25",
        "--tempuh-line-height": "1.2",
        "--tempuh-letter-spacing": "1px",
        "--tempuh-word-spacing": "0.2em",
      },
    );
    expect(await violations(host)).toEqual([]);
  });
});

describe("WCAG 2.2 visual criteria", () => {
  it("[SC 1.4.1] marks an invalid control with a thicker border as well as a color", () => {
    const { find } = mount("<input type='text' aria-label='a'><input type='text' aria-label='b' aria-invalid='true'>");
    const [valid, invalid] = [find("input:nth-of-type(1)"), find("input:nth-of-type(2)")];
    expect(computed(valid, "border-top-width")).toBe("1px");
    expect(computed(invalid, "border-top-width")).toBe("3px");
  });

  it("[SC 1.4.1] emphasizes keywords by weight as well as a background", () => {
    const { find } = mount("<p><span class='qti-keyword-emphasis'>k</span></p>", {
      "data-tempuh-keyword-emphasis": "",
    });
    expect(computed(find("span"), "font-weight")).toBe("700");
  });

  it("[SC 1.4.3] keeps the text, the accent and the borders above the minimum in every theme", () => {
    for (const [name, attributes] of THEMES) {
      const { host } = mount("<p>x</p>", attributes);
      const background = computed(host, "background-color");
      expect(contrast(tokenColor(host, "tempuh-fg"), background), `${name} text`).toBeGreaterThanOrEqual(7);
      expect(contrast(tokenColor(host, "tempuh-muted"), background), `${name} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokenColor(host, "tempuh-accent"), background), `${name} accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokenColor(host, "tempuh-invalid"), background), `${name} invalid`).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokenColor(host, "tempuh-on-accent"), tokenColor(host, "tempuh-accent")),
        `${name} on accent`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(tokenColor(host, "tempuh-fg"), tokenColor(host, "tempuh-surface")),
        `${name} on surface`,
      ).toBeGreaterThanOrEqual(7);
      expect(
        contrast(tokenColor(host, "tempuh-fg"), tokenColor(host, "tempuh-accent-surface")),
        `${name} on selection`,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it("[SC 1.4.3] passes the axe color-contrast rule for every interaction in every theme, selected or not", async () => {
    for (const [name, attributes] of THEMES) {
      const { host, findAll } = mount(REPRESENTATIVE, attributes);
      for (const control of findAll<HTMLInputElement>("qti-simple-choice .tempuh-control, qti-hottext .tempuh-control"))
        control.checked = true;
      expect(await violations(host, ["color-contrast"]), name).toEqual([]);
    }
  });

  it("[SC 1.4.4] doubles the text and loses no content, at a width of 1280 and of 640 pixels", async () => {
    for (const width of [1280, 640]) {
      await resize(width, 800);
      const { host, find } = mount(REPRESENTATIVE, {}, { "--tempuh-text-zoom": "2" });
      expect(computed(find("p"), "font-size")).toBe("32px");
      expect(clipped(host), `${width} wide`).toEqual([]);
      expect(document.documentElement.scrollWidth, `${width} wide`).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    }
  });

  it("[SC 1.4.10] reflows at 320 CSS pixels without scrolling in two directions", async () => {
    await resize(320, 568);
    const { host, findAll } = mount(REPRESENTATIVE);
    expect(clipped(host)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    const wide = findAll("*").filter((element) => rectOf(element).right > document.documentElement.clientWidth + 1);
    expect(wide.map((element) => element.localName)).toEqual([]);
  });

  it("[SC 1.4.10] reflows with magnified text at 320 CSS pixels", async () => {
    await resize(320, 568);
    const { host } = mount(REPRESENTATIVE, { "data-tempuh-wrapping": "" }, { "--tempuh-text-zoom": "2" });
    expect(clipped(host)).toEqual([]);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  });

  it("[SC 1.4.11] draws control borders, accents, focus rings and selection lines at 3:1 against the background in every theme", () => {
    for (const [name, attributes] of THEMES) {
      const { host, find } = mount(
        "<input type='text' aria-label='a'><qti-gap></qti-gap><qti-order-interaction><div class='tempuh-targets'><div class='tempuh-target'></div></div></qti-order-interaction>" +
          hotspots("", "qti-hotspot-interaction"),
        attributes,
      );
      const background = computed(host, "background-color");
      for (const [what, color] of [
        ["input border", computed(find("input"), "border-top-color")],
        ["gap border", computed(find("qti-gap"), "border-top-color")],
        ["target border", computed(find(".tempuh-target"), "border-top-color")],
        ["focus ring", tokenColor(host, "tempuh-focus")],
        ["accent", tokenColor(host, "tempuh-accent")],
        ["hotspot line", computed(find(".tempuh-face"), "border-top-color")],
      ] as const) {
        expect(contrast(color, background), `${name} ${what}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("[SC 1.4.12] loses no content when the text spacing of the success criterion is applied", async () => {
    const spacing = stylesheet(
      "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }",
    );
    for (const width of [1280, 320]) {
      await resize(width, 800);
      const { host, find } = mount(REPRESENTATIVE, {}, {}, [spacing]);
      expect(clipped(host), `${width} wide`).toEqual([]);
      expect(rectOf(find("textarea")).height).toBeGreaterThanOrEqual(
        6 * Number.parseFloat(computed(find("p"), "line-height")),
      );
      expect(document.documentElement.scrollWidth, `${width} wide`).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    }
  });

  it("[SC 2.4.7] draws a visible ring around the control that has keyboard focus, in every theme, inside the root", async () => {
    for (const [name, attributes] of THEMES) {
      const { host, find } = mount("<input type='text' aria-label='a'>", attributes);
      const input = find<HTMLInputElement>("input");
      await focusByKeyboard(input);
      const style = getComputedStyle(input);
      expect(style.outlineStyle, name).toBe("solid");
      const ring = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
      expect(Number.parseFloat(style.outlineWidth), name).toBeGreaterThanOrEqual(3);
      expect(contrast(style.outlineColor, computed(host, "background-color")), name).toBeGreaterThanOrEqual(3);
      expect(rectOf(input).left - ring, name).toBeGreaterThanOrEqual(rectOf(host).left);
      expect(rectOf(input).top - ring, name).toBeGreaterThanOrEqual(rectOf(host).top);
    }
  });

  it("[SC 2.4.7] draws the ring on the face of a choice whose control is hidden", async () => {
    const { find } = mount(choiceInteraction("qti-input-control-hidden", 2));
    await focusByKeyboard(find<HTMLInputElement>(".tempuh-control"));
    expect(computed(find(".tempuh-face"), "outline-style")).toBe("solid");
  });

  it("[SC 2.4.11] scrolls a focused element clear of the sticky chrome", async () => {
    const header = document.createElement("header");
    header.style.cssText = "position: sticky; top: 0; height: 80px; background: #ccc; z-index: 10";
    const before = document.createElement("div");
    const after = document.createElement("div");
    before.style.height = after.style.height = "3000px";
    document.body.prepend(header, before);
    try {
      const clear = mount("<input type='text' aria-label='a'>", {}, { "--tempuh-sticky-top": "80px" });
      const plain = mount("<input type='text' aria-label='b'>");
      document.body.append(after);
      const input = clear.find<HTMLInputElement>("input");
      input.scrollIntoView({ block: "start" });
      expect(rectOf(input).top).toBeGreaterThanOrEqual(80);
      expect(rectOf(input).top).toBeLessThan(120);
      await focusByKeyboard(input);
      const point = document.elementFromPoint(rectOf(input).left + 2, rectOf(input).top + 2);
      expect(point).toBe(clear.host);
      plain.find("input").scrollIntoView({ block: "start" });
      expect(rectOf(plain.find("input")).top).toBeLessThan(40);
    } finally {
      header.remove();
      before.remove();
      after.remove();
      window.scrollTo(0, 0);
    }
  });

  it("[SC 2.5.8] makes every target at least 24 by 24 CSS pixels", () => {
    for (const [name, attributes] of THEMES) {
      const { findAll } = mount(
        `<p><input type='text' aria-label='a'> <select aria-label='b'><option>x</option></select> <button type='button'>b</button>
        <input type='checkbox' aria-label='c'> <input type='radio' aria-label='d'> <qti-gap></qti-gap></p>
        ${choiceInteraction("qti-input-control-hidden", 2)}${choiceInteraction("", 2)}
        <qti-order-interaction><div class='tempuh-targets'><div class='tempuh-target'></div></div></qti-order-interaction>`,
        attributes,
      );
      const targets = findAll(
        "input:not(.qti-input-control-hidden .tempuh-control), select, button, qti-gap, .tempuh-face, .tempuh-target, qti-simple-choice",
      ).filter((element) => !element.closest(".qti-input-control-hidden") || !element.matches(".tempuh-control"));
      for (const element of targets) {
        const { width, height } = rectOf(element);
        expect(width, `${name} ${element.localName} wide`).toBeGreaterThanOrEqual(24);
        expect(height, `${name} ${element.localName} tall`).toBeGreaterThanOrEqual(24);
      }
    }
  });
});
