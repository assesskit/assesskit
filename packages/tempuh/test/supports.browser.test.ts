import { readAsi } from "@luthfanwakan/olah/asi";
import { createEngine, type DeliveryState, type SupportView, stamp } from "@luthfanwakan/olah/delivery";
import { describeInteractions } from "@luthfanwakan/olah/interactions";
import { readPnp, type SupportSetting } from "@luthfanwakan/olah/pnp";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { DataError, EN_MESSAGES, ID_MESSAGES } from "../src/index.js";
import {
  applyPresentation,
  createContentRoot,
  createInteractionRenderers,
  InteractionElement,
  mountContentSupports,
  mountSpoken,
  mountSupportPanel,
  mountVariantNotice,
  presentationOf,
  type SpeechHook,
  type SpeechRequest,
} from "../src/player/index.js";
import { audioPlaysToEnd } from "./audio.js";
import { computed, mount, PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { STATIC_URL } from "./interactions-fixture.js";
import { axeViolations, ITEM_PATH } from "./renderer-fixture.js";
import { onSupport, supportView } from "./supports-fixture.js";

const { asset } = inject("fixtures");

/** The browsers of a run share the servers, so this file names its paths with a token of its own. */
const TOKEN = crypto.randomUUID();
const ASSETS = `${asset}/content/${TOKEN}/`;

const NAMESPACE = 'xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
// A pointer left over from the last test would hover whatever the next one draws under it.
beforeEach(async () => {
  await userEvent.unhover(document.body);
});

const tracked = <T extends Element>(element: T): T => {
  document.body.append(element);
  cleanups.push(() => element.remove());
  return element;
};

/** Returns the element that matches, which must exist. */
function el<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`No element matches ${selector}.`);
  return found;
}

/** Returns the button of a parent with the given text, which must exist. */
function buttonOf(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((button) => button.textContent === text);
  if (found === undefined) throw new Error(`No button has the text ${JSON.stringify(text)}.`);
  return found;
}

/** Returns the element that has the focus, looking through open shadow roots. */
function focused(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

// --- Content with catalogs ------------------------------------------------------------------------------------------

const BODY = `
  <p id="intro" data-catalog-idref="intro">Plants make food by <span id="photo" data-catalog-idref="photo">photosynthesis</span> in leaves.</p>
  <p id="hard" data-catalog-idref="hard">The feline reposed upon the rug.</p>
  <div><img id="pic" src="images/dot.png" alt="A dot" data-catalog-idref="pic"/></div>
  <p id="plain" data-catalog-idref="none">No card here.</p>
  <div><video id="clip" data-catalog-idref="clip" width="160" height="90" controls="controls">
    <source src="media/clip.mp4" type="video/mp4"/>
    <track kind="captions" src="media/clip.vtt" srclang="en" label="English"/>
    <track kind="descriptions" src="media/clip-d.vtt" srclang="en" label="Descriptions"/>
    <track kind="chapters" src="media/clip-c.vtt" srclang="en" label="Chapters"/>
  </video></div>`;

const CATALOGS = `
  <qti-catalog id="photo">
    <qti-card support="glossary-on-screen">
      <qti-card-entry xml:lang="en" default="true"><qti-html-content><p>How plants turn light into food.</p></qti-html-content></qti-card-entry>
      <qti-card-entry xml:lang="id"><qti-html-content xml:lang="id"><p>Cara tumbuhan mengubah cahaya menjadi makanan.</p></qti-html-content></qti-card-entry>
    </qti-card>
    <qti-card support="keyword-translation">
      <qti-card-entry xml:lang="es"><qti-html-content xml:lang="es"><p>fotosintesis</p></qti-html-content></qti-card-entry>
      <qti-card-entry xml:lang="id"><qti-html-content xml:lang="id"><p>fotosintesis (id)</p></qti-html-content></qti-card-entry>
      <qti-card-entry xml:lang="en" default="true"><qti-html-content><p>photosynthesis (default)</p></qti-html-content></qti-card-entry>
    </qti-card>
    <qti-card support="linguistic-guidance"><qti-html-content><p>The word comes from Greek.</p></qti-html-content></qti-card>
    <qti-card support="additional-directions"><qti-html-content><p>Read the sentence twice.</p></qti-html-content></qti-card>
    <qti-card support="keyboard-directions"><qti-html-content><p>Press Tab to move.</p></qti-html-content></qti-card>
    <qti-card support="ext:kxz-illustrated-glossary"><qti-html-content><p>An illustrated glossary entry.</p></qti-html-content></qti-card>
  </qti-catalog>
  <qti-catalog id="intro">
    <qti-card support="sign-language">
      <qti-card-entry xml:lang="ase"><qti-file-href mime-type="video/mp4">media/sign-ase.mp4</qti-file-href></qti-card-entry>
      <qti-card-entry xml:lang="ins"><qti-file-href mime-type="video/mp4">media/sign-ins.mp4</qti-file-href></qti-card-entry>
    </qti-card>
    <qti-card support="transcript"><qti-html-content><p>The transcript of the paragraph.</p></qti-html-content></qti-card>
    <qti-card support="audio-description"><qti-html-content><p>A description of the paragraph.</p></qti-html-content></qti-card>
  </qti-catalog>
  <qti-catalog id="hard">
    <qti-card support="simplified-language-portions"><qti-html-content><p>The cat sat on the rug.</p></qti-html-content></qti-card>
    <qti-card support="high-contrast"><qti-html-content><p>THE FELINE RESTED ON THE RUG.</p></qti-html-content></qti-card>
    <qti-card support="long-description"><qti-html-content><p>A long account of the rug.</p></qti-html-content></qti-card>
    <qti-card support="braille"><qti-html-content>⠉⠁⠞</qti-html-content><qti-file-href mime-type="text/x-brf">files/rug.brf</qti-file-href></qti-card>
    <qti-card support="tactile"><qti-file-href mime-type="application/pdf">files/rug-tactile.pdf</qti-file-href></qti-card>
  </qti-catalog>
  <qti-catalog id="pic">
    <qti-card support="simplified-graphics"><qti-file-href mime-type="image/png">images/dot.png</qti-file-href></qti-card>
    <qti-card support="high-contrast"><qti-file-href mime-type="image/png">images/dot.png</qti-file-href></qti-card>
  </qti-catalog>
  <qti-catalog id="clip">
    <qti-card support="transcript"><qti-html-content><p>The words of the clip.</p></qti-html-content></qti-card>
  </qti-catalog>`;

/** Reads an item with a catalog and returns its body and catalogs as the view gives them. */
function item(body = BODY, catalogs = CATALOGS) {
  const document = readAsi(
    `<qti-assessment-item ${NAMESPACE} identifier="c" title="c" adaptive="false" time-dependent="false">
       <qti-item-body>${body}</qti-item-body><qti-catalog-info>${catalogs}</qti-catalog-info>
     </qti-assessment-item>`,
  );
  if (document.kind !== "item" || document.item.body === undefined) throw new Error("not an item");
  return { body: document.item.body.children, catalogs: document.item.catalogInfo?.catalogs ?? [] };
}

/** Opens a content root that shows the item, with the style of the player, in the page. */
async function openRoot(
  extra: { readonly hostStyle?: string; readonly body?: string; readonly catalogs?: string } = {},
) {
  const host = tracked(document.createElement("div"));
  if (extra.hostStyle !== undefined) host.setAttribute("style", extra.hostStyle);
  const root = createContentRoot(host, {
    messages: EN_MESSAGES,
    assets: (path) => `${ASSETS}${path}`,
    fetch: (url, request) => fetch(url, request),
    stylesheet: stylesheet(PLAYER_CSS),
  });
  const { body, catalogs } = item(extra.body, extra.catalogs);
  await root.show({ body: { nodes: body, base: ITEM_PATH }, catalogs });
  cleanups.push(() => root.destroy());
  return { host, root };
}

/** Opens a root and mounts the content supports on it. */
async function openSupported(extra: Parameters<typeof openRoot>[0] = {}, messages = EN_MESSAGES) {
  const opened = await openRoot(extra);
  const supports = mountContentSupports(opened.root, { messages });
  cleanups.push(() => supports.destroy());
  return { ...opened, supports };
}

const settings = <T extends SupportSetting>(setting: T): T => setting;

describe("applyPresentation", () => {
  it("[T79][T87] shows a theme in the content root and changes it with the next presentation", () => {
    const content = mount("<p>Text</p>");
    const colors = (): string[] => [computed(content.find("p"), "color"), computed(content.host, "background-color")];
    expect(colors()).toEqual(["rgb(26, 26, 26)", "rgb(255, 255, 255)"]);
    applyPresentation(content.host, presentationOf([onSupport("high-contrast")]));
    expect(colors()).toEqual(["rgb(0, 0, 0)", "rgb(255, 255, 255)"]);
    applyPresentation(content.host, presentationOf([onSupport("high-contrast"), onSupport("invert-display-polarity")]));
    expect(colors()).toEqual(["rgb(255, 255, 255)", "rgb(0, 0, 0)"]);
    applyPresentation(content.host, presentationOf([]));
    expect(colors()).toEqual(["rgb(26, 26, 26)", "rgb(255, 255, 255)"]);
    expect(content.host.hasAttribute("data-tempuh-contrast")).toBe(false);
  });

  it("[T89] sets the size, face and spacing of the text appearance and the colors of the profile", () => {
    const content = mount("<p>Text</p>");
    const appearance = settings({
      name: "text-appearance",
      replaceAccessModes: [],
      fontColor: "#123456",
      backgroundColor: "#fffbe6",
      fontSize: 18,
      fontFace: { fontNames: ["Courier New"], genericFontFace: "monospaced" },
      letterSpacing: 0.1,
      wordSpacing: 0.2,
    });
    applyPresentation(content.host, presentationOf([onSupport("text-appearance", appearance)]));
    const paragraph = content.find("p");
    expect(computed(paragraph, "color")).toBe("rgb(18, 52, 86)");
    expect(computed(content.host, "background-color")).toBe("rgb(255, 251, 230)");
    // 18 points over 12 points is 1.5 times the 16 pixels of the base size.
    expect(computed(paragraph, "font-size")).toBe("24px");
    expect(computed(paragraph, "font-family")).toContain("Courier New");
    expect(computed(paragraph, "letter-spacing")).toBe("2.4px");
    expect(computed(paragraph, "word-spacing")).toBe("4.8px");
  });

  it("[T88] enlarges the text by the zoom of the magnification, and takes it off", () => {
    const content = mount("<p>Text</p>");
    applyPresentation(content.host, presentationOf([onSupport("magnification")]));
    expect(computed(content.find("p"), "font-size")).toBe("32px");
    applyPresentation(content.host, presentationOf([]));
    expect(computed(content.find("p"), "font-size")).toBe("16px");
  });

  it("[T90][T91] sets the single column and the keyword emphasis as the stylesheet reads them", () => {
    const content = mount('<p class="qti-keyword-emphasis">Key</p>');
    const before = computed(content.find("p"), "font-weight");
    applyPresentation(content.host, presentationOf([onSupport("layout-single-column"), onSupport("keyword-emphasis")]));
    expect(content.host.hasAttribute("data-tempuh-single-column")).toBe(true);
    expect(computed(content.find("p"), "font-weight")).not.toBe(before);
  });

  it("leaves the attributes and properties it did not set, and takes off only its own", () => {
    const content = mount("<p>Text</p>", { "data-other": "kept" }, { "--other": "kept" });
    applyPresentation(content.host, presentationOf([onSupport("high-contrast"), onSupport("magnification")]));
    applyPresentation(content.host, presentationOf([]));
    expect(content.host.getAttribute("data-other")).toBe("kept");
    expect(content.host.style.getPropertyValue("--other")).toBe("kept");
    expect(content.host.hasAttribute("data-tempuh-contrast")).toBe(false);
    expect(content.host.style.getPropertyValue("--tempuh-text-zoom")).toBe("");
  });

  it("rejects a target that is not an element and a presentation that is not one", () => {
    expect(() => applyPresentation(JSON.parse("null"), presentationOf([]))).toThrow(
      new DataError("The target must be an element, found null."),
    );
    expect(() => applyPresentation(document.createElement("div"), JSON.parse("{}"))).toThrow(
      new DataError("The presentation property attributes must be a Map, found undefined."),
    );
  });
});

describe("mountSupportPanel", () => {
  const options = (extra: Partial<Parameters<typeof mountSupportPanel>[1]> = {}) => {
    const requests: [string, boolean][] = [];
    return {
      requests,
      options: {
        messages: EN_MESSAGES,
        onSupport: (name: string, active: boolean) => requests.push([name, active]),
        ...extra,
      },
    };
  };
  const mountPanel = (extra: Partial<Parameters<typeof mountSupportPanel>[1]> = {}) => {
    const host = tracked(document.createElement("div"));
    const { requests, options: given } = options(extra);
    const panel = mountSupportPanel(host, given);
    cleanups.push(() => panel.destroy());
    return { host, panel, requests };
  };
  const offered = [
    supportView("captions", { state: "option" }),
    supportView("high-contrast", { state: "option", active: true }),
    supportView("magnification", { state: "prohibited" }),
    supportView("spoken", { state: "active", active: true }),
    supportView("transcript", { state: "assigned", active: true }),
    supportView("line-reader", { state: "option" }),
    supportView("dictionary-on-screen", { state: "option" }),
    supportView("ext:kxz-illustrated-glossary", { state: "option" }),
  ];

  it("[T75] shows a toggle button for each option support, pressed when it is on, and no button for any other", () => {
    const { host, panel } = mountPanel();
    panel.update(offered);
    const region = el(host, "section");
    expect(region.getAttribute("aria-label")).toBe("Supports");
    const buttons = [...region.querySelectorAll("button")];
    // The toolbar of the tools turns on the line reader and the dictionary; the others have no option to turn.
    expect(buttons.map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["Captions", "false"],
      ["High contrast", "true"],
      ["kxz-illustrated-glossary", "false"],
    ]);
    expect(region.hidden).toBe(false);
  });

  it("[T75] asks for the opposite of what the last input said, and shows what the next input says, not the request", async () => {
    const { host, panel, requests } = mountPanel();
    panel.update(offered);
    await userEvent.click(buttonOf(host, "Captions"));
    await userEvent.click(buttonOf(host, "High contrast"));
    expect(requests).toEqual([
      ["captions", true],
      ["high-contrast", false],
    ]);
    expect(buttonOf(host, "Captions").getAttribute("aria-pressed")).toBe("false");
    panel.update(offered.map((support) => (support.name === "captions" ? { ...support, active: true } : support)));
    expect(buttonOf(host, "Captions").getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(buttonOf(host, "Captions"));
    expect(requests.at(-1)).toEqual(["captions", false]);
  });

  it("[T75] lists the supports that the candidate cannot change with their state, and gives them no control", () => {
    const { host, panel } = mountPanel();
    panel.update(offered);
    const lines = [...host.querySelectorAll("li")].map((line) => [
      line.textContent,
      line.querySelector("button") !== null,
    ]);
    // The prohibited magnification and the supports that the tools turn on and off are not listed.
    expect(lines).toEqual([
      ["Captions", true],
      ["High contrast", true],
      ["Spoken: on", false],
      ["Transcript: on", false],
      ["kxz-illustrated-glossary", true],
    ]);
    panel.update(offered.map((support) => (support.name === "transcript" ? { ...support, active: false } : support)));
    expect(host.querySelectorAll("li")[3]?.textContent).toBe("Transcript: off");
  });

  it("[T75][T97] writes the state of a support in the language of the interface", () => {
    const { host, panel } = mountPanel({ messages: ID_MESSAGES });
    panel.update([
      supportView("additional-testing-time", { state: "assigned", active: true }),
      supportView("encouragement", { state: "active", active: false }),
    ]);
    expect([...host.querySelectorAll("li")].map(({ textContent }) => textContent)).toEqual([
      `${ID_MESSAGES.supportAdditionalTestingTime}: ${ID_MESSAGES.supportOn}`,
      `${ID_MESSAGES.supportEncouragement}: ${ID_MESSAGES.supportOff}`,
    ]);
  });

  it("[T75] has no region when there is nothing to list, and takes a line away when its support leaves", () => {
    const { host, panel } = mountPanel();
    panel.update([
      supportView("magnification", { state: "prohibited" }),
      supportView("line-reader", { state: "active", active: true }),
    ]);
    expect(el(host, "section").hidden).toBe(true);
    panel.update(offered);
    panel.update(offered.filter(({ name }) => name !== "captions" && name !== "spoken"));
    expect([...host.querySelectorAll("button")].map(({ textContent }) => textContent)).toEqual([
      "High contrast",
      "kxz-illustrated-glossary",
    ]);
    expect(host.querySelectorAll("li")).toHaveLength(3);
    panel.update([]);
    expect(el(host, "section").hidden).toBe(true);
  });

  it("[T75] turns a line into a button, and back, when the state of its support changes", () => {
    const { host, panel } = mountPanel();
    panel.update([supportView("captions", { state: "assigned", active: true })]);
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("li")?.textContent).toBe("Captions: on");
    panel.update([supportView("captions", { state: "option", active: true })]);
    expect(buttonOf(host, "Captions").getAttribute("aria-pressed")).toBe("true");
    panel.update([supportView("captions", { state: "assigned", active: false })]);
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("li")?.textContent).toBe("Captions: off");
  });

  it("keeps the focus on a button while the supports update around it, and keeps the order of the supports", () => {
    const { host, panel } = mountPanel();
    panel.update(offered);
    buttonOf(host, "High contrast").focus();
    panel.update([
      supportView("encouragement", { state: "option" }),
      ...offered.filter(({ name }) => name !== "captions"),
    ]);
    expect(focused()).toBe(buttonOf(host, "High contrast"));
    expect([...host.querySelectorAll("button")].map(({ textContent }) => textContent)).toEqual([
      "Encouragement",
      "High contrast",
      "kxz-illustrated-glossary",
    ]);
  });

  it("[T97] names the supports in the language of the interface", () => {
    const { host, panel } = mountPanel({ messages: ID_MESSAGES });
    panel.update(offered);
    expect(el(host, "section").getAttribute("aria-label")).toBe("Dukungan");
    expect([...host.querySelectorAll("button")].map(({ textContent }) => textContent)).toEqual([
      "Takarir",
      "Kontras tinggi",
      "kxz-illustrated-glossary",
    ]);
  });

  it("[T96][SC 2.1.1] is operated by the keyboard alone: each button is in the tab order, and Enter and Space turn it", async () => {
    const { host, panel, requests } = mountPanel();
    panel.update(offered);
    // Safari does not Tab to a button unless its settings say so, so the focus is set and the keys are pressed.
    expect([...host.querySelectorAll("button")].map(({ tabIndex }) => tabIndex)).toEqual([0, 0, 0]);
    buttonOf(host, "Captions").focus();
    await userEvent.keyboard("{Enter}");
    buttonOf(host, "High contrast").focus();
    await userEvent.keyboard(" ");
    expect(requests).toEqual([
      ["captions", true],
      ["high-contrast", false],
    ]);
  });

  it("[T96] is operated by the pointer alone: a click turns a support, with no key", async () => {
    const { host, panel, requests } = mountPanel();
    panel.update(offered);
    await userEvent.click(buttonOf(host, "kxz-illustrated-glossary"));
    expect(requests).toEqual([["ext:kxz-illustrated-glossary", true]]);
  });

  it("[T75][SC 2.5.8][SC 4.1.2] has controls of at least 24 by 24 pixels, and passes axe", async () => {
    const { host, panel } = mountPanel();
    panel.update(offered);
    for (const button of host.querySelectorAll("button")) {
      const box = button.getBoundingClientRect();
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    }
    expect(await axeViolations(host)).toEqual([]);
  });

  it("takes the panel away", () => {
    const { host, panel } = mountPanel();
    panel.update(offered);
    panel.destroy();
    expect(host.querySelector("section")).toBeNull();
  });

  it("rejects a host, options or supports of the wrong type", () => {
    const host = tracked(document.createElement("div"));
    const valid = { messages: EN_MESSAGES, onSupport: () => undefined };
    expect(() => mountSupportPanel(JSON.parse("null"), valid)).toThrow(
      new DataError("The host must be an element in a document, found null."),
    );
    expect(() => mountSupportPanel(document.createElement("div"), valid)).toThrow(
      new DataError(`The host must be an element in a document, found an object.`),
    );
    expect(() => mountSupportPanel(host, JSON.parse("null"))).toThrow(
      new DataError("The options must be an object, found null."),
    );
    expect(() => mountSupportPanel(host, { ...valid, onSupport: JSON.parse("1") })).toThrow(
      new DataError("The option onSupport must be a function, found 1."),
    );
    expect(() => mountSupportPanel(host, { ...valid, ...JSON.parse('{"extra": 1}') })).toThrow(
      new DataError('The options has the properties "messages" and "onSupport", found "extra".'),
    );
    const panel = mountSupportPanel(host, valid);
    expect(() => panel.update(JSON.parse("{}"))).toThrow(
      new DataError("The list of supports is invalid: expected an array, found an object."),
    );
    panel.destroy();
  });
});

describe("mountContentSupports", () => {
  const glossary = onSupport("glossary-on-screen");

  /** The button that opens the popup of a support on an element, with the popup and the anchor around them. */
  function popupOn(root: ParentNode, selector: string, name: string) {
    const host = el(root, selector);
    const trigger = buttonOf(host, name);
    const anchor = trigger.closest<HTMLElement>(".tempuh-card-anchor");
    if (anchor === null) throw new Error("The button has no anchor.");
    return { host, trigger, anchor, popup: el(host, `#${trigger.getAttribute("aria-controls")}`) };
  }

  describe("popups", () => {
    it("[T76] puts a button at the term, and draws no card until the candidate asks for it", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(popup.hidden).toBe(true);
      expect(popup.getAttribute("role")).toBe("group");
      expect(popup.getAttribute("aria-label")).toBe("Glossary");
      expect(popup.textContent).toContain("How plants turn light into food.");
      await userEvent.click(trigger);
      expect(popup.hidden).toBe(false);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      // Only the term that has a card gets a button.
      expect(root.root.querySelectorAll(".tempuh-card-trigger")).toHaveLength(1);
    });

    it("[T76] shows the glossary in the language of the translation of the question when that is on", async () => {
      const { root, supports } = await openSupported();
      const translation = settings({ name: "item-translation", replaceAccessModes: [], language: "id" });
      supports.update([glossary, onSupport("item-translation", translation)]);
      const { popup } = popupOn(root.root, "#photo", "Glossary");
      expect(popup.textContent).toContain("Cara tumbuhan mengubah cahaya menjadi makanan.");
      expect(el(popup, "[lang]").getAttribute("lang")).toBe("id");
    });

    it("[T76] draws no button for a support that is off or prohibited, or for a term whose catalog has no such card", async () => {
      const { root, supports } = await openSupported();
      supports.update([supportView("glossary-on-screen", { state: "option", active: false })]);
      expect(root.root.querySelector(".tempuh-card-trigger")).toBeNull();
      supports.update([supportView("glossary-on-screen", { state: "prohibited" })]);
      expect(root.root.querySelector(".tempuh-card-trigger")).toBeNull();
      supports.update([onSupport("transcript")]);
      expect(root.root.querySelector(".tempuh-card-trigger")).toBeNull();
    });

    it("[T77] shows the keyword translation of the language of the support, the same language with a region, or the default entry", async () => {
      const { root, supports } = await openSupported();
      const translated = (language: string): string => {
        supports.update([
          onSupport("keyword-translation", settings({ name: "keyword-translation", replaceAccessModes: [], language })),
        ]);
        return popupOn(root.root, "#photo", "Keyword translation").popup.textContent ?? "";
      };
      expect(translated("es")).toContain("fotosintesis");
      expect(translated("id")).toContain("fotosintesis (id)");
      expect(translated("id-ID")).toContain("fotosintesis (id)");
      expect(translated("de")).toContain("photosynthesis (default)");
    });

    it("[T78] opens the guidance, the additional directions and the keyboard directions on request, each under its name", async () => {
      const { root, supports } = await openSupported();
      supports.update([
        onSupport("linguistic-guidance"),
        onSupport("additional-directions"),
        onSupport("keyboard-directions"),
      ]);
      const texts = new Map([
        ["Linguistic guidance", "The word comes from Greek."],
        ["Additional directions", "Read the sentence twice."],
        ["Keyboard directions", "Press Tab to move."],
      ]);
      for (const [name, text] of texts) {
        const { trigger, popup } = popupOn(root.root, "#photo", name);
        expect(popup.hidden).toBe(true);
        await userEvent.click(trigger);
        expect(popup.hidden).toBe(false);
        expect(popup.textContent).toContain(text);
        await userEvent.click(trigger);
        expect(popup.hidden).toBe(true);
      }
    });

    it("[T76] shows the cards of a custom support (BPIG §5.4) on request, under its local name", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("ext:kxz-illustrated-glossary")]);
      const { trigger, popup } = popupOn(root.root, "#photo", "kxz-illustrated-glossary");
      await userEvent.click(trigger);
      expect(popup.textContent).toContain("An illustrated glossary entry.");
    });

    it("[SC 1.4.13] is hoverable: the pointer goes from the button onto the popup and the popup stays", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.hover(trigger);
      expect(popup.hidden).toBe(false);
      await userEvent.hover(popup);
      expect(popup.hidden).toBe(false);
      await userEvent.unhover(popup);
      expect(popup.hidden).toBe(true);
    });

    it("[SC 1.4.13] touches the button, so that the pointer never crosses a gap between it and the popup", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { anchor, trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.hover(trigger);
      const box = popup.getBoundingClientRect();
      const at = anchor.getBoundingClientRect();
      expect(Math.min(Math.abs(box.top - at.bottom), Math.abs(box.bottom - at.top))).toBeLessThanOrEqual(1);
    });

    it("[SC 1.4.13] is persistent: it stays after a press while the pointer is away, until it is dismissed", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.click(trigger);
      await userEvent.unhover(trigger);
      expect(popup.hidden).toBe(false);
      await userEvent.click(trigger);
      expect(popup.hidden).toBe(true);
    });

    it("[SC 1.4.13] is dismissible with Escape while the pointer stays over it, and shows again when the pointer comes back", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.hover(trigger);
      expect(popup.hidden).toBe(false);
      await userEvent.keyboard("{Escape}");
      expect(popup.hidden).toBe(true);
      await userEvent.unhover(trigger);
      await userEvent.hover(trigger);
      expect(popup.hidden).toBe(false);
    });

    it("[SC 1.4.13] is dismissible with Escape while the focus stays on the button, and shows again when the focus comes back", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      trigger.focus();
      expect(popup.hidden).toBe(false);
      await userEvent.keyboard("{Escape}");
      expect(popup.hidden).toBe(true);
      expect(focused()).toBe(trigger);
      trigger.blur();
      trigger.focus();
      expect(popup.hidden).toBe(false);
    });

    it("[SC 1.4.13] shows when the button takes the focus, and hides when the focus leaves both", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      const other = tracked(document.createElement("button"));
      trigger.focus();
      expect(popup.hidden).toBe(false);
      const close = buttonOf(popup, "Close");
      close.focus();
      expect(popup.hidden).toBe(false);
      other.focus();
      expect(popup.hidden).toBe(true);
    });

    it("[T96][SC 1.4.13] is dismissed by its Close button, which is for the pointer alone", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.click(trigger);
      const close = buttonOf(popup, "Close");
      expect(close.getAttribute("aria-label")).toBe("Close Glossary");
      await userEvent.click(close);
      expect(popup.hidden).toBe(true);
    });

    it("[T96] gives the focus to the button when the Close button that has it dismisses the popup", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.click(trigger);
      buttonOf(popup, "Close").focus();
      await userEvent.keyboard("{Enter}");
      expect(popup.hidden).toBe(true);
      expect(focused()).toBe(trigger);
    });

    it("[T96][SC 2.1.1] is operated by the keyboard alone: the button shows it on focus, Enter keeps it, Escape dismisses it", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      expect(trigger.tabIndex).toBe(0);
      trigger.focus();
      expect(popup.hidden).toBe(false);
      await userEvent.keyboard("{Enter}");
      // The focus goes into the popup and the popup stays.
      buttonOf(popup, "Close").focus();
      expect(popup.hidden).toBe(false);
      await userEvent.keyboard("{Escape}");
      expect(popup.hidden).toBe(true);
      expect(focused()).toBe(trigger);
    });

    it("[SC 1.4.13] keeps the popup inside the host, which clips what lies outside it", async () => {
      const { root, supports, host } = await openSupported({ hostStyle: "width: 260px;" });
      supports.update([glossary]);
      // The term stands at the right edge of the host.
      el<HTMLElement>(root.root, "#intro").style.textAlign = "right";
      const { trigger, popup } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.click(trigger);
      const inside = host.getBoundingClientRect();
      const box = popup.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(inside.left - 0.5);
      expect(box.right).toBeLessThanOrEqual(inside.right + 0.5);
      expect(box.bottom).toBeLessThanOrEqual(inside.bottom + 0.5);
    });

    it("[SC 1.4.13] opens above the button when there is more room above than below", async () => {
      const { root, supports, host } = await openSupported({
        body: '<p id="top">Above.</p><p id="last"><span id="photo" data-catalog-idref="photo">photosynthesis</span></p>',
      });
      supports.update([glossary]);
      const { trigger, popup, anchor } = popupOn(root.root, "#photo", "Glossary");
      await userEvent.click(trigger);
      const at = anchor.getBoundingClientRect();
      const box = popup.getBoundingClientRect();
      expect(box.bottom).toBeLessThanOrEqual(at.top + 1);
      expect(box.top).toBeGreaterThanOrEqual(host.getBoundingClientRect().top - 0.5);
    });

    it("[SC 1.4.13][SC 1.4.3][SC 4.1.2][T76] passes axe with the popup open, and with every popup button", async () => {
      const { host, root, supports } = await openSupported();
      supports.update([
        glossary,
        onSupport(
          "keyword-translation",
          settings({ name: "keyword-translation", replaceAccessModes: [], language: "es" }),
        ),
        onSupport("linguistic-guidance"),
      ]);
      expect(await axeViolations(host)).toEqual([]);
      await userEvent.click(buttonOf(el(root.root, "#photo"), "Glossary"));
      expect(await axeViolations(host)).toEqual([]);
    });

    it("[SC 1.4.3][SC 1.4.11] passes axe in the themes of the supports with the popup open", async () => {
      const { host, root, supports } = await openSupported();
      supports.update([glossary]);
      await userEvent.click(buttonOf(el(root.root, "#photo"), "Glossary"));
      for (const themed of [
        [onSupport("high-contrast")],
        [onSupport("invert-display-polarity")],
        [onSupport("high-contrast"), onSupport("invert-display-polarity")],
      ]) {
        applyPresentation(host, presentationOf(themed));
        expect(await axeViolations(host)).toEqual([]);
      }
    });
  });

  describe("replacing the content", () => {
    it("[T79] puts the card of high contrast in place of the content, and gives the content back when the support goes", async () => {
      const { root, supports } = await openSupported();
      const hard = el(root.root, "#hard");
      const before = [...hard.childNodes];
      supports.update([onSupport("high-contrast")]);
      expect(hard.textContent).toBe("THE FELINE RESTED ON THE RUG.");
      supports.update([]);
      expect([...hard.childNodes]).toEqual(before);
      expect(hard.textContent).toBe("The feline reposed upon the rug.");
    });

    it("[T79] hides a picture and shows the card after it", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("high-contrast")]);
      const picture = el(root.root, "#pic");
      expect(picture.hasAttribute("hidden")).toBe(true);
      const card = el(root.root, '[data-tempuh-card="high-contrast"]');
      expect(picture.nextElementSibling).toBe(card);
      expect(card.querySelector("img")?.getAttribute("src")).toBe(`${ASSETS}items/q1/images/dot.png`);
      supports.update([]);
      expect(picture.hasAttribute("hidden")).toBe(false);
      expect(root.root.querySelector('[data-tempuh-card="high-contrast"]')).toBeNull();
    });

    it("[T80] puts the simplified language in place of a passage, and the simplified graphic in place of a picture", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("simplified-language-portions"), onSupport("simplified-graphics")]);
      expect(el(root.root, "#hard").textContent).toBe("The cat sat on the rug.");
      expect(el(root.root, "#pic").hasAttribute("hidden")).toBe(true);
      expect(el(root.root, '[data-tempuh-card="simplified-graphics"] img')).toBeTruthy();
    });

    it("[T80] gives the card of a choice for its face and keeps its control", async () => {
      const { root, supports } = await openSupported({
        body: '<div id="choice" data-catalog-idref="hard"><span class="tempuh-face">First</span></div>',
      });
      // The interaction draws the control before the face; the test stands in for it.
      const control = document.createElement("input");
      control.type = "radio";
      control.className = "tempuh-control";
      control.setAttribute("aria-label", "First");
      el(root.root, "#choice").prepend(control);
      supports.update([onSupport("simplified-language-portions")]);
      const choice = el(root.root, "#choice");
      expect(choice.querySelector("input")).toBe(control);
      expect(el(choice, ".tempuh-face").textContent).toBe("The cat sat on the rug.");
      supports.update([]);
      expect(el(choice, ".tempuh-face").textContent).toBe("First");
    });

    it("[T80] shows the card beside a control it cannot replace", async () => {
      const { root, supports } = await openSupported({ body: '<div id="holder" data-catalog-idref="hard"></div>' });
      const button = document.createElement("button");
      button.textContent = "Press";
      el(root.root, "#holder").append(button);
      supports.update([onSupport("simplified-language-portions")]);
      const holder = el(root.root, "#holder");
      expect(holder.querySelector("button")?.textContent).toBe("Press");
      expect(el(holder, '[data-tempuh-card="simplified-language-portions"]').textContent).toBe(
        "The cat sat on the rug.",
      );
    });
  });

  describe("cards beside the content", () => {
    it("[T81] shows the sign language video of the language of the support", async () => {
      const { root, supports } = await openSupported();
      supports.update([
        onSupport("sign-language", settings({ name: "sign-language", replaceAccessModes: [], language: "ins" })),
      ]);
      const card = el(root.root, '[data-tempuh-card="sign-language"]');
      expect(card.getAttribute("role")).toBe("group");
      expect(card.getAttribute("aria-label")).toBe("Sign language");
      expect(el(card, "video").getAttribute("src")).toBe(`${ASSETS}items/q1/media/sign-ins.mp4`);
      expect(el(card, "video").hasAttribute("controls")).toBe(true);
      supports.update([
        onSupport("sign-language", settings({ name: "sign-language", replaceAccessModes: [], language: "ase" })),
      ]);
      expect(el(root.root, '[data-tempuh-card="sign-language"] video').getAttribute("src")).toBe(
        `${ASSETS}items/q1/media/sign-ase.mp4`,
      );
    });

    it("[T81] shows no video when the catalog has no entry for the language and none is the default", async () => {
      const { root, supports } = await openSupported();
      supports.update([
        onSupport("sign-language", settings({ name: "sign-language", replaceAccessModes: [], language: "fr" })),
      ]);
      expect(root.root.querySelector('[data-tempuh-card="sign-language"]')).toBeNull();
    });

    it("[T82][SC 1.2.1] shows the transcript card of audio and video, in a group named Transcript", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("transcript")]);
      const cards = [...root.root.querySelectorAll('[data-tempuh-card="transcript"]')];
      expect(cards.map(({ textContent }) => textContent)).toEqual([
        "The transcript of the paragraph.",
        "The words of the clip.",
      ]);
      expect(cards.every((card) => card.getAttribute("aria-label") === "Transcript")).toBe(true);
      // The card of the video stands after it: a video has no content of its own to hold it.
      expect(el(root.root, "#clip").nextElementSibling).toBe(cards[1]);
    });

    it("[T82][SC 1.2.3][SC 1.2.5] shows the audio description card", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("audio-description")]);
      expect(el(root.root, '[data-tempuh-card="audio-description"]').textContent).toBe(
        "A description of the paragraph.",
      );
    });

    it("[T84] shows the alternative text of an image as text after it, and takes it away with the support", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("alternative-text")]);
      const picture = el(root.root, "#pic");
      const text = el(root.root, ".tempuh-alternative-text");
      expect(picture.nextElementSibling).toBe(text);
      expect(text.textContent).toBe("A dot");
      expect(text.getBoundingClientRect().height).toBeGreaterThan(1);
      supports.update([]);
      expect(root.root.querySelector(".tempuh-alternative-text")).toBeNull();
    });

    it("[T84] shows no alternative text for an image that is decoration", async () => {
      const { root, supports } = await openSupported({ body: '<div><img src="images/dot.png" alt=""/></div>' });
      supports.update([onSupport("alternative-text")]);
      expect(root.root.querySelector(".tempuh-alternative-text")).toBeNull();
    });

    it("[T84] hides the long description from sight and leaves it to assistive technology, unless the profile shows it", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("long-description")]);
      const description = el(root.root, '[data-tempuh-card="long-description"] qti-html-content');
      expect(description.classList.contains("qti-visually-hidden")).toBe(true);
      const hidden = description.getBoundingClientRect();
      expect([hidden.width, hidden.height]).toEqual([1, 1]);
      expect(description.closest('[aria-hidden="true"]')).toBeNull();
      expect(computed(description, "display")).not.toBe("none");
      supports.update([
        onSupport(
          "long-description",
          settings({ name: "long-description", replaceAccessModes: [], hideVisually: false }),
        ),
      ]);
      const shown = el(root.root, '[data-tempuh-card="long-description"] qti-html-content');
      expect(shown.classList.contains("qti-visually-hidden")).toBe(false);
      expect(shown.getBoundingClientRect().height).toBeGreaterThan(1);
    });

    it("[T83] gives the text of a braille card to the screen reader, and the file to take for embossing", async () => {
      const { root, supports } = await openSupported();
      supports.update([
        onSupport("braille", settings({ name: "braille", replaceAccessModes: [], deliveryMode: "refreshable" })),
      ]);
      const card = el(root.root, '[data-tempuh-card="braille"]');
      expect(el(card, "qti-html-content").classList.contains("qti-visually-hidden")).toBe(true);
      expect(card.textContent).toContain("⠉⠁⠞");
      const link = el<HTMLAnchorElement>(card, "a");
      expect(link.getAttribute("href")).toBe(`${ASSETS}items/q1/files/rug.brf`);
      expect(link.getBoundingClientRect().height).toBeGreaterThan(1);
    });

    it("[T83] shows the braille text too when the delivery is embossed", async () => {
      const { root, supports } = await openSupported();
      supports.update([
        onSupport("braille", settings({ name: "braille", replaceAccessModes: [], deliveryMode: "embossed" })),
      ]);
      expect(
        el(root.root, '[data-tempuh-card="braille"] qti-html-content').classList.contains("qti-visually-hidden"),
      ).toBe(false);
    });

    it("[T83] offers the file of a tactile card", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("tactile")]);
      const card = el(root.root, '[data-tempuh-card="tactile"]');
      expect(card.getAttribute("aria-label")).toBe("Tactile");
      expect(el(card, "a").getAttribute("href")).toBe(`${ASSETS}items/q1/files/rug-tactile.pdf`);
    });

    it("[T82][T84][T83][T81] passes axe with every card beside the content", async () => {
      const { host, supports } = await openSupported();
      supports.update([
        onSupport("sign-language", settings({ name: "sign-language", replaceAccessModes: [], language: "ase" })),
        onSupport("transcript"),
        onSupport("audio-description"),
        onSupport("captions"),
        onSupport("alternative-text"),
        onSupport("long-description"),
        onSupport("braille"),
        onSupport("tactile"),
      ]);
      expect(await axeViolations(host)).toEqual([]);
    });
  });

  describe("text tracks", () => {
    const tracks = (root: ParentNode): Record<string, TextTrackMode> =>
      Object.fromEntries([...root.querySelectorAll("track")].map((track) => [track.kind, track.track.mode]));

    it("[T82][SC 1.2.2] shows the captions track of the media when the captions are on, and gives the mode back when they go", async () => {
      const { root, supports } = await openSupported();
      const before = tracks(root.root);
      supports.update([onSupport("captions")]);
      expect(tracks(root.root)).toEqual({ ...before, captions: "showing" });
      supports.update([]);
      expect(tracks(root.root)).toEqual(before);
    });

    it("[T82][SC 1.2.3] shows the description track when the audio description is on", async () => {
      const { root, supports } = await openSupported();
      supports.update([onSupport("audio-description")]);
      expect(tracks(root.root).descriptions).toBe("showing");
      expect(tracks(root.root).captions).not.toBe("showing");
    });

    it("[T82] leaves the chapters alone", async () => {
      const { root, supports } = await openSupported();
      const before = tracks(root.root).chapters;
      supports.update([onSupport("captions"), onSupport("audio-description")]);
      expect(tracks(root.root).chapters).toBe(before);
    });
  });

  describe("updating", () => {
    it("replaces what an earlier call applied, and gives the content back on destroy", async () => {
      const { root, supports } = await openSupported();
      const original = root.root.innerHTML;
      const all = [glossary, onSupport("high-contrast"), onSupport("transcript"), onSupport("alternative-text")];
      supports.update(all);
      expect(root.root.innerHTML).not.toBe(original);
      supports.update(all);
      expect(root.root.querySelectorAll(".tempuh-card-trigger")).toHaveLength(1);
      supports.destroy();
      expect(root.root.innerHTML).toBe(original);
    });

    it("applies the supports again to the content of the next show", async () => {
      const { root, supports } = await openSupported();
      supports.update([glossary]);
      const { body, catalogs } = item();
      await root.show({ body: { nodes: body, base: ITEM_PATH }, catalogs });
      expect(root.root.querySelector(".tempuh-card-trigger")).toBeNull();
      supports.update([glossary]);
      expect(root.root.querySelectorAll(".tempuh-card-trigger")).toHaveLength(1);
    });

    it("rejects supports, a root and options of the wrong type", async () => {
      const { root, supports } = await openSupported();
      expect(() => supports.update(JSON.parse("{}"))).toThrow(
        new DataError("The list of supports is invalid: expected an array, found an object."),
      );
      expect(() => mountContentSupports(JSON.parse("null"), { messages: EN_MESSAGES })).toThrow(
        new DataError("The content root must be an object, found null."),
      );
      expect(() => mountContentSupports(JSON.parse('{"root": 1}'), { messages: EN_MESSAGES })).toThrow(
        new DataError("The root of the content root must be a shadow root, found 1."),
      );
      expect(() => mountContentSupports(root, JSON.parse("null"))).toThrow(
        new DataError("The options must be an object, found null."),
      );
      expect(() => mountContentSupports(root, { messages: EN_MESSAGES, ...JSON.parse('{"extra": 1}') })).toThrow(
        new DataError('The options has the property "messages", found "extra".'),
      );
    });
  });
});

describe("mountSpoken", () => {
  const BodyText =
    '<p id="a">Read this text.</p><p id="b" data-qti-suppress-tts="computer-read-aloud">Not for the voice.</p><p id="c" data-qti-suppress-tts="screen-reader">Not for the screen reader.</p>';

  /** A voice that records what it is asked to say. */
  function fakeVoice(): SpeechHook & { readonly requests: SpeechRequest[]; stops: number } {
    const voice = {
      requests: [] as SpeechRequest[],
      stops: 0,
      speak: async (request: SpeechRequest) => {
        voice.requests.push(request);
      },
      stop: () => {
        voice.stops += 1;
      },
    };
    return voice;
  }

  async function open(body = BodyText, voice = fakeVoice(), messages = EN_MESSAGES) {
    const { root } = await openRoot({ body });
    const chrome = tracked(document.createElement("div"));
    const spoken = mountSpoken(chrome, root, { messages, language: "en", voice });
    cleanups.push(() => spoken.destroy());
    return { root, chrome, spoken, voice };
  }

  const reading = (settings: Partial<Extract<SupportSetting, { name: "spoken" }>> = {}): SupportView =>
    onSupport("spoken", {
      name: "spoken",
      replaceAccessModes: [],
      restrictionTypes: [],
      readingType: "computer-read-aloud",
      ...settings,
    });

  it("[T85] shows the controls and reads the content with the voice, with the rate, pitch and volume of the support", async () => {
    const { chrome, spoken, voice } = await open();
    spoken.update([reading({ speechRate: 240, pitch: 0.4, volume: 0.8 })]);
    const group = el(chrome, ".tempuh-read-aloud");
    expect(group.hidden).toBe(false);
    expect(group.getAttribute("aria-label")).toBe("Spoken");
    await userEvent.click(buttonOf(chrome, "Read aloud"));
    expect(voice.requests).toHaveLength(1);
    expect(voice.requests[0]).toMatchObject({
      text: expect.stringContaining("Read this text."),
      lang: "en",
      rate: 240,
      pitch: 0.4,
      volume: 0.8,
    });
    // data-qti-suppress-tts keeps the passage away from the voice (VOCAB §1.1.1.3).
    expect(voice.requests[0]?.text).not.toContain("Not for the voice.");
  });

  it("[T85] stops the voice when the candidate asks, and when the support goes", async () => {
    const { chrome, spoken, voice } = await open();
    spoken.update([reading()]);
    await userEvent.click(buttonOf(chrome, "Stop reading"));
    expect(voice.stops).toBe(1);
    spoken.update([]);
    expect(voice.stops).toBe(2);
    expect(el(chrome, ".tempuh-read-aloud").hidden).toBe(true);
    spoken.update([]);
    expect(voice.stops).toBe(2);
  });

  it("[T85] has no controls for the screen reader, which is also the reading type when the support names none, and hides what it suppresses", async () => {
    const { root, chrome, spoken } = await open();
    spoken.update([onSupport("spoken")]);
    expect(el(chrome, ".tempuh-read-aloud").hidden).toBe(true);
    expect(el(root.root, "#c").getAttribute("aria-hidden")).toBe("true");
    expect(el(root.root, "#b").hasAttribute("aria-hidden")).toBe(false);
    spoken.update([reading()]);
    expect(el(root.root, "#c").hasAttribute("aria-hidden")).toBe(false);
    spoken.update([]);
    expect(el(root.root, "#c").hasAttribute("aria-hidden")).toBe(false);
  });

  it("[T85] says that there is nothing to read, and that the voice failed", async () => {
    const failing = fakeVoice();
    failing.speak = async () => {
      throw new Error("The voice is gone.");
    };
    const { chrome, spoken, voice } = await open('<p data-qti-suppress-tts="computer-read-aloud">Silent.</p>', failing);
    spoken.update([reading()]);
    await userEvent.click(buttonOf(chrome, "Read aloud"));
    expect(el(chrome, "output").textContent).toBe("There is nothing to read.");
    expect(voice.requests).toEqual([]);
    const second = await open("<p>Loud.</p>", failing);
    second.spoken.update([reading()]);
    const errors: unknown[] = [];
    const catcher = (event: ErrorEvent): void => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", catcher);
    await userEvent.click(buttonOf(second.chrome, "Read aloud"));
    await vi.waitFor(() => expect(el(second.chrome, "output").textContent).toBe("The voice could not read this."));
    window.removeEventListener("error", catcher);
    expect(errors).toHaveLength(1);
  });

  it("[T85] reads word by word with the buttons for the previous and the next word, and skips what the voice leaves out", async () => {
    const { chrome, spoken, voice } = await open(
      '<p>One two <span data-qti-suppress-tts="computer-read-aloud">hidden</span> three.</p>',
    );
    spoken.update([reading({ restrictionTypes: ["word-by-word"] })]);
    const said = (): string[] => voice.requests.map(({ text }) => text);
    await userEvent.click(buttonOf(chrome, "Next word"));
    await userEvent.click(buttonOf(chrome, "Next word"));
    await userEvent.click(buttonOf(chrome, "Next word"));
    expect(said()).toEqual(["One", "two", "three."]);
    expect(el(chrome, "output").textContent).toBe("three.");
    await userEvent.click(buttonOf(chrome, "Previous word"));
    await userEvent.click(buttonOf(chrome, "Read aloud"));
    expect(said().slice(3)).toEqual(["two", "two"]);
    await userEvent.click(buttonOf(chrome, "Next word"));
    await userEvent.click(buttonOf(chrome, "Next word"));
    expect(el(chrome, "output").textContent).toBe("There is nothing to read.");
    await userEvent.click(buttonOf(chrome, "Previous word"));
    expect(said().at(-1)).toBe("two");
  });

  it("[T85] starts the word cursor again when the content is replaced", async () => {
    const { root, chrome, spoken, voice } = await open("<p>One two.</p>");
    spoken.update([reading({ restrictionTypes: ["word-by-word"] })]);
    await userEvent.click(buttonOf(chrome, "Next word"));
    await userEvent.click(buttonOf(chrome, "Next word"));
    const { body, catalogs } = item("<p>Alpha beta.</p>", CATALOGS);
    await root.show({ body: { nodes: body, base: ITEM_PATH }, catalogs });
    spoken.update([reading({ restrictionTypes: ["word-by-word"] })]);
    await userEvent.click(buttonOf(chrome, "Next word"));
    expect(voice.requests.at(-1)?.text).toBe("Alpha");
  });

  it("[T85] echoes what the candidate types in a text field, as the typing echo says, and stops when the support goes", async () => {
    const { root, spoken, voice } = await open("<p>Type.</p>");
    const field = document.createElement("input");
    field.type = "text";
    field.setAttribute("aria-label", "Answer");
    el(root.root, ".tempuh-body").append(field);
    spoken.update([reading({ typingEcho: "characters" })]);
    field.focus();
    await userEvent.keyboard("ab");
    expect(voice.requests.map(({ text }) => text)).toEqual(["a", "b"]);
    spoken.update([reading({ typingEcho: "none" })]);
    await userEvent.keyboard("c");
    expect(voice.requests).toHaveLength(2);
  });

  it("[T96][SC 2.1.1] is operated by the keyboard alone, and by the pointer alone", async () => {
    const { chrome, spoken, voice } = await open();
    spoken.update([reading()]);
    buttonOf(chrome, "Read aloud").focus();
    await userEvent.keyboard("{Enter}");
    buttonOf(chrome, "Stop reading").focus();
    await userEvent.keyboard(" ");
    expect([voice.requests.length, voice.stops]).toEqual([1, 1]);
    await userEvent.click(buttonOf(chrome, "Read aloud"));
    expect(voice.requests).toHaveLength(2);
  });

  it("[T85][SC 4.1.2][SC 2.5.8] has named controls of at least 24 by 24 pixels that pass axe", async () => {
    const { chrome, spoken } = await open();
    spoken.update([reading({ restrictionTypes: ["word-by-word"] })]);
    for (const button of chrome.querySelectorAll("button")) {
      const box = button.getBoundingClientRect();
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(24);
    }
    expect(await axeViolations(chrome)).toEqual([]);
  });

  it("[T97] names the controls in the language of the interface", async () => {
    const { chrome, spoken } = await open(BodyText, fakeVoice(), ID_MESSAGES);
    spoken.update([reading()]);
    expect([...chrome.querySelectorAll("button")].map(({ textContent }) => textContent)).toEqual([
      "Bacakan",
      "Hentikan pembacaan",
    ]);
  });

  it("takes the controls away and gives the content back on destroy", async () => {
    const { root, chrome, spoken } = await open();
    spoken.update([onSupport("spoken")]);
    expect(el(root.root, "#c").getAttribute("aria-hidden")).toBe("true");
    spoken.destroy();
    expect(chrome.querySelector(".tempuh-read-aloud")).toBeNull();
    expect(el(root.root, "#c").hasAttribute("aria-hidden")).toBe(false);
  });

  it("rejects a host, a root, options and supports of the wrong type", async () => {
    const { root, chrome, spoken } = await open();
    const valid = { messages: EN_MESSAGES, language: "en", voice: fakeVoice() };
    expect(() => mountSpoken(JSON.parse("null"), root, valid)).toThrow(
      new DataError("The host must be an element in a document, found null."),
    );
    expect(() => mountSpoken(chrome, JSON.parse("null"), valid)).toThrow(
      new DataError("The content root must be an object, found null."),
    );
    expect(() => mountSpoken(chrome, root, { ...valid, language: JSON.parse("1") })).toThrow(
      new DataError("The option language must be a non-empty string, found 1."),
    );
    expect(() => mountSpoken(chrome, root, { ...valid, voice: JSON.parse("{}") })).toThrow(
      new DataError("The method speak of the option voice must be a function, found undefined."),
    );
    expect(() => mountSpoken(chrome, root, { ...valid, lexicons: JSON.parse("{}") })).toThrow(
      new DataError("The option lexicons must be an array, found an object."),
    );
    expect(() => spoken.update(JSON.parse("{}"))).toThrow(
      new DataError("The list of supports is invalid: expected an array, found an object."),
    );
    expect(() => spoken.update([reading({ pitch: 2 })])).toThrow(
      new DataError("The pitch must be a number from 0 to 1, found 2."),
    );
  });
});

describe("mountVariantNotice", () => {
  const mountNotice = (language = "en", messages = EN_MESSAGES) => {
    const host = tracked(document.createElement("div"));
    const notice = mountVariantNotice(host, { messages, language });
    cleanups.push(() => notice.destroy());
    return { host, notice };
  };

  it("[T74] says nothing when the question itself is delivered", () => {
    const { host, notice } = mountNotice();
    notice.update(undefined);
    expect(el(host, "p").hidden).toBe(true);
    expect(el(host, "p").textContent).toBe("");
  });

  it("[T74] names the language of the delivered variant, in the language of the interface and marked as the language it names", () => {
    const { host, notice } = mountNotice("en");
    notice.update({ resource: "q1-id", language: "id" });
    const paragraph = el(host, "p");
    expect(paragraph.hidden).toBe(false);
    expect(paragraph.textContent).toBe("Language of this version: Indonesian");
    expect(el(paragraph, "span").getAttribute("lang")).toBe("id");
    notice.update({ resource: "q1-fr", language: "fr-CA" });
    expect(paragraph.textContent).toBe("Language of this version: Canadian French");
  });

  it("[T74][T97] names the language in Indonesian when that is the language of the interface", () => {
    const { host, notice } = mountNotice("id", ID_MESSAGES);
    notice.update({ resource: "q1-en", language: "en" });
    expect(el(host, "p").textContent).toBe("Bahasa versi ini: Inggris");
  });

  it("[T74] says that an adapted version is shown when the resource names no language, and takes it back", () => {
    const { host, notice } = mountNotice();
    notice.update({ resource: "q1-large-print" });
    expect(el(host, "p").textContent).toBe("An adapted version of this question is shown.");
    notice.update(undefined);
    expect(el(host, "p").hidden).toBe(true);
  });

  it("[T74] gives the tag when the browser has no name for it", () => {
    const { host, notice } = mountNotice();
    notice.update({ resource: "q1-x", language: "x-klingon-invalid-tag-12345678901" });
    expect(el(host, "span").textContent).toBe("x-klingon-invalid-tag-12345678901");
  });

  it("[T74][SC 3.1.2][SC 1.4.3] marks the language of the part and passes axe", async () => {
    const { host, notice } = mountNotice();
    notice.update({ resource: "q1-id", language: "id" });
    expect(await axeViolations(host)).toEqual([]);
  });

  it("rejects a host, options and a variant of the wrong type", () => {
    const host = tracked(document.createElement("div"));
    expect(() => mountVariantNotice(JSON.parse("null"), { messages: EN_MESSAGES, language: "en" })).toThrow(
      new DataError("The host must be an element in a document, found null."),
    );
    expect(() => mountVariantNotice(host, { messages: EN_MESSAGES, language: JSON.parse("1") })).toThrow(
      new DataError("The option language must be a non-empty string, found 1."),
    );
    const notice = mountVariantNotice(host, { messages: EN_MESSAGES, language: "en" });
    expect(() => notice.update(JSON.parse("1"))).toThrow(new DataError("The variant must be an object, found 1."));
    expect(() => notice.update(JSON.parse('{"resource": "r", "language": 1}'))).toThrow(
      new DataError("The language of the variant must be a non-empty string, found 1."),
    );
    notice.destroy();
  });
});

describe("supports and a media interaction", () => {
  const Tone = "items/q1/media/tone.wav";
  const MediaCatalog = `<qti-catalog id="clip">
    <qti-card support="audio-description"><qti-file-href mime-type="audio/wav">media/blip.wav</qti-file-href></qti-card>
    <qti-card support="transcript"><qti-html-content><p>A tone.</p></qti-html-content></qti-card>
  </qti-catalog>`;
  const MediaItem = `<qti-assessment-item ${NAMESPACE} identifier="m" title="m" adaptive="false" time-dependent="false">
    <qti-response-declaration identifier="R" cardinality="single" base-type="integer"/>
    <qti-item-body>
      <qti-media-interaction response-identifier="R" autostart="false" data-catalog-idref="clip">
        <qti-prompt>Listen to the tone.</qti-prompt>
        <audio><source src="media/tone.wav" type="audio/wav"/><track kind="captions" src="media/captions.vtt" srclang="en" label="English"/></audio>
      </qti-media-interaction>
    </qti-item-body>
    <qti-catalog-info>${MediaCatalog}</qti-catalog-info>
  </qti-assessment-item>`;

  /** Shows the item with the renderers of the interactions, sets the descriptors, and mounts the content supports. */
  async function open() {
    const parsed = readAsi(MediaItem);
    if (parsed.kind !== "item" || parsed.item.body === undefined) throw new Error("not an item");
    const host = tracked(document.createElement("div"));
    const root = createContentRoot(host, {
      messages: EN_MESSAGES,
      assets: (path) => `${ASSETS}${path}`,
      fetch: (url, request) => fetch(url, request),
      stylesheet: stylesheet(PLAYER_CSS),
      interactions: createInteractionRenderers({
        messages: EN_MESSAGES,
        files: { upload: () => Promise.reject(new Error("The test has no upload.")), url: () => "" },
        staticUrl: STATIC_URL,
      }),
    });
    cleanups.push(() => root.destroy());
    await root.show({
      body: { nodes: parsed.item.body.children, base: ITEM_PATH },
      catalogs: parsed.item.catalogInfo?.catalogs ?? [],
    });
    const descriptors = describeInteractions(parsed.item);
    for (const element of root.root.querySelectorAll("*")) {
      if (element instanceof InteractionElement) {
        const descriptor = descriptors.find(
          ({ responseIdentifier }) => responseIdentifier === element.responseIdentifier,
        );
        if (descriptor !== undefined) element.descriptor = descriptor;
      }
    }
    const supports = mountContentSupports(root, { messages: EN_MESSAGES });
    cleanups.push(() => supports.destroy());
    return { root, supports, recording: el<HTMLAudioElement>(root.root, "qti-media-interaction > audio") };
  }

  const barButton = (root: ParentNode, text: string): HTMLButtonElement =>
    buttonOf(el(root, ".tempuh-media-bar"), text);

  it("[T82][SC 1.2.2] shows the captions of the player when the support is on, and the button of the player follows", async () => {
    const { root, supports, recording } = await open();
    const [track] = recording.textTracks;
    expect(barButton(root.root, "Captions").getAttribute("aria-pressed")).toBe("false");
    supports.update([onSupport("captions")]);
    expect(track?.mode).toBe("showing");
    await vi.waitFor(() => expect(barButton(root.root, "Captions").getAttribute("aria-pressed")).toBe("true"));
    supports.update([]);
    await vi.waitFor(() => expect(barButton(root.root, "Captions").getAttribute("aria-pressed")).toBe("false"));
    expect(track?.mode).not.toBe("showing");
  });

  it("[T82] lets the candidate turn the captions off with the button of the player while the support is on", async () => {
    const { root, supports, recording } = await open();
    supports.update([onSupport("captions")]);
    await userEvent.click(barButton(root.root, "Captions"));
    expect(recording.textTracks[0]?.mode).toBe("hidden");
    expect(barButton(root.root, "Captions").getAttribute("aria-pressed")).toBe("false");
  });

  it("[T82] shows the transcript inside the interaction, after the player", async () => {
    const { root, supports } = await open();
    supports.update([onSupport("transcript")]);
    const card = el(root.root, "qti-media-interaction > [data-tempuh-card='transcript']");
    expect(card.textContent).toBe("A tone.");
    expect(card.previousElementSibling).not.toBeNull();
  });

  it("[T82] makes the audio of a description follow the player, with no controls and no sound of its own", async (context) => {
    if (!(await audioPlaysToEnd(`${ASSETS}${Tone}`))) context.skip();
    const { root, supports, recording } = await open();
    supports.update([onSupport("audio-description")]);
    const companion = el<HTMLAudioElement>(root.root, "[data-tempuh-card='audio-description'] audio");
    expect(companion.hasAttribute("controls")).toBe(false);
    expect(companion.muted).toBe(true);
    expect(companion.paused).toBe(true);
    await userEvent.click(barButton(root.root, "Play"));
    await vi.waitFor(() => expect(companion.paused).toBe(false));
    await userEvent.click(barButton(root.root, "Pause"));
    await vi.waitFor(() => expect(companion.paused).toBe(true));
    expect(recording.paused).toBe(true);
  });

  it("[T82] gives the audio of the card its controls and its sound back when the support goes", async () => {
    const { root, supports } = await open();
    supports.update([onSupport("audio-description")]);
    supports.update([]);
    expect(root.root.querySelector("[data-tempuh-card='audio-description']")).toBeNull();
    supports.update([onSupport("audio-description")]);
    supports.destroy();
    expect(root.root.querySelector("[data-tempuh-card='audio-description']")).toBeNull();
  });

  it("[T82][SC 4.1.2][SC 1.4.3] passes axe with the captions on and the cards beside the player", async () => {
    const { root, supports } = await open();
    supports.update([onSupport("captions"), onSupport("transcript"), onSupport("audio-description")]);
    expect(await axeViolations(el(root.root, "qti-media-interaction"))).toEqual([]);
  });
});

describe("the supports with olah's engine", () => {
  const Profile = `<access-for-all-pnp xmlns="http://www.imsglobal.org/xsd/qti/qtiv3p0/imsafa3p0pnp_v1p0">
    <glossary-on-screen/><high-contrast/><magnification/>
    <activate-as-option-set><glossary-on-screen/><high-contrast/></activate-as-option-set>
    <prohibit-set><magnification/></prohibit-set>
  </access-for-all-pnp>`;

  it("[T75][T76][T79] turns a support on from the panel, applies it to the next view, and refuses what the profile prohibits", async () => {
    const document_ = readAsi(
      `<qti-assessment-item ${NAMESPACE} identifier="e" title="E" adaptive="false" time-dependent="false">
         <qti-item-body><p id="term" data-catalog-idref="photo">photosynthesis</p></qti-item-body>
         <qti-catalog-info>${CATALOGS}</qti-catalog-info>
       </qti-assessment-item>`,
    );
    if (document_.kind !== "item") throw new Error("not an item");
    const engine = createEngine({ kind: "item", item: document_.item, base: "item.xml" });
    const profile = readPnp(Profile);
    if (!("supports" in profile)) throw new Error("Expected one profile.");
    const started = engine.start({ seed: 1, at: 0, pnp: profile });
    if (!started.ok) throw new Error(started.refusal.message);
    let state: DeliveryState = started.state;
    let clock = 0;

    const { host, root } = await openRoot();
    const chrome = tracked(document.createElement("div"));
    const contentSupports = mountContentSupports(root, { messages: EN_MESSAGES });
    const refusals: string[] = [];
    const render = async (): Promise<void> => {
      const view = engine.view(state, clock);
      const current = view.current;
      if (current === undefined) throw new Error("The item is presented.");
      await root.show({ body: { nodes: current.body, base: "item.xml" }, catalogs: current.catalogs });
      applyPresentation(host, presentationOf(view.supports));
      panel.update(view.supports);
      contentSupports.update(view.supports);
    };
    const panel = mountSupportPanel(chrome, {
      messages: EN_MESSAGES,
      onSupport: (name, active) => {
        clock += 10;
        const step = engine.apply(state, stamp(state, { type: "support", name, active }, clock));
        if (step.ok) state = step.state;
        else refusals.push(step.refusal.code);
        void render();
      },
    });
    cleanups.push(() => {
      panel.destroy();
      contentSupports.destroy();
    });
    await render();

    // The glossary and high contrast are options; magnification is prohibited and has no button.
    expect(
      [...chrome.querySelectorAll("button")].map(({ textContent }) => [
        textContent,
        el(chrome, "button").getAttribute("aria-pressed"),
      ]),
    ).toEqual([
      ["Glossary", "false"],
      ["High contrast", "false"],
    ]);
    expect(root.root.querySelector(".tempuh-card-trigger")).toBeNull();

    await userEvent.click(buttonOf(chrome, "Glossary"));
    await vi.waitFor(() => expect(buttonOf(chrome, "Glossary").getAttribute("aria-pressed")).toBe("true"));
    await vi.waitFor(() => expect(root.root.querySelectorAll(".tempuh-card-trigger")).toHaveLength(1));

    await userEvent.click(buttonOf(chrome, "High contrast"));
    await vi.waitFor(() => expect(host.getAttribute("data-tempuh-contrast")).toBe("high"));
    expect(computed(el(root.root, "#term"), "color")).toBe("rgb(0, 0, 0)");

    await userEvent.click(buttonOf(chrome, "High contrast"));
    await vi.waitFor(() => expect(host.hasAttribute("data-tempuh-contrast")).toBe(false));

    // A request for a prohibited support is refused by the engine, and the next view is as it was.
    clock += 10;
    const refused = engine.apply(state, stamp(state, { type: "support", name: "magnification", active: true }, clock));
    expect(refused.ok).toBe(false);
    expect(refusals).toEqual([]);
    expect(host.style.getPropertyValue("--tempuh-text-zoom")).toBe("");
  });
});
