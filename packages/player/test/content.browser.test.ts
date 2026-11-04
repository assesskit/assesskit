// cspell:ignore Ärlig
import { type BodyNode, readAsi } from "@assesskit/runtime/asi";
import { resolveContent } from "@assesskit/runtime/content";
import { createItemVariables } from "@assesskit/runtime/processing";
import { buildSingle } from "@assesskit/runtime/values";
import { parseXml, type XmlElement } from "@assesskit/runtime/xml";
import { afterEach, describe, expect, inject, it } from "vitest";
import { userEvent } from "vitest/browser";
import { createLocalSession } from "../src/client/local/index.js";
import { EN_MESSAGES } from "../src/index.js";
import { enableSorting } from "../src/player/content/internal.js";
import {
  buildSpeechRequest,
  type ContentRoot,
  createContentRoot,
  mountItem,
  mountTools,
  type RootContent,
} from "../src/player/index.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";
import { NO_RECORDING } from "./files-fixture.js";
import { axeViolations, ITEM_PATH, itemBody, renderBody, testRenderer } from "./renderer-fixture.js";
import { supportView } from "./supports-fixture.js";
import { waitFor } from "./wait.js";

const { asset, other, stranger } = inject("fixtures");

/** The browsers of a run share the servers, so this file names its paths with a token of its own. */
const TOKEN = crypto.randomUUID();
const ASSETS = `${asset}/content/${TOKEN}/`;
const ITEM_DIRECTORY = `${ASSETS}items/q1/`;

/** Returns the paths that a server was asked for below this file's token. */
async function hits(origin: string): Promise<string[]> {
  const paths: string[] = await (await fetch(`${origin}/__hits`, { cache: "no-store" })).json();
  return paths.filter((path) => path.includes(`/${TOKEN}/`));
}

/** Returns the element of a content root that matches, which must exist. */
function el(root: ParentNode, selector: string): Element {
  const found = root.querySelector(selector);
  if (found === null) throw new Error(`No element matches ${selector}.`);
  return found;
}

/** Returns the names of an element and the elements below it in an XML tree, in document order. */
function namesOf(element: XmlElement): string[] {
  return [element.name, ...element.children.flatMap((child) => (child.kind === "element" ? namesOf(child) : []))];
}

describe("body", () => {
  const Body = `<div class="qti-layout-row">
    <h1>Title</h1>
    <p>Text with <a href="https://other.invalid/x">a link</a>, <abbr title="abbreviation">abbr</abbr>, <b>b</b>, <i>i</i>, <sup>2</sup>, <sub>n</sub>, <code>code</code>, <kbd>k</kbd> and <q cite="https://other.invalid/q">quote</q>.<br/></p>
    <ul><li>One</li><li>Two</li></ul>
    <ol><li>First</li></ol>
    <dl><dt>Term</dt><dd>Definition</dd></dl>
    <table>
      <caption>Caption</caption>
      <thead><tr><th id="a" scope="col">A</th><th id="b" scope="col">B</th></tr></thead>
      <tbody><tr><th scope="row">r1</th><td headers="a b" colspan="1" rowspan="1">1</td></tr></tbody>
      <tfoot><tr><td>sum</td></tr></tfoot>
    </table>
    <details open="true"><summary>More</summary><p>Detail</p></details>
    <figure><img src="images/dot.png" alt="A dot"/><figcaption>Figure</figcaption></figure>
    <blockquote><p>Quote</p></blockquote><pre>pre   text</pre><hr/>
    <section><header><h2>Head</h2></header><article><p>Article</p></article><aside><p>Aside</p></aside><nav><p>Nav</p></nav><footer><p>Foot</p></footer><address>Address</address></section>
  </div>`;

  it("renders the nodes of the body in order, with the text between them", () => {
    const content = renderBody("<p>One <em>two</em>, <strong>three</strong>.</p>\n<p>Four</p>", ASSETS);
    expect(content.root.innerHTML).toBe("<p>One <em>two</em>, <strong>three</strong>.</p><p>Four</p>");
  });

  it("renders every HTML element as the element of the same name, in the order of the document", () => {
    const content = renderBody(Body, ASSETS);
    const expected = namesOf(
      parseXml(`<root xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">${Body}</root>`),
    ).slice(1);
    expect([...content.root.querySelectorAll("*")].map((element) => element.localName)).toEqual(expected);
  });

  it("keeps the headers and scopes of a table, the summary of details and the caption of a figure", async () => {
    const content = renderBody(Body, ASSETS);
    expect(content.findAll("th[scope=col]").map((cell) => cell.id)).toEqual(["a", "b"]);
    expect(el(content.root, "th[scope=row]").textContent).toBe("r1");
    const cell = el(content.root, "td[headers]");
    expect(cell.getAttribute("headers")).toBe("a b");
    expect(cell.getAttribute("colspan")).toBe("1");
    expect(el(content.root, "caption").parentElement?.localName).toBe("table");
    const details = el(content.root, "details");
    expect(details.hasAttribute("open")).toBe(true);
    expect(details.firstElementChild?.localName).toBe("summary");
    expect(el(content.root, "figure > figcaption").textContent).toBe("Figure");
    expect(el(content.root, "pre").textContent).toBe("pre   text");
    expect(await axeViolations(content.host)).toEqual([]);
  });

  it("leaves the open attribute off a closed details, as HTML reads the attribute by its presence", () => {
    const content = renderBody('<div><details open="false"><summary>S</summary><p>P</p></details></div>', ASSETS);
    expect(el(content.root, "details").hasAttribute("open")).toBe(false);
  });

  it("draws a prompt and the label of an inline choice as the elements of QTI beside the other content", () => {
    const content = renderBody(
      `<p><qti-inline-choice-interaction response-identifier="R">
         <qti-label>Pick one</qti-label>
         <qti-inline-choice identifier="a">A</qti-inline-choice>
       </qti-inline-choice-interaction></p>
       <qti-choice-interaction response-identifier="C" max-choices="1">
         <qti-prompt>Which?</qti-prompt>
         <qti-simple-choice identifier="x">X</qti-simple-choice>
       </qti-choice-interaction>`,
      ASSETS,
    );
    expect(el(content.root, "qti-prompt").textContent).toBe("Which?");
    expect(el(content.root, "qti-label").textContent).toBe("Pick one");
    expect(content.root.querySelector("label")).toBeNull();
    expect(el(content.root, "qti-simple-choice").textContent).toBe("X");
  });

  it("draws an interaction without a renderer as a placeholder that holds its content, with its attributes of class and id", () => {
    const content = renderBody(
      `<qti-choice-interaction id="c1" class="qti-labels-upper-alpha" response-identifier="C" max-choices="1" shuffle="true">
         <qti-simple-choice identifier="x">X</qti-simple-choice>
       </qti-choice-interaction>`,
      ASSETS,
    );
    const interaction = el(content.root, "qti-choice-interaction");
    expect(interaction.hasAttribute("data-ak-placeholder")).toBe(true);
    expect(interaction.id).toBe("c1");
    expect(interaction.className).toBe("qti-labels-upper-alpha");
    // The attributes that only the interaction itself reads stay in the model.
    expect(interaction.hasAttribute("shuffle")).toBe(false);
    expect(interaction.hasAttribute("response-identifier")).toBe(false);
  });

  it("gives an interaction to the renderer registered for its kind, with the renderer of the body to render its content", () => {
    const calls: string[] = [];
    const renderer = testRenderer(ASSETS, {
      interactions: new Map([
        [
          "choice-interaction",
          (interaction, body) => {
            calls.push(interaction.kind);
            const prompt = interaction.kind === "choice-interaction" ? interaction.prompt : undefined;
            return body.element("qti-choice-interaction", interaction, [
              ...body.nodes(prompt?.children ?? []),
              document.createTextNode("[filled]"),
            ]);
          },
        ],
      ]),
    });
    const content = renderBody("", ASSETS);
    content.root.append(
      ...renderer.nodes(
        itemBody(`<qti-choice-interaction response-identifier="C" max-choices="1" class="mine">
          <qti-prompt>Which <em>one</em>?</qti-prompt>
          <qti-simple-choice identifier="x">X</qti-simple-choice>
        </qti-choice-interaction>`),
      ),
    );
    expect(calls).toEqual(["choice-interaction"]);
    const interaction = el(content.root, "qti-choice-interaction");
    expect(interaction.innerHTML).toBe("Which <em>one</em>?[filled]");
    expect(interaction.className).toBe("mine");
    expect(interaction.hasAttribute("data-ak-placeholder")).toBe(false);
  });
});

describe("wide content", () => {
  it("draws an element with more children than a call can take as arguments", () => {
    // 130,000 children, which a spread into append refuses with a RangeError in Chromium and WebKit; the model is built
    // as readAsi reads it, so that the test times the drawing and not the reading.
    const count = 130_000;
    const wide: BodyNode = {
      kind: "div",
      extensions: [],
      children: Array.from({ length: count }, () => ({ kind: "text", value: "a" }) as const),
    };
    const [drawn] = testRenderer(ASSETS).nodes([wide]);
    expect(drawn?.childNodes.length).toBe(count);
  });
});

describe("images", () => {
  it("loads the image through assets, from the path against the document of the item", async () => {
    const content = renderBody('<p><img src="images/dot.png" alt="A dot"/></p>', ASSETS);
    const image = el(content.root, "img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
    await image.decode();
    expect(image.naturalWidth).toBe(1);
    expect(image.alt).toBe("A dot");
  });

  it("keeps the alt text, the long description link and the size, and passes axe", async () => {
    const content = renderBody(
      '<p><img src="images/dot.png" alt="A dot" longdesc="descriptions/dot.html" width="120" height="80"/><img src="images/dot.png" alt=""/></p>',
      ASSETS,
    );
    const [first, second] = content.findAll<HTMLImageElement>("img");
    expect(first?.alt).toBe("A dot");
    expect(first?.getAttribute("longdesc")).toBe(`${ITEM_DIRECTORY}descriptions/dot.html`);
    expect([first?.getAttribute("width"), first?.getAttribute("height")]).toEqual(["120", "80"]);
    expect(second?.getAttribute("alt")).toBe("");
    expect(await axeViolations(content.host)).toEqual([]);
  });

  it("multiplies the pixel size of an image by the magnification of non-text content, and not a percentage", () => {
    const content = renderBody(
      '<p><img src="images/dot.png" alt="a" width="120" height="80"/><img src="images/dot.png" alt="b" width="50%"/></p>',
      ASSETS,
      { mediaScale: 1.5 },
    );
    const [first, second] = content.findAll("img");
    expect([first?.getAttribute("width"), first?.getAttribute("height")]).toEqual(["180", "120"]);
    expect(second?.getAttribute("width")).toBe("50%");
    // The size the author gave stays in attributes of its own, because the coordinates of the graphic interactions use it.
    expect([first?.getAttribute("data-ak-width"), first?.getAttribute("data-ak-height")]).toEqual(["120", "80"]);
    expect(second?.hasAttribute("data-ak-width")).toBe(false);
  });

  it("resolves the sources of a picture, with their srcset and sizes", () => {
    const content = renderBody(
      `<p><picture>
         <source srcset="images/dot.png 1x, images/dot@2x.png 2x" sizes="(max-width: 600px) 480px, 800px" media="(min-width: 400px)" type="image/png"/>
         <img src="images/dot.png" alt="A dot"/>
       </picture></p>`,
      ASSETS,
    );
    const source = el(content.root, "picture > source");
    expect(source.getAttribute("srcset")).toBe(
      `${ITEM_DIRECTORY}images/dot.png 1x, ${ITEM_DIRECTORY}images/dot@2x.png 2x`,
    );
    expect(source.getAttribute("sizes")).toBe("(max-width: 600px) 480px, 800px");
    expect(source.getAttribute("media")).toBe("(min-width: 400px)");
    expect(source.getAttribute("type")).toBe("image/png");
  });

  it("starts the references below an element with xml:base at that base, as XML Base reads it, and nowhere else", () => {
    const content = renderBody(
      `<div xml:base="shared/"><p><img src="a.png" alt="a"/></p><div xml:base="../other/"><p><img src="b.png" alt="b"/></p></div></div>
       <div xml:base="../../../outside/"><p><img src="c.png" alt="c"/></p></div>
       <p><img src="d.png" alt="d"/></p>`,
      ASSETS,
    );
    expect(content.findAll("img").map((image) => image.getAttribute("src"))).toEqual([
      `${ITEM_DIRECTORY}shared/a.png`,
      `${ITEM_DIRECTORY}other/b.png`,
      `${ITEM_DIRECTORY}c.png`,
      `${ITEM_DIRECTORY}d.png`,
    ]);
  });

  it("refuses an image from an origin that the options do not name, and the browser never asks the origin", async () => {
    const leak = `${stranger}/${TOKEN}/leak.png`;
    const content = renderBody(
      `<p><img src="${leak}" alt="outside"/><img src="//${new URL(stranger).host}/${TOKEN}/leak2.png" alt="outside"/></p>`,
      ASSETS,
    );
    for (const image of content.findAll("img")) expect(image.hasAttribute("src")).toBe(false);
    await new Promise((done) => setTimeout(done, 300));
    expect(await hits(stranger)).toEqual([]);
  });

  it("loads an image from an origin that the options name", async () => {
    const content = renderBody(`<p><img src="${other}/cdn/${TOKEN}/x.png" alt="named"/></p>`, ASSETS, {
      origins: [other],
    });
    expect(el(content.root, "img").getAttribute("src")).toBe(`${other}/cdn/${TOKEN}/x.png`);
  });

  it("keeps the data URL of a raster image and refuses one of an SVG", () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQizoBAAHaAUGizqgqAAAAAElFTkSuQmCC";
    const content = renderBody(
      `<p><img src="${png}" alt="inline"/><img src="data:image/svg+xml,&lt;svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/&gt;" alt="svg"/></p>`,
      ASSETS,
    );
    const [first, second] = content.findAll("img");
    expect(first?.getAttribute("src")).toBe(png);
    expect(second?.hasAttribute("src")).toBe(false);
  });
});

describe("audio and video", () => {
  const Media = `<audio src="media/a.mp3" controls="false" autoplay="autoplay" loop="true" preload="none" crossorigin="use-credentials">
      <source src="media/a.ogg" type="audio/ogg"/>Fallback text of the audio.
    </audio>
    <video src="media/v.mp4" width="320" height="180" poster="images/dot.png" muted="muted" autoplay="true">
      <source src="media/v.webm" type="video/webm"/>
      <track kind="captions" src="media/v-en.vtt" srclang="en" label="English" default="default"/>
      <track kind="descriptions" src="media/v-d.vtt" srclang="en" label="Descriptions"/>
      <track kind="subtitles" src="media/v-id.vtt" srclang="id" label="Indonesia"/>
      <track kind="chapters" src="media/v-c.vtt" srclang="en" label="Chapters"/>
    </video>`;

  it("gives the player the controls of the browser whatever the item says, and never starts it", () => {
    const content = renderBody(Media, ASSETS);
    const audio = el(content.root, "audio");
    const video = el(content.root, "video");
    for (const media of [audio, video]) {
      expect(media.hasAttribute("controls"), media.localName).toBe(true);
      expect(media.hasAttribute("autoplay"), media.localName).toBe(false);
      expect(media.hasAttribute("crossorigin"), media.localName).toBe(false);
    }
    expect(audio.getAttribute("src")).toBe(`${ITEM_DIRECTORY}media/a.mp3`);
    expect(audio.hasAttribute("loop")).toBe(true);
    expect(audio.getAttribute("preload")).toBe("none");
    expect(audio.textContent).toContain("Fallback text of the audio.");
    expect(video.hasAttribute("muted")).toBe(true);
    expect([video.getAttribute("width"), video.getAttribute("height")]).toEqual(["320", "180"]);
    expect(video.getAttribute("poster")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
  });

  it("renders the sources and the tracks of a video: captions, descriptions, subtitles and chapters", () => {
    const content = renderBody(Media, ASSETS);
    expect(content.findAll("audio > source, video > source").map((source) => source.getAttribute("src"))).toEqual([
      `${ITEM_DIRECTORY}media/a.ogg`,
      `${ITEM_DIRECTORY}media/v.webm`,
    ]);
    const tracks = content.findAll<HTMLTrackElement>("track");
    expect(tracks.map((track) => [track.kind, track.srclang, track.label])).toEqual([
      ["captions", "en", "English"],
      ["descriptions", "en", "Descriptions"],
      ["subtitles", "id", "Indonesia"],
      ["chapters", "en", "Chapters"],
    ]);
    expect(tracks.map((track) => track.getAttribute("src"))).toEqual([
      `${ITEM_DIRECTORY}media/v-en.vtt`,
      `${ITEM_DIRECTORY}media/v-d.vtt`,
      `${ITEM_DIRECTORY}media/v-id.vtt`,
      `${ITEM_DIRECTORY}media/v-c.vtt`,
    ]);
    expect(tracks.map((track) => track.hasAttribute("default"))).toEqual([true, false, false, false]);
  });

  it("passes axe with a captions track, which WCAG asks for", async () => {
    const content = renderBody(Media, ASSETS);
    expect(await axeViolations(content.host)).toEqual([]);
  });
});

describe("objects", () => {
  const object = (attributes: string, inside = ""): string => `<p><object ${attributes}>${inside}</object></p>`;

  it("draws an object of an image type as an image whose alt is its fallback content", async () => {
    const content = renderBody(
      object('data="images/dot.png" type="image/png" class="qti-width-6" width="40"', "A dot <em>in</em> the page"),
      ASSETS,
      { mediaScale: 2 },
    );
    const image = el(content.root, "img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
    expect(image.alt).toBe("A dot in the page");
    expect(image.className).toBe("qti-width-6");
    expect(image.getAttribute("width")).toBe("80");
    expect(image.getAttribute("data-ak-width")).toBe("40");
    expect(image.hasAttribute("data-ak-height")).toBe(false);
    expect(content.root.querySelector("object")).toBeNull();
    await image.decode();
  });

  it("prefers the alt that an author gives the object beside the schema, and leaves out its data and type", () => {
    const content = renderBody(
      object('data="images/dot.png" type="image/png" alt="Short alternative"', "Long fallback"),
      ASSETS,
    );
    const image = el(content.root, "img");
    expect(image.getAttribute("alt")).toBe("Short alternative");
    expect(image.hasAttribute("data")).toBe(false);
    expect(image.hasAttribute("type")).toBe(false);
  });

  it("draws an object of an audio or video type as the element that plays it, with controls", () => {
    const content = renderBody(
      `${object('data="media/a.mp3" type="audio/mpeg"', "Audio fallback")}${object('data="media/v.mp4" type="video/mp4" width="300" height="200"', "Video fallback")}`,
      ASSETS,
    );
    const audio = el(content.root, "audio");
    const video = el(content.root, "video");
    expect(audio.getAttribute("src")).toBe(`${ITEM_DIRECTORY}media/a.mp3`);
    expect(video.getAttribute("src")).toBe(`${ITEM_DIRECTORY}media/v.mp4`);
    expect(audio.hasAttribute("controls") && video.hasAttribute("controls")).toBe(true);
    expect(audio.textContent).toBe("Audio fallback");
    expect([video.getAttribute("width"), video.getAttribute("height")]).toEqual(["300", "200"]);
  });

  it("puts a page in a frame with an empty sandbox, so that it runs no script and is not of the origin of the player", async () => {
    const content = renderBody(
      object('data="pages/note.html" type="text/html" width="400" height="100"', "A note"),
      ASSETS,
      {
        mediaScale: 1,
      },
    );
    const frame = el(content.root, "iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.sandbox.length).toBe(0);
    expect(frame.title).toBe("A note");
    expect(frame.getAttribute("src")).toBe(`${ITEM_DIRECTORY}pages/note.html`);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    await new Promise((done) => frame.addEventListener("load", done, { once: true }));
    expect(() => frame.contentDocument?.title).not.toThrow();
    expect(frame.contentDocument).toBeNull();
  });

  it("offers a file of any other type as a link that opens in a tab of its own, with the fallback as its text", () => {
    const content = renderBody(
      `${object('data="files/data.pdf" type="application/pdf"', "The data sheet")}${object('data="files/other.bin" type="application/octet-stream"')}`,
      ASSETS,
    );
    const [first, second] = content.findAll("a");
    expect(first?.getAttribute("href")).toBe(`${ITEM_DIRECTORY}files/data.pdf`);
    expect([first?.getAttribute("target"), first?.getAttribute("rel")]).toEqual(["_blank", "noopener noreferrer"]);
    expect(first?.textContent).toBe("The data sheet");
    expect(second?.textContent).toBe("Open the file");
  });

  it("does not draw the parameters, which are for plug-ins, and keeps the fallback where the file is refused", () => {
    const content = renderBody(
      object(
        `data="${stranger}/${TOKEN}/movie.swf" type="application/x-shockwave-flash"`,
        '<param name="movie" value="x" valuetype="DATA"/>Your browser cannot show the movie.',
      ),
      ASSETS,
    );
    expect(content.root.querySelector("param")).toBeNull();
    expect(content.root.querySelector("a, iframe, embed, object")).toBeNull();
    expect(el(content.root, "p").textContent).toBe("Your browser cannot show the movie.");
  });

  it("shows the value that param-variable put in a parameter as the runtime resolved it", () => {
    const document = readAsi(
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="p" title="p" adaptive="false" time-dependent="false">
         <qti-template-declaration identifier="SRC" cardinality="single" base-type="string" param-variable="true"/>
         <qti-item-body><p><object data="images/dot.png" type="image/png"><param name="label" value="SRC" valuetype="DATA"/>fallback</object></p></qti-item-body>
       </qti-assessment-item>`,
    );
    if (document.kind !== "item" || document.item.body === undefined) throw new Error("not an item");
    const variables = createItemVariables(document.item);
    const templates = new Map(variables.templates).set("SRC", buildSingle("string", "resolved"));
    const [resolved] = resolveContent(
      document.item.body.children,
      { outcomes: variables.outcomes, templates },
      document.item,
      {
        view: "candidate",
      },
    );
    const object = resolved?.kind === "p" ? resolved.children.find(({ kind }) => kind === "object") : undefined;
    const param = object?.kind === "object" ? object.children.find(({ kind }) => kind === "param") : undefined;
    expect(param?.kind === "param" ? param.value : undefined).toBe("resolved");
    const content = renderBody("", ASSETS);
    content.root.append(...testRenderer(ASSETS).nodes(resolved === undefined ? [] : [resolved]));
    expect(el(content.root, "img").getAttribute("alt")).toBe("fallback");
  });
});

describe("links", () => {
  it("links a file of the package to its URL and opens it in a tab of its own, without an opener or a referrer", () => {
    const content = renderBody('<p><a href="files/data.pdf">Data</a></p>', ASSETS);
    const link = el(content.root, "a");
    expect(link.getAttribute("href")).toBe(`${ITEM_DIRECTORY}files/data.pdf`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("links an external page only when its origin is named, and then with the same rel", () => {
    const content = renderBody(
      `<p><a href="${other}/page">named</a><a href="https://elsewhere.invalid/page">not named</a></p>`,
      ASSETS,
      { origins: [other] },
    );
    const [named, notNamed] = content.findAll("a");
    expect(named?.getAttribute("href")).toBe(`${other}/page`);
    expect(named?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(notNamed?.hasAttribute("href")).toBe(false);
    expect(notNamed?.textContent).toBe("not named");
  });

  it("keeps a link to an id of the item as it is, for the content root to follow", () => {
    const content = renderBody('<p><a href="#note">note</a></p><p id="note">The note.</p>', ASSETS);
    const link = el(content.root, "a");
    expect(link.getAttribute("href")).toBe("#note");
    expect(link.hasAttribute("target")).toBe(false);
  });

  it("refuses a link with a scheme that runs script", () => {
    const content = renderBody(
      '<p><a href="javascript:alert(1)">a</a><a href="  JaVaScRiPt:alert(1)">b</a><a href="vbscript:x">c</a><a href="data:text/html,x">d</a></p>',
      ASSETS,
    );
    for (const link of content.findAll("a")) expect(link.hasAttribute("href"), link.textContent ?? "").toBe(false);
  });
});

describe("ruby and direction", () => {
  it("draws the annotation of a ruby above its base and keeps the parentheses for a browser without ruby", () => {
    const content = renderBody("<p>日本語は<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>で書く。</p>", ASSETS);
    const ruby = el(content.root, "ruby");
    expect(ruby.textContent).toBe("漢字(かんじ)");
    const annotation = el(content.root, "rt").getBoundingClientRect();
    const paragraph = el(content.root, "p").getBoundingClientRect();
    expect(annotation.height).toBeGreaterThan(0);
    // The annotation is set over the line, so it is above the text of the paragraph's first line box center.
    expect(annotation.bottom).toBeLessThanOrEqual(paragraph.top + paragraph.height);
    expect(getComputedStyle(el(content.root, "rp")).display).toBe("none");
  });

  it("keeps rb and rtc, the elements of complex ruby", () => {
    const content = renderBody("<p><ruby><rb>漢</rb><rb>字</rb><rtc><rt>かん</rt><rt>じ</rt></rtc></ruby></p>", ASSETS);
    expect(content.findAll("rb, rtc, rt").map((element) => element.localName)).toEqual(["rb", "rb", "rtc", "rt", "rt"]);
    expect(el(content.root, "ruby").textContent).toBe("漢字かんじ");
  });

  it("keeps the direction of text: dir on any element, bdo, bdi, and the auto direction", () => {
    const content = renderBody(
      '<p dir="rtl">abc</p><p><bdo dir="rtl">abc</bdo> and <bdi dir="auto">def</bdi></p><p dir="auto">hello</p>',
      ASSETS,
    );
    const [rtl, mixed, auto] = content.findAll("p");
    expect(rtl?.getAttribute("dir")).toBe("rtl");
    expect(getComputedStyle(rtl as Element).direction).toBe("rtl");
    expect(getComputedStyle(el(content.root, "bdo")).direction).toBe("rtl");
    expect(el(content.root, "bdi").getAttribute("dir")).toBe("auto");
    expect(mixed?.querySelector("bdo")?.textContent).toBe("abc");
    expect(auto?.getAttribute("dir")).toBe("auto");
  });
});

describe("language", () => {
  const Body =
    '<p xml:lang="fr">French <span lang="de">German</span> <span xml:lang="id" lang="en">Indonesian</span> <span xml:lang="">x</span></p>';

  it("sets lang from xml:lang and from lang, and xml:lang wins where an element has both", () => {
    const content = renderBody(Body, ASSETS);
    expect(el(content.root, "p").getAttribute("lang")).toBe("fr");
    expect(el(content.root, "span[lang=de]").textContent).toBe("German");
    expect(el(content.root, "span[lang=id]").textContent).toBe("Indonesian");
    expect(el(content.root, "span[lang='']").textContent).toBe("x");
  });

  it("lets the browser apply the language of a part: it matches :lang() and passes axe", async () => {
    const content = renderBody(Body, ASSETS);
    expect(el(content.root, "span[lang=de]").matches(":lang(de)")).toBe(true);
    expect(el(content.root, "span[lang=de]").matches(":lang(fr)")).toBe(false);
    expect(el(content.root, "p").matches(":lang(fr)")).toBe(true);
    expect(await axeViolations(content.host)).toEqual([]);
  });
});

describe("attributes", () => {
  it("passes role and the ARIA attributes, lists included, and the values that are booleans", async () => {
    const content = renderBody(
      `<div role="group" aria-label="Group" aria-labelledby="t" aria-describedby="d1 d2" aria-hidden="false" aria-live="polite" aria-atomic="true">
         <h2 id="t" aria-level="3">Title</h2><p id="d1">One</p><p id="d2">Two</p>
       </div>`,
      ASSETS,
    );
    const group = el(content.root, "div");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe("Group");
    expect(group.getAttribute("aria-labelledby")).toBe("t");
    expect(group.getAttribute("aria-describedby")).toBe("d1 d2");
    expect(group.getAttribute("aria-hidden")).toBe("false");
    expect(el(content.root, "h2").getAttribute("aria-level")).toBe("3");
    expect(group.getAttribute("aria-live")).toBe("polite");
    expect(group.getAttribute("aria-atomic")).toBe("true");
    expect(await axeViolations(content.host)).toEqual([]);
  });

  it("turns data-qti-aria-* into the ARIA attribute it stands for, without replacing one the element has", () => {
    const content = renderBody(
      '<p id="p" data-qti-aria-details="long" data-qti-aria-label="Backup" aria-label="Own">Text</p><div id="long" data-qti-a11y-content-role="long-description">Long description</div>',
      ASSETS,
    );
    const paragraph = el(content.root, "p");
    expect(paragraph.getAttribute("aria-details")).toBe("long");
    expect(paragraph.getAttribute("aria-label")).toBe("Own");
    expect(paragraph.getAttribute("data-qti-aria-details")).toBe("long");
    expect(el(content.root, "#long").getAttribute("data-qti-a11y-content-role")).toBe("long-description");
  });

  it("keeps data-* attributes of any spelling, and the three attributes of QTI that speech and cards read", () => {
    const content = renderBody(
      '<p data-selected_color="red" data-tap-message="tap" data-x.y-z="1" data-qti-suppress-tts="all" data-ssml=\'{"sub":{"alias":"x"}}\' data-catalog-idref="glossary">T</p>',
      ASSETS,
    );
    const paragraph = el(content.root, "p");
    expect(paragraph.getAttribute("data-selected_color")).toBe("red");
    expect(paragraph.getAttribute("data-tap-message")).toBe("tap");
    expect(paragraph.getAttribute("data-x.y-z")).toBe("1");
    expect(paragraph.getAttribute("data-qti-suppress-tts")).toBe("all");
    expect(paragraph.getAttribute("data-ssml")).toBe('{"sub":{"alias":"x"}}');
    expect(paragraph.getAttribute("data-catalog-idref")).toBe("glossary");
  });

  it("keeps the class, the id and the title-less abbreviations, and drops the label that results report", () => {
    const content = renderBody('<p id="a" class="qti-italic qti-bordered" label="for results">T</p>', ASSETS);
    const paragraph = el(content.root, "p");
    expect(paragraph.id).toBe("a");
    expect(paragraph.className).toBe("qti-italic qti-bordered");
    expect(paragraph.hasAttribute("label")).toBe(false);
  });
});

describe("hostile markup", () => {
  /** Markup that the reader of the runtime accepts and that a package could use to run script or reach another origin. */
  const Hostile = `<div onclick="alert(1)" style="position:fixed;top:0;left:0;width:100%;height:100%" onmouseover="alert(2)" xml:base="https://evil.invalid/">
    <p onload="alert(3)" data-ok="1" xmlns:x="http://www.w3.org/1999/xlink" x:href="javascript:alert(4)" onclick="alert(5)">Text</p>
    <p><a href="javascript:alert(6)" onfocus="alert(7)">js</a>
    <a href="jav&#97;script:alert(8)">entity</a>
    <a href="java&#x09;script:alert(9)">tab</a>
    <img src="${stranger}/${TOKEN}/pixel.png" alt="tracker" onerror="alert(10)"/>
    <picture><source srcset="${stranger}/${TOKEN}/pic.png" /><img src="images/dot.png" alt="p"/></picture>
    <object data="javascript:alert(12)" type="text/html">fallback</object>
    <object data="${stranger}/${TOKEN}/page.html" type="text/html">fallback2</object>
    <m:math onclick="alert(14)" style="color:red"><m:mi href="javascript:alert(15)" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="javascript:alert(16)">x</m:mi><m:annotation-xml encoding="text/html"><script xmlns="http://www.w3.org/1999/xhtml">alert(17)</script></m:annotation-xml></m:math></p>
    <blockquote cite="javascript:alert(13)"><p>q</p></blockquote>
    <video src="${stranger}/${TOKEN}/v.mp4" poster="${stranger}/${TOKEN}/poster.png" onplay="alert(11)"></video>
  </div>`;

  /** Nodes that the reader refuses and that a hostile view could still carry: the renderer is the last guard. */
  const Injected = JSON.parse(`[
    {"kind":"p","children":[
      {"kind":"element","namespace":"http://www.w3.org/2000/svg","name":"svg","attributes":[{"namespace":"","name":"onload","value":"alert(18)"}],"children":[
        {"kind":"element","namespace":"http://www.w3.org/2000/svg","name":"script","attributes":[],"children":[{"kind":"text","value":"alert(19)"}]}]},
      {"kind":"element","namespace":"http://www.w3.org/1999/xhtml","name":"script","attributes":[],"children":[{"kind":"text","value":"alert(20)"}]},
      {"kind":"element","namespace":"http://www.w3.org/1999/xhtml","name":"iframe","attributes":[{"namespace":"","name":"src","value":"javascript:alert(21)"}],"children":[]},
      {"kind":"element","namespace":"http://www.w3.org/1998/Math/MathML","name":"math","attributes":[{"namespace":"","name":"ONCLICK","value":"alert(22)"},{"namespace":"","name":"Style","value":"x"},{"namespace":"","name":"on x","value":"y"}],"children":[]},
      {"kind":"script","children":[{"kind":"text","value":"alert(23)"}]},
      {"kind":"style","children":[{"kind":"text","value":"p{display:none}"}]},
      {"kind":"p","onclick":"alert(24)","style":"x","srcdoc":"<script>alert(26)</script>","children":[],"extensions":[{"namespace":"","name":"onclick","value":"alert(25)"},{"namespace":"","name":"style","value":"x"},{"namespace":"http://www.w3.org/1999/xhtml","name":"data-x","value":"y"}]}
    ]}
  ]`);

  /** Records the calls of `alert`, which every handler of the markup above makes. */
  async function withAlerts<T>(run: () => Promise<T>): Promise<{ readonly result: T; readonly alerts: unknown[] }> {
    const original = window.alert;
    const alerts: unknown[] = [];
    window.alert = (message?: unknown) => {
      alerts.push(message);
    };
    try {
      return { result: await run(), alerts };
    } finally {
      window.alert = original;
    }
  }

  /** Fires the events that a handler answers, on every element, and waits for the loads that would follow. */
  async function provoke(root: ParentNode): Promise<void> {
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      for (const type of ["click", "mouseover", "focus", "error", "load", "play"]) {
        element.dispatchEvent(new Event(type, { bubbles: true }));
      }
    }
    await new Promise((done) => setTimeout(done, 300));
  }

  it("builds no event handler, inline style, script or frame from markup, and the browser asks no other origin", async () => {
    const { alerts } = await withAlerts(async () => {
      const content = renderBody(Hostile, ASSETS);
      expect(content.root.querySelector("script, svg, embed, link, style, meta, base, iframe")).toBeNull();
      for (const element of content.root.querySelectorAll("*")) {
        const names = element.getAttributeNames();
        expect(
          names.filter((name) => name.startsWith("on")),
          element.localName,
        ).toEqual([]);
        expect(names, element.localName).not.toContain("style");
        expect(
          names.filter((name) => name.includes(":")),
          element.localName,
        ).toEqual([]);
      }
      await provoke(content.root);
    });
    expect(alerts).toEqual([]);
    expect(await hits(stranger)).toEqual([]);
  });

  it("refuses the references of markup: javascript: in every spelling, other origins, in every attribute that loads", () => {
    const content = renderBody(Hostile, ASSETS);
    for (const link of content.findAll("a")) expect(link.hasAttribute("href"), link.textContent ?? "").toBe(false);
    expect(el(content.root, "img[alt=tracker]").hasAttribute("src")).toBe(false);
    expect(el(content.root, "picture > source").hasAttribute("srcset")).toBe(false);
    const video = el(content.root, "video");
    expect(video.hasAttribute("src") || video.hasAttribute("poster")).toBe(false);
    expect(el(content.root, "blockquote").hasAttribute("cite")).toBe(false);
  });

  it("draws the allowed content around the hostile and keeps the text that an object leaves as its fallback", () => {
    const content = renderBody(Hostile, ASSETS);
    expect(el(content.root, "p").textContent).toBe("Text");
    expect(el(content.root, "p").getAttribute("data-ok")).toBe("1");
    expect(content.root.textContent).toContain("fallback");
    expect(content.root.textContent).toContain("fallback2");
    expect(content.root.querySelector("object")).toBeNull();
    expect(el(content.root, "picture > img").getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
  });

  it("draws MathML in the MathML namespace, with its text and without the handlers, links and script of hostile markup", () => {
    const content = renderBody(Hostile, ASSETS);
    const math = el(content.root, "math");
    expect(math.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
    const identifier = el(math, "mi");
    expect(identifier.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
    expect(identifier.textContent).toBe("x");
    expect(identifier.getAttributeNames()).toEqual([]);
    expect(math.getAttributeNames()).toEqual([]);
    expect(math.querySelector("annotation-xml")?.childElementCount).toBe(0);
    expect(math.querySelector("script")).toBeNull();
  });

  it("holds against nodes that no reader would give: foreign elements, properties and attributes of a forged view", async () => {
    const { alerts } = await withAlerts(async () => {
      const content = renderBody("", ASSETS);
      content.root.append(...testRenderer(ASSETS).nodes(Injected));
      expect(content.root.querySelector("script, style, svg, iframe, object, embed")).toBeNull();
      for (const element of content.root.querySelectorAll("*")) {
        expect(
          element.getAttributeNames().filter((name) => name === "style" || name.startsWith("on")),
          element.localName,
        ).toEqual([]);
      }
      expect(content.findAll("p").map((paragraph) => paragraph.getAttributeNames())).toEqual([[], []]);
      const math = el(content.root, "math");
      expect(math.getAttributeNames()).toEqual([]);
      await provoke(content.root);
    });
    expect(alerts).toEqual([]);
  });

  it("gives a node of an unknown kind the name of a QTI element, so that it is never a script or a style", () => {
    const content = renderBody("", ASSETS);
    content.root.append(...testRenderer(ASSETS).nodes(Injected));
    expect(content.findAll("qti-script, qti-style").map((element) => element.localName)).toEqual([
      "qti-script",
      "qti-style",
    ]);
  });

  it("throws DataError for a malformed node instead of building an element from it", () => {
    const renderer = testRenderer(ASSETS);
    const malformed = [
      '{"kind":"p><script>alert(1)</script><p"}',
      '{"kind":"P"}',
      '{"kind":"a b"}',
      '{"kind":1}',
      "null",
      '"text"',
      '{"kind":"text","value":1}',
    ];
    for (const text of malformed) {
      expect(() => renderer.nodes([JSON.parse(text)]), text).toThrow(/^A node of content|^The value of a text node/u);
    }
    expect(() => renderer.nodes(JSON.parse('{"length":1}'))).toThrow(
      "The nodes of content must be an array, found an object.",
    );
  });

  it("drops an attribute name that is not valid, instead of letting the DOM throw", () => {
    const node = JSON.parse(
      '{"kind":"p","children":[],"extensions":[{"namespace":"","name":"data-a b","value":"1"},{"namespace":"","name":"data-\\"x","value":"2"},{"namespace":"","name":"data-ok","value":"3"},{"namespace":"urn:x","name":"data-ns","value":"4"}]}',
    );
    const [paragraph] = testRenderer(ASSETS).nodes([node]);
    expect((paragraph as Element).getAttributeNames()).toEqual(["data-ok"]);
  });

  it("checks that assets returns a string", () => {
    const renderer = testRenderer(ASSETS, { assets: () => JSON.parse("1") });
    expect(() => renderer.nodes(itemBody('<p><img src="a.png" alt="a"/></p>'))).toThrow(
      "The URL that the option assets returned must be a string, found 1.",
    );
  });
});

describe("foreign content", () => {
  it("draws MathML and SSML in their namespaces, which the typesetter and the speech model look for", () => {
    const content = renderBody(
      '<p>Half is <m:math><m:mfrac><m:mn>1</m:mn><m:mn>2</m:mn></m:mfrac></m:math> and <ssml:sub alias="messenger RNA">mRNA</ssml:sub>.</p>',
      ASSETS,
    );
    const math = el(content.root, "math");
    expect(math.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
    expect(math.querySelector("mfrac")?.namespaceURI).toBe("http://www.w3.org/1998/Math/MathML");
    const sub = el(content.root, "p").lastElementChild;
    expect(sub?.localName).toBe("sub");
    expect(sub?.namespaceURI).toBe("http://www.w3.org/2001/10/synthesis");
    expect(sub?.getAttribute("alias")).toBe("messenger RNA");
    expect(sub?.textContent).toBe("mRNA");
  });

  it("keeps xml:lang on SSML and MathML elements, where the speech model reads it, and leaves out an xi:include", () => {
    const content = renderBody(
      '<p><ssml:voice xml:lang="fr">bonjour</ssml:voice><m:math xml:lang="en"><m:mi>x</m:mi></m:math><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="other.xml"/></p>',
      ASSETS,
    );
    expect(
      el(content.root, "p").firstElementChild?.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang"),
    ).toBe("fr");
    expect(el(content.root, "math").getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang")).toBe("en");
    expect(el(content.root, "p").children).toHaveLength(2);
  });

  it("resolves the src of SSML audio against the package", () => {
    const content = renderBody('<p><ssml:audio src="media/chime.wav">chime</ssml:audio></p>', ASSETS);
    expect(el(content.root, "p").firstElementChild?.getAttribute("src")).toBe(`${ITEM_DIRECTORY}media/chime.wav`);
  });
});

describe("printed variables", () => {
  const Declarations = `<qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
    <qti-template-declaration identifier="N" cardinality="single" base-type="integer"/>
    <qti-template-declaration identifier="LINK" cardinality="single" base-type="uri"/>
    <qti-template-declaration identifier="UPLOAD" cardinality="single" base-type="file"/>`;
  const Body =
    '<p>Score <qti-printed-variable identifier="SCORE" format="%.1f"/> of <qti-printed-variable identifier="N"/>, see <qti-printed-variable identifier="LINK"/>: <qti-printed-variable identifier="UPLOAD"/>.</p>';

  const variables = {
    outcomes: new Map([["SCORE", buildSingle("float", 0.7)]]),
    templates: new Map([
      ["N", buildSingle("integer", 4)],
      ["LINK", buildSingle("uri", "files/guide.pdf")],
      ["UPLOAD", buildSingle("file", { reference: "upload-1", mimeType: "text/plain", fileName: "answer.txt" })],
    ]),
  };

  it("prints the text as the runtime formats it: the format, the integer default, a uri and the name of a file", () => {
    const content = renderBody(Body, ASSETS, {}, Declarations);
    expect(content.root.textContent).toBe("Score  of , see : .");
    const printed = renderBody(Body, ASSETS, { variables }, Declarations);
    expect(printed.root.textContent).toBe("Score 0.7 of 4, see files/guide.pdf: answer.txt.");
  });

  it("shows a uri as a link to the file in the package and a file as a link where the host gives its URL", () => {
    const content = renderBody(
      Body,
      ASSETS,
      { variables, fileUrl: (file) => `${asset}/f/${file.reference}` },
      Declarations,
    );
    const [link, upload] = content.findAll("qti-printed-variable a");
    expect(link?.getAttribute("href")).toBe(`${ITEM_DIRECTORY}files/guide.pdf`);
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(upload?.getAttribute("href")).toBe(`${asset}/f/upload-1`);
    expect(upload?.textContent).toBe("answer.txt");
  });

  it("shows a uri that the policy refuses as text, not as a link", () => {
    const hostile = {
      ...variables,
      templates: new Map([["LINK", buildSingle("uri", "javascript:alert(1)")]]),
    };
    const content = renderBody(Body, ASSETS, { variables: hostile }, Declarations);
    expect(content.root.querySelector("a")).toBeNull();
    expect(content.root.textContent).toContain("see javascript:alert(1):");
  });

  it("draws the text that the runtime's resolveContent put in place of a printed variable", () => {
    const document = readAsi(
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="r" title="r" adaptive="false" time-dependent="false">${Declarations}<qti-item-body>${Body}</qti-item-body></qti-assessment-item>`,
    );
    if (document.kind !== "item" || document.item.body === undefined) throw new Error("not an item");
    const resolved = resolveContent(document.item.body.children, variables, document.item, { view: "candidate" });
    const content = renderBody("", ASSETS);
    content.root.append(...testRenderer(ASSETS).nodes(resolved));
    expect(content.root.querySelector("qti-printed-variable")).toBeNull();
    expect(content.root.textContent).toBe("Score 0.7 of 4, see files/guide.pdf: answer.txt.");
  });
});

describe("feedback, template content and rubric", () => {
  const Declarations = `<qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
    <qti-template-declaration identifier="T" cardinality="single" base-type="identifier"/>`;
  const Body = `<p>Question.</p>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="right" show-hide="show" class="qti-well"><qti-content-body><p>Well done.</p></qti-content-body></qti-feedback-block>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="wrong" show-hide="show"><qti-content-body><p>Try again.</p></qti-content-body></qti-feedback-block>
    <p>Inline: <qti-feedback-inline outcome-identifier="FEEDBACK" identifier="right" show-hide="show">correct</qti-feedback-inline><qti-feedback-inline outcome-identifier="FEEDBACK" identifier="wrong" show-hide="show">incorrect</qti-feedback-inline>.</p>
    <qti-template-block template-identifier="T" identifier="a" show-hide="show"><qti-content-body><p>Variant A.</p></qti-content-body></qti-template-block>
    <qti-template-block template-identifier="T" identifier="b" show-hide="show"><qti-content-body><p>Variant B.</p></qti-content-body></qti-template-block>
    <p>Template: <qti-template-inline template-identifier="T" identifier="a" show-hide="show">alpha</qti-template-inline><qti-template-inline template-identifier="T" identifier="b" show-hide="show">beta</qti-template-inline>.</p>`;

  /** Resolves the body as the engine does for an outcome and a template value, with the runtime. */
  function resolved(outcome: string, template: string) {
    const document = readAsi(
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="f" title="f" adaptive="false" time-dependent="false">${Declarations}<qti-item-body>${Body}</qti-item-body></qti-assessment-item>`,
    );
    if (document.kind !== "item" || document.item.body === undefined) throw new Error("not an item");
    const variables = {
      outcomes: new Map([["FEEDBACK", buildSingle("identifier", outcome)]]),
      templates: new Map([["T", buildSingle("identifier", template)]]),
    };
    return resolveContent(document.item.body.children, variables, document.item, { view: "candidate" });
  }

  function render(outcome: string, template: string) {
    const content = renderBody("", ASSETS);
    content.root.append(...testRenderer(ASSETS).nodes(resolved(outcome, template)));
    return content;
  }

  it("draws the feedback blocks and inline feedback that the view resolved, and none that it removed", () => {
    const content = render("right", "a");
    const blocks = content.findAll("qti-feedback-block");
    expect(blocks.map((block) => block.textContent?.trim())).toEqual(["Well done."]);
    expect(blocks[0]?.className).toBe("qti-well");
    expect(el(blocks[0] as Element, "qti-content-body > p").textContent).toBe("Well done.");
    expect(content.findAll("qti-feedback-inline").map((inline) => inline.textContent)).toEqual(["correct"]);
    expect(getComputedStyle(el(content.root, "qti-feedback-block")).display).toBe("block");
    expect(getComputedStyle(el(content.root, "qti-feedback-inline")).display).toBe("inline");
    const other = render("wrong", "a");
    expect(other.findAll("qti-feedback-block").map((block) => block.textContent?.trim())).toEqual(["Try again."]);
  });

  it("draws the template blocks and inline template content that the view resolved", () => {
    const content = render("right", "b");
    expect(content.findAll("qti-template-block").map((block) => block.textContent?.trim())).toEqual(["Variant B."]);
    expect(content.findAll("qti-template-inline").map((inline) => inline.textContent)).toEqual(["beta"]);
    expect(getComputedStyle(el(content.root, "qti-template-block")).display).toBe("block");
  });

  const Rubric = (view: string, use: string): string =>
    `<qti-rubric-block view="${view}" use="${use}" class="qti-bordered"><qti-content-body><p>Read the passage.</p></qti-content-body></qti-rubric-block>`;

  it("draws a rubric block for the candidate with its use, and leaves out a block for another view", () => {
    const content = renderBody(
      `${Rubric("candidate", "instructions")}${Rubric("scorer", "scoring")}${Rubric("candidate tutor", "navigation")}`,
      ASSETS,
    );
    const blocks = content.findAll("qti-rubric-block");
    expect(blocks.map((block) => block.getAttribute("data-use"))).toEqual(["instructions", "navigation"]);
    expect(blocks[0]?.className).toBe("qti-bordered");
    expect(el(content.root, "qti-rubric-block > qti-content-body > p").textContent).toBe("Read the passage.");
    expect(getComputedStyle(el(content.root, "qti-rubric-block")).display).toBe("block");
  });

  it("draws the rubric of the view that the renderer is for: a scorer sees the scoring rubric", () => {
    const content = renderBody(`${Rubric("candidate", "instructions")}${Rubric("scorer", "scoring")}`, ASSETS, {
      view: "scorer",
    });
    expect(content.findAll("qti-rubric-block").map((block) => block.getAttribute("data-use"))).toEqual(["scoring"]);
  });

  it("ignores an extension use: the block is drawn without data-use", () => {
    const content = renderBody(Rubric("candidate", "ext:glossary"), ASSETS);
    const block = el(content.root, "qti-rubric-block");
    expect(block.hasAttribute("data-use")).toBe(false);
    expect(block.textContent?.trim()).toBe("Read the passage.");
  });
});

// Tabs and sortable tables ------------------------------------------------------------------------------------------------

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** A content root and the host element in the page that holds it. */
type Shown = ContentRoot & { readonly host: HTMLElement };

/** Shows an item body, and the stimuli that the content names, in a new content root of the page or in the one given. */
async function showBody(
  body: string,
  extra: { readonly stimuli?: readonly string[]; readonly language?: string } = {},
  root?: Shown,
): Promise<Shown> {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const shown =
    root ??
    Object.assign(
      createContentRoot(host, {
        messages: EN_MESSAGES,
        assets: (path) => `${ASSETS}${path}`,
        fetch: () => Promise.reject(new Error("The fixture has no stylesheet.")),
        stylesheet: stylesheet(PLAYER_CSS),
      }),
      { host },
    );
  const content: RootContent = {
    body: { nodes: itemBody(body), base: ITEM_PATH },
    stimuli: (extra.stimuli ?? []).map((stimulus) => ({ nodes: itemBody(stimulus), base: ITEM_PATH })),
    ...(extra.language === undefined ? {} : { language: extra.language }),
  };
  await shown.show(content);
  return shown;
}

const all = (root: Shown, selector: string): HTMLElement[] => [...root.root.querySelectorAll<HTMLElement>(selector)];

describe("tabs", () => {
  const Tabs = `<div role="tablist" aria-label="Sources">
    <span role="tab" id="tab-email" aria-controls="panel-email" aria-selected="true">Email</span>
    <span role="tab" id="tab-memo" aria-controls="panel-memo">Memo</span>
    <span role="tab" id="tab-notes" aria-controls="panel-notes">Notes</span>
  </div>
  <div role="tabpanel" id="panel-email" aria-labelledby="tab-email"><p>Email text.</p></div>
  <div role="tabpanel" id="panel-memo" aria-labelledby="tab-memo"><p>Memo text.</p></div>
  <div role="tabpanel" id="panel-notes" aria-labelledby="tab-notes"><p>Notes text.</p></div>`;

  /** The state the player sets: for each tab `aria-selected` and `tabindex`, and for each panel whether it is hidden. */
  function state(root: Shown) {
    return {
      selected: all(root, "[role=tab]").map((tab) => tab.getAttribute("aria-selected")),
      tabindex: all(root, "[role=tab]").map((tab) => tab.getAttribute("tabindex")),
      hidden: all(root, "[role=tabpanel]").map((panel) => panel.hidden),
    };
  }

  const tab = (root: Shown, id: string): HTMLElement => {
    const found = root.root.getElementById(id);
    if (found === null) throw new Error(`The fixture has no tab ${id}.`);
    return found;
  };

  it("shows the panel of the tab marked selected, hides the others and gives the selected tab the tab stop", async () => {
    const root = await showBody(Tabs);
    expect(state(root)).toEqual({
      selected: ["true", "false", "false"],
      tabindex: ["0", "-1", "-1"],
      hidden: [false, true, true],
    });
    for (const panel of all(root, "[role=tabpanel]")) {
      expect(getComputedStyle(panel).display).toBe(panel.hidden ? "none" : "block");
    }
  });

  it("selects the first tab when none is marked, and the marked one when it is not the first", async () => {
    const unmarked = await showBody(Tabs.replace(' aria-selected="true"', ""));
    expect(state(unmarked).selected).toEqual(["true", "false", "false"]);
    const second = await showBody(
      Tabs.replace(' aria-selected="true"', "").replace('id="tab-memo"', 'id="tab-memo" aria-selected="true"'),
    );
    expect(state(second)).toMatchObject({ selected: ["false", "true", "false"], hidden: [true, false, true] });
  });

  it("selects the tab that a press reaches, with the pointer", async () => {
    const root = await showBody(Tabs);
    await userEvent.click(tab(root, "tab-memo"));
    expect(state(root)).toEqual({
      selected: ["false", "true", "false"],
      tabindex: ["-1", "0", "-1"],
      hidden: [true, false, true],
    });
    expect(root.root.activeElement).toBe(tab(root, "tab-memo"));
  });

  it("moves and selects with Left and Right, wrapping at the ends, and with Home and End", async () => {
    const root = await showBody(Tabs);
    await userEvent.type(tab(root, "tab-email"), "{ArrowRight}");
    expect(state(root).selected).toEqual(["false", "true", "false"]);
    expect(root.root.activeElement).toBe(tab(root, "tab-memo"));
    await userEvent.keyboard("{End}");
    expect(root.root.activeElement).toBe(tab(root, "tab-notes"));
    await userEvent.keyboard("{ArrowRight}");
    expect(state(root).selected).toEqual(["true", "false", "false"]);
    await userEvent.keyboard("{ArrowLeft}");
    expect(root.root.activeElement).toBe(tab(root, "tab-notes"));
    await userEvent.keyboard("{Home}");
    expect(state(root)).toMatchObject({ selected: ["true", "false", "false"], hidden: [false, true, true] });
    expect(root.root.activeElement).toBe(tab(root, "tab-email"));
  });

  it("leaves the keys with a modifier to the browser", async () => {
    const root = await showBody(Tabs);
    await userEvent.type(tab(root, "tab-email"), "{Shift>}{ArrowRight}{/Shift}");
    expect(state(root).selected).toEqual(["true", "false", "false"]);
  });

  it("turns the arrows round where the text runs from right to left", async () => {
    const root = await showBody(Tabs.replace('role="tablist"', 'role="tablist" dir="rtl"'));
    await userEvent.type(tab(root, "tab-email"), "{ArrowLeft}");
    expect(root.root.activeElement).toBe(tab(root, "tab-memo"));
    await userEvent.keyboard("{ArrowRight}");
    expect(root.root.activeElement).toBe(tab(root, "tab-email"));
  });

  it("keeps the tab of a stimulus that the next content shares, and starts a tablist it has not shown from the default", async () => {
    const root = await showBody("<p>First item.</p>", { stimuli: [Tabs] });
    await userEvent.click(tab(root, "tab-notes"));
    await showBody("<p>Second item.</p>", { stimuli: [Tabs] }, root);
    expect(state(root)).toMatchObject({ selected: ["false", "false", "true"], hidden: [true, true, false] });
    const other = Tabs.replaceAll("email", "mail").replaceAll("memo", "note").replaceAll("notes", "log");
    await showBody("<p>Third item.</p>", { stimuli: [other] }, root);
    expect(state(root).selected).toEqual(["true", "false", "false"]);
    await showBody("<p>Fourth item.</p>", { stimuli: [Tabs] }, root);
    expect(state(root).selected).toEqual(["false", "false", "true"]);
  });

  it("leaves a tablist as authored when a tab names no panel, so that every panel shows", async () => {
    const root = await showBody(Tabs.replace('aria-controls="panel-notes"', 'aria-controls="missing"'));
    expect(state(root)).toEqual({
      selected: ["true", null, null],
      tabindex: [null, null, null],
      hidden: [false, false, false],
    });
    expect(all(root, "[role=tablist]")[0]?.classList.contains("ak-tablist")).toBe(false);
  });

  it("is read aloud and followed by the line reader for the panel that shows alone", async () => {
    const root = await showBody(
      Tabs.replaceAll("Email text.", "Email text one.").replaceAll("Memo text.", "Memo text two."),
    );
    const range = document.createRange();
    range.selectNodeContents(root.stage);
    const read = () =>
      buildSpeechRequest(range, {
        settings: { readingType: "computer-read-aloud", restrictionTypes: [] },
        messages: EN_MESSAGES,
        language: "en",
      })?.text;
    expect(read()).toContain("Email text one.");
    expect(read()).not.toContain("Memo text two.");
    await userEvent.click(tab(root, "tab-memo"));
    expect(read()).toContain("Memo text two.");
    expect(read()).not.toContain("Email text one.");

    const tools = document.createElement("div");
    document.body.append(tools);
    hosts.push(tools);
    const handle = mountTools(tools, {
      messages: EN_MESSAGES,
      language: "en",
      stage: root.stage,
      assets: (path) => path,
      slots: {},
      onSupport: () => undefined,
    });
    handle.update({ companion: null, supports: [supportView("line-reader", { state: "active", active: true })] });
    const band = root.stage.querySelector("[role=slider]");
    // The tablist and the one paragraph that shows are the lines; the two hidden paragraphs are none.
    expect(band?.getAttribute("aria-valuemax")).toBe("2");
    handle.destroy();
  });

  it("passes axe at WCAG 2.2 AA with the first and with the last tab selected", async () => {
    const root = await showBody(Tabs);
    expect(await axeViolations(root.host)).toEqual([]);
    await userEvent.click(tab(root, "tab-notes"));
    expect(await axeViolations(root.host)).toEqual([]);
  });
});

describe("sortable tables", () => {
  const Revenue = `<table>
    <caption>Revenue by region</caption>
    <thead><tr><th aria-sort="none">Region</th><th aria-sort="none">Revenue</th><th>Note</th></tr></thead>
    <tbody>
      <tr><td>North</td><td data-ak-sort-value="1200">$1,200</td><td>a</td></tr>
      <tr><td>South</td><td data-ak-sort-value="900">$900</td><td>b</td></tr>
      <tr><td>East</td><td data-ak-sort-value="1200">$1,200</td><td>c</td></tr>
      <tr><td>West</td><td data-ak-sort-value="50">$50</td><td>d</td></tr>
    </tbody>
  </table>`;

  const column = (root: Shown, index: number): string[] =>
    all(root, "tbody tr").map((row) => row.children[index]?.textContent ?? "");
  const header = (root: Shown, index: number): HTMLElement => {
    const found = all(root, "thead th")[index];
    if (found === undefined) throw new Error(`The fixture has no header ${index}.`);
    return found;
  };
  const press = async (root: Shown, index: number): Promise<void> => {
    const button = header(root, index).querySelector("button");
    if (button === null) throw new Error(`The header ${index} has no button.`);
    await userEvent.click(button);
  };
  const sorts = (root: Shown): (string | null)[] => all(root, "thead th").map((cell) => cell.getAttribute("aria-sort"));

  it("puts a button around the content of each header that has aria-sort, and none around the others", async () => {
    const root = await showBody(Revenue);
    expect(all(root, "thead th").map((cell) => cell.querySelector("button")?.textContent?.replace(/\W/g, ""))).toEqual([
      "Region",
      "Revenue",
      undefined,
    ]);
    expect(all(root, "thead th button").every((button) => button.getAttribute("type") === "button")).toBe(true);
    expect(header(root, 2).textContent).toBe("Note");
  });

  it("sorts ascending and then descending by the sort value of the cells, stably, and marks the headers", async () => {
    const root = await showBody(Revenue);
    await press(root, 1);
    expect(column(root, 0)).toEqual(["West", "South", "North", "East"]);
    expect(sorts(root)).toEqual(["none", "ascending", null]);
    await press(root, 1);
    expect(column(root, 0)).toEqual(["North", "East", "South", "West"]);
    expect(sorts(root)).toEqual(["none", "descending", null]);
    await press(root, 0);
    expect(column(root, 0)).toEqual(["East", "North", "South", "West"]);
    expect(sorts(root)).toEqual(["ascending", "none", null]);
  });

  it("sorts from the keyboard, keeps the focus on the button that was pressed, and moves the rows themselves", async () => {
    const root = await showBody(Revenue);
    const rows = all(root, "tbody tr");
    const button = el(header(root, 1), "button");
    // Safari leaves a button out of the tab order and does not focus it on a press, so the test focuses it and presses the
    // key in one command.
    await userEvent.type(button, "{Enter}");
    expect(column(root, 0)).toEqual(["West", "South", "North", "East"]);
    await userEvent.keyboard(" ");
    expect(column(root, 0)).toEqual(["North", "East", "South", "West"]);
    expect(root.root.activeElement).toBe(button);
    expect(new Set(all(root, "tbody tr"))).toEqual(new Set(rows));
  });

  it("sorts the text of a column in the collation of the language of the content, with numbers inside text in order", async () => {
    const cities = `<table><thead><tr><th aria-sort="none">City</th></tr></thead>
      <tbody><tr><td>Zeta</td></tr><tr><td>Ärlig</td></tr><tr><td>Alfa</td></tr><tr><td>Zone 10</td></tr><tr><td>Zone 9</td></tr></tbody></table>`;
    const swedish = await showBody(cities, { language: "sv" });
    await press(swedish, 0);
    expect(column(swedish, 0)).toEqual(["Alfa", "Zeta", "Zone 9", "Zone 10", "Ärlig"]);
    const german = await showBody(cities, { language: "de" });
    await press(german, 0);
    expect(column(german, 0)).toEqual(["Alfa", "Ärlig", "Zeta", "Zone 9", "Zone 10"]);
    const invalid = await showBody(cities, { language: "xx_YY" });
    await press(invalid, 0);
    expect(column(invalid, 0)).toHaveLength(5);
  });

  it("sorts a table with more rows than a call can take as arguments", () => {
    // 130,000 rows, which a spread into append refuses with a RangeError in Chromium and WebKit. The table is built in the
    // page, as the renderer would build it, so that the test times the sort and not the reading of an item that large.
    const count = 130_000;
    const container = document.createElement("div");
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    const header = document.createElement("th");
    header.setAttribute("aria-sort", "none");
    header.textContent = "N";
    head.append(header);
    const body = table.createTBody();
    // insertRow counts the rows on each call, so the rows are made and appended instead.
    for (let index = 0; index < count; index += 1) {
      const row = document.createElement("tr");
      row.append(Object.assign(document.createElement("td"), { textContent: String(count - index) }));
      body.append(row);
    }
    container.append(table);
    document.body.append(container);
    hosts.push(container);
    enableSorting(container);
    // A click of the page, not of the driver, whose checks wait for the layout of so many rows.
    header.querySelector("button")?.click();
    expect([body.rows[0]?.textContent, body.rows[count - 1]?.textContent]).toEqual(["1", String(count)]);
  });

  it("orders a column by value when every key is a number, and by the text when one is not", async () => {
    const numbers = (cells: readonly string[]): string =>
      `<table><thead><tr><th aria-sort="none">N</th></tr></thead><tbody>${cells.map((cell) => `<tr><td>${cell}</td></tr>`).join("")}</tbody></table>`;
    const values = await showBody(numbers(["99", "1e2", "-5", ".5", "+7"]));
    await press(values, 0);
    expect(column(values, 0)).toEqual(["-5", ".5", "+7", "99", "1e2"]);
    const mixed = await showBody(numbers(["99", "1e2", "n/a"]));
    await press(mixed, 0);
    expect(column(mixed, 0)).toEqual(["1e2", "99", "n/a"]);
  });

  it("starts descending where the author marked the header ascending, and sorts a row that lacks the cell by an empty key", async () => {
    const root = await showBody(
      Revenue.replace('<th aria-sort="none">Revenue</th>', '<th aria-sort="ascending">Revenue</th>'),
    );
    await press(root, 1);
    expect(sorts(root)).toEqual(["none", "descending", null]);
    expect(column(root, 0)).toEqual(["North", "East", "South", "West"]);
    const short = await showBody(
      Revenue.replace('<tr><td>West</td><td data-ak-sort-value="50">$50</td><td>d</td></tr>', "<tr><td>West</td></tr>"),
    );
    await press(short, 1);
    expect(column(short, 0)).toEqual(["West", "South", "North", "East"]);
  });

  it("follows a colspan when it looks for the cell of a column", async () => {
    const spanning = `<table><thead><tr><th aria-sort="none">A</th><th aria-sort="none">B</th></tr></thead>
      <tbody><tr><td colspan="2">9</td></tr><tr><td>1</td><td>8</td></tr></tbody></table>`;
    const root = await showBody(spanning);
    await press(root, 1);
    expect(all(root, "tbody tr").map((row) => row.children.length)).toEqual([2, 1]);
  });

  it("leaves a table as authored when it has a rowspan, several bodies, a restarting interaction or no header to sort by", async () => {
    const rowspan = Revenue.replace("<td>a</td>", '<td rowspan="2">a</td>');
    const bodies = Revenue.replace("</tbody>", "</tbody><tbody><tr><td>X</td><td>1</td><td>x</td></tr></tbody>");
    const media = Revenue.replace(
      "<td>b</td>",
      '<td><qti-media-interaction response-identifier="M" autostart="false"><object data="a.mp3" type="audio/mpeg"/></qti-media-interaction></td>',
    );
    const plain = Revenue.replaceAll(' aria-sort="none"', "");
    for (const [table, authored] of [
      [rowspan, ["none", "none", null]],
      [bodies, ["none", "none", null]],
      [media, ["none", "none", null]],
      [plain, [null, null, null]],
    ] as const) {
      const root = await showBody(table);
      expect(all(root, "button")).toHaveLength(0);
      expect(sorts(root)).toEqual(authored);
    }
  });

  it("draws the table again, unsorted, when the content is shown again", async () => {
    const root = await showBody(Revenue);
    await press(root, 1);
    await showBody(Revenue, {}, root);
    expect(column(root, 0)).toEqual(["North", "South", "East", "West"]);
    expect(sorts(root)).toEqual(["none", "none", null]);
  });

  it("passes axe at WCAG 2.2 AA, unsorted and sorted", async () => {
    const root = await showBody(Revenue);
    expect(await axeViolations(root.host)).toEqual([]);
    await press(root, 1);
    expect(await axeViolations(root.host)).toEqual([]);
  });
});

describe("tabs and sorted tables in a session", () => {
  const Item = `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="tabs" title="Tabs" adaptive="false" time-dependent="false">
    <qti-response-declaration identifier="TAB" cardinality="single" base-type="string"/>
    <qti-response-declaration identifier="ROW1" cardinality="single" base-type="string"/>
    <qti-response-declaration identifier="ROW2" cardinality="single" base-type="string"/>
    <qti-item-body>
      <div role="tablist" aria-label="Parts">
        <span role="tab" id="t1" aria-controls="p1" aria-selected="true">One</span>
        <span role="tab" id="t2" aria-controls="p2">Two</span>
      </div>
      <div role="tabpanel" id="p1" aria-labelledby="t1"><p>First panel.</p></div>
      <div role="tabpanel" id="p2" aria-labelledby="t2"><p>Answer <qti-text-entry-interaction response-identifier="TAB" expected-length="6"/></p></div>
      <table>
        <caption>Answers by name</caption>
        <thead><tr><th aria-sort="none">Name</th><th>Answer</th></tr></thead>
        <tbody>
          <tr><td>b</td><td><qti-text-entry-interaction response-identifier="ROW1" expected-length="6"/></td></tr>
          <tr><td>a</td><td><qti-text-entry-interaction response-identifier="ROW2" expected-length="6"/></td></tr>
        </tbody>
      </table>
    </qti-item-body>
  </qti-assessment-item>`;

  it("keeps the drafts of the interactions in a hidden panel and in a sorted row, and sends no action of its own", async () => {
    const parsed = readAsi(Item);
    if (parsed.kind !== "item") throw new Error("The fixture is not an item.");
    const saved = new Map<string, string>();
    const client = await createLocalSession({
      definition: { kind: "item", item: parsed.item, base: "items/tabs.xml" },
      store: {
        load: async (session) => saved.get(session),
        save: async (session, { state }) => void saved.set(session, state),
      },
      session: "tabs",
      seed: 1,
      assets: (path) => `${ASSETS}${path}`,
    });
    const sent: string[] = [];
    const recording = Object.create(client, {
      dispatch: {
        value: (action: Parameters<typeof client.dispatch>[0]) => {
          sent.push(action.type);
          return client.dispatch(action);
        },
      },
    });
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PLAYER_CSS);
    mountItem(host, {
      client: recording,
      files: {
        upload: async () => ({ reference: "f", mimeType: "image/png" }),
        read: async () => new Uint8Array(),
        url: () => "",
        ...NO_RECORDING,
      },
      staticUrl: `${ASSETS}static/`,
      stylesheet: sheet,
      fetch: async () => ({ ok: false, status: 404, text: async () => "" }),
    });
    const content = (): ShadowRoot => {
      const holder = host.shadowRoot?.querySelector(".ak-content-host");
      if (holder?.shadowRoot == null) throw new Error("The item is not on screen.");
      return holder.shadowRoot;
    };
    const inputs = (): HTMLInputElement[] => [
      ...content().querySelectorAll<HTMLInputElement>("qti-text-entry-interaction input"),
    ];
    await waitFor(() => expect(inputs()).toHaveLength(3));
    const [tabEntry, firstRow, secondRow] = inputs();
    if (tabEntry === undefined || firstRow === undefined || secondRow === undefined) throw new Error("Three inputs.");
    const tab = (id: string): HTMLElement => {
      const found = content().getElementById(id);
      if (found === null) throw new Error(`No ${id}.`);
      return found;
    };

    await userEvent.click(tab("t2"));
    await userEvent.fill(tabEntry, "alpha");
    await userEvent.fill(firstRow, "beta");
    await userEvent.fill(secondRow, "gamma");
    await waitFor(() => expect(recording.view.current?.responses.size).toBe(3));
    const drafts = new Map(recording.view.current?.responses);
    const actions = sent.length;

    await userEvent.click(tab("t1"));
    await userEvent.click(tab("t2"));
    await userEvent.click(content().querySelector("thead th button") as HTMLElement);
    expect([...content().querySelectorAll("tbody tr td:first-child")].map((cell) => cell.textContent)).toEqual([
      "a",
      "b",
    ]);
    expect(
      inputs()
        .map((input) => input.value)
        .sort(),
    ).toEqual(["alpha", "beta", "gamma"]);
    expect(inputs()).toContain(tabEntry);
    expect(tabEntry.value).toBe("alpha");
    expect(firstRow.value).toBe("beta");
    expect(secondRow.value).toBe("gamma");
    expect(sent).toHaveLength(actions);
    expect(recording.view.current?.responses).toEqual(drafts);
  });
});
