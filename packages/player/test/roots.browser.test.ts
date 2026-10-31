import { readAsi } from "@assesskit/runtime/asi";
import { AssesskitError, DataError } from "@assesskit/runtime/errors";
import { afterEach, describe, expect, inject, it } from "vitest";
import { page } from "vitest/browser";
import { EN_MESSAGES } from "../src/index.js";
import { type ContentRootOptions, createContentRoot, createMathTypesetter } from "../src/player/index.js";
import { sanitizeStylesheet } from "../src/player/roots/internal.js";
import { computed, PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { axeViolations, ITEM_PATH, itemBody } from "./renderer-fixture.js";

const { asset, stranger } = inject("fixtures");

/** The browsers of a run share the servers, so this file names its paths with a token of its own. */
const TOKEN = crypto.randomUUID();
const ASSETS = `${asset}/content/${TOKEN}/`;
const ITEM_DIRECTORY = `${ASSETS}items/q1/`;
const MATHJAX = `${asset}/mathjax/${TOKEN}/mml-chtml.js`;

/** Returns the paths that a server was asked for below this file's token. */
async function hits(origin: string): Promise<string[]> {
  const paths: string[] = await (await fetch(`${origin}/__hits`, { cache: "no-store" })).json();
  return paths.filter((path) => path.includes(`/${TOKEN}/`));
}

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** What a fake fetch answers: the text of a stylesheet, or a status. */
type Reply = string | number | Error;

/** Makes a `fetch` that answers by path from a table, and records what it was asked. */
function fakeFetch(replies: Readonly<Record<string, Reply>>) {
  const requests: { readonly url: string; readonly request: unknown }[] = [];
  const fetcher: ContentRootOptions["fetch"] = async (url, request) => {
    requests.push({ url, request });
    const reply = replies[new URL(url).pathname.replace(`/content/${TOKEN}/`, "")];
    if (reply instanceof Error) throw reply;
    const status = typeof reply === "number" ? reply : reply === undefined ? 404 : 200;
    return { ok: status === 200, status, text: async () => (typeof reply === "string" ? reply : "") };
  };
  return { fetcher, requests };
}

/** Creates a content root in a host that the page holds, with the options of the tests. */
function createRoot(extra: Partial<ContentRootOptions> = {}, hostStyle = "") {
  const host = document.createElement("div");
  if (hostStyle !== "") host.setAttribute("style", hostStyle);
  document.body.append(host);
  hosts.push(host);
  const root = createContentRoot(host, {
    messages: EN_MESSAGES,
    assets: (path) => `${ASSETS}${path}`,
    fetch: (url, request) => fetch(url, request),
    stylesheet: stylesheet(PLAYER_CSS),
    ...extra,
  });
  return { host, root };
}

/** Returns the element of a root that matches, which must exist. */
function el(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`No element matches ${selector}.`);
  return found;
}

const nextFrame = (): Promise<unknown> => new Promise((done) => requestAnimationFrame(done));

/** Resizes the viewport and waits until the engine applies it to the layout and to the media queries. */
async function resize(width: number, height = 800): Promise<void> {
  await page.viewport(width, height);
  for (let frame = 0; frame < 60 && window.innerWidth !== width; frame++) await nextFrame();
  await nextFrame();
  await nextFrame();
}

describe("createContentRoot", () => {
  it("shows the rubric, the stimuli and the body in an open shadow root, in the order the candidate meets them", async () => {
    const { host, root } = createRoot();
    await root.show({
      rubric: { nodes: itemBody("<p>Read both texts.</p>") },
      stimuli: [{ nodes: itemBody("<p>Stimulus one.</p>") }, { nodes: itemBody("<p>Stimulus two.</p>") }],
      body: { nodes: itemBody("<p>The question.</p>") },
      language: "id",
    });
    expect(root.root).toBe(host.shadowRoot);
    expect(root.root.mode).toBe("open");
    const content = el(root.root, ".ak-content");
    expect(content.getAttribute("lang")).toBe("id");
    expect([...content.querySelectorAll("p")].map((paragraph) => paragraph.textContent)).toEqual([
      "Read both texts.",
      "Stimulus one.",
      "Stimulus two.",
      "The question.",
    ]);
    expect(content.querySelectorAll(".ak-stimulus")).toHaveLength(2);
    expect(el(content, ".ak-main").hasAttribute("data-ak-stimuli")).toBe(true);
  });

  it("sets a stimulus beside the item on a wide viewport and above it on a narrow one", async () => {
    const { root } = createRoot();
    await root.show({
      stimuli: [{ nodes: itemBody("<p>A passage that the item shares.</p>") }],
      body: { nodes: itemBody("<p>The question.</p>") },
    });
    const place = () => ({
      stimulus: el(root.root, ".ak-stimuli").getBoundingClientRect(),
      body: el(root.root, ".ak-body").getBoundingClientRect(),
    });
    await resize(1280);
    const wide = place();
    expect(wide.body.left).toBeGreaterThanOrEqual(wide.stimulus.right);
    expect(Math.abs(wide.body.top - wide.stimulus.top)).toBeLessThan(2);
    await resize(400);
    const narrow = place();
    expect(narrow.body.top).toBeGreaterThanOrEqual(narrow.stimulus.bottom);
    await resize(1280);
  });

  it("folds the columns of a layout row for the viewport of the moment when the host mounts the root again after a resize, with a sheet built from the same text", async () => {
    const columns = itemBody(
      "<div class='qti-layout-row'><div class='qti-layout-col6' id='a'>a</div><div class='qti-layout-col6' id='b'>b</div></div>",
    );
    // A host builds the sheet from the text of `player.css`, as the content guide shows, and the sheets of the earlier mounts
    // stay in memory. The fixture's `stylesheet` makes the text of each sheet its own, because WebKit gave the sheets of the
    // fixture's mounts the media queries of an earlier sheet in some runs; this test builds the sheets as a host does.
    const sheets: CSSStyleSheet[] = [];
    for (const [width, folded] of [
      [1280, false],
      [600, true],
      [1280, false],
      [400, true],
      [600, true],
      [1280, false],
      [767, true],
      [1280, false],
    ] as const) {
      await resize(width);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(PLAYER_CSS);
      sheets.push(sheet);
      const { host, root } = createRoot({ stylesheet: sheet });
      await root.show({ body: { nodes: columns } });
      const [a, b] = ["#a", "#b"].map((selector) => el(root.root, selector).getBoundingClientRect());
      expect(b?.left === a?.left, `${width} wide`).toBe(folded);
      root.destroy();
      host.remove();
    }
  });

  it("keeps the stimulus above the item when the candidate asks for a single column", async () => {
    const { host, root } = createRoot();
    host.setAttribute("data-ak-single-column", "");
    await root.show({
      stimuli: [{ nodes: itemBody("<p>A passage.</p>") }],
      body: { nodes: itemBody("<p>The question.</p>") },
    });
    await resize(1280);
    const stimulus = el(root.root, ".ak-stimuli").getBoundingClientRect();
    expect(el(root.root, ".ak-body").getBoundingClientRect().top).toBeGreaterThanOrEqual(stimulus.bottom);
  });

  it("replaces what it showed with the next content, and destroy leaves the root empty", async () => {
    const { root } = createRoot();
    await root.show({ body: { nodes: itemBody("<p>First.</p>") } });
    await root.show({ body: { nodes: itemBody("<p>Second.</p>") } });
    expect(root.root.querySelectorAll(".ak-content")).toHaveLength(1);
    expect(root.root.textContent).toBe("Second.");
    root.destroy();
    expect(root.root.childNodes).toHaveLength(0);
    expect(root.root.adoptedStyleSheets).toHaveLength(0);
  });

  it("renders each part against the document it comes from", async () => {
    const { root } = createRoot();
    await root.show({
      stimuli: [{ nodes: itemBody('<p><img src="images/dot.png" alt="s"/></p>'), base: "stimuli/s1/stimulus.xml" }],
      body: { nodes: itemBody('<p><img src="images/dot.png" alt="b"/></p>'), base: ITEM_PATH },
    });
    expect(el(root.root, ".ak-stimulus img").getAttribute("src")).toBe(`${ASSETS}stimuli/s1/images/dot.png`);
    expect(el(root.root, ".ak-body img").getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
  });

  it("contains layout and paint and isolates its stacking, so that a fixed element of the item stays in the root", async () => {
    const sheet = "p.fixed { position: fixed; top: 0; left: 0; width: 100%; height: 30px; z-index: 2147483647; }";
    const { host, root } = createRoot(
      { fetch: fakeFetch({ "items/q1/style/fixed.css": sheet }).fetcher },
      "margin: 120px 0 0 60px; width: 300px;",
    );
    await root.show({
      body: { nodes: itemBody('<p class="fixed">Fixed</p><p>Text</p>') },
      stylesheets: ["items/q1/style/fixed.css"],
    });
    expect(computed(host, "contain")).toBe("layout paint");
    expect(computed(host, "isolation")).toBe("isolate");
    const fixed = el(root.root, "p.fixed").getBoundingClientRect();
    const box = host.getBoundingClientRect();
    expect(fixed.top).toBeGreaterThanOrEqual(box.top);
    expect(fixed.left).toBeGreaterThanOrEqual(box.left);
    expect(fixed.right).toBeLessThanOrEqual(box.right + 1);
  });

  it("adopts player.css first and the stylesheets of the item after it, and the item's rules apply in the root only", async () => {
    const page_ = document.createElement("p");
    page_.textContent = "Page";
    document.body.append(page_);
    hosts.push(page_);
    const { root } = createRoot();
    await root.show({
      body: { nodes: itemBody('<p class="accent">Red</p><p class="wide">Green</p><p class="layered">Blue</p>') },
      stylesheets: ["items/q1/style/item.css"],
    });
    expect(root.root.adoptedStyleSheets).toHaveLength(2);
    const [first, second] = root.root.adoptedStyleSheets;
    expect(first?.cssRules.length).toBeGreaterThan(100);
    expect(second?.cssRules.length).toBeGreaterThan(3);
    expect(computed(el(root.root, ".accent"), "color")).toBe("rgb(200, 0, 0)");
    expect(computed(el(root.root, ".wide"), "color")).toBe("rgb(0, 128, 0)");
    expect(computed(el(root.root, ".layered"), "color")).toBe("rgb(0, 0, 200)");
    expect(computed(el(root.root, ".accent"), "letter-spacing")).toBe("3px");
    expect(computed(page_, "letter-spacing")).not.toBe("3px");
  });

  it("resolves a relative url() of the stylesheet against the stylesheet, and the browser loads the image", async () => {
    const { root } = createRoot();
    await root.show({
      body: { nodes: itemBody('<p class="picture">Picture</p>') },
      stylesheets: ["items/q1/style/item.css"],
    });
    expect(computed(el(root.root, ".picture"), "background-image")).toBe(`url("${ITEM_DIRECTORY}images/dot.png")`);
    await new Promise((done) => setTimeout(done, 200));
    expect(await hits(asset)).toContain(`/content/${TOKEN}/items/q1/images/dot.png`);
  });

  it("fetches a stylesheet without credentials or referrer, and once for any number of shows", async () => {
    const { fetcher, requests } = fakeFetch({ "items/q1/style/a.css": ".x { color: rgb(1, 2, 3); }" });
    const { root } = createRoot({ fetch: fetcher });
    const content = { body: { nodes: itemBody('<p class="x">x</p>') }, stylesheets: ["items/q1/style/a.css"] };
    await root.show(content);
    await root.show(content);
    expect(requests).toEqual([
      {
        url: `${ASSETS}items/q1/style/a.css`,
        request: { credentials: "omit", referrerPolicy: "no-referrer" },
      },
    ]);
    expect(computed(el(root.root, ".x"), "color")).toBe("rgb(1, 2, 3)");
  });

  it("shows the content and adopts the stylesheets that loaded when one cannot be fetched, and rejects with AssesskitError", async () => {
    const { fetcher, requests } = fakeFetch({
      "items/q1/style/ok.css": ".x { color: rgb(1, 2, 3); }",
      "items/q1/style/gone.css": 404,
      "items/q1/style/down.css": new TypeError("Failed to fetch"),
    });
    const { root } = createRoot({ fetch: fetcher });
    const shown = root.show({
      body: { nodes: itemBody('<p class="x">x</p>') },
      stylesheets: ["items/q1/style/gone.css", "items/q1/style/ok.css", "items/q1/style/down.css"],
    });
    await expect(shown).rejects.toThrow(AssesskitError);
    await expect(shown).rejects.toThrow(/^The stylesheet .*gone\.css could not be fetched: HTTP 404\.$/u);
    expect(root.root.textContent).toBe("x");
    expect(root.root.adoptedStyleSheets).toHaveLength(2);
    expect(computed(el(root.root, ".x"), "color")).toBe("rgb(1, 2, 3)");
    // A failure is not kept: the next show asks again.
    await expect(root.show({ stylesheets: ["items/q1/style/gone.css"] })).rejects.toThrow(AssesskitError);
    expect(requests.filter(({ url }) => url.endsWith("gone.css"))).toHaveLength(2);
  });

  it("follows a link to an id of the root by moving the focus there, and leaves the address of the page alone", async () => {
    const { root } = createRoot();
    await root.show({ body: { nodes: itemBody('<p><a href="#note">note</a></p><p id="note">The note.</p>') } });
    const before = location.href;
    el(root.root, "a").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
    expect(root.root.activeElement?.id).toBe("note");
    expect(location.href).toBe(before);
  });

  it("typesets the MathML of the root when it has a typesetter, with the styles that MathJax needs in the root", async () => {
    const { root } = createRoot({ typesetter: createMathTypesetter(MATHJAX) });
    await root.show({
      body: {
        nodes: itemBody("<p>Half of x is <m:math><m:mfrac><m:mi>x</m:mi><m:mn>2</m:mn></m:mfrac></m:math>.</p>"),
      },
    });
    expect(root.root.querySelector("math")).toBeNull();
    expect(el(root.root, "mjx-container mjx-frac")).not.toBeNull();
    expect(root.root.adoptedStyleSheets).toHaveLength(2);
    // The next content is typeset again after the root has reset its sheets.
    await root.show({ body: { nodes: itemBody("<p><m:math><m:mi>y</m:mi></m:math></p>") } });
    expect(el(root.root, "mjx-container mjx-mi mjx-c").getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("leaves the MathML to the browser when it has no typesetter", async () => {
    const { root } = createRoot();
    await root.show({ body: { nodes: itemBody("<p><m:math><m:mi>y</m:mi></m:math></p>") } });
    expect(el(root.root, "math > mi").textContent).toBe("y");
    expect(root.root.querySelector("mjx-container")).toBeNull();
  });
});

describe("hazards", () => {
  const Media = `<div><audio src="media/a.mp3">Audio alternative</audio></div>
    <div><video src="media/v.mp4">Video alternative</video></div>
    <p><object data="media/o.mp4" type="video/mp4">Object alternative</object>
    <object data="pages/note.html" type="text/html">Page alternative</object>
    <img src="images/anim.gif" alt="An animation"/><img src="images/dot.png" alt="A still"/></p>`;

  it("withholds the media, the animation and the sound of an item when a hazard that the candidate avoids remains, and says which", async () => {
    const { root } = createRoot();
    await root.show({
      body: { nodes: itemBody(Media) },
      hazards: [
        { hazard: "flashing", avoided: true },
        { hazard: "sound", avoided: false },
        { hazard: "motion-simulation", avoided: true },
      ],
    });
    expect(root.root.querySelector("audio, video, iframe, object")).toBeNull();
    expect(root.root.textContent).toContain("Audio alternative");
    expect(root.root.textContent).toContain("Video alternative");
    expect(root.root.textContent).toContain("Object alternative");
    expect(root.root.textContent).toContain("Page alternative");
    const images = [...root.root.querySelectorAll("img")];
    expect(images.map((image) => image.alt)).toEqual(["A still"]);
    expect(root.root.textContent).toContain("An animation");
    const notice = el(root.root, ".ak-hazards");
    expect(notice.getAttribute("role")).toBe("note");
    expect(notice.querySelector("p")?.textContent).toBe(EN_MESSAGES.hazardNotice);
    expect([...notice.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Flashing",
      "Simulated motion",
    ]);
    expect(notice.compareDocumentPosition(el(root.root, ".ak-main")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names a hazard in the language of the interface", async () => {
    const { root } = createRoot({ messages: { ...EN_MESSAGES, hazardSound: "Loud noise", hazardNotice: "A notice." } });
    await root.show({ body: { nodes: itemBody("<p>x</p>") }, hazards: [{ hazard: "sound", avoided: true }] });
    expect(el(root.root, ".ak-hazards p").textContent).toBe("A notice.");
    expect(el(root.root, ".ak-hazards li").textContent).toBe("Loud noise");
  });

  it("draws the media and no notice when the hazards of the content are not avoided or there are none", async () => {
    const { root } = createRoot();
    await root.show({ body: { nodes: itemBody(Media) }, hazards: [{ hazard: "flashing", avoided: false }] });
    expect(root.root.querySelector(".ak-hazards")).toBeNull();
    expect([...root.root.querySelectorAll("audio, video, iframe, img")].map((element) => element.localName)).toEqual([
      "audio",
      "video",
      "video",
      "iframe",
      "img",
      "img",
    ]);
    await root.show({ body: { nodes: itemBody(Media) } });
    expect(root.root.querySelector(".ak-hazards")).toBeNull();
  });

  it("gives a notice for a hazard that has nothing to withhold, such as a smell", async () => {
    const { root } = createRoot();
    await root.show({ body: { nodes: itemBody(Media) }, hazards: [{ hazard: "olfactory-hazard", avoided: true }] });
    expect([...root.root.querySelectorAll(".ak-hazards li")].map((item) => item.textContent)).toEqual(["Smell"]);
  });
});

describe("feedback and rubric in a root", () => {
  const TestFeedback = (title: string) =>
    `<qti-test-feedback outcome-identifier="FB" identifier="done" show-hide="show" access="atEnd"${title}><qti-content-body><p>You finished the test.</p></qti-content-body></qti-test-feedback>`;

  it("shows the test feedback that the view gives after the item, in a region of its own with its title", async () => {
    const { root } = createRoot();
    const read = readAsi(
      `<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="t" title="t">
         <qti-outcome-declaration identifier="FB" cardinality="single" base-type="identifier"/>
         <qti-test-part identifier="p" navigation-mode="linear" submission-mode="individual">
           <qti-assessment-section identifier="s" title="s" visible="true"/>
           ${TestFeedback(' title="Result"')}
         </qti-test-part>
       </qti-assessment-test>`,
    );
    expect(read.kind).toBe("test");
    const feedback = read.kind === "test" ? (read.test.testParts[0]?.testFeedback ?? []) : [];
    expect(feedback).toHaveLength(1);
    await root.show({ body: { nodes: itemBody("<p>The last question.</p>") }, testFeedback: feedback });
    const region = el(root.root, ".ak-test-feedback");
    expect(region.getAttribute("aria-label")).toBe("Feedback");
    expect(region.querySelector("h2")?.textContent).toBe("Result");
    expect(region.querySelector("qti-test-feedback > p")?.textContent).toBe("You finished the test.");
    expect(region.compareDocumentPosition(el(root.root, ".ak-body")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(getComputedStyle(el(region, "qti-test-feedback")).display).toBe("block");
  });

  it("shows the rubric of the test before the item, for the view of the renderer", async () => {
    const { root } = createRoot();
    const rubric = (view: string) =>
      `<qti-rubric-block view="${view}" use="instructions"><qti-content-body><p>For ${view}.</p></qti-content-body></qti-rubric-block>`;
    await root.show({ rubric: { nodes: itemBody(`${rubric("candidate")}${rubric("scorer")}`) } });
    expect([...root.root.querySelectorAll(".ak-rubric p")].map((paragraph) => paragraph.textContent)).toEqual([
      "For candidate.",
    ]);
  });

  it("passes axe for a root with a rubric, a stimulus, an item with an image, a table, a hazard notice and feedback", async () => {
    const { host, root } = createRoot();
    await root.show({
      rubric: {
        nodes: itemBody(
          '<qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>Directions.</p></qti-content-body></qti-rubric-block>',
        ),
      },
      stimuli: [{ nodes: itemBody('<p>Passage <img src="images/dot.png" alt="A dot"/></p>') }],
      body: {
        nodes: itemBody(
          '<h1>Question</h1><table><caption>Data</caption><thead><tr><th scope="col">A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p lang="fr">Bonjour</p>',
        ),
      },
      hazards: [{ hazard: "flashing", avoided: true }],
      language: "en",
    });
    expect(await axeViolations(host)).toEqual([]);
  });
});

describe("themes", () => {
  const Themes: readonly Readonly<Record<string, string>>[] = [
    {},
    { "data-ak-polarity": "inverted" },
    { "data-ak-contrast": "high" },
    { "data-ak-contrast": "high", "data-ak-polarity": "inverted" },
  ];

  it("keeps the contrast of the hazard notice, the rubric and the test feedback in every theme", async () => {
    const { host, root } = createRoot();
    await root.show({
      rubric: {
        nodes: itemBody(
          '<qti-rubric-block view="candidate" use="instructions"><qti-content-body><p>Directions.</p></qti-content-body></qti-rubric-block>',
        ),
      },
      body: { nodes: itemBody("<p>The question.</p>") },
      hazards: [{ hazard: "flashing", avoided: true }],
    });
    for (const theme of Themes) {
      for (const [name, value] of Object.entries(theme)) host.setAttribute(name, value);
      expect(await axeViolations(host), JSON.stringify(theme)).toEqual([]);
      for (const name of Object.keys(theme)) host.removeAttribute(name);
    }
  });

  it("keeps the contrast of the dialog in every theme", async () => {
    const { host, root } = createRoot();
    await root.show({ body: { nodes: itemBody("<p>The question.</p>") } });
    const document_ = readAsi(
      '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="f" title="f" adaptive="false" time-dependent="false"><qti-item-body><p>Q</p></qti-item-body><qti-modal-feedback outcome-identifier="FB" identifier="a" show-hide="show" title="Result"><qti-content-body><p>Feedback text.</p></qti-content-body></qti-modal-feedback></qti-assessment-item>',
    );
    const feedback = document_.kind === "item" ? document_.item.modalFeedback : [];
    for (const theme of Themes) {
      for (const [name, value] of Object.entries(theme)) host.setAttribute(name, value);
      const closed = root.showFeedback(feedback);
      expect(await axeViolations(host), JSON.stringify(theme)).toEqual([]);
      root.root.querySelector("dialog")?.close();
      await closed;
      for (const name of Object.keys(theme)) host.removeAttribute(name);
    }
  });
});

describe("hostile stylesheets", () => {
  const url = (name: string): string => `${stranger}/${TOKEN}/${name}`;
  const Hostile = `@import url("${url("import.css")}");
@import "relative.css";
:host { position: fixed; inset: 0; contain: none; background: red; }
:host(.x) { color: red; }
:host-context(body) { color: red; }
::slotted(p) { color: red; }
.keep { color: rgb(1, 2, 3); }
.rel { background-image: url(../images/dot.png); }
.png { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQizoBAAHaAUGizqgqAAAAAElFTkSuQmCC); }
.ext { background: url(${url("ext.png")}); }
.esc { background: u\\72l(${url("esc.png")}); }
.esc2 { background-image: \\75 rl("${url("esc2.png")}"); }
.set { background-image: image-set("${url("set.png")}" 1x); }
.fade { background-image: cross-fade(url(${url("fade.png")}) 50%, url(${url("fade2.png")}) 50%); }
.var { --x: url(${url("var.png")}); background: var(--x); }
.var2 { --y: u\\72l(${url("var2.png")}); background: var(--y); }
.fb { background: var(--nothing, u\\72l(${url("fb.png")})); }
.svg { background: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"); }
.content::before { content: url(${url("content.png")}); }
.cursor { cursor: url(${url("cur.png")}), auto; }
.list { list-style-image: url(${url("li.png")}); }
.mask { mask-image: url(${url("mask.png")}); -webkit-mask-image: url(${url("mask2.png")}); }
.border { border-image-source: url(${url("border.png")}); }
@font-face { font-family: Hostile; src: url(${url("font.woff2")}); }
@property --p { syntax: "<url>"; inherits: false; initial-value: url(${url("prop.png")}); }
@media (min-width: 1px) { .m { background: url(${url("m.png")}); } .mk { color: rgb(9, 9, 9); } }
@supports (display: grid) { .s { background: url(${url("s.png")}); } .sk { color: rgb(8, 8, 8); } }
@layer l { .l { background: url(${url("l.png")}); } .lk { color: rgb(7, 7, 7); } }
@container (min-width: 1px) { .c { background: url(${url("c.png")}); } }
@keyframes k { from { background: url(${url("k.png")}); } to { color: rgb(6, 6, 6); } }
@page { background: url(${url("page.png")}); }
@namespace svg url(http://www.w3.org/2000/svg);
`;
  const Classes = [
    "keep",
    "rel",
    "png",
    "ext",
    "esc",
    "esc2",
    "set",
    "fade",
    "var",
    "var2",
    "fb",
    "svg",
    "content",
    "cursor",
    "list",
    "mask",
    "border",
    "m",
    "mk",
    "s",
    "sk",
    "l",
    "lk",
    "c",
  ];
  const policy = { url: `${ITEM_DIRECTORY}style/hostile.css`, origins: new Set<string>() };

  it("ignores an @import when it builds the sheet from text, in every engine", () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('@import url("https://example.invalid/x.css"); @import "y.css"; p { color: rgb(1, 2, 3); }');
    expect([...sheet.cssRules].some((rule) => rule instanceof CSSImportRule)).toBe(false);
    expect([...sheet.cssRules].map((rule) => rule.constructor.name)).toEqual(["CSSStyleRule"]);
  });

  it("writes a relative url() as the absolute URL against the stylesheet, which Chromium does not do for baseURL", () => {
    const sheet = sanitizeStylesheet(
      ".x { background-image: url(../images/dot.png); } @media (min-width: 1px) { .y { border-image-source: url(f.png); } }",
      policy,
    );
    const [rule, media] = [...sheet.cssRules];
    expect(rule instanceof CSSStyleRule ? rule.style.getPropertyValue("background-image") : "").toBe(
      `url("${ITEM_DIRECTORY}images/dot.png")`,
    );
    const inner = media instanceof CSSMediaRule ? media.cssRules[0] : undefined;
    expect(inner instanceof CSSStyleRule ? inner.style.getPropertyValue("border-image-source") : "").toBe(
      `url("${ITEM_DIRECTORY}style/f.png")`,
    );
  });

  it("removes imports, rules for the host, and every url() and loader that leaves the origin of the sheet", () => {
    const sheet = sanitizeStylesheet(Hostile, policy);
    const text = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
    for (const forbidden of [
      new URL(stranger).host,
      "@import",
      ":host",
      "::slotted",
      "image-set",
      "cross-fade",
      "@property",
      "@font-face",
      "@page",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(text).toContain("rgb(1, 2, 3)");
    expect(text).toContain(`${ITEM_DIRECTORY}images/dot.png`);
    expect(text).toContain("data:image/png;base64");
    expect(text).toContain("rgb(9, 9, 9)");
    expect(text).toContain("rgb(8, 8, 8)");
    expect(text).toContain("rgb(7, 7, 7)");
    expect(text).toContain("rgb(6, 6, 6)");
    expect(text).not.toContain("svg+xml");
    expect(text).not.toContain("src:");
    expect(text).not.toContain("var(--nothing");
  });

  it("keeps the root's frame as it is under a stylesheet that restyles the host, and the browser asks no other origin", async () => {
    const { host, root } = createRoot({ fetch: fakeFetch({ "items/q1/style/hostile.css": Hostile }).fetcher });
    const before = { contain: computed(host, "contain"), position: computed(host, "position") };
    await root.show({
      body: {
        nodes: itemBody(Classes.map((name) => `<p class="${name}">${name}</p>`).join("")),
      },
      stylesheets: ["items/q1/style/hostile.css"],
    });
    expect({ contain: computed(host, "contain"), position: computed(host, "position") }).toEqual(before);
    expect(computed(host, "position")).not.toBe("fixed");
    expect(computed(el(root.root, ".keep"), "color")).toBe("rgb(1, 2, 3)");
    expect(computed(el(root.root, ".mk"), "color")).toBe("rgb(9, 9, 9)");
    expect(computed(el(root.root, ".rel"), "background-image")).toContain(`${ITEM_DIRECTORY}images/dot.png`);
    for (const name of ["ext", "esc", "esc2", "set", "fade", "var", "var2", "fb", "svg", "m", "s", "l", "c"]) {
      expect(computed(el(root.root, `.${name}`), "background-image"), name).toBe("none");
    }
    expect(computed(el(root.root, ".content"), "list-style-image")).toBe("none");
    await new Promise((done) => setTimeout(done, 400));
    expect(await hits(stranger)).toEqual([]);
  });
});

describe("the stage and the media scale", () => {
  const Pictures =
    '<p id="line">Look.</p><p id="images"><img src="images/dot.png" alt="a" width="120" height="80"/><img src="images/dot.png" alt="b" width="50%"/></p><p id="object"><object type="image/png" data="images/dot.png" width="200" height="100">c</object></p><div id="video"><video width="300" height="150" controls="controls"><source src="media/clip.mp4" type="video/mp4"/></video></div>';

  const sizes = (root: ParentNode, selector: string): (string | null)[][] =>
    [...root.querySelectorAll(selector)].map((each) => [each.getAttribute("width"), each.getAttribute("height")]);

  it("fills the width of the host, which the rules of the stage of a graphic interaction would shrink to its content", async () => {
    const { host, root } = createRoot({}, "width: 480px;");
    await root.show({ body: { nodes: itemBody("<p>Text.</p>") } });
    expect(computed(root.stage, "display")).toBe("block");
    const padding = parseFloat(computed(host, "padding-left")) + parseFloat(computed(host, "padding-right"));
    expect(root.stage.getBoundingClientRect().width).toBe(host.getBoundingClientRect().width - padding);
  });

  it("holds the content in a positioned element that stays when the content is replaced", async () => {
    const { root } = createRoot();
    expect(root.stage.parentNode).toBe(root.root);
    expect(computed(root.stage, "position")).toBe("relative");
    await root.show({ body: { nodes: itemBody("<p>First.</p>") } });
    expect(el(root.stage, ".ak-content").textContent).toBe("First.");
    await root.show({ body: { nodes: itemBody("<p>Second.</p>") } });
    expect(root.stage.querySelectorAll(".ak-content")).toHaveLength(1);
    expect(el(root.stage, ".ak-content").textContent).toBe("Second.");
    expect(root.root.querySelector(".ak-content")?.parentNode).toBe(root.stage);
  });

  it("scales the pixel sizes of media from the size the author gave, and leaves percentages alone", async () => {
    const { root } = createRoot();
    await root.show({ body: { nodes: itemBody(Pictures) } });
    expect(sizes(root.root, "#images img")).toEqual([
      ["120", "80"],
      ["50%", null],
    ]);
    root.setMediaScale(2);
    expect(sizes(root.root, "#images img")).toEqual([
      ["240", "160"],
      ["50%", null],
    ]);
    expect(sizes(root.root, "#object > *")).toEqual([["400", "200"]]);
    expect(sizes(root.root, "#video video")).toEqual([["600", "300"]]);
    // It scales from the author's size, so that two changes do not compound.
    root.setMediaScale(3);
    expect(sizes(root.root, "#images img")[0]).toEqual(["360", "240"]);
    root.setMediaScale(1);
    expect(sizes(root.root, "#images img")[0]).toEqual(["120", "80"]);
    expect(sizes(root.root, "#video video")).toEqual([["300", "150"]]);
  });

  it("does not draw the content again when the scale changes", async () => {
    const { root } = createRoot();
    await root.show({ body: { nodes: itemBody(Pictures) } });
    const content = el(root.root, ".ak-content");
    const line = el(root.root, "#line");
    const image = el(root.root, "img");
    root.setMediaScale(2);
    expect(el(root.root, ".ak-content")).toBe(content);
    expect(el(root.root, "#line")).toBe(line);
    expect(el(root.root, "img")).toBe(image);
  });

  it("draws the content that comes after a change at the scale of the moment", async () => {
    const { root } = createRoot();
    root.setMediaScale(2);
    await root.show({ body: { nodes: itemBody(Pictures) } });
    expect(sizes(root.root, "#images img")[0]).toEqual(["240", "160"]);
    root.setMediaScale(1.5);
    await root.show({ body: { nodes: itemBody(Pictures) } });
    expect(sizes(root.root, "#images img")[0]).toEqual(["180", "120"]);
  });

  it("starts at the scale of the option", async () => {
    const { root } = createRoot({ mediaScale: 1.5 });
    await root.show({ body: { nodes: itemBody(Pictures) } });
    expect(sizes(root.root, "#images img")[0]).toEqual(["180", "120"]);
    root.setMediaScale(1);
    expect(sizes(root.root, "#images img")[0]).toEqual(["120", "80"]);
  });

  it("rejects a scale that is not a positive number", () => {
    const { root } = createRoot();
    const scale = (value: string): void => root.setMediaScale(JSON.parse(value));
    expect(() => scale('"2"')).toThrow(new DataError('The media scale must be a positive number, found "2".'));
    expect(() => scale("0")).toThrow("The media scale must be a positive number, found 0.");
    expect(() => scale("null")).toThrow(DataError);
  });
});

describe("options", () => {
  const create = (host: unknown, options: unknown): unknown => createContentRoot(host as never, options as never);
  const valid = () => ({
    messages: EN_MESSAGES,
    assets: (path: string) => path,
    fetch: (url: string, request: unknown) => fetch(url, request as RequestInit),
    stylesheet: stylesheet(PLAYER_CSS),
  });

  it("throws DataError for a host and options of other types", () => {
    const host = document.createElement("div");
    expect(() => create(JSON.parse("null"), valid())).toThrow("The host must be an element, found null.");
    expect(() => create(host, JSON.parse("null"))).toThrow("The options must be an object, found null.");
    expect(() => create(host, { ...valid(), extra: 1 })).toThrow(/found "extra"\.$/u);
    expect(() => create(host, { ...valid(), fetch: JSON.parse('"fetch"') })).toThrow(
      'The option fetch must be a function, found "fetch".',
    );
    expect(() => create(host, { ...valid(), stylesheet: JSON.parse("{}") })).toThrow(
      "The option stylesheet must be a CSSStyleSheet, found an object.",
    );
    expect(() => create(host, { ...valid(), typesetter: JSON.parse("{}") })).toThrow(
      "The typeset method of the option typesetter must be a function, found undefined.",
    );
    expect(() => create(host, { ...valid(), assets: JSON.parse("1") })).toThrow(DataError);
  });

  it("throws DataError for a host that already has a shadow root", () => {
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" });
    expect(() => create(host, valid())).toThrow(
      "The host must be an element that can have a shadow root and has none.",
    );
  });

  it("throws DataError for content of other types", async () => {
    const { root } = createRoot();
    const show = (content: unknown) => root.show(content as never);
    await expect(show(JSON.parse("null"))).rejects.toThrow("The content must be an object, found null.");
    await expect(show({ extra: 1 })).rejects.toThrow(/found "extra"\.$/u);
    await expect(show({ stimuli: JSON.parse('"x"') })).rejects.toThrow(
      'The stimuli of the content must be an array, found "x".',
    );
    await expect(show({ body: JSON.parse('"x"') })).rejects.toThrow(
      'A part of the content must be an object, found "x".',
    );
    await expect(show({ hazards: JSON.parse("{}") })).rejects.toThrow(
      "The hazards of the content must be an array, found an object.",
    );
    await expect(show({ language: JSON.parse("1") })).rejects.toThrow(
      "The language of the content must be a string, found 1.",
    );
    await expect(show({ body: { nodes: JSON.parse('{"length":1}') } })).rejects.toThrow(
      "The nodes of content must be an array, found an object.",
    );
    expect(() => root.showFeedback(JSON.parse("{}"))).toThrow("The feedback must be an array, found an object.");
  });
});
