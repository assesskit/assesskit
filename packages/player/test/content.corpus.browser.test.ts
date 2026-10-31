import { ReadError, SecurityError } from "@assesskit/runtime";
import { type AssessmentItem, type BodyNode, readAsi } from "@assesskit/runtime/asi";
import { resolveReference } from "@assesskit/runtime/package";
import { parseXml, type XmlElement } from "@assesskit/runtime/xml";
import { describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { EN_MESSAGES } from "../src/index.js";
import { createContentRoot } from "../src/player/index.js";
import { PLAYER_CSS, stylesheet } from "./css-fixture.js";

/** The origin that the examples are served from: no request is made, the fake fetch answers. */
const ASSETS = "https://assets.example/g/token/";

interface Example {
  readonly path: string;
  readonly xml: string;
  readonly item?: AssessmentItem;
  readonly stimulus?: readonly BodyNode[];
}

const files = await commands.corpusFiles();
const styles = new Map(files.filter(({ path }) => path.endsWith(".css")).map(({ path, text }) => [path, text]));
const examples: Example[] = [];
for (const { path, text } of files) {
  if (!path.endsWith(".xml")) continue;
  try {
    const document = readAsi(text, { path });
    if (document.kind === "item") examples.push({ path, xml: text, item: document.item });
    else if (document.kind === "stimulus")
      examples.push({ path, xml: text, stimulus: document.stimulus.body?.children ?? [] });
  } catch (error) {
    if (!(error instanceof ReadError || error instanceof SecurityError)) throw error;
  }
}

/** Returns the stylesheets of an item that the examples contain: some items name a stylesheet that the examples lack. */
function referenced(path: string, item: AssessmentItem | undefined): string[] {
  return (item?.stylesheets ?? []).flatMap(({ href }) => {
    const target = resolveReference(path, href);
    return target !== undefined && styles.has(target) ? [target] : [];
  });
}

/** Answers the stylesheets of the examples by their path in the examples. */
const fetcher = async (url: string) => {
  const text = styles.get(decodeURIComponent(url.slice(ASSETS.length)));
  return { ok: text !== undefined, status: text === undefined ? 404 : 200, text: async () => text ?? "" };
};

/** The elements that the renderer passes through as the same elements, which a test counts in the source and in the DOM. */
const PASSED = [
  "p",
  "div",
  "span",
  "em",
  "strong",
  "b",
  "i",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "td",
  "th",
  "br",
  "hr",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "figure",
  "figcaption",
  "section",
  "sup",
  "sub",
  "a",
  "img",
];

/** Returns whether an element is a rubric block that the candidate does not see: its `view` does not list `candidate`. */
function isForOthers(element: XmlElement): boolean {
  const view = element.attributes.find(({ name }) => name === "view")?.value ?? "";
  return element.name === "qti-rubric-block" && !view.split(/\s+/u).includes("candidate");
}

/**
 * Counts the elements by name below an XML element, leaving out what the renderer does not draw as it is: catalogs,
 * objects, parameters and the rubric of other views.
 */
function count(element: XmlElement, counts = new Map<string, number>()): Map<string, number> {
  for (const child of element.children) {
    if (
      child.kind !== "element" ||
      ["qti-catalog-info", "object", "param"].includes(child.name) ||
      isForOthers(child)
    ) {
      continue;
    }
    counts.set(child.name, (counts.get(child.name) ?? 0) + 1);
    count(child, counts);
  }
  return counts;
}

/** Returns the body element of an example. */
function bodyOf(xml: string): XmlElement {
  const root = parseXml(xml);
  const body = root.children.find(
    (child): child is XmlElement =>
      child.kind === "element" && (child.name === "qti-item-body" || child.name === "qti-stimulus-body"),
  );
  if (body === undefined) throw new Error("The example has no body.");
  return body;
}

describe("the examples of 1EdTech", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createContentRoot(host, {
    messages: EN_MESSAGES,
    assets: (path) => `${ASSETS}${encodeURIComponent(path)}`,
    fetch: fetcher,
    stylesheet: stylesheet(PLAYER_CSS),
    origins: [],
  });

  it("[T1][T3][T20] finds the items and the stimuli of the examples", () => {
    expect(examples.filter(({ item }) => item !== undefined)).toHaveLength(251);
    expect(examples.filter(({ stimulus }) => stimulus !== undefined)).toHaveLength(1);
  });

  it("[T1][T3][T20] renders the body of every item and stimulus without an error, with every interaction as a placeholder", async () => {
    for (const { path, item, stimulus } of examples) {
      const nodes = item?.body?.children ?? stimulus ?? [];
      const stylesheets = referenced(path, item);
      try {
        await root.show({ body: { nodes, base: path }, stylesheets });
      } catch (error) {
        throw new Error(`${path}: ${String(error)}`);
      }
      const shadow = root.root;
      expect(shadow.querySelector(".ak-body")?.childNodes.length ?? 0, path).toBeGreaterThan(0);
      expect(shadow.querySelector("script, style, embed, svg, link, meta, base"), path).toBeNull();
      for (const frame of shadow.querySelectorAll("iframe"))
        expect(frame.getAttribute("sandbox"), `${path} iframe`).toBe("");
      for (const element of shadow.querySelectorAll("*")) {
        const names = element.getAttributeNames();
        expect(
          names.filter((name) => name === "style" || name.startsWith("on")),
          `${path} ${element.localName}`,
        ).toEqual([]);
      }
      const interactions = [...shadow.querySelectorAll("[data-ak-placeholder]")];
      expect(interactions.length, path).toBe(
        [...shadow.querySelectorAll("*")].filter((element) => element.localName.endsWith("-interaction")).length,
      );
      for (const image of shadow.querySelectorAll("img")) expect(image.hasAttribute("alt"), `${path} img`).toBe(true);
    }
  }, 120_000);

  it("[T3] draws every HTML element of every body as many times as the XML has it", async () => {
    for (const { path, xml, item, stimulus } of examples) {
      await root.show({ body: { nodes: item?.body?.children ?? stimulus ?? [], base: path } });
      const expected = count(bodyOf(xml));
      for (const name of PASSED) {
        const drawn = root.root.querySelectorAll(`.ak-body ${name}`).length;
        // An object of an image type becomes an img and a link, and a refused link or image stays an element without its URL.
        if (name === "img" || name === "a") continue;
        expect(drawn, `${path} ${name}`).toBe(expected.get(name) ?? 0);
      }
    }
  }, 120_000);

  it("[T4][T6][T7] points every image, link and media of the examples at the package, and none at another origin", async () => {
    for (const { path, item, stimulus } of examples) {
      await root.show({ body: { nodes: item?.body?.children ?? stimulus ?? [], base: path } });
      for (const element of root.root.querySelectorAll("[src], [href], [poster], [srcset]")) {
        for (const name of ["src", "href", "poster", "srcset"]) {
          const value = element.getAttribute(name);
          if (value === null || value.startsWith("#")) continue;
          expect(
            value.startsWith(ASSETS) || value.startsWith("data:image/"),
            `${path} ${element.localName} ${name} ${value}`,
          ).toBe(true);
        }
      }
    }
  }, 120_000);

  it("[T12][X] sanitizes and adopts every stylesheet that the examples reference, and keeps its rules", async () => {
    let adopted = 0;
    for (const { path, item } of examples) {
      const hrefs = referenced(path, item);
      if (hrefs.length === 0) continue;
      await root.show({ body: { nodes: item?.body?.children ?? [], base: path }, stylesheets: hrefs });
      expect(root.root.adoptedStyleSheets, path).toHaveLength(1 + new Set(hrefs).size);
      for (const sheet of root.root.adoptedStyleSheets.slice(1)) expect(sheet.cssRules.length, path).toBeGreaterThan(0);
      adopted += hrefs.length;
    }
    expect(adopted).toBeGreaterThan(0);
  }, 120_000);

  it("[T21][X] shows every modal feedback of the examples in a dialog and lets it close", async () => {
    let shown = 0;
    for (const { path, item } of examples) {
      if (item === undefined || item.modalFeedback.length === 0) continue;
      await root.show({ body: { nodes: item.body?.children ?? [], base: path } });
      const closed = root.showFeedback(item.modalFeedback);
      const dialog = root.root.querySelector("dialog");
      expect(dialog?.open, path).toBe(true);
      expect(dialog?.querySelectorAll("qti-modal-feedback").length, path).toBe(item.modalFeedback.length);
      dialog?.close();
      await closed;
      shown += item.modalFeedback.length;
    }
    expect(shown).toBe(101);
  }, 120_000);
});
