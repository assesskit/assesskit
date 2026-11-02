// cspell:ignore mrow allô
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASI_NAMESPACE,
  type AssessmentItem,
  type AssessmentTest,
  type BodyNode,
  type Braille,
  type Catalog,
  type ContentVariables,
  catalogsFor,
  checkCatalog,
  container,
  DataError,
  DRD_HAZARDS,
  descendantNodes,
  formatPrintedVariable,
  HAZARD_TERMS,
  hazardExposure,
  isShown,
  type ModelNode,
  type PersonalNeedsProfile,
  PNP_HAZARDS,
  PNP_NAMESPACE,
  type PrintedVariable,
  ReadError,
  readAsi,
  readPnp,
  record,
  resolveContent,
  rubricBlocksFor,
  type SingleValue,
  selectCard,
  single,
  testRubricBlocks,
  type Value,
  VIEWS,
  type View,
  visibleModalFeedback,
  visibleTestFeedback,
} from "../src/index.js";
import { asProfile } from "./arbitraries/pnp.js";
import printf from "./fixtures/printf.json" with { type: "json" };
import { runGuideSamples } from "./guide-samples.js";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

const NS = `xmlns="${ASI_NAMESPACE}"`;

function itemOf(content: string): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false">${content}</qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("The test reads an item.");
  return document.item;
}

function testOf(content: string): AssessmentTest {
  const document = readAsi(
    `<qti-assessment-test ${NS} identifier="test" title="Test">${content}</qti-assessment-test>`,
  );
  if (document.kind !== "test") throw new Error("The test reads a test.");
  return document.test;
}

const id = (value: string): SingleValue => single("identifier", value);
const int = (value: number): SingleValue => single("integer", value);
const float = (value: number): SingleValue => single("float", value);
function text(value: string): SingleValue {
  const built = single("string", value);
  if (built === null) throw new Error("The test builds an empty string.");
  return built;
}

function ids(cardinality: "multiple" | "ordered", values: readonly string[]): Value {
  const built = container(cardinality, "identifier", values);
  if (built === null) throw new Error("The test builds an empty container.");
  return built;
}

const variables = (
  outcomes: Record<string, Value | null> = {},
  templates: Record<string, Value | null> = {},
): ContentVariables => ({ outcomes: new Map(Object.entries(outcomes)), templates: new Map(Object.entries(templates)) });

/** The printed variable of the markup, as the reader gives it. */
function printedOf(attributes: string): PrintedVariable {
  const item = itemOf(`<qti-item-body><p><qti-printed-variable identifier="X" ${attributes}/></p></qti-item-body>`);
  const [paragraph] = item.body?.children ?? [];
  const [node] = paragraph?.kind === "p" ? paragraph.children : [];
  if (node?.kind !== "printed-variable") throw new Error("The test reads a printed variable.");
  return node;
}

/** The text of a node and its descendants. */
function textOf(nodes: readonly ModelNode[]): string {
  return nodes
    .flatMap((node) => [node, ...descendantNodes(node)])
    .map((node) => (node.kind === "text" && "value" in node ? String(node.value) : ""))
    .join("");
}

/** A node of the XML that the model keeps for MathML: an element with children, or text. */
interface XmlPart {
  readonly kind: string;
  readonly name?: string;
  readonly value?: string;
  readonly children?: readonly XmlPart[];
}

/** The name and text of each MathML element below an element, in document order: `mn:7`. */
function mathParts(element: XmlPart): string[] {
  return (element.children ?? []).flatMap((child) =>
    child.kind === "element"
      ? [`${child.name}:${(child.children ?? []).map((part) => part.value ?? "").join("")}`, ...mathParts(child)]
      : [],
  );
}

const print = (attributes: string, value: Value | null, scope: ContentVariables = variables()): string =>
  formatPrintedVariable(printedOf(attributes), value, scope);
const formatted = (format: string, value: Value | null): string => print(`format="${format}"`, value);

const sample = itemOf(`
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"/>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-outcome-declaration identifier="FEEDBACK" cardinality="single" base-type="identifier"/>
  <qti-template-declaration identifier="N" cardinality="single" base-type="integer" math-variable="true" param-variable="true"/>
  <qti-template-declaration identifier="W" cardinality="single" base-type="float" param-variable="true"/>
  <qti-template-declaration identifier="SHOWN" cardinality="multiple" base-type="identifier"/>
  <qti-item-body>
    <p>Score <qti-printed-variable identifier="SCORE" format="%.1f"/>, n = <qti-printed-variable identifier="N"/>, response <qti-printed-variable identifier="RESPONSE"/>.</p>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="right" show-hide="show"><qti-content-body><p>Right</p></qti-content-body></qti-feedback-block>
    <qti-feedback-block outcome-identifier="FEEDBACK" identifier="right" show-hide="hide"><qti-content-body><p>Not right</p></qti-content-body></qti-feedback-block>
    <p>Inline <qti-feedback-inline outcome-identifier="FEEDBACK" identifier="right" show-hide="show">yes</qti-feedback-inline><qti-template-inline template-identifier="SHOWN" identifier="b" show-hide="show">B</qti-template-inline></p>
    <qti-template-block template-identifier="SHOWN" identifier="a" show-hide="show"><qti-content-body><p>Block A, n = <qti-printed-variable identifier="N"/></p></qti-content-body></qti-template-block>
    <qti-rubric-block view="candidate scorer" use="instructions"><qti-content-body><p>For candidates</p></qti-content-body></qti-rubric-block>
    <qti-rubric-block view="scorer" use="scoring"><qti-content-body><p>For scorers, n = <qti-printed-variable identifier="N"/></p></qti-content-body></qti-rubric-block>
    <qti-choice-interaction response-identifier="RESPONSE">
      <qti-simple-choice identifier="A" template-identifier="SHOWN" show-hide="show">A</qti-simple-choice>
      <qti-simple-choice identifier="B" template-identifier="SHOWN" show-hide="hide">B</qti-simple-choice>
      <qti-simple-choice identifier="C">C</qti-simple-choice>
    </qti-choice-interaction>
    <div><object data="graph.swf" type="application/x-shockwave-flash"><param name="width" value="W" valuetype="DATA"/><param name="count" value="N" valuetype="DATA"/><param name="keep" value="literal" valuetype="DATA"/></object></div>
    <p><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>N</mi><mo>+</mo><mi>x</mi><mrow><ci>N</ci></mrow></math></p>
  </qti-item-body>`);
const body = sample.body?.children ?? [];

const resolve = (
  outcomes: Record<string, Value | null>,
  templates: Record<string, Value | null>,
  view: View = "candidate",
): readonly BodyNode[] => resolveContent(body, variables(outcomes, templates), sample, { view });
const rightOutcomes = { SCORE: float(0.55), FEEDBACK: id("right") };
const drawnTemplates = { N: int(7), W: float(0.5), SHOWN: ids("multiple", ["a", "A", "b"]) };

/** The `kind`s of the blocks of the body that the resolved content keeps. */
const kinds = (nodes: readonly BodyNode[]): string[] => nodes.map(({ kind }) => kind);
const choicesOf = (nodes: readonly BodyNode[]): string[] => {
  const interaction = nodes.find((node) => node.kind === "choice-interaction");
  return interaction?.kind === "choice-interaction"
    ? interaction.simpleChoices.map(({ identifier }) => identifier)
    : [];
};

describe("catalogs and cards", () => {
  const catalogItem = itemOf(
    `<qti-item-body><p data-catalog-idref="c1">Hard word</p><p>Plain</p><p data-catalog-idref="missing">Nothing</p><qti-feedback-block outcome-identifier="F" identifier="x" show-hide="show"><qti-content-body><p data-catalog-idref="c2">Inside</p></qti-content-body><qti-catalog-info><qti-catalog id="c2"><qti-card support="spoken"><qti-html-content>Say it</qti-html-content></qti-card></qti-catalog></qti-catalog-info></qti-feedback-block></qti-item-body><qti-catalog-info><qti-catalog id="c1"><qti-card support="glossary-on-screen"><qti-card-entry xml:lang="en" default="true"><qti-html-content>hello</qti-html-content></qti-card-entry><qti-card-entry xml:lang="fr"><qti-html-content>bonjour</qti-html-content></qti-card-entry><qti-card-entry xml:lang="fr-CA"><qti-html-content>allô</qti-html-content></qti-card-entry><qti-card-entry xml:lang="id-ID"><qti-file-href mime-type="audio/mpeg">id.mp3</qti-file-href></qti-card-entry></qti-card><qti-card support="spoken"><qti-html-content>read this</qti-html-content></qti-card><qti-card support="sign-language"><qti-file-href mime-type="video/mp4">a.mp4</qti-file-href><qti-file-href mime-type="video/webm">a.webm</qti-file-href></qti-card><qti-card support="transcript"><qti-card-entry xml:lang="de"><qti-html-content>Text</qti-html-content></qti-card-entry></qti-card></qti-catalog></qti-catalog-info>`,
  );
  const [c1] = catalogItem.catalogInfo?.catalogs ?? [];
  const catalog = (): Catalog => {
    if (c1 === undefined) throw new Error("The test reads a catalog.");
    return c1;
  };
  const htmlOf = (
    language?: string,
    support: "glossary-on-screen" | "spoken" | "transcript" = "glossary-on-screen",
  ): string | undefined => {
    const content = selectCard(catalog(), support, language);
    return content === undefined ? undefined : textOf(content.htmlContent === undefined ? [] : [content.htmlContent]);
  };

  it("selects the card entry of the language by xml:lang, then one with the same primary language, then the default", () => {
    expect(htmlOf("fr")).toBe("bonjour");
    expect(htmlOf("FR-ca")).toBe("allô");
    expect(htmlOf("fr-BE")).toBe("bonjour");
    expect(htmlOf("en-GB")).toBe("hello");
    expect(htmlOf("de")).toBe("hello");
    expect(htmlOf()).toBe("hello");
  });

  it("gives the content of a card without entries, and the file references of a card or an entry", () => {
    expect(htmlOf(undefined, "spoken")).toBe("read this");
    expect(selectCard(catalog(), "sign-language")?.fileHrefs.map((href) => href.value)).toEqual(["a.mp4", "a.webm"]);
    expect(selectCard(catalog(), "sign-language")?.htmlContent).toBeUndefined();
    expect(selectCard(catalog(), "glossary-on-screen", "id")?.fileHrefs.map((href) => href.value)).toEqual(["id.mp3"]);
  });

  it("gives nothing when the catalog has no card for the support, or no entry fits and none is the default", () => {
    expect(selectCard(catalog(), "braille")).toBeUndefined();
    expect(selectCard(catalog(), "ext:custom")).toBeUndefined();
    expect(htmlOf("de", "transcript")).toBe("Text");
    expect(htmlOf("fr", "transcript")).toBeUndefined();
    expect(htmlOf(undefined, "transcript")).toBeUndefined();
  });

  it("chooses the entry of a braille or tactile card by the braille settings of the candidate, as the guide's data attributes say", () => {
    const item = itemOf(
      `<qti-item-body><p data-catalog-idref="b">Text</p></qti-item-body><qti-catalog-info><qti-catalog id="b"><qti-card support="braille"><qti-card-entry data-braille-type="ueb"><qti-file-href mime-type="text/plain">ueb.brf</qti-file-href></qti-card-entry><qti-card-entry data-braille-type="EBAE"><qti-file-href mime-type="text/plain">ebae.brf</qti-file-href></qti-card-entry></qti-card><qti-card support="tactile"><qti-card-entry data-braille-type="ueb" data-braille-grade="1"><qti-file-href mime-type="image/svg+xml">ueb-1.svg</qti-file-href></qti-card-entry><qti-card-entry data-braille-type="ueb" data-grade="2" default="true"><qti-file-href mime-type="image/svg+xml">ueb-2.svg</qti-file-href></qti-card-entry><qti-card-entry data-math-type="nemeth" xml:lang="fr"><qti-file-href mime-type="image/svg+xml">nemeth.svg</qti-file-href></qti-card-entry></qti-card></qti-catalog></qti-catalog-info>`,
    );
    const [braille] = item.catalogInfo?.catalogs ?? [];
    if (braille === undefined) throw new Error("The test reads a catalog.");
    const files = (
      support: "braille" | "tactile",
      settings?: Partial<Braille>,
      language?: string,
    ): string[] | undefined =>
      selectCard(
        braille,
        support,
        language,
        settings === undefined ? undefined : { name: "braille", replaceAccessModes: [], ...settings },
      )?.fileHrefs.map(({ value }) => value);
    expect(files("braille")).toBeUndefined();
    expect(files("braille", {})).toBeUndefined();
    expect(files("braille", { brailleType: "ueb" })).toEqual(["ueb.brf"]);
    expect(files("braille", { brailleType: "ebae" })).toEqual(["ebae.brf"]);
    expect(files("braille", { brailleType: "ext:other" })).toBeUndefined();
    expect(files("tactile", { brailleType: "ueb", grade: 1 })).toEqual(["ueb-1.svg"]);
    expect(files("tactile", { brailleType: "ueb", grade: 2 })).toEqual(["ueb-2.svg"]);
    expect(files("tactile", { brailleType: "ueb", grade: 3 })).toEqual(["ueb-2.svg"]);
    expect(files("tactile", { brailleType: "ueb" })).toEqual(["ueb-2.svg"]);
    expect(files("tactile", { mathType: "nemeth" }, "fr")).toEqual(["nemeth.svg"]);
    expect(files("tactile", { mathType: "ueb" }, "fr")).toEqual(["ueb-2.svg"]);
    expect(() => selectCard(braille, "braille", undefined, JSON.parse('"ueb"'))).toThrow(
      'The braille settings must be an object, found "ueb".',
    );
  });

  it("finds the catalog that data-catalog-idref names, wherever the item keeps it", () => {
    const [first, plain, missing, feedback] = catalogItem.body?.children ?? [];
    const reference = (node: BodyNode | undefined): string[] =>
      node === undefined ? [] : catalogsFor(catalogItem, node).map((found) => found.id);
    expect(reference(first)).toEqual(["c1"]);
    expect(reference(plain)).toEqual([]);
    expect(reference(missing)).toEqual([]);
    const inside = feedback?.kind === "feedback-block" ? feedback.contentBody?.children[0] : undefined;
    expect(reference(inside)).toEqual(["c2"]);
  });

  it("SupportEnum and SupportEnumExt: a card names one of the 15 supports, or ext: and a name, and no other term", () => {
    const supports = [
      "additional-directions",
      "audio-description",
      "braille",
      "glossary-on-screen",
      "high-contrast",
      "keyboard-directions",
      "keyword-translation",
      "linguistic-guidance",
      "long-description",
      "sign-language",
      "simplified-graphics",
      "simplified-language-portions",
      "spoken",
      "tactile",
      "transcript",
    ];
    const read = (support: string): string | undefined =>
      itemOf(
        `<qti-item-body><p>x</p></qti-item-body><qti-catalog-info><qti-catalog id="c"><qti-card support="${support}"><qti-html-content>x</qti-html-content></qti-card></qti-catalog></qti-catalog-info>`,
      ).catalogInfo?.catalogs[0]?.cards[0]?.support;
    for (const support of [...supports, "ext:flashcards", "ext:org.example-deck"]) expect(read(support)).toBe(support);
    for (const support of ["hint", "Spoken", "line-reader", "ext:", ""]) {
      expect(() => read(support), support).toThrow(ReadError);
    }
  });

  describe("checkCatalog", () => {
    const checkIssues = (cards: string): ReturnType<typeof checkCatalog> => {
      const item = itemOf(
        `<qti-item-body><p>x</p></qti-item-body><qti-catalog-info><qti-catalog id="c">${cards}</qti-catalog></qti-catalog-info>`,
      );
      const [found] = item.catalogInfo?.catalogs ?? [];
      if (found === undefined) throw new Error("The test reads a catalog.");
      return checkCatalog(found);
    };
    const check = (cards: string): string[] => checkIssues(cards).map(({ code }) => code);
    const html = "<qti-html-content>x</qti-html-content>";

    it("reports nothing for a catalog that follows the rules", () => {
      expect(checkCatalog(catalog())).toEqual([]);
      expect(
        check(
          `<qti-card support="spoken">${html}</qti-card><qti-card support="braille"><qti-file-href mime-type="text/plain">b.brf</qti-file-href></qti-card>`,
        ),
      ).toEqual([]);
    });

    it("reports two cards for one support in a catalog", () => {
      expect(
        check(`<qti-card support="spoken">${html}</qti-card><qti-card support="spoken">${html}</qti-card>`),
      ).toEqual(["assesskit/content/duplicate-card"]);
    });

    it("reports a card or a card entry that has neither HTML content nor a file reference", () => {
      expect(check('<qti-card support="spoken"/>')).toEqual(["assesskit/content/empty-card"]);
      expect(
        check(
          `<qti-card support="spoken"><qti-card-entry xml:lang="en">${html}</qti-card-entry><qti-card-entry xml:lang="fr"/></qti-card>`,
        ),
      ).toEqual(["assesskit/content/empty-card"]);
    });

    it("reports a card that has more than one default entry", () => {
      const doubled = `<qti-card support="spoken"><qti-card-entry default="true">${html}</qti-card-entry><qti-card-entry default="true">${html}</qti-card-entry></qti-card>`;
      expect(checkIssues(doubled)).toEqual([
        {
          severity: "error",
          code: "assesskit/content/duplicate-default-entry",
          message:
            'More than one qti-card-entry of the qti-card for the support "spoken" is the default, but one may be.',
          location: { element: "qti-catalog/qti-card/qti-card-entry" },
        },
      ]);
    });
  });

  it("refuses arguments of the wrong type", () => {
    expect(() => selectCard(json("null"), "spoken")).toThrow(DataError);
    expect(() => selectCard(json('{"cards": 1}'), "spoken")).toThrow(DataError);
    expect(() => selectCard(catalog(), json("1"))).toThrow(DataError);
    expect(() => selectCard(catalog(), "spoken", json("1"))).toThrow(DataError);
    expect(() => catalogsFor(json("null"), { kind: "text", value: "x" })).toThrow(DataError);
    expect(() => catalogsFor(catalogItem, json("null"))).toThrow(DataError);
    expect(() => checkCatalog(json("null"))).toThrow(DataError);
  });
});

describe("modal feedback", () => {
  const item = itemOf(
    '<qti-item-body><p>x</p></qti-item-body><qti-modal-feedback outcome-identifier="FEEDBACK" show-hide="show" identifier="right" title="Right"><qti-content-body><p>Right</p></qti-content-body></qti-modal-feedback><qti-modal-feedback outcome-identifier="FEEDBACK" show-hide="show" identifier="wrong"><qti-content-body><p>Wrong</p></qti-content-body></qti-modal-feedback><qti-modal-feedback outcome-identifier="FEEDBACK" show-hide="hide" identifier="wrong"><qti-content-body><p>Not wrong</p></qti-content-body></qti-modal-feedback>',
  );
  const shown = (feedback: Value | null): string[] =>
    visibleModalFeedback(item, new Map([["FEEDBACK", feedback]])).map((modal) => textOf(modal.contentBody.children));

  it("shows the modal feedback that the outcome selects, in document order", () => {
    expect(shown(id("right"))).toEqual(["Right", "Not wrong"]);
    expect(shown(id("wrong"))).toEqual(["Wrong"]);
    expect(shown(ids("multiple", ["right", "wrong"]))).toEqual(["Right", "Wrong"]);
  });

  it("treats a missing or NULL outcome as naming nothing", () => {
    expect(shown(null)).toEqual(["Not wrong"]);
    expect(visibleModalFeedback(item, new Map()).map((modal) => modal.identifier)).toEqual(["wrong"]);
  });

  it("shows the feedback of the outcomes it is given: the defaults give the item as at the start of the attempt, the final outcomes the feedback", () => {
    const defaults = new Map<string, Value | null>([["FEEDBACK", null]]);
    const final = new Map<string, Value | null>([["FEEDBACK", id("right")]]);
    expect(visibleModalFeedback(item, defaults).map((modal) => modal.identifier)).toEqual(["wrong"]);
    expect(visibleModalFeedback(item, final).map((modal) => modal.identifier)).toEqual(["right", "wrong"]);
  });

  it("refuses arguments of the wrong type", () => {
    expect(() => visibleModalFeedback(json("null"), new Map())).toThrow(DataError);
    expect(() => visibleModalFeedback(json('{"modalFeedback": 1}'), new Map())).toThrow(DataError);
    expect(() => visibleModalFeedback(item, json("{}"))).toThrow(
      "The outcomes must be a Map from identifier to value, found an object.",
    );
  });
});

describe("test feedback", () => {
  const test = testOf(
    '<qti-test-part identifier="part" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="s" title="S" visible="true"><qti-assessment-item-ref identifier="i" href="i.xml"/></qti-assessment-section><qti-test-feedback access="during" outcome-identifier="PASSED" show-hide="show" identifier="yes"><qti-content-body><p>So far so good</p></qti-content-body></qti-test-feedback><qti-test-feedback access="atEnd" outcome-identifier="PASSED" show-hide="show" identifier="yes"><qti-content-body><p>Passed</p></qti-content-body></qti-test-feedback><qti-test-feedback access="atEnd" outcome-identifier="PASSED" show-hide="show" identifier="no"><qti-content-body><p>Failed</p></qti-content-body></qti-test-feedback></qti-test-part>',
  );
  const feedback = test.testParts[0]?.testFeedback ?? [];
  const shown = (access: "atEnd" | "during", outcome: Value | null): string[] =>
    visibleTestFeedback(feedback, new Map([["PASSED", outcome]]), access).map((entry) =>
      textOf(entry.contentBody?.children ?? []),
    );

  it("shows the feedback of the access asked for: during after outcome processing, atEnd at the end of the part or test", () => {
    expect(shown("during", id("yes"))).toEqual(["So far so good"]);
    expect(shown("atEnd", id("yes"))).toEqual(["Passed"]);
    expect(shown("atEnd", id("no"))).toEqual(["Failed"]);
    expect(shown("atEnd", null)).toEqual([]);
  });

  it("refuses an access that is neither during nor atEnd, and other arguments of the wrong type", () => {
    expect(() => visibleTestFeedback(feedback, new Map(), json('"always"'))).toThrow(
      'The access must be "during" or "atEnd", found "always".',
    );
    expect(() => visibleTestFeedback(json("null"), new Map(), "during")).toThrow(DataError);
    expect(() => visibleTestFeedback(feedback, json("[]"), "during")).toThrow(DataError);
  });

  it("TestFeedbackAccessEnum: reads during and atEnd and refuses any other term", () => {
    const read = (access: string): AssessmentTest =>
      testOf(
        `<qti-test-part identifier="p" navigation-mode="linear" submission-mode="individual"><qti-assessment-section identifier="s" title="S" visible="true"><qti-assessment-item-ref identifier="i" href="i.xml"/></qti-assessment-section><qti-test-feedback access="${access}" outcome-identifier="O" show-hide="show" identifier="x"/></qti-test-part>`,
      );
    expect(read("during").testParts[0]?.testFeedback[0]?.access).toBe("during");
    expect(read("atEnd").testParts[0]?.testFeedback[0]?.access).toBe("atEnd");
    for (const term of ["AtEnd", "end", ""]) expect(() => read(term)).toThrow(ReadError);
  });
});

describe("hazards", () => {
  const profile = (hazards: string): PersonalNeedsProfile =>
    asProfile(readPnp(`<access-for-all-pnp xmlns="${PNP_NAMESPACE}">${hazards}</access-for-all-pnp>`));

  it("maps each hazard term of the DRD to the term of the PNP: olfactoryHazard to olfactory-hazard, motionSimulation to motion-simulation", () => {
    expect([...HAZARD_TERMS]).toEqual([
      ["flashing", "flashing"],
      ["motionSimulation", "motion-simulation"],
      ["olfactoryHazard", "olfactory-hazard"],
      ["sound", "sound"],
    ]);
  });

  it("covers every term of the DRD vocabulary Hazard and every term of the PNP hazard-avoidance, once", () => {
    expect([...HAZARD_TERMS.keys()].sort()).toEqual([...DRD_HAZARDS].sort());
    expect([...HAZARD_TERMS.values()].sort()).toEqual([...PNP_HAZARDS].sort());
  });

  it("marks the hazards that the profile avoids, so that the candidate is not exposed to content that has them", () => {
    const avoiding = profile(
      "<hazard-avoidance>flashing</hazard-avoidance><hazard-avoidance>olfactory-hazard</hazard-avoidance>",
    );
    expect(hazardExposure(["flashing", "sound", "olfactoryHazard", "motionSimulation"], avoiding)).toEqual([
      { hazard: "flashing", avoided: true },
      { hazard: "sound", avoided: false },
      { hazard: "olfactory-hazard", avoided: true },
      { hazard: "motion-simulation", avoided: false },
    ]);
  });

  it("avoids nothing without a profile or a hazard-avoidance, lists each hazard once and none for a resource without hazards", () => {
    expect(hazardExposure(["sound", "sound"])).toEqual([{ hazard: "sound", avoided: false }]);
    expect(hazardExposure(["sound"], profile("<high-contrast/>"))).toEqual([{ hazard: "sound", avoided: false }]);
    expect(hazardExposure([], profile("<hazard-avoidance>sound</hazard-avoidance>"))).toEqual([]);
  });

  it("does not take an extension term of the PNP for a hazard of the resource", () => {
    const extended = profile("<hazard-avoidance>ext:strobe</hazard-avoidance>");
    expect(hazardExposure(["flashing"], extended)).toEqual([{ hazard: "flashing", avoided: false }]);
  });

  it("refuses arguments of the wrong type", () => {
    expect(() => hazardExposure(json("null"))).toThrow(DataError);
    expect(() => hazardExposure(json('["olfactory-hazard"]'))).toThrow(
      'A hazard must be one of flashing, motionSimulation, olfactoryHazard, sound, found "olfactory-hazard".',
    );
    expect(() => hazardExposure([], json("1"))).toThrow(DataError);
  });
});

describe("printed variables", () => {
  /** The examples of the best practices guide, with the spaces they show as underscores written as spaces. */
  const AppendixE: readonly (readonly [string, Value, string])[] = [
    ["%i", int(-987), "-987"],
    ["%.4i", int(-987), "-0987"],
    ["%.0i", int(0), ""],
    ["%8i", int(987), "     987"],
    ["%2i", int(987), "987"],
    ["%-8i", int(987), "987     "],
    ["%08i", int(987), "00000987"],
    ["%+i", int(987), "+987"],
    ["% i", int(987), " 987"],
    ["%o", int(987), "1733"],
    ["%#o", int(987), "01733"],
    ["%x", int(987), "3db"],
    ["%#x", int(987), "0x3db"],
    ["%X", int(987), "3DB"],
    ["%#X", int(987), "0X3DB"],
    ["%f", float(987.654), "987.654000"],
    ["%.2f", float(987.654), "987.65"],
    ["%#.0f", int(987), "987."],
    ["%e", float(987.654), "9.876540e+02"],
    ["%.2e", float(987.654), "9.88e+02"],
    ["%E", float(987.654), "9.876540E+02"],
    ["%g", float(987654.321), "987654"],
    ["%g", int(987), "987"],
    ["%g", int(987654321), "9.87654e+08"],
    ["%g", float(0.0000987654321), "9.87654e-05"],
    ["%#g", int(987), "987.000"],
    ["%G", float(0.0000987654321), "9.87654E-05"],
    ["%r", float(0.0000987654321), "0.0000987654"],
    ["%R", float(0.0000987654321), "0.0000987654"],
  ];

  it.each(AppendixE)("%s of %j is %j, as BPIG Appendix E has it", (format, value, expected) => {
    expect(formatted(format, value)).toBe(expected);
  });

  it("formats the 1000 floats of the Python fixture as the C conversions e E f g G do, rounding from the exact binary value", () => {
    expect(printf.floats).toHaveLength(1000);
    for (const { format, value, expected } of printf.floats) {
      expect(formatted(format, float(value)), `${format} of ${value}`).toBe(expected);
    }
  });

  it("formats the 675 integers of the Python fixture as the conversions d i o x X do", () => {
    expect(printf.integers).toHaveLength(675);
    for (const { format, value, expected } of printf.integers) {
      // The specification has no %d: %i is the decimal conversion.
      expect(formatted(format.replace(/d$/, "i"), int(value)), `${format} of ${value}`).toBe(expected);
    }
  });

  it("r and R round to the significant figures of g and G but leave the fixed form only when the figures are fewer than the digits left of the point", () => {
    expect(formatted("%.3r", float(123456))).toBe("1.23e+05");
    expect(formatted("%.3R", float(123456))).toBe("1.23E+05");
    expect(formatted("%.3r", float(123.456))).toBe("123");
    expect(formatted("%.3r", float(0.00123456))).toBe("0.00123");
    expect(formatted("%.2r", float(1234.5))).toBe("1.2e+03");
    expect(formatted("%r", float(100000))).toBe("100000");
    expect(formatted("%r", float(1234567))).toBe("1.23457e+06");
    expect(formatted("%r", float(0.000000123456789))).toBe("0.000000123457");
    expect(formatted("%#r", float(2))).toBe("2.00000");
  });

  it("writes NaN and the infinities as C does, in capitals for E, G and R, and never pads them with zeros", () => {
    expect(formatted("%f", float(Number.NaN))).toBe("nan");
    expect(formatted("%E", float(Number.POSITIVE_INFINITY))).toBe("INF");
    expect(formatted("%+g", float(Number.POSITIVE_INFINITY))).toBe("+inf");
    expect(formatted("%08f", float(Number.NEGATIVE_INFINITY))).toBe("    -inf");
    expect(formatted("%-6R", float(Number.NaN))).toBe("NAN   ");
  });

  it("writes negative zero with its sign and keeps zero padding after the sign and the 0x prefix", () => {
    expect(formatted("%.1f", float(-0))).toBe("-0.0");
    expect(formatted("%08.2f", float(-1.5))).toBe("-0001.50");
    expect(formatted("%#08x", int(255))).toBe("0x0000ff");
    expect(formatted("%+05i", int(7))).toBe("+0007");
  });

  it("truncates a float for an integer conversion and writes a negative number for o, x and X with a minus sign", () => {
    expect(formatted("%i", float(-3.9))).toBe("-3");
    expect(formatted("%i", float(-0.5))).toBe("0");
    expect(formatted("%x", int(-255))).toBe("-ff");
    expect(formatted("%o", float(8.9))).toBe("10");
  });

  it("writes an integer by %i and a float or a duration by %G when the printed variable has no format", () => {
    expect(print("", int(-42))).toBe("-42");
    expect(print("", float(0.1))).toBe("0.1");
    expect(print("", float(1234567))).toBe("1.23457E+06");
    expect(print("", float(100000))).toBe("100000");
    expect(print("", single("duration", 90))).toBe("90");
  });

  it("writes the other base types as text: boolean, point, pair, directed pair, identifier, string, uri and the name of a file", () => {
    expect(print("", single("boolean", true))).toBe("true");
    expect(print("", single("point", [118, 184]))).toBe("118 184");
    expect(print("", single("pair", ["W", "G1"]))).toBe("W G1");
    expect(print("", single("directedPair", ["a", "b"]))).toBe("a b");
    expect(print("", id("choiceA"))).toBe("choiceA");
    expect(print("", text("Hello"))).toBe("Hello");
    expect(print("", single("uri", "http://example.com/x"))).toBe("http://example.com/x");
    expect(print("", single("file", { reference: "f1", mimeType: "text/plain", fileName: "notes.txt" }))).toBe(
      "notes.txt",
    );
    expect(print("", single("file", { reference: "f1", mimeType: "text/plain" }))).toBe("");
  });

  it("writes NULL as the empty string", () => {
    expect(print('format="%.2f"', null)).toBe("");
  });

  it("writes an integer in the base of the attribute with %i, or of the variable that the attribute names", () => {
    expect(print('format="%i" base="16"', int(255))).toBe("ff");
    expect(print('format="%.8i" base="2"', int(5))).toBe("00000101");
    expect(print('format="%i" base="36"', int(35))).toBe("z");
    expect(print('format="%i" base="BASE"', int(255), variables({}, { BASE: int(8) }))).toBe("377");
    expect(print('format="%i" base="BASE"', int(255), variables({ BASE: int(2) }, { BASE: int(8) }))).toBe("11111111");
  });

  it("uses base 10 when the base is not usable: out of range 2 to 36, not an integer, a variable that is missing", () => {
    expect(print('format="%i" base="1"', int(255))).toBe("255");
    expect(print('format="%i" base="37"', int(255))).toBe("255");
    expect(print('format="%i" base="NONE"', int(255))).toBe("255");
    expect(print('format="%i" base="B"', int(255), variables({}, { B: float(8) }))).toBe("255");
    expect(print('format="%x" base="2"', int(255))).toBe("ff");
  });

  it("writes the values of a container with the delimiter, ; by default", () => {
    const multiple = ids("multiple", ["A", "B", "C"]);
    expect(print("", multiple)).toBe("A;B;C");
    expect(print('delimiter=", "', multiple)).toBe("A, B, C");
    expect(print('format="%.1f"', container("ordered", "float", [1, 2.25]))).toBe("1.0;2.2");
  });

  it("writes only the value at index of an ordered container, counting from 1, and nothing when there is none", () => {
    const ordered = ids("ordered", ["A", "B", "C"]);
    expect(print('index="2"', ordered)).toBe("B");
    expect(print('index="0"', ordered)).toBe("");
    expect(print('index="4"', ordered)).toBe("");
    expect(print('index="I"', ordered, variables({}, { I: int(3) }))).toBe("C");
    expect(print('index="2"', ids("multiple", ["A", "B", "C"]))).toBe("A;B;C");
  });

  it("writes a record as its fields with the mapping indicator, = by default, or the one field that field names", () => {
    const fields = record([
      ["name", text("Ada")],
      ["score", float(0.5)],
    ]);
    expect(print("", fields)).toBe("name=Ada;score=0.5");
    expect(print('delimiter=" | " mapping-indicator=": "', fields)).toBe("name: Ada | score: 0.5");
    expect(print('field="score" format="%.2f"', fields)).toBe("0.50");
    expect(print('field="missing"', fields)).toBe("");
  });

  it("writes the exponent of a number in power form: 1.5e+03 becomes 1.5 × 10³, e-05 becomes × 10⁻⁵", () => {
    expect(print('format="%.1e" power-form="true"', float(1500))).toBe("1.5 × 10³");
    expect(print('format="%.2E" power-form="true"', float(0.0000123))).toBe("1.23 × 10⁻⁵");
    expect(print('format="%.1e" power-form="true"', float(1e100))).toBe("1.0 × 10¹⁰⁰");
    expect(print('format="%.1e" power-form="true"', float(0))).toBe("0.0 × 10⁰");
    expect(print('format="%.1e" power-form="false"', float(1500))).toBe("1.5e+03");
    expect(print('power-form="true"', text("e+03"))).toBe("e+03");
  });

  it("ignores a format that is not one conversion specifier, and one asking for more than 1100 places", () => {
    for (const format of [
      "abc",
      "%d",
      "%s",
      "%",
      "%5",
      "%.2f%%",
      "%ii",
      "x%i",
      "%i ",
      "% +i-",
      "%1.2.3f",
      "%99999f",
      "%.5000e",
      "%l",
    ]) {
      expect(formatted(format, float(1234567)), format).toBe("1.23457E+06");
      expect(formatted(format, int(42)), format).toBe("42");
    }
  });

  it("refuses arguments of the wrong type", () => {
    expect(() => formatPrintedVariable(json("null"), null, variables())).toThrow(DataError);
    expect(() => formatPrintedVariable(printedOf(""), null, json("null"))).toThrow(DataError);
  });
});

describe("resolving content", () => {
  it("prints the variables as text and keeps the feedback and template content that the outcomes and the templates show", () => {
    const resolved = resolve(rightOutcomes, drawnTemplates);
    expect(textOf(resolved.slice(0, 1))).toBe("Score 0.6, n = 7, response .");
    expect(kinds(resolved)).toEqual([
      "p",
      "feedback-block",
      "p",
      "template-block",
      "rubric-block",
      "choice-interaction",
      "div",
      "p",
    ]);
    expect(resolved.filter((node) => node.kind === "feedback-block")).toHaveLength(1);
    expect(textOf(resolved.filter((node) => node.kind === "feedback-block"))).toBe("Right");
    expect(textOf(resolved.filter((node) => node.kind === "template-block"))).toBe("Block A, n = 7");
  });

  it("removes the feedback and template content that is hidden: an outcome that names nothing, a template variable that is NULL", () => {
    const resolved = resolve({ SCORE: float(0), FEEDBACK: id("wrong") }, { N: int(1), SHOWN: null });
    expect(textOf(resolved.filter((node) => node.kind === "feedback-block"))).toBe("Not right");
    expect(resolved.filter((node) => node.kind === "template-block")).toEqual([]);
    const inline = resolved.find((node) => node.kind === "p" && textOf([node]).startsWith("Inline"));
    expect(textOf(inline === undefined ? [] : [inline])).toBe("Inline ");
    expect(textOf(resolve(rightOutcomes, drawnTemplates).filter((node) => node.kind === "p"))).toContain("Inline yesB");
  });

  it("removes the choices that a template variable hides and keeps the order of the others", () => {
    expect(choicesOf(resolve(rightOutcomes, { ...drawnTemplates, SHOWN: ids("multiple", ["A"]) }))).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(choicesOf(resolve(rightOutcomes, { ...drawnTemplates, SHOWN: ids("multiple", ["B"]) }))).toEqual(["C"]);
    expect(choicesOf(resolve(rightOutcomes, { ...drawnTemplates, SHOWN: null }))).toEqual(["B", "C"]);
  });

  it("keeps the rubric blocks whose view lists the view, with their printed variables resolved", () => {
    const rubric = (view: View): string[] =>
      resolve(rightOutcomes, drawnTemplates, view)
        .filter((node) => node.kind === "rubric-block")
        .map((block) => textOf([block]));
    expect(rubric("candidate")).toEqual(["For candidates"]);
    expect(rubric("scorer")).toEqual(["For candidates", "For scorers, n = 7"]);
    expect(rubric("tutor")).toEqual([]);
  });

  it("substitutes the value of a template variable with param-variable for the parameter that names it", () => {
    const resolved = resolve(rightOutcomes, drawnTemplates);
    const div = resolved.find((node) => node.kind === "div");
    const object = div?.kind === "div" ? div.children[0] : undefined;
    const params =
      object?.kind === "object" ? object.children.flatMap((child) => (child.kind === "param" ? [child] : [])) : [];
    expect(params.map(({ name, value }) => [name, value])).toEqual([
      ["width", "0.5"],
      ["count", "7"],
      ["keep", "literal"],
    ]);
    const asAuthored = resolve(rightOutcomes, { ...drawnTemplates, W: null, N: container("multiple", "integer", [1]) });
    const kept = asAuthored.find((node) => node.kind === "div");
    const authored = kept?.kind === "div" && kept.children[0]?.kind === "object" ? kept.children[0].children : [];
    expect(authored.flatMap((child) => (child.kind === "param" ? [child.value] : []))).toEqual(["W", "N", "literal"]);
  });

  it("replaces the mi and ci of MathML that name a template variable with math-variable by mn and cn with its value", () => {
    const names = (nodes: readonly BodyNode[]): string[] => {
      const paragraph = nodes[nodes.length - 1];
      const math = paragraph?.kind === "p" ? paragraph.children[0] : undefined;
      return math === undefined ? [] : mathParts(math);
    };
    expect(names(resolve(rightOutcomes, drawnTemplates))).toEqual(["mn:7", "mo:+", "mi:x", "mrow:", "cn:7"]);
    expect(names(resolve(rightOutcomes, { ...drawnTemplates, N: null }))).toEqual([
      "mi:N",
      "mo:+",
      "mi:x",
      "mrow:",
      "ci:N",
    ]);
  });

  it("prints nothing for a response variable, whose value the candidate knows from the interaction", () => {
    const resolved = resolveContent(body, variables(rightOutcomes, drawnTemplates), sample, { view: "candidate" });
    expect(textOf(resolved.slice(0, 1))).toContain("response .");
  });

  it("does not change the content it is given, nor the nodes it keeps whole", () => {
    const before = structuredClone(body);
    resolve(rightOutcomes, drawnTemplates);
    resolve({ FEEDBACK: id("wrong") }, { SHOWN: null }, "scorer");
    expect(body).toEqual(before);
  });

  it("refuses arguments of the wrong type", () => {
    const options = { view: "candidate" } as const;
    expect(() => resolveContent(json("null"), variables(), sample, options)).toThrow(DataError);
    expect(() => resolveContent(body, json("null"), sample, options)).toThrow(DataError);
    expect(() => resolveContent(body, json('{"outcomes": {}, "templates": {}}'), sample, options)).toThrow(
      "The outcomes of the variables must be a Map, found an object.",
    );
    expect(() => resolveContent(body, variables(), json("null"), options)).toThrow(DataError);
    expect(() => resolveContent(body, variables(), json('{"templateDeclarations": 1}'), options)).toThrow(DataError);
    expect(() => resolveContent(body, variables(), sample, json("null"))).toThrow(DataError);
    expect(() => resolveContent(body, variables(), sample, json('{"view": "student"}'))).toThrow(
      'The option view must be "author", "candidate", "proctor", "scorer", "testConstructor" or "tutor", found "student".',
    );
  });
});

describe("rubric blocks", () => {
  const block = (view: string, label: string, use = ' use="instructions"'): string =>
    `<qti-rubric-block view="${view}"${use}><qti-content-body><p>${label}</p></qti-content-body></qti-rubric-block>`;
  const rubricTest = testOf(
    `${block("candidate", "test candidate")}${block("scorer", "test scorer", "")}<qti-test-part identifier="part" navigation-mode="linear" submission-mode="individual">${block("candidate proctor", "part candidate")}<qti-assessment-section identifier="outer" title="Outer" visible="true">${block("candidate tutor", "outer candidate")}<qti-assessment-section identifier="inner" title="Inner" visible="true">${block("candidate", "inner candidate")}${block("author", "inner author")}<qti-assessment-item-ref identifier="i" href="i.xml"/></qti-assessment-section></qti-assessment-section></qti-test-part>`,
  );
  const part = rubricTest.testParts[0];
  const outer = part?.sections[0];
  const inner = outer?.kind === "assessment-section" ? outer.children[0] : undefined;
  const sections = [outer, inner].flatMap((section) => (section?.kind === "assessment-section" ? [section] : []));
  const labels = (blocks: ReturnType<typeof testRubricBlocks>): string[] => blocks.map((entry) => textOf([entry]));

  it("keeps the rubric blocks of a list whose view lists the view", () => {
    const blocks = rubricTest.rubricBlocks;
    expect(labels(rubricBlocksFor(blocks, "candidate"))).toEqual(["test candidate"]);
    expect(labels(rubricBlocksFor(blocks, "scorer"))).toEqual(["test scorer"]);
    expect(rubricBlocksFor(blocks, "proctor")).toEqual([]);
  });

  it("puts the rubric in the order test, test part, then the sections from the top down, each level in its own order", () => {
    expect(labels(testRubricBlocks({ test: rubricTest, part, sections }, "candidate"))).toEqual([
      "test candidate",
      "part candidate",
      "outer candidate",
      "inner candidate",
    ]);
    expect(labels(testRubricBlocks({ test: rubricTest, part, sections }, "tutor"))).toEqual(["outer candidate"]);
    expect(labels(testRubricBlocks({ test: rubricTest, part, sections }, "author"))).toEqual(["inner author"]);
  });

  it("gives the rubric of the test alone, or of the test and its part, when the position has no part or no sections", () => {
    expect(labels(testRubricBlocks({ test: rubricTest }, "candidate"))).toEqual(["test candidate"]);
    expect(labels(testRubricBlocks({ test: rubricTest, part }, "candidate"))).toEqual([
      "test candidate",
      "part candidate",
    ]);
    expect(labels(testRubricBlocks({ test: rubricTest, sections: [] }, "candidate"))).toEqual(["test candidate"]);
  });

  it("ViewEnum: reads author, candidate, proctor, scorer, testConstructor and tutor, alone or together, and refuses any other term", () => {
    expect(VIEWS).toEqual(["author", "candidate", "proctor", "scorer", "testConstructor", "tutor"]);
    const read = (view: string): readonly string[] | undefined =>
      itemOf(`<qti-item-body>${block(view, "x")}</qti-item-body>`).body?.children.flatMap((node) =>
        node.kind === "rubric-block" ? [node.view] : [],
      )[0];
    for (const view of VIEWS) expect(read(view)).toEqual([view]);
    expect(read("author  candidate\ttutor")).toEqual(["author", "candidate", "tutor"]);
    for (const view of ["student", "Candidate", "test-constructor", "author student"])
      expect(() => read(view)).toThrow(ReadError);
  });

  it("UseEnum and UseEnumExt: reads instructions, scoring and navigation and an ext: term, and refuses any other", () => {
    const read = (use: string): string | undefined =>
      itemOf(
        `<qti-item-body><qti-rubric-block view="author" use="${use}"><qti-content-body><p>x</p></qti-content-body></qti-rubric-block></qti-item-body>`,
      ).body?.children.flatMap((node) => (node.kind === "rubric-block" ? [node.use] : []))[0];
    for (const use of ["instructions", "scoring", "navigation", "ext:hint", "ext:org.example-kind_1"])
      expect(read(use)).toBe(use);
    for (const use of ["hint", "Instructions", "ext:", "extension"]) expect(() => read(use)).toThrow(ReadError);
  });

  it("refuses a rubric block that contains an interaction or another rubric block", () => {
    const read = (content: string): unknown =>
      readAsi(
        `<qti-assessment-item ${NS} identifier="i" title="T" time-dependent="false"><qti-item-body><qti-rubric-block view="author" use="instructions"><qti-content-body>${content}</qti-content-body></qti-rubric-block></qti-item-body></qti-assessment-item>`,
      );
    expect(() => read('<qti-text-entry-interaction response-identifier="R"/>')).toThrow(ReadError);
    expect(() =>
      read(
        '<qti-choice-interaction response-identifier="R"><qti-simple-choice identifier="A">a</qti-simple-choice></qti-choice-interaction>',
      ),
    ).toThrow(ReadError);
    expect(() => read(block("author", "inner"))).toThrow(ReadError);
    expect(() =>
      read(
        '<p>Plain <qti-printed-variable identifier="N"/></p><qti-template-block template-identifier="T" identifier="x"><qti-content-body><p>x</p></qti-content-body></qti-template-block>',
      ),
    ).not.toThrow();
  });

  it("refuses arguments of the wrong type", () => {
    expect(() => rubricBlocksFor(json("null"), "candidate")).toThrow(DataError);
    expect(() => rubricBlocksFor([], json('"student"'))).toThrow(DataError);
    expect(() => rubricBlocksFor(json("[1]"), "candidate")).toThrow(DataError);
    expect(() => rubricBlocksFor(json('[{"view": "candidate"}]'), "candidate")).toThrow(DataError);
    expect(() => testRubricBlocks(json("null"), "candidate")).toThrow(DataError);
    expect(() => testRubricBlocks(json("{}"), "candidate")).toThrow(DataError);
    expect(() => testRubricBlocks({ test: rubricTest, sections: json("1") }, "candidate")).toThrow(DataError);
  });
});

describe("the visibility of content", () => {
  it("shows content with show when the variable matches or contains the identifier, and hides it otherwise", () => {
    expect(isShown("show", "A", id("A"))).toBe(true);
    expect(isShown("show", "A", id("B"))).toBe(false);
    expect(isShown("show", "A", ids("multiple", ["B", "A"]))).toBe(true);
    expect(isShown("show", "A", ids("multiple", ["B", "C"]))).toBe(false);
    expect(isShown("show", "A", ids("ordered", ["B", "A"]))).toBe(true);
    expect(isShown("show", "A", null)).toBe(false);
  });

  it("inverts the rule for hide: shown by default, hidden when the variable matches or contains the identifier", () => {
    expect(isShown("hide", "A", id("A"))).toBe(false);
    expect(isShown("hide", "A", id("B"))).toBe(true);
    expect(isShown("hide", "A", ids("multiple", ["B", "A"]))).toBe(false);
    expect(isShown("hide", "A", ids("multiple", ["B", "C"]))).toBe(true);
    expect(isShown("hide", "A", null)).toBe(true);
  });

  it("takes an absent show-hide for show, the default of the schema", () => {
    expect(isShown(undefined, "A", id("A"))).toBe(true);
    expect(isShown(undefined, "A", null)).toBe(false);
  });

  it("a variable of another base type or a record names nothing", () => {
    expect(isShown("show", "A", text("A"))).toBe(false);
    expect(isShown("hide", "A", text("A"))).toBe(true);
    expect(isShown("show", "A", record([["A", id("A")]]))).toBe(false);
    expect(isShown("show", "1", int(1))).toBe(false);
  });

  it("refuses arguments of the wrong type", () => {
    expect(() => isShown(json('"visible"'), "A", null)).toThrow(DataError);
    expect(() => isShown("show", json("1"), null)).toThrow("The identifier must be a string, found 1.");
    expect(() => isShown("show", "A", json("1"))).toThrow(DataError);
  });
});

describe("the terms of show and hide", () => {
  it("ShowHideEnum: reads show and hide and refuses any other term", () => {
    const read = (term: string): string | undefined =>
      itemOf(
        `<qti-item-body><qti-feedback-block outcome-identifier="F" identifier="x" show-hide="${term}"><qti-content-body><p>x</p></qti-content-body></qti-feedback-block></qti-item-body>`,
      ).body?.children.flatMap((node) => (node.kind === "feedback-block" ? [node.showHide] : []))[0];
    expect(read("show")).toBe("show");
    expect(read("hide")).toBe("hide");
    for (const term of ["Show", "visible", ""]) expect(() => read(term)).toThrow(ReadError);
  });
});

describe("companion materials", () => {
  const Materials = `<qti-companion-materials-info>
      <qti-calculator><qti-calculator-type>scientific</qti-calculator-type><qti-description>A scientific calculator</qti-description></qti-calculator>
      <qti-rule><qti-description>A ruler</qti-description><qti-rule-system-si><qti-minimum-length>10</qti-minimum-length><qti-minor-increment unit="Millimeter">1</qti-minor-increment><qti-major-increment unit="Centimeter">1</qti-major-increment></qti-rule-system-si></qti-rule>
      <qti-protractor><qti-description>A protractor</qti-description><qti-increment-us><qti-minor-increment unit="Degree">1</qti-minor-increment><qti-major-increment unit="Degree">10</qti-major-increment></qti-increment-us></qti-protractor>
      <qti-digital-material mime-type="application/pdf"><qti-file-href>formulas.pdf</qti-file-href><qti-resource-icon>icon.png</qti-resource-icon></qti-digital-material>
      <qti-physical-material>Graph paper</qti-physical-material>
    </qti-companion-materials-info>`;
  const withMaterials = (materials: string): AssessmentItem =>
    itemOf(`${materials}<qti-item-body><p>x</p></qti-item-body>`);

  it("gives the calculators, rules, protractors, digital and physical materials of an item as data", () => {
    const materials = withMaterials(Materials).companionMaterials;
    expect(
      materials?.calculators.map((calculator) => [calculator.calculatorType.value, calculator.description.value]),
    ).toEqual([["scientific", "A scientific calculator"]]);
    const [rule] = materials?.rules ?? [];
    expect(rule?.description.value).toBe("A ruler");
    expect(rule?.ruleSystem.kind).toBe("rule-system-si");
    expect(rule?.ruleSystem.minimumLength.value).toBe(10);
    expect(rule?.ruleSystem.majorIncrement).toMatchObject({ unit: "Centimeter", value: "1" });
    const [protractor] = materials?.protractors ?? [];
    expect(protractor?.increment.kind).toBe("increment-us");
    expect(protractor?.increment.majorIncrement).toMatchObject({ unit: "Degree", value: "10" });
    const [digital] = materials?.digitalMaterials ?? [];
    expect(digital?.fileHref.value).toBe("formulas.pdf");
    expect(digital?.resourceIcon?.value).toBe("icon.png");
    expect(materials?.physicalMaterials.map((material) => material.value)).toEqual(["Graph paper"]);
  });

  it("has no companion materials for an item that declares none", () => {
    expect(withMaterials("").companionMaterials).toBeUndefined();
  });

  it("CalculatorTypeEnum: reads basic, graphing, scientific and standard, and refuses any other term", () => {
    const read = (type: string): string | undefined =>
      withMaterials(
        `<qti-companion-materials-info><qti-calculator><qti-calculator-type>${type}</qti-calculator-type><qti-description>c</qti-description></qti-calculator></qti-companion-materials-info>`,
      ).companionMaterials?.calculators[0]?.calculatorType.value;
    for (const type of ["basic", "graphing", "scientific", "standard"]) expect(read(type)).toBe(type);
    for (const type of ["Basic", "financial", ""]) expect(() => read(type)).toThrow(ReadError);
  });

  /** Reads the unit of an increment in a ruler of the system, or of a protractor. */
  function unitIn(place: "rule-si" | "rule-us" | "protractor-si" | "protractor-us", unit: string): string | undefined {
    const increments = `<qti-minor-increment unit="${unit}">1</qti-minor-increment><qti-major-increment unit="${unit}">2</qti-major-increment>`;
    const markup = {
      "rule-si": `<qti-rule><qti-description>r</qti-description><qti-rule-system-si><qti-minimum-length>1</qti-minimum-length>${increments}</qti-rule-system-si></qti-rule>`,
      "rule-us": `<qti-rule><qti-description>r</qti-description><qti-rule-system-us><qti-minimum-length>1</qti-minimum-length>${increments}</qti-rule-system-us></qti-rule>`,
      "protractor-si": `<qti-protractor><qti-description>p</qti-description><qti-increment-si>${increments}</qti-increment-si></qti-protractor>`,
      "protractor-us": `<qti-protractor><qti-description>p</qti-description><qti-increment-us>${increments}</qti-increment-us></qti-protractor>`,
    }[place];
    const materials = withMaterials(
      `<qti-companion-materials-info>${markup}</qti-companion-materials-info>`,
    ).companionMaterials;
    const increment = place.startsWith("rule") ? materials?.rules[0]?.ruleSystem : materials?.protractors[0]?.increment;
    return increment?.majorIncrement.unit;
  }

  it("SIUnitTypeEnum: a metric ruler measures in Millimeter, Centimeter, Meter and Kilometer, and refuses any other unit", () => {
    for (const unit of ["Millimeter", "Centimeter", "Meter", "Kilometer"]) expect(unitIn("rule-si", unit)).toBe(unit);
    for (const unit of ["Inch", "meter", "Radian"]) expect(() => unitIn("rule-si", unit)).toThrow(ReadError);
  });

  it("USUnitTypeEnum: a ruler in US units measures in Inch, Foot, Yard and Mile, and refuses any other unit", () => {
    for (const unit of ["Inch", "Foot", "Yard", "Mile"]) expect(unitIn("rule-us", unit)).toBe(unit);
    for (const unit of ["Meter", "foot", "Degree"]) expect(() => unitIn("rule-us", unit)).toThrow(ReadError);
  });

  it("SIRadialUnitTypeEnum: a protractor in SI units measures in Radian, and refuses any other unit", () => {
    expect(unitIn("protractor-si", "Radian")).toBe("Radian");
    for (const unit of ["Degree", "radian", "Meter"]) expect(() => unitIn("protractor-si", unit)).toThrow(ReadError);
  });

  it("USRadialUnitTypeEnum: a protractor in US units measures in Degree, Minute and Second, and refuses any other unit", () => {
    for (const unit of ["Degree", "Minute", "Second"]) expect(unitIn("protractor-us", unit)).toBe(unit);
    for (const unit of ["Radian", "degree", "Hour"]) expect(() => unitIn("protractor-us", unit)).toThrow(ReadError);
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/content.md", import.meta.url);
    const modules = {
      "@assesskit/runtime/asi": await import("../src/asi/index.js"),
      "@assesskit/runtime/content": await import("../src/content/index.js"),
      "@assesskit/runtime/processing": await import("../src/processing/index.js"),
      "@assesskit/runtime/values": await import("../src/values/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("hide shows exactly what show hides", () => {
    const value = fc.oneof(
      fc.constant(null),
      fc.constantFrom("A", "B", "C").map(id),
      fc.array(fc.constantFrom("A", "B", "C"), { minLength: 1, maxLength: 3 }).map((values) => ids("multiple", values)),
    );
    fc.assert(
      fc.property(fc.constantFrom("A", "B", "C", "D"), value, (identifier, variable) => {
        expect(isShown("hide", identifier, variable)).toBe(!isShown("show", identifier, variable));
      }),
    );
  });

  it("reads back what %.17g writes: every finite double", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        expect(Number(formatted("%.17g", float(value)))).toBe(value);
        expect(Number(formatted("%.16e", float(value)))).toBe(value);
      }),
    );
  });

  it("pads to the width, to the left unless the minus flag is set, and never cuts a number", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100_000, max: 100_000 }), fc.integer({ min: 0, max: 12 }), (value, width) => {
        const natural = formatted("%i", int(value));
        expect(formatted(`%${width}i`, int(value))).toBe(natural.padStart(width, " "));
        expect(formatted(`%-${width}i`, int(value))).toBe(natural.padEnd(width, " "));
      }),
    );
  });

  it("keeps a choice with show when the template variable names it and one with hide when it does not, and a choice without a template variable always", () => {
    fc.assert(
      fc.property(fc.subarray(["A", "B", "C", "D"]), (named) => {
        const shown = choicesOf(
          resolve(rightOutcomes, { ...drawnTemplates, SHOWN: named.length === 0 ? null : ids("multiple", named) }),
        );
        expect(shown).toEqual([...(named.includes("A") ? ["A"] : []), ...(named.includes("B") ? [] : ["B"]), "C"]);
      }),
    );
  });
});
