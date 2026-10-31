import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ASI_NAMESPACE,
  type AssessmentItem,
  answeredStatus,
  type BaseType,
  type Binding,
  checkBindings,
  checkResponse,
  container,
  createRandom,
  DataError,
  describeInteractions,
  type InteractionDescriptor,
  type InteractionKind,
  initialResponse,
  numericRecord,
  type Primitive,
  presentChoices,
  type Random,
  ReadError,
  type RecordValue,
  type ResponseViolation,
  readAsi,
  type SingleValue,
  shuffleChoices,
  single,
  type Value,
} from "../src/index.js";
import { shufflingDescriptor } from "./arbitraries/interactions.js";
import { interactionKinds } from "./asi-elements.js";
import { runGuideSamples } from "./guide-samples.js";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

const NS = `xmlns="${ASI_NAMESPACE}"`;

/** Reads an item with the given declarations and body. */
function itemOf(body: string, declarations = ""): AssessmentItem {
  const document = readAsi(
    `<qti-assessment-item ${NS} identifier="item" title="Item" time-dependent="false">${declarations}<qti-item-body>${body}</qti-item-body></qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("The test reads an item.");
  return document.item;
}

const declare = (cardinality: string, baseType: string, identifier = "R"): string =>
  `<qti-response-declaration identifier="${identifier}" cardinality="${cardinality}" base-type="${baseType}"/>`;

/** Describes the only interaction of an item that has the given body. */
function descriptorOf(body: string, declarations = declare("single", "identifier")): InteractionDescriptor {
  const [descriptor] = describeInteractions(itemOf(body, declarations));
  if (descriptor === undefined) throw new Error("The test describes an interaction.");
  return descriptor;
}

const id = (value: string): SingleValue => single("identifier", value);
const pair = (first: string, second: string): [string, string] => [first, second];

function list(cardinality: "multiple" | "ordered", baseType: BaseType, values: readonly Primitive[]): Value {
  const built = container(cardinality, baseType, values);
  if (built === null) throw new Error("The test builds an empty container.");
  return built;
}

const identifiers = (cardinality: "multiple" | "ordered", values: readonly string[]): Value =>
  list(cardinality, "identifier", values);

/** Names the bindings of a descriptor: `single identifier`, `record`. */
function namesOf(bindings: readonly Binding[]): string[] {
  return bindings.flatMap(({ cardinality, baseTypes }) =>
    baseTypes.length === 0 ? [cardinality] : baseTypes.map((baseType) => `${cardinality} ${baseType}`),
  );
}

const choice = (identifier: string, attributes = ""): string =>
  `<qti-simple-choice identifier="${identifier}"${attributes}>${identifier}</qti-simple-choice>`;
const associable = (identifier: string, attributes = ' match-max="1"'): string =>
  `<qti-simple-associable-choice identifier="${identifier}"${attributes}>${identifier}</qti-simple-associable-choice>`;
const IMAGE = '<img src="a.png" alt="a" width="10" height="10"/>';
const hotspot = (identifier: string, tag = "qti-hotspot-choice", attributes = ""): string =>
  `<${tag} identifier="${identifier}" shape="rect" coords="0,0,5,5"${attributes}/>`;

/** A seeded random source that counts its draws. */
function counting(seed: number): Random & { draws: number } {
  const source = createRandom(seed);
  return {
    draws: 0,
    uniform() {
      this.draws++;
      return source.uniform();
    },
  };
}

/** The interactions of the information model as markup, with the bindings that it gives each. */
const INTERACTIONS: readonly {
  readonly kind: InteractionKind;
  readonly body: string;
  readonly bindings: readonly string[];
}[] = [
  {
    kind: "choice-interaction",
    body: `<qti-choice-interaction response-identifier="R">${choice("A")}</qti-choice-interaction>`,
    bindings: ["single identifier", "multiple identifier"],
  },
  {
    kind: "order-interaction",
    body: `<qti-order-interaction response-identifier="R">${choice("A")}${choice("B")}</qti-order-interaction>`,
    bindings: ["ordered identifier"],
  },
  {
    kind: "associate-interaction",
    body: `<qti-associate-interaction response-identifier="R">${associable("A")}${associable("B")}</qti-associate-interaction>`,
    bindings: ["single pair", "multiple pair"],
  },
  {
    kind: "match-interaction",
    body: `<qti-match-interaction response-identifier="R"><qti-simple-match-set>${associable("A")}</qti-simple-match-set><qti-simple-match-set>${associable("X")}</qti-simple-match-set></qti-match-interaction>`,
    bindings: ["single directedPair", "multiple directedPair"],
  },
  {
    kind: "gap-match-interaction",
    body: '<qti-gap-match-interaction response-identifier="R"><qti-gap-text identifier="W" match-max="1">w</qti-gap-text><p>a <qti-gap identifier="G1"/> b</p></qti-gap-match-interaction>',
    bindings: ["single directedPair", "multiple directedPair"],
  },
  {
    kind: "inline-choice-interaction",
    body: '<p><qti-inline-choice-interaction response-identifier="R"><qti-inline-choice identifier="A">a</qti-inline-choice></qti-inline-choice-interaction></p>',
    bindings: ["single identifier"],
  },
  {
    kind: "text-entry-interaction",
    body: '<p><qti-text-entry-interaction response-identifier="R"/></p>',
    bindings: ["single float", "single integer", "single string", "record"],
  },
  {
    kind: "extended-text-interaction",
    body: '<qti-extended-text-interaction response-identifier="R"/>',
    bindings: ["single float", "single integer", "single string", "record"],
  },
  {
    kind: "hottext-interaction",
    body: '<qti-hottext-interaction response-identifier="R"><p>x <qti-hottext identifier="H1">one</qti-hottext></p></qti-hottext-interaction>',
    bindings: ["single identifier", "multiple identifier"],
  },
  {
    kind: "hotspot-interaction",
    body: `<qti-hotspot-interaction response-identifier="R">${IMAGE}${hotspot("S1")}</qti-hotspot-interaction>`,
    bindings: ["single identifier", "multiple identifier"],
  },
  {
    kind: "graphic-order-interaction",
    body: `<qti-graphic-order-interaction response-identifier="R">${IMAGE}${hotspot("S1")}${hotspot("S2")}</qti-graphic-order-interaction>`,
    bindings: ["ordered identifier"],
  },
  {
    kind: "graphic-associate-interaction",
    body: `<qti-graphic-associate-interaction response-identifier="R">${IMAGE}${hotspot("S1", "qti-associable-hotspot", ' match-max="1"')}</qti-graphic-associate-interaction>`,
    bindings: ["single pair", "multiple pair"],
  },
  {
    kind: "graphic-gap-match-interaction",
    body: `<qti-graphic-gap-match-interaction response-identifier="R">${IMAGE}<qti-gap-text identifier="W" match-max="1">w</qti-gap-text>${hotspot("S1", "qti-associable-hotspot", ' match-max="1"')}</qti-graphic-gap-match-interaction>`,
    bindings: ["multiple directedPair"],
  },
  {
    kind: "select-point-interaction",
    body: `<qti-select-point-interaction response-identifier="R" max-choices="1">${IMAGE}</qti-select-point-interaction>`,
    bindings: ["single point", "multiple point"],
  },
  {
    kind: "position-object-interaction",
    body: `<qti-position-object-stage>${IMAGE}<qti-position-object-interaction response-identifier="R">${IMAGE}</qti-position-object-interaction></qti-position-object-stage>`,
    bindings: ["single point", "multiple point"],
  },
  {
    kind: "slider-interaction",
    body: '<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="10"/>',
    bindings: ["single float", "single integer"],
  },
  {
    kind: "media-interaction",
    body: '<qti-media-interaction response-identifier="R" autostart="false"><object data="a.mp3" type="audio/mpeg"/></qti-media-interaction>',
    bindings: ["single integer"],
  },
  {
    kind: "drawing-interaction",
    body: `<qti-drawing-interaction response-identifier="R">${IMAGE}</qti-drawing-interaction>`,
    bindings: ["single file"],
  },
  {
    kind: "upload-interaction",
    body: '<qti-upload-interaction response-identifier="R" type="image/png text/plain"/>',
    bindings: ["single file"],
  },
  {
    kind: "end-attempt-interaction",
    body: '<p><qti-end-attempt-interaction response-identifier="R" title="Hint"/></p>',
    bindings: ["single boolean"],
  },
];

/** The fields of a numeric record as a plain object. */
const fields = (record: RecordValue | null): Record<string, string | number> =>
  Object.fromEntries([...(record?.fields ?? [])].map(([name, field]) => [name, field.value as string | number]));

describe("describing interactions", () => {
  it.each(INTERACTIONS)(
    "$kind: accepts the bindings that the information model gives it",
    ({ kind, body, bindings }) => {
      const descriptor = descriptorOf(body);
      expect(descriptor.kind).toBe(kind);
      expect(descriptor.responseIdentifier).toBe("R");
      expect(namesOf(descriptor.bindings)).toEqual(bindings);
    },
  );

  it("covers every kind of interaction that the ASI schema declares: the table above and the two custom kinds below", () => {
    const covered = new Set<string>(INTERACTIONS.map(({ kind }) => kind));
    covered.add("custom-interaction").add("portable-custom-interaction");
    expect([...covered].sort()).toEqual(interactionKinds());
  });

  it("custom interaction and portable custom interaction: accept every cardinality with every base type", () => {
    const custom = descriptorOf('<qti-custom-interaction response-identifier="R"/>');
    const portable = descriptorOf(
      '<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:x:pci" module="m"><qti-interaction-markup/></qti-portable-custom-interaction>',
    );
    for (const descriptor of [custom, portable]) {
      expect(descriptor.bindings.map(({ cardinality }) => cardinality)).toEqual([
        "multiple",
        "ordered",
        "record",
        "single",
      ]);
      expect(namesOf(descriptor.bindings)).toContain("multiple file");
      expect(namesOf(descriptor.bindings)).toContain("record");
      expect(descriptor.choices).toEqual([]);
    }
  });

  it("needs a container when more than one value can be given: max-choices above 1 or 0, max-associations, several gaps", () => {
    const many = (attributes: string): string[] =>
      namesOf(
        descriptorOf(
          `<qti-choice-interaction response-identifier="R"${attributes}>${choice("A")}</qti-choice-interaction>`,
        ).bindings,
      );
    expect(many(' max-choices="1"')).toEqual(["single identifier", "multiple identifier"]);
    expect(many(' max-choices="3"')).toEqual(["multiple identifier"]);
    expect(many(' max-choices="0"')).toEqual(["multiple identifier"]);
    const associate = descriptorOf(
      `<qti-associate-interaction response-identifier="R" max-associations="2">${associable("A")}${associable("B")}</qti-associate-interaction>`,
    );
    expect(namesOf(associate.bindings)).toEqual(["multiple pair"]);
    const gaps = descriptorOf(
      '<qti-gap-match-interaction response-identifier="R"><qti-gap-text identifier="W" match-max="1">w</qti-gap-text><p><qti-gap identifier="G1"/><qti-gap identifier="G2"/></p></qti-gap-match-interaction>',
    );
    expect(namesOf(gaps.bindings)).toEqual(["multiple directedPair"]);
    const selectPoint = descriptorOf(
      `<qti-select-point-interaction response-identifier="R">${IMAGE}</qti-select-point-interaction>`,
    );
    expect(namesOf(selectPoint.bindings)).toEqual(["multiple point"]);
  });

  it("extended text: accepts a container only when max-strings says how many strings", () => {
    const without = descriptorOf('<qti-extended-text-interaction response-identifier="R"/>');
    const container = descriptorOf('<qti-extended-text-interaction response-identifier="R" max-strings="3"/>');
    expect(namesOf(without.bindings)).not.toContain("multiple string");
    expect(namesOf(container.bindings)).toEqual([
      "single float",
      "single integer",
      "single string",
      "multiple float",
      "multiple integer",
      "multiple string",
      "ordered float",
      "ordered integer",
      "ordered string",
      "record",
    ]);
  });

  it("finds the interactions of the body in document order, inside feedback, a table and the position object stage", () => {
    const item = itemOf(
      `<div>${'<qti-text-entry-interaction response-identifier="FIRST"/>'}</div><qti-feedback-block outcome-identifier="O" identifier="x" show-hide="show"><qti-content-body><qti-choice-interaction response-identifier="SECOND">${choice("A")}</qti-choice-interaction></qti-content-body></qti-feedback-block><table><tr><td><qti-slider-interaction response-identifier="THIRD" lower-bound="0" upper-bound="1"/></td></tr></table><qti-position-object-stage>${IMAGE}<qti-position-object-interaction response-identifier="FOURTH">${IMAGE}</qti-position-object-interaction></qti-position-object-stage>`,
    );
    expect(describeInteractions(item).map(({ responseIdentifier }) => responseIdentifier)).toEqual([
      "FIRST",
      "SECOND",
      "THIRD",
      "FOURTH",
    ]);
  });

  it("describes an item once, and a changed copy of it on its own", () => {
    const item = itemOf('<div><qti-text-entry-interaction response-identifier="FIRST"/></div>');
    expect(describeInteractions(item)).toBe(describeInteractions(item));
    const emptied = { ...item, body: item.body && { ...item.body, children: [] } };
    expect(describeInteractions(emptied)).toEqual([]);
    expect(describeInteractions(item).map(({ responseIdentifier }) => responseIdentifier)).toEqual(["FIRST"]);
  });

  it("describes an item without a body or with no interaction as no interactions", () => {
    expect(describeInteractions(itemOf("<p>Text</p>"))).toEqual([]);
    const document = readAsi(`<qti-assessment-item ${NS} identifier="i" title="T" time-dependent="false"/>`);
    if (document.kind !== "item") throw new Error("The test reads an item.");
    expect(describeInteractions(document.item)).toEqual([]);
  });

  it("gives the declared type of the response variable, and none when the item does not declare it", () => {
    const body = `<qti-choice-interaction response-identifier="R">${choice("A")}</qti-choice-interaction>`;
    expect(descriptorOf(body, declare("multiple", "identifier")).declaration).toEqual({
      cardinality: "multiple",
      baseType: "identifier",
    });
    expect(descriptorOf(body, "").declaration).toBeUndefined();
    expect(descriptorOf(body, declare("record", "string").replace(' base-type="string"', "")).declaration).toEqual({
      cardinality: "record",
    });
  });

  it("puts no limit on the associations of a gap match or graphic gap match interaction that gives none: each gap takes one choice", () => {
    const gaps = descriptorOf(
      '<qti-gap-match-interaction response-identifier="R"><qti-gap-text identifier="W" match-max="2">w</qti-gap-text><p><qti-gap identifier="G1"/><qti-gap identifier="G2"/></p></qti-gap-match-interaction>',
      declare("multiple", "directedPair"),
    );
    expect(gaps.constraints).toEqual({});
    const limited = descriptorOf(
      '<qti-gap-match-interaction response-identifier="R" max-associations="1"><qti-gap-text identifier="W" match-max="2">w</qti-gap-text><p><qti-gap identifier="G1"/></p></qti-gap-match-interaction>',
    );
    expect(limited.constraints).toEqual({ maxAssociations: 1 });
    const graphic = descriptorOf(
      `<qti-graphic-gap-match-interaction response-identifier="R">${IMAGE}<qti-gap-text identifier="W" match-max="2">w</qti-gap-text>${hotspot("S1", "qti-associable-hotspot", ' match-max="1"')}</qti-graphic-gap-match-interaction>`,
      declare("multiple", "directedPair"),
    );
    expect(graphic.constraints).toEqual({});
  });

  it("leaves out a maximum of 0, which is no restriction, and a minimum of 0, and applies the defaults of the schema", () => {
    const choices = (attributes: string): InteractionDescriptor =>
      descriptorOf(
        `<qti-choice-interaction response-identifier="R"${attributes}>${choice("A")}</qti-choice-interaction>`,
      );
    expect(choices("").constraints).toEqual({ maxChoices: 1 });
    expect(choices(' max-choices="0" min-choices="0"').constraints).toEqual({});
    expect(choices(' max-choices="4" min-choices="2"').constraints).toEqual({ minChoices: 2, maxChoices: 4 });
    const associate = descriptorOf(
      `<qti-associate-interaction response-identifier="R" min-associations="1" max-associations="0">${associable("A", ' match-max="0" match-min="1"')}</qti-associate-interaction>`,
    );
    expect(associate.constraints).toEqual({ minAssociations: 1 });
    expect(associate.choices[0]).toMatchObject({ identifier: "A", matchMin: 1 });
    expect(associate.choices[0]?.matchMax).toBeUndefined();
  });

  it("reads the constraints of text, slider, media and upload interactions", () => {
    expect(
      descriptorOf(
        '<p><qti-text-entry-interaction response-identifier="R" pattern-mask="[0-9]+" base="16" string-identifier="S"/></p>',
        declare("single", "integer") + declare("single", "string", "S"),
      ),
    ).toMatchObject({ constraints: { patternMask: "[0-9]+", base: 16 }, stringIdentifier: "S" });
    expect(
      descriptorOf(
        '<qti-extended-text-interaction response-identifier="R" min-strings="1" max-strings="3"/>',
        declare("multiple", "string"),
      ).constraints,
    ).toEqual({ base: 10, minStrings: 1, maxStrings: 3 });
    expect(
      descriptorOf(
        '<qti-media-interaction response-identifier="R" autostart="false" min-plays="1" max-plays="3"><object data="a.mp3" type="audio/mpeg"/></qti-media-interaction>',
      ).constraints,
    ).toEqual({ minPlays: 1, maxPlays: 3 });
    expect(
      descriptorOf('<qti-upload-interaction response-identifier="R" type="image/png text/plain"/>').constraints,
    ).toEqual({
      mimeTypes: ["image/png", "text/plain"],
    });
    expect(descriptorOf('<qti-upload-interaction response-identifier="R"/>').constraints).toEqual({});
  });

  it("rounds the bounds of a slider bound to an integer outward and gives it the step 1", () => {
    const slider = (type: string, step = ""): InteractionDescriptor =>
      descriptorOf(
        `<qti-slider-interaction response-identifier="R" lower-bound="0.5" upper-bound="9.2"${step}/>`,
        declare("single", type),
      );
    expect(slider("integer").constraints).toEqual({ lowerBound: 0, upperBound: 10, step: 1 });
    expect(slider("float").constraints).toEqual({ lowerBound: 0.5, upperBound: 9.2 });
    expect(slider("float", ' step="0.25"').constraints).toEqual({ lowerBound: 0.5, upperBound: 9.2, step: 0.25 });
  });

  it("keeps what decides the visibility of a choice and how often it is associated", () => {
    const descriptor = descriptorOf(
      `<qti-match-interaction response-identifier="R"><qti-simple-match-set><qti-simple-associable-choice identifier="A" fixed="true" template-identifier="T" show-hide="hide" match-max="2" match-min="1" match-group="X Y">A</qti-simple-associable-choice></qti-simple-match-set><qti-simple-match-set>${associable("X")}</qti-simple-match-set></qti-match-interaction>`,
    );
    expect(descriptor.matchSets?.map((set) => set.map(({ identifier }) => identifier))).toEqual([["A"], ["X"]]);
    expect(descriptor.choices.map(({ identifier }) => identifier)).toEqual(["A", "X"]);
    expect(descriptor.choices[0]).toEqual({
      identifier: "A",
      fixed: true,
      templateIdentifier: "T",
      showHide: "hide",
      matchMax: 2,
      matchMin: 1,
      matchGroup: ["X", "Y"],
    });
    expect(descriptor.choices[1]).toEqual({ identifier: "X", fixed: false, showHide: "show", matchMax: 1 });
  });

  it("takes the hot texts and the gaps from the running text of their interaction", () => {
    const hottext = descriptorOf(
      '<qti-hottext-interaction response-identifier="R" max-choices="2"><p>One <qti-hottext identifier="H1">a</qti-hottext> two <em><qti-hottext identifier="H2" template-identifier="T">b</qti-hottext></em></p></qti-hottext-interaction>',
    );
    expect(hottext.choices.map(({ identifier }) => identifier)).toEqual(["H1", "H2"]);
    expect(hottext.choices[1]?.templateIdentifier).toBe("T");
    const gaps = descriptorOf(
      '<qti-gap-match-interaction response-identifier="R"><qti-gap-text identifier="W1" match-max="1">a</qti-gap-text><qti-gap-text identifier="W2" match-max="2">b</qti-gap-text><p>x <qti-gap identifier="G1" required="true"/> y</p><p><qti-gap identifier="G2"/></p></qti-gap-match-interaction>',
      declare("multiple", "directedPair"),
    );
    expect(gaps.matchSets?.map((set) => set.map(({ identifier }) => identifier))).toEqual([
      ["W1", "W2"],
      ["G1", "G2"],
    ]);
    expect(gaps.matchSets?.[1]?.[0]?.required).toBe(true);
  });

  it("rejects an item that is not an item", () => {
    expect(() => describeInteractions(json("null"))).toThrow(DataError);
    expect(() => describeInteractions(json('{"responseDeclarations": "x"}'))).toThrow(
      'The response declarations of the item must be an array, found "x".',
    );
    expect(() => describeInteractions(json('{"responseDeclarations": [], "body": {"children": 1}}'))).toThrow(
      DataError,
    );
  });
});

describe("the vocabularies of the interactions", () => {
  /** Reads the choice interaction with the attribute `orientation`, `format` or `type` set to a term. */
  function reads(body: (term: string) => string, term: string): void {
    itemOf(body(term));
  }

  it("OrientationEnum: accepts horizontal and vertical on a choice, an order and a slider interaction and refuses any other term", () => {
    const places = [
      (term: string) =>
        `<qti-choice-interaction response-identifier="R" orientation="${term}">${choice("A")}</qti-choice-interaction>`,
      (term: string) =>
        `<qti-order-interaction response-identifier="R" orientation="${term}">${choice("A")}</qti-order-interaction>`,
      (term: string) =>
        `<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="1" orientation="${term}"/>`,
    ];
    for (const place of places) {
      for (const term of ["horizontal", "vertical"]) expect(() => reads(place, term)).not.toThrow();
      for (const term of ["diagonal", "Horizontal", ""]) expect(() => reads(place, term)).toThrow(ReadError);
    }
  });

  it("TextFormatEnum: accepts plain, preformatted and xhtml on an extended text interaction and refuses any other term", () => {
    const place = (term: string): string => `<qti-extended-text-interaction response-identifier="R" format="${term}"/>`;
    for (const term of ["plain", "preformatted", "xhtml"]) expect(() => reads(place, term)).not.toThrow();
    for (const term of ["html", "Plain", ""]) expect(() => reads(place, term)).toThrow(ReadError);
  });

  it("MimeTypeList: reads the types of an upload interaction as a list, one or more separated by white space", () => {
    const types = (text: string): readonly string[] | undefined => {
      const [descriptor] = describeInteractions(
        itemOf(`<qti-upload-interaction response-identifier="R" type="${text}"/>`),
      );
      return descriptor?.constraints.mimeTypes;
    };
    expect(types("image/png")).toEqual(["image/png"]);
    expect(types("image/png  text/plain\tapplication/pdf")).toEqual(["image/png", "text/plain", "application/pdf"]);
    expect(types("")).toBeUndefined();
  });
});

describe("checking bindings", () => {
  const issueCodes = (body: string, declarations: string): string[] =>
    checkBindings(itemOf(body, declarations)).map(({ code }) => code);
  const Choice = `<qti-choice-interaction response-identifier="R">${choice("A")}</qti-choice-interaction>`;

  it.each(INTERACTIONS)(
    "$kind: reports nothing when the response variable has a binding it accepts",
    ({ body, bindings }) => {
      const [first = ""] = bindings;
      const [cardinality = "", baseType = ""] = first.split(" ");
      expect(checkBindings(itemOf(body, declare(cardinality, baseType === "" ? "string" : baseType)))).toEqual([]);
    },
  );

  it("reports a response variable whose base type the interaction does not accept, with the section that says so", () => {
    expect(checkBindings(itemOf(Choice, declare("single", "string")))).toEqual([
      {
        severity: "error",
        code: "assesskit/interactions/binding",
        message:
          'The interaction qti-choice-interaction is bound to "R", a variable with the type single string, but it accepts single identifier or multiple identifier here.',
        location: { element: "qti-choice-interaction" },
      },
    ]);
  });

  it("reports a cardinality that the interaction does not accept: order needs ordered, inline choice needs single", () => {
    const order = `<qti-order-interaction response-identifier="R">${choice("A")}</qti-order-interaction>`;
    expect(issueCodes(order, declare("multiple", "identifier"))).toEqual(["assesskit/interactions/binding"]);
    expect(issueCodes(order, declare("ordered", "identifier"))).toEqual([]);
    const inline = `<p><qti-inline-choice-interaction response-identifier="R"><qti-inline-choice identifier="A">a</qti-inline-choice></qti-inline-choice-interaction></p>`;
    expect(issueCodes(inline, declare("multiple", "identifier"))).toEqual(["assesskit/interactions/binding"]);
  });

  it("reports a single value where max-choices allows more than one", () => {
    const three = `<qti-choice-interaction response-identifier="R" max-choices="3">${choice("A")}</qti-choice-interaction>`;
    expect(issueCodes(three, declare("single", "identifier"))).toEqual(["assesskit/interactions/binding"]);
    expect(issueCodes(three, declare("multiple", "identifier"))).toEqual([]);
  });

  it("reports a response variable that the item does not declare", () => {
    const [issue] = checkBindings(itemOf(Choice, ""));
    expect(issue).toMatchObject({ code: "assesskit/interactions/response-undeclared" });
    expect(issue?.message).toBe(
      'The interaction qti-choice-interaction is bound to the response variable "R", which the item does not declare. Declare it with a qti-response-declaration.',
    );
  });

  it("reports a response variable that two interactions bind", () => {
    expect(issueCodes(`${Choice}${Choice}`, declare("single", "identifier"))).toEqual([
      "assesskit/interactions/response-bound-twice",
    ]);
  });

  it("a text entry may keep the typed text in a second string variable, and no other variable will do", () => {
    const entry = (extra: string): string =>
      `<p><qti-text-entry-interaction response-identifier="R" string-identifier="S"${extra}/></p>`;
    const numeric = declare("single", "float");
    expect(issueCodes(entry(""), numeric + declare("single", "string", "S"))).toEqual([]);
    expect(issueCodes(entry(""), numeric)).toEqual(["assesskit/interactions/string-identifier"]);
    expect(issueCodes(entry(""), numeric + declare("single", "integer", "S"))).toEqual([
      "assesskit/interactions/string-identifier",
    ]);
    expect(issueCodes(entry(""), numeric + declare("multiple", "string", "S"))).toEqual([
      "assesskit/interactions/string-identifier",
    ]);
    expect(
      issueCodes(`${entry("")}${Choice.replace('"R"', '"S"')}`, numeric + declare("single", "string", "S")),
    ).toEqual(["assesskit/interactions/response-bound-twice", "assesskit/interactions/binding"]);
  });

  it("accepts any binding for a custom interaction and a portable custom interaction", () => {
    const custom = '<qti-custom-interaction response-identifier="R"/>';
    const portable =
      '<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:fdc:x:pci" module="m"><qti-interaction-markup/></qti-portable-custom-interaction>';
    for (const body of [custom, portable]) {
      expect(issueCodes(body, declare("record", "string"))).toEqual([]);
      expect(issueCodes(body, declare("multiple", "file"))).toEqual([]);
    }
  });

  it("rejects an item that is not an item", () => {
    expect(() => checkBindings(json("[]"))).toThrow(DataError);
  });
});

describe("checking responses", () => {
  const check = (descriptor: InteractionDescriptor, response: Value | null): [string, readonly ResponseViolation[]] => {
    const { status, reasons } = checkResponse(descriptor, response);
    return [status, reasons];
  };
  const choiceInteraction = (
    attributes: string,
    declaration = declare("multiple", "identifier"),
  ): InteractionDescriptor =>
    descriptorOf(
      `<qti-choice-interaction response-identifier="R"${attributes}>${choice("A")}${choice("B")}${choice("C")}${choice("D")}</qti-choice-interaction>`,
      declaration,
    );

  it("says presented for NULL, answered for a valid response and attempted for an invalid one", () => {
    const descriptor = choiceInteraction(' max-choices="2"');
    expect(check(descriptor, null)).toEqual(["presented", []]);
    expect(check(descriptor, identifiers("multiple", ["A"]))).toEqual(["answered", []]);
    expect(check(descriptor, identifiers("multiple", ["A", "B", "C"]))).toEqual(["attempted", ["max-choices"]]);
  });

  it("NULL breaks the rules that a missing response breaks: min-choices, required", () => {
    expect(check(choiceInteraction(' min-choices="1" max-choices="2"'), null)).toEqual(["presented", ["min-choices"]]);
    const inline = descriptorOf(
      '<p><qti-inline-choice-interaction response-identifier="R" required="true"><qti-inline-choice identifier="A">a</qti-inline-choice></qti-inline-choice-interaction></p>',
    );
    expect(check(inline, null)).toEqual(["presented", ["required"]]);
    expect(check(inline, id("A"))).toEqual(["answered", []]);
  });

  it("choices: min-choices, max-choices (0 is no limit), unknown and repeated identifiers", () => {
    const bounded = choiceInteraction(' min-choices="2" max-choices="3"');
    expect(check(bounded, identifiers("multiple", ["A"]))).toEqual(["attempted", ["min-choices"]]);
    expect(check(bounded, identifiers("multiple", ["A", "B"]))).toEqual(["answered", []]);
    expect(check(bounded, identifiers("multiple", ["A", "B", "C", "D"]))).toEqual(["attempted", ["max-choices"]]);
    expect(check(bounded, identifiers("multiple", ["A", "Z"]))).toEqual(["attempted", ["unknown-choice"]]);
    expect(check(bounded, identifiers("multiple", ["A", "A"]))).toEqual(["attempted", ["repeated-choice"]]);
    const unlimited = choiceInteraction(' max-choices="0"');
    expect(check(unlimited, identifiers("multiple", ["A", "B", "C", "D"]))).toEqual(["answered", []]);
    expect(check(choiceInteraction("", declare("single", "identifier")), id("B"))).toEqual(["answered", []]);
  });

  it("order: without min-choices every choice is ordered and max-choices is ignored", () => {
    const body = (attributes: string): string =>
      `<qti-order-interaction response-identifier="R"${attributes}>${choice("A")}${choice("B")}${choice("C")}</qti-order-interaction>`;
    const declaration = declare("ordered", "identifier");
    const all = descriptorOf(body(' max-choices="2"'), declaration);
    expect(check(all, identifiers("ordered", ["C", "A", "B"]))).toEqual(["answered", []]);
    expect(check(all, identifiers("ordered", ["C", "A"]))).toEqual(["attempted", ["min-choices"]]);
    const subset = descriptorOf(body(' min-choices="2" max-choices="2"'), declaration);
    expect(check(subset, identifiers("ordered", ["C", "A"]))).toEqual(["answered", []]);
    expect(check(subset, identifiers("ordered", ["C"]))).toEqual(["attempted", ["min-choices"]]);
    expect(check(subset, identifiers("ordered", ["C", "A", "B"]))).toEqual(["attempted", ["max-choices"]]);
    const open = descriptorOf(body(' min-choices="1"'), declaration);
    expect(check(open, identifiers("ordered", ["A", "B", "C"]))).toEqual(["answered", []]);
    expect(check(open, identifiers("ordered", ["A", "B", "C", "A"]))).toEqual([
      "attempted",
      ["repeated-choice", "max-choices"],
    ]);
    expect(check(all, null)).toEqual(["presented", ["min-choices"]]);
  });

  it("hotspots and hot texts select by identifier like choices; points are counted", () => {
    const hotspots = descriptorOf(
      `<qti-hotspot-interaction response-identifier="R" max-choices="2">${IMAGE}${hotspot("S1")}${hotspot("S2")}</qti-hotspot-interaction>`,
      declare("multiple", "identifier"),
    );
    expect(check(hotspots, identifiers("multiple", ["S1", "S2"]))).toEqual(["answered", []]);
    expect(check(hotspots, identifiers("multiple", ["S3"]))).toEqual(["attempted", ["unknown-choice"]]);
    const points = descriptorOf(
      `<qti-select-point-interaction response-identifier="R" min-choices="1" max-choices="2">${IMAGE}</qti-select-point-interaction>`,
      declare("multiple", "point"),
    );
    expect(check(points, list("multiple", "point", [[1, 2]]))).toEqual(["answered", []]);
    expect(
      check(
        points,
        list("multiple", "point", [
          [1, 2],
          [3, 4],
          [5, 6],
        ]),
      ),
    ).toEqual(["attempted", ["max-choices"]]);
    expect(check(points, null)).toEqual(["presented", ["min-choices"]]);
  });

  describe("pairs", () => {
    const associate = (choiceAttributes: string, attributes = ""): InteractionDescriptor =>
      descriptorOf(
        `<qti-associate-interaction response-identifier="R"${attributes}>${associable("A", choiceAttributes)}${associable("B", choiceAttributes)}${associable("C", choiceAttributes)}</qti-associate-interaction>`,
        declare("multiple", "pair"),
      );
    const pairs = (values: readonly [string, string][], baseType: "pair" | "directedPair" = "pair"): Value =>
      list("multiple", baseType, values);

    it("associate: min-associations, max-associations and the choices a pair names", () => {
      const descriptor = associate(' match-max="0"', ' min-associations="1" max-associations="2"');
      expect(check(descriptor, pairs([pair("A", "B")]))).toEqual(["answered", []]);
      expect(check(descriptor, pairs([pair("A", "B"), pair("B", "C"), pair("A", "C")]))).toEqual([
        "attempted",
        ["max-associations"],
      ]);
      expect(check(descriptor, pairs([pair("A", "Z")]))).toEqual(["attempted", ["unknown-choice"]]);
      expect(check(descriptor, null)).toEqual(["presented", ["min-associations"]]);
    });

    it("match-max limits how often a choice is used, and 0 is no limit; match-min demands it", () => {
      const limited = associate(' match-max="1"', ' max-associations="3"');
      expect(check(limited, pairs([pair("A", "B")]))).toEqual(["answered", []]);
      expect(check(limited, pairs([pair("A", "B"), pair("A", "C")]))).toEqual(["attempted", ["match-max"]]);
      const unlimited = associate(' match-max="0"', ' max-associations="3"');
      expect(check(unlimited, pairs([pair("A", "B"), pair("A", "C")]))).toEqual(["answered", []]);
      const demanded = associate(' match-max="1" match-min="1"', ' max-associations="3"');
      expect(check(demanded, pairs([pair("A", "B")]))).toEqual(["attempted", ["match-min"]]);
      expect(check(demanded, pairs([pair("A", "B"), pair("A", "B")]))).toEqual([
        "attempted",
        ["match-max", "match-min"],
      ]);
    });

    it("match-group: a choice is paired only with the choices of its group, from either side", () => {
      const descriptor = descriptorOf(
        `<qti-associate-interaction response-identifier="R" max-associations="3">${associable("A", ' match-max="0" match-group="B"')}${associable("B", ' match-max="0"')}${associable("C", ' match-max="0"')}</qti-associate-interaction>`,
        declare("multiple", "pair"),
      );
      expect(check(descriptor, pairs([pair("A", "B")]))).toEqual(["answered", []]);
      expect(check(descriptor, pairs([pair("C", "A")]))).toEqual(["attempted", ["match-group"]]);
      expect(check(descriptor, pairs([pair("B", "C")]))).toEqual(["answered", []]);
    });

    it("match: a directed pair runs from a choice of the first set to one of the second", () => {
      const descriptor = descriptorOf(
        `<qti-match-interaction response-identifier="R" max-associations="3"><qti-simple-match-set>${associable("A", ' match-max="2"')}${associable("B")}</qti-simple-match-set><qti-simple-match-set>${associable("X", ' match-max="2"')}${associable("Y")}</qti-simple-match-set></qti-match-interaction>`,
        declare("multiple", "directedPair"),
      );
      expect(check(descriptor, pairs([pair("A", "X"), pair("B", "Y")], "directedPair"))).toEqual(["answered", []]);
      expect(check(descriptor, pairs([pair("X", "A")], "directedPair"))).toEqual(["attempted", ["unknown-choice"]]);
      expect(check(descriptor, pairs([pair("A", "X"), pair("A", "Y"), pair("B", "X")], "directedPair"))).toEqual([
        "answered",
        [],
      ]);
      expect(check(descriptor, pairs([pair("B", "Y"), pair("B", "X")], "directedPair"))).toEqual([
        "attempted",
        ["match-max"],
      ]);
    });

    it("gap match: each gap takes one choice, a gap that is required must be filled", () => {
      const descriptor = descriptorOf(
        '<qti-gap-match-interaction response-identifier="R" max-associations="2"><qti-gap-text identifier="W1" match-max="2">a</qti-gap-text><qti-gap-text identifier="W2" match-max="1">b</qti-gap-text><p><qti-gap identifier="G1"/> <qti-gap identifier="G2" required="true"/></p></qti-gap-match-interaction>',
        declare("multiple", "directedPair"),
      );
      expect(check(descriptor, pairs([pair("W1", "G1"), pair("W2", "G2")], "directedPair"))).toEqual(["answered", []]);
      expect(check(descriptor, pairs([pair("W1", "G1"), pair("W2", "G1")], "directedPair"))).toEqual([
        "attempted",
        ["match-max", "required"],
      ]);
      expect(check(descriptor, pairs([pair("W1", "G1")], "directedPair"))).toEqual(["attempted", ["required"]]);
    });

    it("graphic gap match: a hotspot takes as many choices as its match-max, and a choice can fill a hotspot twice", () => {
      const descriptor = descriptorOf(
        `<qti-graphic-gap-match-interaction response-identifier="R" max-associations="4">${IMAGE}<qti-gap-img identifier="W1" match-max="2"><img src="a.png" alt="a"/></qti-gap-img>${hotspot("S1", "qti-associable-hotspot", ' match-max="2"')}</qti-graphic-gap-match-interaction>`,
        declare("multiple", "directedPair"),
      );
      expect(check(descriptor, pairs([pair("W1", "S1"), pair("W1", "S1")], "directedPair"))).toEqual(["answered", []]);
      expect(check(descriptor, pairs([pair("W1", "S1"), pair("W1", "S1"), pair("W1", "S1")], "directedPair"))).toEqual([
        "attempted",
        ["match-max"],
      ]);
    });
  });

  it("text: min-strings and max-strings count the non-empty strings; a record is one entry", () => {
    const extended = descriptorOf(
      '<qti-extended-text-interaction response-identifier="R" min-strings="2" max-strings="3"/>',
      declare("multiple", "string"),
    );
    const strings = (values: readonly string[]): Value => list("multiple", "string", values);
    expect(check(extended, strings(["a", "b"]))).toEqual(["answered", []]);
    expect(check(extended, strings(["a"]))).toEqual(["attempted", ["min-strings"]]);
    expect(check(extended, strings(["a", "b", "c", "d"]))).toEqual(["attempted", ["max-strings"]]);
    const one = descriptorOf(
      '<qti-extended-text-interaction response-identifier="R" min-strings="1"/>',
      declare("single", "string"),
    );
    expect(check(one, single("string", "text"))).toEqual(["answered", []]);
    expect(check(one, null)).toEqual(["presented", ["min-strings"]]);
  });

  it("pattern-mask: the whole string must match, in the regular expressions of XML Schema", () => {
    const entry = descriptorOf(
      '<p><qti-text-entry-interaction response-identifier="R" pattern-mask="[0-9]{2,3}"/></p>',
      declare("single", "string"),
    );
    expect(check(entry, single("string", "123"))).toEqual(["answered", []]);
    expect(check(entry, single("string", "12a"))).toEqual(["attempted", ["pattern-mask"]]);
    expect(check(entry, single("string", "1234"))).toEqual(["attempted", ["pattern-mask"]]);
    const record = numericRecord("45");
    expect(
      check(
        descriptorOf(
          '<p><qti-text-entry-interaction response-identifier="R" pattern-mask="[0-9]{2,3}"/></p>',
          declare("record", "string").replace(' base-type="string"', ""),
        ),
        record,
      ),
    ).toEqual(["answered", []]);
    const numeric = descriptorOf(
      '<p><qti-text-entry-interaction response-identifier="R" pattern-mask="[a-z]+"/></p>',
      declare("single", "integer"),
    );
    expect(check(numeric, single("integer", 7))).toEqual(["answered", []]);
  });

  it("slider: the value is within the bounds and on a step", () => {
    const slider = descriptorOf(
      '<qti-slider-interaction response-identifier="R" lower-bound="1" upper-bound="9" step="2"/>',
      declare("single", "float"),
    );
    expect(check(slider, single("float", 5))).toEqual(["answered", []]);
    expect(check(slider, single("float", 4))).toEqual(["attempted", ["step"]]);
    expect(check(slider, single("float", 11))).toEqual(["attempted", ["bounds"]]);
    expect(check(slider, single("float", 0))).toEqual(["attempted", ["bounds", "step"]]);
    const fine = descriptorOf(
      '<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="1" step="0.1"/>',
      declare("single", "float"),
    );
    expect(check(fine, single("float", 0.30000000000000004))).toEqual(["answered", []]);
    expect(check(slider, null)).toEqual(["presented", []]);
    const continuous = descriptorOf(
      '<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="1"/>',
      declare("single", "float"),
    );
    expect(check(continuous, single("float", 0.123456))).toEqual(["answered", []]);
  });

  it("media: the number of plays is at least min-plays and at most max-plays", () => {
    const media = descriptorOf(
      '<qti-media-interaction response-identifier="R" autostart="false" min-plays="1" max-plays="3"><object data="a.mp3" type="audio/mpeg"/></qti-media-interaction>',
      declare("single", "integer"),
    );
    expect(check(media, single("integer", 2))).toEqual(["answered", []]);
    expect(check(media, single("integer", 4))).toEqual(["attempted", ["max-plays"]]);
    expect(check(media, single("integer", 0))).toEqual(["attempted", ["min-plays"]]);
    expect(check(media, null)).toEqual(["presented", ["min-plays"]]);
  });

  it("upload: the MIME type of the file is one of the types, whatever its case and parameters", () => {
    const upload = descriptorOf(
      '<qti-upload-interaction response-identifier="R" type="image/png text/plain"/>',
      declare("single", "file"),
    );
    const file = (mimeType: string): Value => single("file", { reference: "f1", mimeType });
    expect(check(upload, file("image/png"))).toEqual(["answered", []]);
    expect(check(upload, file("TEXT/Plain; charset=utf-8"))).toEqual(["answered", []]);
    expect(check(upload, file("application/pdf"))).toEqual(["attempted", ["mime-type"]]);
    const any = descriptorOf('<qti-upload-interaction response-identifier="R"/>', declare("single", "file"));
    expect(check(any, file("application/pdf"))).toEqual(["answered", []]);
  });

  it("a response of another type than the interaction accepts, or than the declaration states, is a binding violation", () => {
    const descriptor = choiceInteraction(' max-choices="2"');
    expect(check(descriptor, single("float", 1))).toEqual(["attempted", ["binding"]]);
    expect(check(descriptor, id("A"))).toEqual(["attempted", ["binding"]]);
    expect(check(choiceInteraction("", declare("multiple", "identifier")), identifiers("multiple", ["A"]))).toEqual([
      "answered",
      [],
    ]);
  });

  it("a custom interaction accepts any response", () => {
    const custom = descriptorOf('<qti-custom-interaction response-identifier="R"/>', declare("single", "string"));
    expect(check(custom, single("string", "x"))).toEqual(["answered", []]);
  });

  it("rejects a descriptor or a response of the wrong type", () => {
    const descriptor = choiceInteraction("");
    expect(() => checkResponse(json("null"), null)).toThrow(
      "The interaction descriptor must be an object, found null.",
    );
    expect(() => checkResponse(json('{"kind": 1}'), null)).toThrow(DataError);
    expect(() => checkResponse(descriptor, json('{"cardinality": "x"}'))).toThrow(DataError);
    expect(() => checkResponse(descriptor, json('"A"'))).toThrow(DataError);
    expect(() => checkResponse({ ...descriptor, choices: json('"x"') }, null)).toThrow(
      'The choices of an interaction descriptor must be an array, found "x".',
    );
    expect(() => checkResponse({ ...descriptor, choices: json('[{"identifier": 1}]') }, null)).toThrow(DataError);
    expect(() => checkResponse({ ...descriptor, matchSets: json("1") }, null)).toThrow(DataError);
  });
});

describe("the answered status", () => {
  const body = `<qti-choice-interaction response-identifier="ONE" min-choices="1">${choice("A")}</qti-choice-interaction><qti-choice-interaction response-identifier="TWO" max-choices="1">${choice("B")}</qti-choice-interaction>`;
  const descriptors = describeInteractions(
    itemOf(body, declare("single", "identifier", "ONE") + declare("single", "identifier", "TWO")),
  );
  const status = (responses: Record<string, Value | null>): string =>
    answeredStatus(descriptors, new Map(Object.entries(responses)));

  it("is presented when no interaction has a response", () => {
    expect(status({})).toBe("presented");
    expect(status({ ONE: null, TWO: null })).toBe("presented");
  });

  it("is answered when there is a response and every interaction is valid, an optional one left blank included", () => {
    expect(status({ ONE: id("A") })).toBe("answered");
    expect(status({ ONE: id("A"), TWO: id("B") })).toBe("answered");
  });

  it("is attempted when a response is invalid or a required one is missing", () => {
    expect(status({ TWO: id("B") })).toBe("attempted");
    expect(status({ ONE: id("Z") })).toBe("attempted");
  });

  it("is presented for an item without interactions and ignores the end attempt interaction", () => {
    expect(answeredStatus([], new Map())).toBe("presented");
    const hint = describeInteractions(
      itemOf(
        '<p><qti-end-attempt-interaction response-identifier="HINT" title="Hint"/></p>',
        declare("single", "boolean", "HINT"),
      ),
    );
    expect(answeredStatus(hint, new Map([["HINT", single("boolean", false)]]))).toBe("presented");
  });

  it("rejects arguments of the wrong type", () => {
    expect(() => answeredStatus(json("null"), new Map())).toThrow(DataError);
    expect(() => answeredStatus([], json("{}"))).toThrow(
      "The responses must be a Map from response identifier to value, found an object.",
    );
  });
});

describe("the initial response", () => {
  const defaultValue = identifiers("multiple", ["A"]);

  it("gives a choice interaction nothing selected, whatever the default value", () => {
    const descriptor = descriptorOf(
      `<qti-choice-interaction response-identifier="R" max-choices="2">${choice("A")}</qti-choice-interaction>`,
      declare("multiple", "identifier"),
    );
    expect(initialResponse(descriptor, defaultValue)).toBeNull();
  });

  it("gives a hot text interaction its default value", () => {
    const descriptor = descriptorOf(
      '<qti-hottext-interaction response-identifier="R" max-choices="2"><p><qti-hottext identifier="A">a</qti-hottext></p></qti-hottext-interaction>',
      declare("multiple", "identifier"),
    );
    expect(initialResponse(descriptor, defaultValue)).toEqual(defaultValue);
    expect(initialResponse(descriptor, null)).toBeNull();
  });

  it("gives an order interaction its default value, which overrides the initial order of the choices", () => {
    const descriptor = descriptorOf(
      `<qti-order-interaction response-identifier="R" shuffle="true">${choice("A")}${choice("B")}</qti-order-interaction>`,
      declare("ordered", "identifier"),
    );
    const order = identifiers("ordered", ["B", "A"]);
    expect(initialResponse(descriptor, order)).toEqual(order);
  });

  it("ignores the default value of an end attempt interaction", () => {
    const descriptor = descriptorOf(
      '<p><qti-end-attempt-interaction response-identifier="R" title="Hint"/></p>',
      declare("single", "boolean"),
    );
    expect(initialResponse(descriptor, single("boolean", true))).toBeNull();
  });

  it("rejects a default value that is not a value", () => {
    const descriptor = descriptorOf(
      '<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="1"/>',
    );
    expect(() => initialResponse(descriptor, json("1"))).toThrow(DataError);
  });
});

describe("shuffling choices", () => {
  /** A source that returns the given draws in turn. */
  function drawing(...draws: number[]): Random & { readonly left: () => number } {
    const queue = [...draws];
    return {
      uniform: () => {
        const draw = queue.shift();
        if (draw === undefined) throw new Error("The test draws more numbers than it gave.");
        return draw;
      },
      left: () => queue.length,
    };
  }
  const four = (shuffle: boolean, fixed = ""): InteractionDescriptor =>
    descriptorOf(
      `<qti-choice-interaction response-identifier="R" shuffle="${shuffle}">${["A", "B", "C", "D"].map((name) => choice(name, fixed === name ? ' fixed="true"' : "")).join("")}</qti-choice-interaction>`,
    );

  it("permutes by Fisher–Yates from the last index with floor(uniform × (i + 1)): C A B D for the draws 0.9, 0.5, 0", () => {
    const random = drawing(0.9, 0.5, 0);
    expect(shuffleChoices(four(true), random)).toEqual([["C", "A", "B", "D"]]);
    expect(random.left()).toBe(0);
  });

  it("keeps a fixed choice in its position and permutes the rest", () => {
    expect(shuffleChoices(four(true, "B"), drawing(0.9, 0))).toEqual([["C", "B", "A", "D"]]);
  });

  it("keeps the order of the document and draws nothing without shuffle", () => {
    const random = counting(1);
    expect(shuffleChoices(four(false), random)).toEqual([["A", "B", "C", "D"]]);
    expect(random.draws).toBe(0);
  });

  it("shuffles each set of a match interaction on its own, one after the other", () => {
    const descriptor = descriptorOf(
      `<qti-match-interaction response-identifier="R" shuffle="true"><qti-simple-match-set>${associable("A")}${associable("B")}${associable("C")}</qti-simple-match-set><qti-simple-match-set>${associable("X")}${associable("Y")}</qti-simple-match-set></qti-match-interaction>`,
      declare("multiple", "directedPair"),
    );
    // First set: i = 2 swaps with floor(0.9 × 3) = 2, i = 1 with floor(0 × 2) = 0: B A C. Second set: i = 1 with floor(0.1 × 2) = 0: Y X.
    expect(shuffleChoices(descriptor, drawing(0.9, 0, 0.1))).toEqual([
      ["B", "A", "C"],
      ["Y", "X"],
    ]);
  });

  it("shuffles the choices of a gap match interaction and not its gaps", () => {
    const descriptor = descriptorOf(
      '<qti-gap-match-interaction response-identifier="R" shuffle="true"><qti-gap-text identifier="W1" match-max="1">a</qti-gap-text><qti-gap-text identifier="W2" match-max="1">b</qti-gap-text><p><qti-gap identifier="G1"/><qti-gap identifier="G2"/></p></qti-gap-match-interaction>',
      declare("multiple", "directedPair"),
    );
    expect(shuffleChoices(descriptor, drawing(0))).toEqual([
      ["W2", "W1"],
      ["G1", "G2"],
    ]);
  });

  it("lists the choices of an interaction that has no shuffle attribute in the order of the document", () => {
    const hotspots = descriptorOf(
      `<qti-hotspot-interaction response-identifier="R">${IMAGE}${hotspot("S1")}${hotspot("S2")}</qti-hotspot-interaction>`,
    );
    expect(shuffleChoices(hotspots, counting(1))).toEqual([["S1", "S2"]]);
    expect(
      shuffleChoices(
        descriptorOf('<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="1"/>'),
        counting(1),
      ),
    ).toEqual([]);
  });

  it("shuffles the choices that a template variable hides with the others, so that the positions of fixed choices hold", () => {
    const descriptor = descriptorOf(
      `<qti-choice-interaction response-identifier="R" shuffle="true">${choice("A", ' template-identifier="T" show-hide="show"')}${choice("B", ' fixed="true"')}${choice("C")}${choice("D", ' template-identifier="T"')}</qti-choice-interaction>`,
    );
    const [order = []] = shuffleChoices(descriptor, drawing(0.99, 0.0));
    // B is fixed in the second place of all four choices, hidden or not.
    expect(order).toEqual(["C", "B", "A", "D"]);
    const hidden = new Set(["A"]);
    const presented = presentChoices(descriptor, [order.filter((identifier) => !hidden.has(identifier))]);
    expect(presented.choices.map(({ identifier }) => identifier)).toEqual(["C", "B", "D"]);
  });

  it("rejects a descriptor or a random source of the wrong type", () => {
    expect(() => shuffleChoices(json("null"), createRandom(1))).toThrow(DataError);
    expect(() => shuffleChoices(four(true), json("null"))).toThrow(
      "The random source must be an object with a function uniform, found null.",
    );
    expect(() => shuffleChoices(four(true), json('{"uniform": 1}'))).toThrow(DataError);
    expect(() => shuffleChoices(four(true), { uniform: () => 1 })).toThrow(DataError);
  });
});

describe("presenting choices", () => {
  const descriptor = descriptorOf(
    `<qti-choice-interaction response-identifier="R">${choice("A")}${choice("B")}${choice("C")}</qti-choice-interaction>`,
  );

  it("puts the choices in the given order and drops those it does not name, such as the hidden ones", () => {
    const presented = presentChoices(descriptor, [["C", "A"]]);
    expect(presented.choices.map(({ identifier }) => identifier)).toEqual(["C", "A"]);
    expect(descriptor.choices.map(({ identifier }) => identifier)).toEqual(["A", "B", "C"]);
    expect(presented.constraints).toEqual(descriptor.constraints);
  });

  it("orders both sets of a match interaction", () => {
    const match = descriptorOf(
      `<qti-match-interaction response-identifier="R"><qti-simple-match-set>${associable("A")}${associable("B")}</qti-simple-match-set><qti-simple-match-set>${associable("X")}</qti-simple-match-set></qti-match-interaction>`,
      declare("multiple", "directedPair"),
    );
    const presented = presentChoices(match, [["B", "A"], ["X"]]);
    expect(presented.matchSets?.map((set) => set.map(({ identifier }) => identifier))).toEqual([["B", "A"], ["X"]]);
    expect(presented.choices.map(({ identifier }) => identifier)).toEqual(["B", "A", "X"]);
  });

  it("rejects orders that do not fit the descriptor", () => {
    expect(() => presentChoices(descriptor, [["A"], ["B"]])).toThrow(
      "The orders must have one list for each of the 1 sets of choices, found 2.",
    );
    expect(() => presentChoices(descriptor, [["Z"]])).toThrow(
      'The order of the set 1 of choices names "Z", which is not a choice of the set.',
    );
    expect(() => presentChoices(descriptor, [["A", "A"]])).toThrow(
      'The order of the set 1 of choices names "A", which occurs twice.',
    );
    expect(() => presentChoices(descriptor, json('"A"'))).toThrow(DataError);
    expect(() => presentChoices(descriptor, json("[[1]]"))).toThrow(DataError);
    expect(() => presentChoices(descriptor, json('["A"]'))).toThrow(DataError);
    expect(() => presentChoices(json("null"), [])).toThrow(DataError);
  });
});

describe("the numeric record of a text entry", () => {
  it("reads an integer: all fields but the exponent", () => {
    expect(fields(numericRecord("123"))).toEqual({
      stringValue: "123",
      floatValue: 123,
      integerValue: 123,
      leftDigits: 3,
      rightDigits: 0,
      ndp: 0,
      nsf: 3,
    });
  });

  it("reads a decimal with fractional digits: no integerValue, ndp is rightDigits", () => {
    expect(fields(numericRecord("12.50"))).toEqual({
      stringValue: "12.50",
      floatValue: 12.5,
      leftDigits: 2,
      rightDigits: 2,
      ndp: 2,
      nsf: 4,
    });
    expect(fields(numericRecord("-.5"))).toMatchObject({ floatValue: -0.5, leftDigits: 0, rightDigits: 1, nsf: 1 });
  });

  it("reads an exponent: ndp is the fractional digits less the exponent, never below 0", () => {
    expect(fields(numericRecord("1.5e3"))).toEqual({
      stringValue: "1.5e3",
      floatValue: 1500,
      leftDigits: 1,
      rightDigits: 1,
      ndp: 0,
      nsf: 2,
      exponent: 3,
    });
    expect(fields(numericRecord("1.5E-2"))).toMatchObject({ floatValue: 0.015, ndp: 3, exponent: -2 });
  });

  it("counts the significant digits from the first digit that is not 0, at least one", () => {
    expect(fields(numericRecord("0.0120"))).toMatchObject({ leftDigits: 1, rightDigits: 4, ndp: 4, nsf: 3 });
    expect(fields(numericRecord("1200"))).toMatchObject({ nsf: 4 });
    expect(fields(numericRecord("0"))).toMatchObject({ nsf: 1, integerValue: 0 });
    expect(fields(numericRecord("000.00"))).toMatchObject({ nsf: 1 });
  });

  it("keeps the text as typed and ignores white space around the number", () => {
    expect(fields(numericRecord(" 42 "))).toMatchObject({ stringValue: " 42 ", floatValue: 42, integerValue: 42 });
    expect(fields(numericRecord("5."))).toMatchObject({ floatValue: 5, integerValue: 5, rightDigits: 0 });
  });

  it("has the string alone when the text is no number", () => {
    for (const text of ["abc", "1,5", "1e", "e5", ".", "+", "1 2", "0x10", "Infinity", "1e999"]) {
      expect(fields(numericRecord(text))).toEqual({ stringValue: text });
    }
  });

  it("has no integerValue for a number beyond the safe integers, but a float", () => {
    expect(fields(numericRecord("9007199254740993"))).toMatchObject({ floatValue: 9007199254740992 });
    expect(fields(numericRecord("9007199254740993"))).not.toHaveProperty("integerValue");
  });

  it("reads an integer in the base of the interaction", () => {
    expect(fields(numericRecord("ff", 16))).toMatchObject({
      floatValue: 255,
      integerValue: 255,
      leftDigits: 2,
      nsf: 2,
    });
    expect(fields(numericRecord("-101", 2))).toMatchObject({ floatValue: -5, integerValue: -5 });
    expect(fields(numericRecord("Z", 36))).toMatchObject({ floatValue: 35 });
    expect(fields(numericRecord("12", 2))).toEqual({ stringValue: "12" });
    expect(fields(numericRecord("1.5", 16))).toEqual({ stringValue: "1.5" });
  });

  it("is NULL for the empty string", () => {
    expect(numericRecord("")).toBeNull();
  });

  it("makes the record of a text-entry response, which checkResponse accepts as one entry", () => {
    const descriptor = descriptorOf(
      '<p><qti-text-entry-interaction response-identifier="R"/></p>',
      declare("record", "string").replace(' base-type="string"', ""),
    );
    expect(checkResponse(descriptor, numericRecord("3.14")).status).toBe("answered");
  });

  it("rejects a text that is not a string and a base outside 2 to 36", () => {
    expect(() => numericRecord(json("1"))).toThrow("The text must be a string, found 1.");
    expect(() => numericRecord("1", 1)).toThrow("The base must be an integer from 2 to 36, found 1.");
    expect(() => numericRecord("1", 37)).toThrow(DataError);
    expect(() => numericRecord("1", json('"10"'))).toThrow(DataError);
    expect(() => numericRecord("1", 10.5)).toThrow(DataError);
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/interactions.md", import.meta.url);
    const modules = {
      "@assesskit/runtime": await import("../src/index.js"),
      "@assesskit/runtime/asi": await import("../src/asi/index.js"),
      "@assesskit/runtime/interactions": await import("../src/interactions/index.js"),
      "@assesskit/runtime/values": await import("../src/values/index.js"),
    };
    expect(await runGuideSamples(guide, modules)).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("a choice interaction breaks min-choices exactly below the minimum and max-choices exactly above the maximum", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 6 }),
        fc.nat(6),
        (size, min, max, picked) => {
          fc.pre(max === 0 || min <= max);
          const names = ["A", "B", "C", "D", "E", "F"].slice(0, size);
          const descriptor = descriptorOf(
            `<qti-choice-interaction response-identifier="R" min-choices="${min}" max-choices="${max}">${names.map((name) => choice(name)).join("")}</qti-choice-interaction>`,
            declare("multiple", "identifier"),
          );
          const count = Math.min(picked, size);
          const response = count === 0 ? null : identifiers("multiple", names.slice(0, count));
          const { status, reasons } = checkResponse(descriptor, response);
          expect(reasons.includes("min-choices")).toBe(count < min);
          expect(reasons.includes("max-choices")).toBe(max > 0 && count > max);
          expect(status).toBe(count === 0 ? "presented" : reasons.length === 0 ? "answered" : "attempted");
        },
      ),
    );
  });

  it("an order interaction takes every ordering of all its choices, and refuses a part of them when min-choices is absent", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 2, max: 6 })
          .chain((size) =>
            fc
              .shuffledSubarray(["A", "B", "C", "D", "E", "F"].slice(0, size), { minLength: 1 })
              .map((order) => ({ size, order })),
          ),
        ({ size, order }) => {
          const names = ["A", "B", "C", "D", "E", "F"].slice(0, size);
          const descriptor = descriptorOf(
            `<qti-order-interaction response-identifier="R">${names.map((name) => choice(name)).join("")}</qti-order-interaction>`,
            declare("ordered", "identifier"),
          );
          const { status } = checkResponse(descriptor, identifiers("ordered", order));
          expect(status).toBe(order.length === size ? "answered" : "attempted");
        },
      ),
    );
  });

  it("a pattern-mask accepts the strings of a regular expression and no others", () => {
    const entry = descriptorOf(
      '<p><qti-text-entry-interaction response-identifier="R" pattern-mask="[a-z]+[0-9]?"/></p>',
      declare("single", "string"),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]{1,6}$/), (typed) => {
        const { reasons } = checkResponse(entry, single("string", typed));
        expect(reasons.length === 0).toBe(/^[a-z]+[0-9]?$/.test(typed));
      }),
    );
  });

  it("gives each set as a permutation of its choices, with the fixed choices where they were, and equal draws give equal orders", () => {
    fc.assert(
      fc.property(shufflingDescriptor, fc.integer(), (descriptor, seed) => {
        const orders = shuffleChoices(descriptor, createRandom(seed));
        const sets = descriptor.matchSets ?? (descriptor.choices.length === 0 ? [] : [descriptor.choices]);
        expect(orders).toHaveLength(sets.length);
        sets.forEach((set, place) => {
          const order = orders[place] ?? [];
          expect([...order].sort()).toEqual(set.map(({ identifier }) => identifier).sort());
          set.forEach((member, index) => {
            if (member.fixed || !descriptor.shuffle) expect(order[index]).toBe(member.identifier);
          });
        });
        expect(shuffleChoices(descriptor, createRandom(seed))).toEqual(orders);
      }),
    );
  });

  it("draws one number for each movable choice but the first, in the sets that it shuffles", () => {
    fc.assert(
      fc.property(shufflingDescriptor, fc.integer(), (descriptor, seed) => {
        const random = counting(seed);
        shuffleChoices(descriptor, random);
        const sets = descriptor.matchSets ?? [descriptor.choices];
        const shuffled = !descriptor.shuffle ? 0 : descriptor.kind === "match-interaction" ? sets.length : 1;
        const expected = sets
          .slice(0, shuffled)
          .reduce((sum, set) => sum + Math.max(0, set.filter(({ fixed }) => !fixed).length - 1), 0);
        expect(random.draws).toBe(expected);
      }),
    );
  });

  it("removing the hidden choices from the order leaves the others in the order of the full shuffle", () => {
    fc.assert(
      fc.property(shufflingDescriptor, fc.integer(), fc.infiniteStream(fc.boolean()), (descriptor, seed, hiding) => {
        const orders = shuffleChoices(descriptor, createRandom(seed));
        const hiddenIdentifiers = new Set(
          descriptor.choices.filter(() => hiding.next().value === true).map(({ identifier }) => identifier),
        );
        const visible = orders.map((order) => order.filter((identifier) => !hiddenIdentifiers.has(identifier)));
        const presented = presentChoices(descriptor, visible);
        const sets = presented.matchSets ?? (presented.choices.length === 0 ? [] : [presented.choices]);
        expect(sets.map((set) => set.map(({ identifier }) => identifier))).toEqual(
          visible.filter((order) => descriptor.matchSets !== undefined || order.length > 0),
        );
      }),
    );
  });

  it("reads every integer in its base and gives the digits of a decimal as typed", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 2, max: 36 }), (integer, base) => {
        const text = integer.toString(base);
        expect(fields(numericRecord(text, base))).toMatchObject({ integerValue: integer, floatValue: integer });
      }),
    );
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9]{0,5}$/), fc.stringMatching(/^[0-9]{0,5}$/), (left, right) => {
        fc.pre(left + right !== "");
        const typed = fields(numericRecord(`${left}.${right}`));
        expect(typed).toMatchObject({ leftDigits: left.length, rightDigits: right.length, ndp: right.length });
        expect(typed.floatValue).toBe(Number(`${left || "0"}.${right || "0"}`));
      }),
    );
  });
});
