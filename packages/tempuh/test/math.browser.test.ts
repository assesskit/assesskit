import axe from "axe-core";
import { describe, expect, inject, it } from "vitest";
import { DataError, EN_MESSAGES } from "../src/index.js";
import { buildSpeechRequest, createMathTypesetter } from "../src/player/index.js";
import { mountContent, wholeRoot } from "./content-fixture.js";
import { mount } from "./css-fixture.js";

const { asset } = inject("fixtures");

/** The browsers of a run share the servers, so this file names its paths with a token of its own. */
const TOKEN = crypto.randomUUID();
const MATHJAX = `${asset}/mathjax/${TOKEN}/mml-chtml.js`;
const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML"';

/** Returns the paths that the asset server was asked for below this file's token, without the token. */
async function hits(): Promise<string[]> {
  const paths: string[] = await (await fetch(`${asset}/__hits`, { cache: "no-store" })).json();
  return paths.filter((path) => path.includes(`/${TOKEN}/`)).map((path) => path.replace(`/${TOKEN}`, ""));
}

/**
 * Returns the URLs of the fonts that the document declares with `@font-face`. A browser that has a font from an earlier
 * page asks the network for none, so the declarations say where the fonts come from, and the downloads do not.
 */
function declaredFonts(): string[] {
  return [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter((rule) => rule instanceof CSSFontFaceRule)
    .flatMap((rule) =>
      [...rule.style.getPropertyValue("src").matchAll(/url\("([^"]+)"\)/gu)].map((match) => match[1] ?? ""),
    );
}

const FRACTION = `<p id="a"><math ${MATHML}><mfrac><mi>x</mi><mn>2</mn></mfrac></math></p>`;

/** Follows a path of properties from a value; MathJax's objects have them and TypeScript does not know them. */
function dig(value: unknown, ...path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      (typeof current === "object" || typeof current === "function") && current !== null
        ? Reflect.get(current, key)
        : undefined,
    value,
  );
}

/** Chooses the braille code of MathJax's menu, as a candidate does in the menu of an expression. */
function selectBrailleCode(code: string): void {
  const pool = dig(Reflect.get(window, "MathJax"), "startup", "document", "menu", "menu", "pool");
  const lookup = dig(pool, "lookup");
  if (typeof lookup !== "function") throw new Error("MathJax has no menu.");
  const variable: unknown = Reflect.apply(lookup, pool, ["brailleCode"]);
  const setValue = dig(variable, "setValue");
  if (typeof setValue !== "function") throw new Error("MathJax has no braille code.");
  Reflect.apply(setValue, variable, [code]);
}

/** Returns the element of a content root that matches, which must exist. */
function el(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`No element matches ${selector}.`);
  return found;
}

describe("createMathTypesetter", () => {
  const typesetter = createMathTypesetter(MATHJAX);

  it("[T9] requests no MathJax for content without MathML", async () => {
    const content = mount("<p>No mathematics here, only <em>words</em>.</p>");
    await typesetter.typeset(content.root);
    expect(Reflect.get(window, "MathJax")).toBeUndefined();
    expect(await hits()).toEqual([]);
  });

  it("[T9] loads MathJax by its URL for the first expression, and typesets it inside a shadow root", async () => {
    const content = mount(FRACTION);
    await typesetter.typeset(content.root);
    expect(await hits()).toContain("/mathjax/mml-chtml.js");
    expect(content.root.querySelector("math")).toBeNull();
    const container = el(content.root, "#a mjx-container");
    expect(container.getAttribute("jax")).toBe("CHTML");
    expect(container.querySelector("mjx-frac")).not.toBeNull();
  });

  it("[T9] stacks the numerator over the denominator in the shadow root, with the styles that it adopts there", async () => {
    const content = mount(FRACTION);
    await typesetter.typeset(content.root);
    const top = (selector: string): number => el(content.root, selector).getBoundingClientRect().top;
    expect(top("mjx-den")).toBeGreaterThan(top("mjx-num") + 4);
    // Without the adopted sheet, the styles in the head of the document do not reach the root: the parts stay in a line.
    content.root.adoptedStyleSheets = content.root.adoptedStyleSheets.slice(0, -1);
    expect(Math.abs(top("mjx-den") - top("mjx-num"))).toBeLessThan(4);
  });

  it("[T9] replaces the adopted styles at every typesetting, so that later expressions have theirs", async () => {
    const content = mount(FRACTION);
    await typesetter.typeset(content.root);
    const later = document.createElement("p");
    later.id = "b";
    later.innerHTML = `<math ${MATHML}><mi>y</mi></math>`;
    content.root.append(later);
    await typesetter.typeset(content.root);
    // MathJax adds the rule that gives a character its size when the character is first used; the box has none without it.
    const glyph = el(content.root, "#b mjx-mi mjx-c").getBoundingClientRect();
    expect(glyph.width).toBeGreaterThan(0);
    expect(glyph.height).toBeGreaterThan(0);
    expect(content.root.adoptedStyleSheets).toHaveLength(2);
  });

  it("[T9] typesets an element in the light DOM without adopting a sheet", async () => {
    const light = document.createElement("div");
    light.innerHTML = `<math ${MATHML}><mi>z</mi></math>`;
    document.body.append(light);
    const adopted = document.adoptedStyleSheets.length;
    await typesetter.typeset(light);
    expect(light.querySelector("mjx-container")).not.toBeNull();
    expect(document.adoptedStyleSheets).toHaveLength(adopted);
    light.remove();
  });

  it("[T9] loads MathJax once for any number of roots", async () => {
    await Promise.all(
      [1, 2, 3].map((n) => typesetter.typeset(mount(`<p><math ${MATHML}><mn>${n}</mn></math></p>`).root)),
    );
    expect((await hits()).filter((path) => path === "/mathjax/mml-chtml.js")).toHaveLength(1);
  });

  it("[T9] gets the fonts and the speech data from the host, never from a CDN", async () => {
    await typesetter.typeset(mount(FRACTION).root);
    const fonts = declaredFonts();
    expect(fonts).not.toEqual([]);
    for (const font of fonts) expect(font.startsWith(`${asset}/mathjax/@mathjax/mathjax-newcm-font/`)).toBe(true);
    const speech = await hits();
    expect(speech).toContain("/mathjax/sre/speech-worker.js");
    expect(speech.some((path) => path.startsWith("/mathjax/sre/mathmaps/"))).toBe(true);
  });

  it("[T9] leaves an expression with elementary math as MathML, and typesets the others in the same root", async () => {
    const content = mount(
      `<p id="a"><math ${MATHML}><mn>1</mn></math></p>` +
        `<p id="stack"><math ${MATHML}><mstack><mn>12</mn><msrow><mo>+</mo><mn>34</mn></msrow><msline/></mstack></math></p>` +
        `<p id="div"><math ${MATHML}><mlongdiv><mn>3</mn><mn>12</mn><mn>4</mn></mlongdiv></math></p>` +
        `<p id="deep"><math ${MATHML}><mrow><mscarries><mscarry><mn>1</mn></mscarry></mscarries></mrow></math></p>`,
    );
    await typesetter.typeset(content.root);
    expect(el(content.root, "#a mjx-container")).toBeDefined();
    for (const id of ["stack", "div", "deep"]) {
      expect(content.root.querySelector(`#${id} math`), id).not.toBeNull();
      expect(content.root.querySelector(`#${id} mjx-container`), id).toBeNull();
    }
    expect(content.root.querySelector("mjx-merror")).toBeNull();
    expect(content.find("#stack").textContent).toContain("12");
  });

  it("[T9] gives Nemeth braille for the expressions of the Nemeth Code that MathJax's Speech Rule Engine knows", async () => {
    const content = mount(
      `<p id="sum"><math ${MATHML}><mi>x</mi><mo>+</mo><mn>1</mn></math></p>` +
        `<p id="square"><math ${MATHML}><msup><mi>x</mi><mn>2</mn></msup></math></p>` +
        `<p id="half"><math ${MATHML}><mfrac><mn>1</mn><mn>2</mn></mfrac></math></p>` +
        `<p id="root"><math ${MATHML}><msqrt><mi>x</mi></msqrt></math></p>`,
    );
    await typesetter.typeset(content.root);
    const braille = (id: string): string | null =>
      el(content.root, `#${id} mjx-speech`).getAttribute("aria-braillelabel");
    // The Nemeth Code: letters and plus (⠭ ⠬), a numeral in the lower position (⠂ for 1, ⠆ for 2), the superscript indicator
    // ⠘, the fraction indicators ⠹ ⠌ ⠼, and the radical indicators ⠜ ⠻.
    expect(braille("sum")).toBe("⠭⠬⠂");
    expect(braille("square")).toBe("⠭⠘⠆");
    expect(braille("half")).toBe("⠹⠂⠌⠆⠼");
    expect(braille("root")).toBe("⠜⠭⠻");
    expect(el(content.root, "#square mjx-speech").getAttribute("aria-label")).toMatch(/squared/u);
  });

  it("[T9][T85] gives the speech request the speech that MathJax made, and nothing under skip-math-equations", async () => {
    const content = mountContent(`<p>Compute <math ${MATHML}><msup><mi>x</mi><mn>2</mn></msup></math> now.</p>`);
    await typesetter.typeset(content.root);
    const options = {
      settings: { readingType: "computer-read-aloud" as const },
      messages: EN_MESSAGES,
      language: "en",
    };
    expect(buildSpeechRequest(wholeRoot(content), options)?.text).toBe("Compute x squared, math now.");
    const skipping = {
      ...options,
      settings: { ...options.settings, restrictionTypes: ["skip-math-equations" as const] },
    };
    expect(buildSpeechRequest(wholeRoot(content), skipping)?.text).toBe("Compute now.");
  });

  it("[T9] leaves no axe violation in a root with typeset mathematics", async () => {
    const content = mount(`${FRACTION}<p><math ${MATHML}><msqrt><mi>x</mi></msqrt></math></p>`);
    await typesetter.typeset(content.root);
    const result = await axe.run(content.host, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      rules: { region: { enabled: false } },
    });
    expect(result.violations.map(({ id }) => id)).toEqual([]);
  });

  it("[T9] refuses a URL that is not an http or https URL, and a root that is not a root", async () => {
    for (const url of [
      "mml-chtml.js",
      "javascript:alert(1)",
      "data:text/javascript,1",
      "",
      JSON.parse("3"),
      JSON.parse("null"),
    ]) {
      expect(() => createMathTypesetter(url), String(url)).toThrow(DataError);
    }
    await expect(typesetter.typeset(JSON.parse("null"))).rejects.toThrow(DataError);
    await expect(typesetter.typeset(JSON.parse('"p"'))).rejects.toThrow(DataError);
  });

  it("[T9] has no braille for UEB math in MathJax 4.1.3: under its UEB code the label is not braille", async () => {
    selectBrailleCode("ueb");
    const content = mount(`<p id="sum"><math ${MATHML}><mi>x</mi><mo>+</mo><mn>1</mn></math></p>`);
    await typesetter.typeset(content.root);
    const label = el(content.root, "#sum mjx-speech").getAttribute("aria-braillelabel") ?? "";
    selectBrailleCode("nemeth");
    expect(label).not.toMatch(/[\u2800-\u28ff]/u);
  });
});
