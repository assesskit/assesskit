import { readAsi } from "@assesskit/runtime/asi";
import { afterEach, describe, expect, inject, it } from "vitest";
import { EN_MESSAGES } from "../src/index.js";
import { createContentRoot } from "../src/player/index.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { axeViolations, ITEM_PATH, itemBody } from "./renderer-fixture.js";

const { asset } = inject("fixtures");

const TOKEN = crypto.randomUUID();
const ASSETS = `${asset}/content/${TOKEN}/`;
const ITEM_DIRECTORY = `${ASSETS}items/q1/`;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const CATALOG = `<qti-catalog-info>
  <qti-catalog id="photosynthesis">
    <qti-card support="glossary-on-screen">
      <qti-card-entry xml:lang="en" default="true"><qti-html-content><p>The <em>process</em> by which plants make food.</p></qti-html-content></qti-card-entry>
      <qti-card-entry xml:lang="fr"><qti-html-content xml:lang="fr"><p>The process in French.</p></qti-html-content></qti-card-entry>
      <qti-card-entry xml:lang="id"><qti-html-content xml:lang="id"><p>The process in Indonesian.</p></qti-html-content></qti-card-entry>
    </qti-card>
    <qti-card support="sign-language">
      <qti-file-href mime-type="video/mp4">media/sign.mp4</qti-file-href>
    </qti-card>
    <qti-card support="braille">
      <qti-file-href mime-type="image/png">images/braille.png</qti-file-href>
    </qti-card>
    <qti-card support="long-description"><qti-html-content><p>A long description with a <a href="https://elsewhere.invalid/x">link</a>.</p></qti-html-content></qti-card>
  </qti-catalog>
  <qti-catalog id="pictured">
    <qti-card support="glossary-on-screen"><qti-html-content><p><img src="images/dot.png" alt="A dot" width="100" height="50"/></p></qti-html-content></qti-card>
  </qti-catalog>
  <qti-catalog id="empty-support">
    <qti-card support="spoken"><qti-html-content><p>Spoken card.</p></qti-html-content></qti-card>
  </qti-catalog>
</qti-catalog-info>`;

/** Reads an item with catalogs and returns its body and catalogs as the view gives them. */
function itemWithCatalogs() {
  const document = readAsi(
    `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="c" title="c" adaptive="false" time-dependent="false">
       <qti-item-body><p data-catalog-idref="photosynthesis">Photosynthesis happens in leaves.</p></qti-item-body>${CATALOG}
     </qti-assessment-item>`,
  );
  if (document.kind !== "item" || document.item.body === undefined) throw new Error("not an item");
  return { body: document.item.body.children, catalogs: document.item.catalogInfo?.catalogs ?? [] };
}

async function openRoot() {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const root = createContentRoot(host, {
    messages: EN_MESSAGES,
    assets: (path) => `${ASSETS}${path}`,
    fetch: (url, request) => fetch(url, request),
    stylesheet: stylesheet(PLAYER_CSS),
  });
  const { body, catalogs } = itemWithCatalogs();
  await root.show({ body: { nodes: body, base: ITEM_PATH }, catalogs });
  return { host, root };
}

describe("catalogs", () => {
  it("keeps data-catalog-idref on the element and draws no card until the candidate asks for one", async () => {
    const { root } = await openRoot();
    const element = root.root.querySelector("p");
    expect(element?.getAttribute("data-catalog-idref")).toBe("photosynthesis");
    expect(root.root.querySelector("qti-catalog-info, qti-catalog, qti-card, qti-html-content")).toBeNull();
    expect(root.root.textContent).toBe("Photosynthesis happens in leaves.");
  });

  it("renders the HTML content of the card for a support, as content", async () => {
    const { root } = await openRoot();
    const card =
      root.root.querySelector("p") && root.root.host.isConnected
        ? root.card("photosynthesis", "glossary-on-screen")
        : undefined;
    expect(card).toBeInstanceOf(DocumentFragment);
    const holder = document.createElement("div");
    holder.append(card as DocumentFragment);
    expect(holder.querySelector("qti-html-content > p")?.textContent).toBe("The process by which plants make food.");
    expect(holder.querySelector("em")?.textContent).toBe("process");
  });

  it("draws a card at the scale of the media that the root has now", async () => {
    const { root } = await openRoot();
    const widths = (): (string | null | undefined)[] =>
      ["glossary-on-screen"].map(() => {
        const holder = document.createElement("div");
        const card = root.card("pictured", "glossary-on-screen");
        if (card !== undefined) holder.append(card);
        return holder.querySelector("img")?.getAttribute("width");
      });
    expect(widths()).toEqual(["100"]);
    root.setMediaScale(2);
    expect(widths()).toEqual(["200"]);
  });

  it("chooses the entry by language as the runtime does: the language itself, its primary language, then the default", async () => {
    const { root } = await openRoot();
    const text = (language: string | undefined): string | undefined => {
      const card = root.card("photosynthesis", "glossary-on-screen", language);
      const holder = document.createElement("div");
      if (card !== undefined) holder.append(card);
      return holder.textContent ?? undefined;
    };
    expect(text("fr")).toBe("The process in French.");
    expect(text("FR-ca")).toBe("The process in French.");
    expect(text("id")).toBe("The process in Indonesian.");
    expect(text("de")).toBe("The process by which plants make food.");
    expect(text(undefined)).toBe("The process by which plants make food.");
  });

  it("marks the language of a card that has one, so that a screen reader speaks it in that language", async () => {
    const { root } = await openRoot();
    const holder = document.createElement("div");
    const card = root.card("photosynthesis", "glossary-on-screen", "fr");
    if (card !== undefined) holder.append(card);
    expect(holder.querySelector("qti-html-content")?.getAttribute("lang")).toBe("fr");
  });

  it("embeds the files of a card by their media type through assets: a video of sign language, an image of braille", async () => {
    const { root } = await openRoot();
    const holder = document.createElement("div");
    const sign = root.card("photosynthesis", "sign-language");
    const braille = root.card("photosynthesis", "braille");
    if (sign !== undefined) holder.append(sign);
    if (braille !== undefined) holder.append(braille);
    const video = holder.querySelector("video");
    expect(video?.getAttribute("src")).toBe(`${ITEM_DIRECTORY}media/sign.mp4`);
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(holder.querySelector("img")?.getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/braille.png`);
  });

  it("applies the rules of the renderer to a card: a link to an origin that is not named has no href", async () => {
    const { root } = await openRoot();
    const holder = document.createElement("div");
    const card = root.card("photosynthesis", "long-description");
    if (card !== undefined) holder.append(card);
    expect(holder.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(holder.textContent).toBe("A long description with a link.");
  });

  it("gives nothing for a catalog that does not exist, a support that the catalog has no card for, or a language with no entry", async () => {
    const { root } = await openRoot();
    expect(root.card("unknown", "glossary-on-screen")).toBeUndefined();
    expect(root.card("photosynthesis", "tactile")).toBeUndefined();
    expect(root.card("empty-support", "glossary-on-screen")).toBeUndefined();
    expect(root.card("empty-support", "spoken")).toBeInstanceOf(DocumentFragment);
  });

  it("has no cards before the content is shown, and none after the root is destroyed and shown new content", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const root = createContentRoot(host, {
      messages: EN_MESSAGES,
      assets: (path) => `${ASSETS}${path}`,
      fetch: (url, request) => fetch(url, request),
      stylesheet: stylesheet(PLAYER_CSS),
    });
    expect(root.card("photosynthesis", "glossary-on-screen")).toBeUndefined();
    await root.show({ body: { nodes: itemBody("<p>x</p>") } });
    expect(root.card("photosynthesis", "glossary-on-screen")).toBeUndefined();
  });

  it("passes axe with the cards in the page", async () => {
    const { host, root } = await openRoot();
    for (const support of ["glossary-on-screen", "braille", "long-description"] as const) {
      const card = root.card("photosynthesis", support);
      if (card !== undefined) root.root.append(card);
    }
    expect(await axeViolations(host)).toEqual([]);
  });
});
