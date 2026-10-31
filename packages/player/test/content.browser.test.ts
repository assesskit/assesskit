import { readAsi } from "@assesskit/runtime/asi";
import { resolveContent } from "@assesskit/runtime/content";
import { createItemVariables } from "@assesskit/runtime/processing";
import { single } from "@assesskit/runtime/values";
import { parseXml, type XmlElement } from "@assesskit/runtime/xml";
import { describe, expect, inject, it } from "vitest";
import { axeViolations, itemBody, renderBody, testRenderer } from "./renderer-fixture.js";

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

  it("[T1] renders the nodes of the body in order, with the text between them", () => {
    const content = renderBody("<p>One <em>two</em>, <strong>three</strong>.</p>\n<p>Four</p>", ASSETS);
    expect(content.root.innerHTML).toBe("<p>One <em>two</em>, <strong>three</strong>.</p><p>Four</p>");
  });

  it("[T3] renders every HTML element as the element of the same name, in the order of the document", () => {
    const content = renderBody(Body, ASSETS);
    const expected = namesOf(
      parseXml(`<root xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">${Body}</root>`),
    ).slice(1);
    expect([...content.root.querySelectorAll("*")].map((element) => element.localName)).toEqual(expected);
  });

  it("[T3][SC 1.3.1] keeps the headers and scopes of a table, the summary of details and the caption of a figure", async () => {
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

  it("[T3] leaves the open attribute off a closed details, as HTML reads the attribute by its presence", () => {
    const content = renderBody('<div><details open="false"><summary>S</summary><p>P</p></details></div>', ASSETS);
    expect(el(content.root, "details").hasAttribute("open")).toBe(false);
  });

  it("[T2] draws a prompt and the label of an inline choice as the elements of QTI beside the other content", () => {
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

  it("[T1] draws an interaction without a renderer as a placeholder that holds its content, with its attributes of class and id", () => {
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

  it("[T1] gives an interaction to the renderer registered for its kind, with the renderer of the body to render its content", () => {
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

describe("images", () => {
  it("[T4] loads the image through assets, from the path against the document of the item", async () => {
    const content = renderBody('<p><img src="images/dot.png" alt="A dot"/></p>', ASSETS);
    const image = el(content.root, "img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
    await image.decode();
    expect(image.naturalWidth).toBe(1);
    expect(image.alt).toBe("A dot");
  });

  it("[T4][SC 1.1.1] keeps the alt text, the long description link and the size, and passes axe", async () => {
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

  it("[T4] multiplies the pixel size of an image by the magnification of non-text content, and not a percentage", () => {
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

  it("[T4] resolves the sources of a picture, with their srcset and sizes", () => {
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

  it("[T4] starts the references below an element with xml:base at that base, as XML Base reads it, and nowhere else", () => {
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

  it("[T4] refuses an image from an origin that the options do not name, and the browser never asks the origin", async () => {
    const leak = `${stranger}/${TOKEN}/leak.png`;
    const content = renderBody(
      `<p><img src="${leak}" alt="outside"/><img src="//${new URL(stranger).host}/${TOKEN}/leak2.png" alt="outside"/></p>`,
      ASSETS,
    );
    for (const image of content.findAll("img")) expect(image.hasAttribute("src")).toBe(false);
    await new Promise((done) => setTimeout(done, 300));
    expect(await hits(stranger)).toEqual([]);
  });

  it("[T4] loads an image from an origin that the options name", async () => {
    const content = renderBody(`<p><img src="${other}/cdn/${TOKEN}/x.png" alt="named"/></p>`, ASSETS, {
      origins: [other],
    });
    expect(el(content.root, "img").getAttribute("src")).toBe(`${other}/cdn/${TOKEN}/x.png`);
  });

  it("[T4] keeps the data URL of a raster image and refuses one of an SVG", () => {
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

  it("[T5] gives the player the controls of the browser whatever the item says, and never starts it", () => {
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

  it("[T5] renders the sources and the tracks of a video: captions, descriptions, subtitles and chapters", () => {
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

  it("[T5] passes axe with the captions track that WCAG 1.2.2 asks for", async () => {
    const content = renderBody(Media, ASSETS);
    expect(await axeViolations(content.host)).toEqual([]);
  });
});

describe("objects", () => {
  const object = (attributes: string, inside = ""): string => `<p><object ${attributes}>${inside}</object></p>`;

  it("[T6] draws an object of an image type as an image whose alt is its fallback content", async () => {
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

  it("[T6] prefers the alt that an author gives the object beside the schema, and leaves out its data and type", () => {
    const content = renderBody(
      object('data="images/dot.png" type="image/png" alt="Short alternative"', "Long fallback"),
      ASSETS,
    );
    const image = el(content.root, "img");
    expect(image.getAttribute("alt")).toBe("Short alternative");
    expect(image.hasAttribute("data")).toBe(false);
    expect(image.hasAttribute("type")).toBe(false);
  });

  it("[T6] draws an object of an audio or video type as the element that plays it, with controls", () => {
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

  it("[T6] puts a page in a frame with an empty sandbox, so that it runs no script and is not of the origin of the player", async () => {
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

  it("[T6] offers a file of any other type as a link that opens in a tab of its own, with the fallback as its text", () => {
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

  it("[T6] does not draw the parameters, which are for plug-ins, and keeps the fallback where the file is refused", () => {
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

  it("[T6] shows the value that param-variable put in a parameter as the runtime resolved it", () => {
    const document = readAsi(
      `<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="p" title="p" adaptive="false" time-dependent="false">
         <qti-template-declaration identifier="SRC" cardinality="single" base-type="string" param-variable="true"/>
         <qti-item-body><p><object data="images/dot.png" type="image/png"><param name="label" value="SRC" valuetype="DATA"/>fallback</object></p></qti-item-body>
       </qti-assessment-item>`,
    );
    if (document.kind !== "item" || document.item.body === undefined) throw new Error("not an item");
    const variables = createItemVariables(document.item);
    const templates = new Map(variables.templates).set("SRC", single("string", "resolved"));
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
  it("[T7] links a file of the package to its URL and opens it in a tab of its own, without an opener or a referrer", () => {
    const content = renderBody('<p><a href="files/data.pdf">Data</a></p>', ASSETS);
    const link = el(content.root, "a");
    expect(link.getAttribute("href")).toBe(`${ITEM_DIRECTORY}files/data.pdf`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("[T7] links an external page only when its origin is named, and then with the same rel", () => {
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

  it("[T7] keeps a link to an id of the item as it is, for the content root to follow", () => {
    const content = renderBody('<p><a href="#note">note</a></p><p id="note">The note.</p>', ASSETS);
    const link = el(content.root, "a");
    expect(link.getAttribute("href")).toBe("#note");
    expect(link.hasAttribute("target")).toBe(false);
  });

  it("[T7] refuses a link with a scheme that runs script", () => {
    const content = renderBody(
      '<p><a href="javascript:alert(1)">a</a><a href="  JaVaScRiPt:alert(1)">b</a><a href="vbscript:x">c</a><a href="data:text/html,x">d</a></p>',
      ASSETS,
    );
    for (const link of content.findAll("a")) expect(link.hasAttribute("href"), link.textContent ?? "").toBe(false);
  });
});

describe("ruby and direction", () => {
  it("[T8] draws the annotation of a ruby above its base and keeps the parentheses for a browser without ruby", () => {
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

  it("[T8] keeps rb and rtc, the elements of complex ruby", () => {
    const content = renderBody("<p><ruby><rb>漢</rb><rb>字</rb><rtc><rt>かん</rt><rt>じ</rt></rtc></ruby></p>", ASSETS);
    expect(content.findAll("rb, rtc, rt").map((element) => element.localName)).toEqual(["rb", "rb", "rtc", "rt", "rt"]);
    expect(el(content.root, "ruby").textContent).toBe("漢字かんじ");
  });

  it("[T8] keeps the direction of text: dir on any element, bdo, bdi, and the auto direction", () => {
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

  it("[T14][SC 3.1.2] sets lang from xml:lang and from lang, and xml:lang wins where an element has both", () => {
    const content = renderBody(Body, ASSETS);
    expect(el(content.root, "p").getAttribute("lang")).toBe("fr");
    expect(el(content.root, "span[lang=de]").textContent).toBe("German");
    expect(el(content.root, "span[lang=id]").textContent).toBe("Indonesian");
    expect(el(content.root, "span[lang='']").textContent).toBe("x");
  });

  it("[T14][SC 3.1.2] lets the browser apply the language of a part: it matches :lang() and passes axe", async () => {
    const content = renderBody(Body, ASSETS);
    expect(el(content.root, "span[lang=de]").matches(":lang(de)")).toBe(true);
    expect(el(content.root, "span[lang=de]").matches(":lang(fr)")).toBe(false);
    expect(el(content.root, "p").matches(":lang(fr)")).toBe(true);
    expect(await axeViolations(content.host)).toEqual([]);
  });
});

describe("attributes", () => {
  it("[T15] passes role and the ARIA attributes, lists included, and the values that are booleans", async () => {
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

  it("[T15] turns data-qti-aria-* into the ARIA attribute it stands for, without replacing one the element has", () => {
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

  it("[T18] keeps data-* attributes of any spelling, and the three attributes of QTI that speech and cards read", () => {
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

  it("[T18] keeps the class, the id and the title-less abbreviations, and drops the label that results report", () => {
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

  it("[T1][T3][T18] builds no event handler, inline style, script or frame from markup, and the browser asks no other origin", async () => {
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

  it("[T1][T3][T7] refuses the references of markup: javascript: in every spelling, other origins, in every attribute that loads", () => {
    const content = renderBody(Hostile, ASSETS);
    for (const link of content.findAll("a")) expect(link.hasAttribute("href"), link.textContent ?? "").toBe(false);
    expect(el(content.root, "img[alt=tracker]").hasAttribute("src")).toBe(false);
    expect(el(content.root, "picture > source").hasAttribute("srcset")).toBe(false);
    const video = el(content.root, "video");
    expect(video.hasAttribute("src") || video.hasAttribute("poster")).toBe(false);
    expect(el(content.root, "blockquote").hasAttribute("cite")).toBe(false);
  });

  it("[T1][T3] draws the allowed content around the hostile and keeps the text that an object leaves as its fallback", () => {
    const content = renderBody(Hostile, ASSETS);
    expect(el(content.root, "p").textContent).toBe("Text");
    expect(el(content.root, "p").getAttribute("data-ok")).toBe("1");
    expect(content.root.textContent).toContain("fallback");
    expect(content.root.textContent).toContain("fallback2");
    expect(content.root.querySelector("object")).toBeNull();
    expect(el(content.root, "picture > img").getAttribute("src")).toBe(`${ITEM_DIRECTORY}images/dot.png`);
  });

  it("[T1] draws MathML in the MathML namespace, with its text and without the handlers, links and script of hostile markup", () => {
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

  it("[T1][T3][T18] holds against nodes that no reader would give: foreign elements, properties and attributes of a forged view", async () => {
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

  it("[T1] gives a node of an unknown kind the name of a QTI element, so that it is never a script or a style", () => {
    const content = renderBody("", ASSETS);
    content.root.append(...testRenderer(ASSETS).nodes(Injected));
    expect(content.findAll("qti-script, qti-style").map((element) => element.localName)).toEqual([
      "qti-script",
      "qti-style",
    ]);
  });

  it("[T1] throws DataError for a malformed node instead of building an element from it", () => {
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

  it("[T1] drops an attribute name that is not valid, instead of letting the DOM throw", () => {
    const node = JSON.parse(
      '{"kind":"p","children":[],"extensions":[{"namespace":"","name":"data-a b","value":"1"},{"namespace":"","name":"data-\\"x","value":"2"},{"namespace":"","name":"data-ok","value":"3"},{"namespace":"urn:x","name":"data-ns","value":"4"}]}',
    );
    const [paragraph] = testRenderer(ASSETS).nodes([node]);
    expect((paragraph as Element).getAttributeNames()).toEqual(["data-ok"]);
  });

  it("[T1] checks that assets returns a string", () => {
    const renderer = testRenderer(ASSETS, { assets: () => JSON.parse("1") });
    expect(() => renderer.nodes(itemBody('<p><img src="a.png" alt="a"/></p>'))).toThrow(
      "The URL that the option assets returned must be a string, found 1.",
    );
  });
});

describe("foreign content", () => {
  it("[T1] draws MathML and SSML in their namespaces, which the typesetter and the speech model look for", () => {
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

  it("[T1] keeps xml:lang on SSML and MathML elements, where the speech model reads it, and leaves out an xi:include", () => {
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

  it("[T1] resolves the src of SSML audio against the package", () => {
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
    outcomes: new Map([["SCORE", single("float", 0.7)]]),
    templates: new Map([
      ["N", single("integer", 4)],
      ["LINK", single("uri", "files/guide.pdf")],
      ["UPLOAD", single("file", { reference: "upload-1", mimeType: "text/plain", fileName: "answer.txt" })],
    ]),
  };

  it("[T19] prints the text as the runtime formats it: the format, the integer default, a uri and the name of a file", () => {
    const content = renderBody(Body, ASSETS, {}, Declarations);
    expect(content.root.textContent).toBe("Score  of , see : .");
    const printed = renderBody(Body, ASSETS, { variables }, Declarations);
    expect(printed.root.textContent).toBe("Score 0.7 of 4, see files/guide.pdf: answer.txt.");
  });

  it("[T19] shows a uri as a link to the file in the package and a file as a link where the host gives its URL", () => {
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

  it("[T19] shows a uri that the policy refuses as text, not as a link", () => {
    const hostile = {
      ...variables,
      templates: new Map([["LINK", single("uri", "javascript:alert(1)")]]),
    };
    const content = renderBody(Body, ASSETS, { variables: hostile }, Declarations);
    expect(content.root.querySelector("a")).toBeNull();
    expect(content.root.textContent).toContain("see javascript:alert(1):");
  });

  it("[T19] draws the text that the runtime's resolveContent put in place of a printed variable", () => {
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
      outcomes: new Map([["FEEDBACK", single("identifier", outcome)]]),
      templates: new Map([["T", single("identifier", template)]]),
    };
    return resolveContent(document.item.body.children, variables, document.item, { view: "candidate" });
  }

  function render(outcome: string, template: string) {
    const content = renderBody("", ASSETS);
    content.root.append(...testRenderer(ASSETS).nodes(resolved(outcome, template)));
    return content;
  }

  it("[T20] draws the feedback blocks and inline feedback that the view resolved, and none that it removed", () => {
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

  it("[T22] draws the template blocks and inline template content that the view resolved", () => {
    const content = render("right", "b");
    expect(content.findAll("qti-template-block").map((block) => block.textContent?.trim())).toEqual(["Variant B."]);
    expect(content.findAll("qti-template-inline").map((inline) => inline.textContent)).toEqual(["beta"]);
    expect(getComputedStyle(el(content.root, "qti-template-block")).display).toBe("block");
  });

  const Rubric = (view: string, use: string): string =>
    `<qti-rubric-block view="${view}" use="${use}" class="qti-bordered"><qti-content-body><p>Read the passage.</p></qti-content-body></qti-rubric-block>`;

  it("[T23] draws a rubric block for the candidate with its use, and leaves out a block for another view", () => {
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

  it("[T23] draws the rubric of the view that the renderer is for: a scorer sees the scoring rubric", () => {
    const content = renderBody(`${Rubric("candidate", "instructions")}${Rubric("scorer", "scoring")}`, ASSETS, {
      view: "scorer",
    });
    expect(content.findAll("qti-rubric-block").map((block) => block.getAttribute("data-use"))).toEqual(["scoring"]);
  });

  it("[T23] ignores an extension use: the block is drawn without data-use", () => {
    const content = renderBody(Rubric("candidate", "ext:glossary"), ASSETS);
    const block = el(content.root, "qti-rubric-block");
    expect(block.hasAttribute("data-use")).toBe(false);
    expect(block.textContent?.trim()).toBe("Read the passage.");
  });
});
