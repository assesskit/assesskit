import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requireCorpus } from "../../../scripts/corpus.js";
import { isRecord } from "../src/checks.js";
import {
  ASI_NAMESPACE,
  type AsiDocument,
  parseXml,
  ReadError,
  readAsi,
  SecurityError,
  writeAsi,
  XINCLUDE_NAMESPACE,
  type XmlElement,
} from "../src/index.js";
import { interactionKinds } from "./asi-elements.js";

const examples = join(requireCorpus(resolve(import.meta.dirname, "../../..")), "qti-examples/qtiv3-examples");
const paths = readdirSync(examples, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".xml"))
  .sort();

function bytesOf(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(examples, path)));
}

/** The documents of the examples that are assessment documents, by path; the others fail with the code returned by `skipped`. */
const documents = new Map<string, AsiDocument>();
const skipped = new Map<string, string>();
for (const path of paths) {
  try {
    documents.set(path, readAsi(bytesOf(path), { path }));
  } catch (error) {
    if (error instanceof ReadError) skipped.set(path, error.issues[0]?.code ?? "");
    else if (error instanceof SecurityError) skipped.set(path, "security");
    else throw error;
  }
}

describe("the 1EdTech examples", () => {
  it("are read when they are assessment documents: 286 of 327 files", () => {
    const kinds = new Map<string, number>();
    for (const { kind } of documents.values()) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    expect(paths).toHaveLength(327);
    expect(Object.fromEntries(kinds)).toEqual({
      item: 251,
      test: 28,
      "response-processing": 5,
      stimulus: 1,
      "outcome-declaration": 1,
    });
  });

  it("are not read when they are no assessment document: manifests, results, usage data, metadata, links and a fragment", () => {
    expect(new Set(skipped.values())).toEqual(
      new Set([
        "assesskit/asi/document-element",
        "assesskit/asi/attribute",
        "assesskit/asi/missing-attribute",
        "assesskit/xml/not-well-formed",
        "security",
      ]),
    );
    expect(skipped.get("tests/rtest01-fragment.xml")).toBe("assesskit/asi/document-element");
    expect(skipped.get("CAT/test.xml")).toBe("security");
    expect(skipped.get("results/full-example.xml")).toBe("assesskit/xml/not-well-formed");
    expect(skipped.get("packaging/simple/imsmanifest.xml")).toBe("assesskit/asi/document-element");
  });

  it("are refused when they break the schema: an attribute it requires is missing, and one it does not have is present", () => {
    expect(skipped.get("packaging/items/data-attributes.xml")).toBe("assesskit/asi/missing-attribute");
    expect(skipped.get("packaging/pci/src/fractions_deps_2.xml")).toBe("assesskit/asi/attribute");
    expect(
      [...skipped.values()].filter(
        (code) => code.startsWith("assesskit/asi/") && code !== "assesskit/asi/document-element",
      ),
    ).toHaveLength(2);
  });

  it("are read again from what is written, to the same model and the same text", () => {
    for (const [path, document] of documents) {
      const written = writeAsi(document);
      expect(readAsi(written, { path }), path).toEqual(document);
      expect(writeAsi(readAsi(written)), path).toBe(written);
    }
  });

  it("keep the include of a fragment as an XInclude element", () => {
    const document = documents.get("tests/rtest01-set01.xml");
    if (document?.kind !== "item") throw new Error("Expected an item.");
    const [include] =
      document.item.body?.children.filter((node) => node.kind === "element" && node.name === "include") ?? [];
    expect(include).toMatchObject({ kind: "element", namespace: XINCLUDE_NAMESPACE, name: "include", prefix: "xi" });
  });
});

/** The names of the elements of the ASI namespace in a tree, as the kinds of the model: without `qti-`. */
function elementKinds(element: XmlElement, kinds: string[] = []): string[] {
  if (element.namespace !== ASI_NAMESPACE) return kinds;
  kinds.push(element.name.startsWith("qti-") ? element.name.slice("qti-".length) : element.name);
  for (const child of element.children) if (child.kind === "element") elementKinds(child, kinds);
  return kinds;
}

/** The kinds of the nodes of a model; text and the XML that the model keeps as it is are left out. */
function modelKinds(value: unknown, kinds: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) modelKinds(item, kinds);
  } else if (isRecord(value)) {
    if (typeof value.kind === "string") {
      if (value.kind === "element" || value.kind === "text") return kinds;
      kinds.push(value.kind);
    }
    for (const property of Object.values(value)) modelKinds(property, kinds);
  }
  return kinds;
}

/** The elements of the ASI namespace in the documents of the examples that are read, by name as written. */
function elementsOfExamples(): Set<string> {
  const names = new Set<string>();
  const visit = (element: XmlElement): void => {
    if (element.namespace !== ASI_NAMESPACE) return;
    names.add(element.name);
    for (const child of element.children) if (child.kind === "element") visit(child);
  };
  for (const path of documents.keys()) visit(parseXml(bytesOf(path)));
  return names;
}

/** The children of the item body of an example. */
function bodyOfExample(path: string) {
  const document = documents.get(path);
  if (document?.kind !== "item") throw new Error(`${path} is not an item.`);
  return document.item.body?.children ?? [];
}

describe("the 1EdTech examples: content", () => {
  it("keep every element of every example in the model: the elements of the XML are the kinds of the model", () => {
    for (const [path, document] of documents) {
      const model = Object.values(document).filter(isRecord);
      expect(modelKinds(model).sort(), path).toEqual(elementKinds(parseXml(bytesOf(path))).sort());
    }
  });

  it("have every kind of interaction that the ASI schema declares, but the custom interaction", () => {
    const names = elementsOfExamples();
    expect(interactionKinds().filter((kind) => !names.has(`qti-${kind}`))).toEqual(["custom-interaction"]);
  });

  it("choice.xml: reads the choice interaction as the example has it", () => {
    const body = bodyOfExample("packaging/items/choice.xml");
    expect(body.map(({ kind }) => kind)).toEqual(["p", "p", "choice-interaction"]);
    expect(body[2]).toMatchObject({
      responseIdentifier: "RESPONSE",
      shuffle: false,
      maxChoices: 1,
      prompt: { children: [{ kind: "text", value: "What does it say?" }] },
      simpleChoices: [
        { identifier: "ChoiceA", children: [{ value: "You must stay with your luggage at all times." }] },
        { identifier: "ChoiceB", children: [{ value: "Do not let someone else look after your luggage." }] },
        { identifier: "ChoiceC", children: [{ value: "Remember your luggage when you leave." }] },
      ],
    });
  });

  it("hotspot.xml: reads the image object and the four hotspots as the example has them", () => {
    const interaction = bodyOfExample("packaging/items/hotspot.xml")[1];
    expect(interaction).toMatchObject({
      kind: "hotspot-interaction",
      maxChoices: 1,
      image: { kind: "object", type: "image/png", width: "206", height: "280", data: "images/ukair.png" },
      hotspotChoices: [
        { identifier: "A", shape: "circle", coords: "77,115,8" },
        { identifier: "B", shape: "circle", coords: "118,184,8" },
        { identifier: "C", shape: "circle", coords: "150,235,8" },
        { identifier: "D", shape: "circle", coords: "96,114,8" },
      ],
    });
  });

  it("gap_match.xml: reads the four choices and the two gaps of the quote as the example has them", () => {
    const interaction = bodyOfExample("packaging/items/gap_match.xml")[0];
    expect(interaction).toMatchObject({
      kind: "gap-match-interaction",
      shuffle: false,
      choices: [
        { identifier: "W", matchMax: 1 },
        { identifier: "Sp", matchMax: 1 },
        { identifier: "Su", matchMax: 1 },
        { identifier: "A", matchMax: 1 },
      ],
      children: [{ kind: "blockquote", children: expect.arrayContaining([expect.objectContaining({ kind: "p" })]) }],
    });
    expect(JSON.stringify(interaction)).toContain('"kind":"gap","identifier":"G1"');
    expect(JSON.stringify(interaction)).toContain('"kind":"gap","identifier":"G2"');
  });

  it("fractions1.xml: reads the two portable custom interactions with their modules and data attributes", () => {
    const [division] = bodyOfExample("packaging/pci/src/fractions1.xml");
    if (division?.kind !== "div") throw new Error("Expected a div.");
    const interactions = division.children.filter((node) => node.kind === "portable-custom-interaction");
    expect(interactions).toHaveLength(2);
    expect(interactions[0]).toMatchObject({
      customInteractionTypeIdentifier: "urn:fdc:hmhco.com:2019:pci:shading",
      responseIdentifier: "EXAMPLE",
      interactionModules: {
        interactionModules: [
          { id: "shading", primaryPath: "modules/shadingXX.js", fallbackPath: "modules/shading.js" },
        ],
      },
      interactionMarkup: { children: [], templates: [] },
    });
    expect(interactions[0]?.extensions).toContainEqual({ namespace: "", name: "data-selected_color", value: "red" });
  });

  it("text_entry.xml: reads the text entry interaction inside the paragraph of the quote", () => {
    const quote = bodyOfExample("packaging/items/text_entry.xml")[1];
    const paragraph = quote?.kind === "blockquote" ? quote.children.find((node) => node.kind === "p") : undefined;
    const entries =
      paragraph?.kind === "p" ? paragraph.children.filter((node) => node.kind === "text-entry-interaction") : [];
    expect(entries).toMatchObject([{ responseIdentifier: "RESPONSE", expectedLength: 15 }]);
  });

  it("slider.xml: reads the bounds and the step as the example has them", () => {
    const interaction = bodyOfExample("packaging/items/slider.xml")[1];
    expect(interaction).toMatchObject({
      kind: "slider-interaction",
      lowerBound: 0,
      upperBound: 100,
      step: 1,
      stepLabel: false,
    });
  });

  it("exemplar06.xml: keeps the SSML sub element of the example", () => {
    const text = JSON.stringify(documents.get("packaging/sharedStimulus/exemplar06.xml"));
    expect(text).toContain('"namespace":"http://www.w3.org/2001/10/synthesis"');
    expect(text).toContain('"name":"sub"');
  });
});
