import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACCESS_MODES,
  type AccessForAllResource,
  ADAPTATION_DETAILS,
  ADAPTATION_MEDIA_TYPES,
  ADAPTATION_TYPES,
  API_INTEROPERABLE,
  COMPLEXITY_OF_ADAPTATION,
  CONTROL_FLEXIBILITY,
  CP_NAMESPACE,
  CSM_NAMESPACE,
  checkQtiMetadata,
  DataError,
  DISPLAY_TRANSFORMABILITY,
  DRD_HAZARDS,
  DRD_NAMESPACE,
  deriveQtiMetadata,
  FEEDBACK_TYPES,
  INTERACTION_TYPES,
  LOM_NAMESPACE,
  parseXml,
  QTI_METADATA_NAMESPACE,
  type QtiMetadata,
  ReadError,
  readAccessForAllResource,
  readAsi,
  readCurriculumStandardsSet,
  readLomGeneral,
  readQtiMetadata,
  readResourceMetadata,
  SCORING_MODES,
  serializeXml,
  writeAccessForAllResource,
  writeCurriculumStandardsSet,
  writeQtiMetadata,
  writeResourceMetadata,
  type XmlElement,
  type XmlNode,
} from "../src/index.js";
import { accessForAllResource, curriculumStandardsSet, lom, qtiMetadata } from "./arbitraries/metadata.js";
import { runGuideSamples } from "./guide-samples.js";

const QMD = `xmlns="${QTI_METADATA_NAMESPACE}"`;
const CSM = `xmlns="${CSM_NAMESPACE}"`;
const DRD = `xmlns="${DRD_NAMESPACE}"`;

/** Returns the error a function throws, after checking that it is of a class. */
function thrownAs<T extends Error>(type: new (...args: never[]) => T, run: () => unknown): T {
  try {
    run();
  } catch (error) {
    if (error instanceof type) return error;
    throw new Error(`Expected a ${type.name}, found ${String(error)}.`);
  }
  throw new Error("The function did not throw.");
}

function issueRule(run: () => unknown): string | undefined {
  return thrownAs(ReadError, run).issues[0]?.rule;
}

/** Drops the positions that `parseXml` adds and the namespace declarations, so that kept XML can be compared. */
function bare(node: XmlNode): XmlNode {
  if (node.kind !== "element") return node;
  const { line: _line, column: _column, ...rest } = node;
  return {
    ...rest,
    attributes: node.attributes.filter(({ name, prefix }) => !(name === "xmlns" || prefix === "xmlns")),
    children: node.children.map(bare),
  };
}

const qti = (xml: string, path?: string): QtiMetadata =>
  readQtiMetadata(parseXml(`<qtiMetadata ${QMD}>${xml}</qtiMetadata>`), { path });

const drd = (xml: string, path?: string): AccessForAllResource =>
  readAccessForAllResource(parseXml(`<accessForAllResource ${DRD}>${xml}</accessForAllResource>`), { path });

describe("reading the accessibility description", () => {
  it("reads the elements in the order of the schema", () => {
    const resource = drd(`
      <accessMode>auditory</accessMode>
      <atInteroperable>true</atInteroperable>
      <educationalComplexityOfAdaptation>simplified</educationalComplexityOfAdaptation>
      <hasAdaptation>items/b.xml</hasAdaptation>
      <hazard>flashing</hazard>
      <hazard>sound</hazard>
      <languageOfAdaptation>id</languageOfAdaptation>`);
    expect(resource).toMatchObject({
      hazard: ["flashing", "sound"],
      accessMode: ["auditory"],
      atInteroperable: true,
      languageOfAdaptation: ["id"],
      hasAdaptation: ["items/b.xml"],
      educationalComplexityOfAdaptation: "simplified",
      adaptationType: [],
      extensions: [],
    });
  });

  it("accepts every term of the DRD vocabularies and an extension term, and rejects any other", () => {
    const vocabularies: readonly (readonly [string, readonly string[]])[] = [
      ["accessMode", ACCESS_MODES],
      ["accessModeAdapted", ACCESS_MODES],
      ["adaptationDetail", ADAPTATION_DETAILS],
      ["adaptationMediaType", ADAPTATION_MEDIA_TYPES],
      ["adaptationType", ADAPTATION_TYPES],
      ["apiInteroperable", API_INTEROPERABLE],
      ["controlFlexibility", CONTROL_FLEXIBILITY],
      ["displayTransformability", DISPLAY_TRANSFORMABILITY],
      ["educationalComplexityOfAdaptation", COMPLEXITY_OF_ADAPTATION],
      ["hazard", DRD_HAZARDS],
    ];
    for (const [name, terms] of vocabularies) {
      for (const term of [...terms, "ext:vendor.term_1"]) {
        expect(drd(`<${name}>${term}</${name}>`), `${name} ${term}`).toBeDefined();
      }
      for (const term of ["unknown", "ext:", "ext:a-b", "EXT:a", terms[0]?.toUpperCase() ?? ""]) {
        expect(
          issueRule(() => drd(`<${name}>${term}</${name}>`)),
          `${name} ${term}`,
        ).toBe("assesskit/metadata/invalid-text");
      }
    }
    expect(ACCESS_MODES).toHaveLength(10);
    expect(DRD_HAZARDS).toEqual(["flashing", "sound", "olfactoryHazard", "motionSimulation"]);
  });

  it("rejects an element out of the order of the schema", () => {
    expect(issueRule(() => drd("<hazard>sound</hazard><accessMode>auditory</accessMode>"))).toBe(
      "assesskit/metadata/unexpected-element",
    );
  });

  it("keeps elements of other namespaces after the DRD elements as extensions", () => {
    const resource = drd('<hazard>sound</hazard><note xmlns="urn:x">hello</note>');
    expect(resource.extensions.map((extension) => extension.name)).toEqual(["note"]);
  });

  it("rejects an element of the DRD namespace that the schema does not declare, a second atInteroperable and a bad boolean", () => {
    expect(issueRule(() => drd("<other/>"))).toBe("assesskit/metadata/unexpected-element");
    expect(issueRule(() => drd("<atInteroperable>true</atInteroperable><atInteroperable>true</atInteroperable>"))).toBe(
      "assesskit/metadata/unexpected-element",
    );
    expect(issueRule(() => drd("<atInteroperable>yes</atInteroperable>"))).toBe("assesskit/metadata/invalid-text");
  });
});

describe("writing the accessibility description", () => {
  it("writes the elements in the order of the DRD schema", () => {
    const element = writeAccessForAllResource({
      ...drd(""),
      hazard: ["sound"],
      isFullAdaptationOf: ["x"],
      adaptationType: ["captions"],
      accessMode: ["visual"],
    });
    expect(element.children.map((child) => (child.kind === "element" ? child.name : ""))).toEqual([
      "accessMode",
      "adaptationType",
      "hazard",
      "isFullAdaptationOf",
    ]);
  });

  it("reads back what it writes, through XML text", () => {
    fc.assert(
      fc.property(accessForAllResource, (resource) => {
        const read = readAccessForAllResource(parseXml(serializeXml(writeAccessForAllResource(resource))));
        expect({ ...read, extensions: read.extensions.map(bare) }).toEqual({
          ...resource,
          extensions: resource.extensions.map(bare),
        });
      }),
      { numRuns: 200 },
    );
  });

  it("throws a DataError for a term outside its vocabulary, an extension in the DRD namespace and the wrong types", () => {
    const valid = JSON.parse(JSON.stringify(drd("")));
    for (const resource of [
      { ...valid, hazard: ["flash"] },
      { ...valid, hazard: "flashing" },
      { ...valid, accessMode: [3] },
      { ...valid, atInteroperable: "true" },
      { ...valid, hasAdaptation: [3] },
      { ...valid, educationalComplexityOfAdaptation: "other" },
      {
        ...valid,
        extensions: [{ kind: "element", namespace: DRD_NAMESPACE, name: "hazard", attributes: [], children: [] }],
      },
      { ...valid, extensions: "x" },
      null,
      "x",
    ]) {
      expect(() => writeAccessForAllResource(resource), JSON.stringify(resource)).toThrow(DataError);
    }
  });
});

const csm = (xml: string): ReturnType<typeof readCurriculumStandardsSet> =>
  readCurriculumStandardsSet(
    parseXml(`<curriculumStandardsMetadataSet ${CSM}>${xml}</curriculumStandardsMetadataSet>`),
  );

describe("reading curriculum standards", () => {
  it("reads the labels, CASE item URIs and GUIDs of the externalMetadata example", () => {
    const set = readCurriculumStandardsSet(
      parseXml(`<curriculumStandardsMetadataSet ${CSM} resourceLabel="Math" resourcePartId="p1">
        <curriculumStandardsMetadata providerId="TEKS">
          <setOfGUIDs region="TX" version="2017">
            <labelledGUID>
              <label>identify a number, its opposite, and its absolute value;</label>
              <caseItemURI>https://teks-api.texasgateway.org/ims/case/v1p0/CFItems/747eee11-848c-597a-8c9c-a71c5399798d</caseItemURI>
              <GUID>747eee11-848c-597a-8c9c-a71c5399798d</GUID>
            </labelledGUID>
          </setOfGUIDs>
        </curriculumStandardsMetadata>
      </curriculumStandardsMetadataSet>`),
      undefined,
    );
    expect(set).toEqual({
      resourceLabel: "Math",
      resourcePartId: "p1",
      standards: [
        {
          providerId: "TEKS",
          guidSets: [
            {
              region: "TX",
              version: "2017",
              labelledGuids: [
                {
                  label: "identify a number, its opposite, and its absolute value;",
                  caseItemUri:
                    "https://teks-api.texasgateway.org/ims/case/v1p0/CFItems/747eee11-848c-597a-8c9c-a71c5399798d",
                  guid: "747eee11-848c-597a-8c9c-a71c5399798d",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("leaves out the optional parts that the document leaves out", () => {
    const set = csm(
      "<curriculumStandardsMetadata><setOfGUIDs><labelledGUID><GUID>g</GUID></labelledGUID></setOfGUIDs></curriculumStandardsMetadata>",
    );
    expect(set.standards[0]?.guidSets[0]?.labelledGuids[0]).toEqual({ guid: "g" });
    expect(set.resourceLabel).toBeUndefined();
  });

  it("rejects a labelled GUID without a GUID, an unknown element and an unknown attribute", () => {
    expect(
      issueRule(() =>
        csm(
          "<curriculumStandardsMetadata><setOfGUIDs><labelledGUID><label>l</label></labelledGUID></setOfGUIDs></curriculumStandardsMetadata>",
        ),
      ),
    ).toBe("assesskit/metadata/missing-element");
    expect(issueRule(() => csm("<other/>"))).toBe("assesskit/metadata/unexpected-element");
    expect(issueRule(() => csm('<curriculumStandardsMetadata other="1"/>'))).toBe(
      "assesskit/metadata/unexpected-attribute",
    );
  });
});

describe("writing curriculum standards", () => {
  it("reads back what it writes, through XML text", () => {
    fc.assert(
      fc.property(curriculumStandardsSet, (set) => {
        expect(readCurriculumStandardsSet(parseXml(serializeXml(writeCurriculumStandardsSet(set))))).toEqual(set);
      }),
      { numRuns: 200 },
    );
  });

  it("throws a DataError for an empty list that the schema requires to have an item, and for the wrong types", () => {
    const guid = { guid: "g" };
    const valid = { standards: [{ guidSets: [{ labelledGuids: [guid] }] }] };
    for (const set of [
      JSON.stringify({ standards: [] }),
      JSON.stringify({ standards: [{ guidSets: [] }] }),
      JSON.stringify({ standards: [{ guidSets: [{ labelledGuids: [] }] }] }),
      JSON.stringify({ standards: [{ guidSets: [{ labelledGuids: [{}] }] }] }),
      JSON.stringify({ ...valid, resourceLabel: 3 }),
      JSON.stringify({ standards: "x" }),
      "null",
    ]) {
      expect(() => writeCurriculumStandardsSet(JSON.parse(set)), set).toThrow(DataError);
    }
  });
});

const ASI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

interface ItemParts {
  readonly attributes?: string;
  readonly declarations?: string;
  readonly template?: string;
  readonly body?: string;
  readonly processing?: string;
  readonly modalFeedback?: string;
}

/** Reads an item of the given parts, in the order of the schema, and derives its metadata. */
function derive(parts: ItemParts = {}): QtiMetadata {
  const { attributes = "", declarations = "", template = "", body = "", processing = "", modalFeedback = "" } = parts;
  const document = readAsi(
    `<qti-assessment-item xmlns="${ASI}" identifier="i" title="t" time-dependent="false" ${attributes}>${declarations}${template}<qti-item-body>${body}</qti-item-body>${processing}${modalFeedback}</qti-assessment-item>`,
  );
  if (document.kind !== "item") throw new Error("Not an item.");
  return deriveQtiMetadata(document.item);
}

const response = (identifier: string, correct = false): string =>
  `<qti-response-declaration identifier="${identifier}" cardinality="single" base-type="identifier">${correct ? "<qti-correct-response><qti-value>A</qti-value></qti-correct-response>" : ""}</qti-response-declaration>`;
const choice =
  '<qti-choice-interaction response-identifier="RESPONSE" max-choices="1"><qti-simple-choice identifier="A">a</qti-simple-choice></qti-choice-interaction>';
const textEntry = (identifier: string): string =>
  `<p><qti-text-entry-interaction response-identifier="${identifier}"/></p>`;

const IMAGE = '<img src="a.png" alt=""/>';
const HOTSPOT = 'identifier="A" shape="rect" coords="0,0,1,1"';
const GAP_TEXT = '<qti-gap-text identifier="A" match-max="1">a</qti-gap-text>';
const CHOICE = '<qti-simple-choice identifier="A">a</qti-simple-choice>';
const ASSOCIABLE = '<qti-simple-associable-choice identifier="A" match-max="1">a</qti-simple-associable-choice>';

/** An interaction of each type, with the content that the ASI schema requires of it, where an item body takes it. */
const INTERACTION_OF_TYPE: readonly (readonly [string, string])[] = [
  [
    "associateInteraction",
    `<qti-associate-interaction response-identifier="R">${ASSOCIABLE}</qti-associate-interaction>`,
  ],
  ["choiceInteraction", `<qti-choice-interaction response-identifier="R">${CHOICE}</qti-choice-interaction>`],
  ["customInteraction", '<qti-custom-interaction response-identifier="R"/>'],
  ["drawingInteraction", `<qti-drawing-interaction response-identifier="R">${IMAGE}</qti-drawing-interaction>`],
  ["endAttemptInteraction", '<p><qti-end-attempt-interaction response-identifier="R" title="t"/></p>'],
  ["extendedTextInteraction", '<qti-extended-text-interaction response-identifier="R"/>'],
  [
    "gapMatchInteraction",
    `<qti-gap-match-interaction response-identifier="R">${GAP_TEXT}<p>x</p></qti-gap-match-interaction>`,
  ],
  [
    "graphicAssociateInteraction",
    `<qti-graphic-associate-interaction response-identifier="R">${IMAGE}<qti-associable-hotspot ${HOTSPOT} match-max="1"/></qti-graphic-associate-interaction>`,
  ],
  [
    "graphicGapMatchInteraction",
    `<qti-graphic-gap-match-interaction response-identifier="R">${IMAGE}${GAP_TEXT}<qti-associable-hotspot ${HOTSPOT} match-max="1"/></qti-graphic-gap-match-interaction>`,
  ],
  [
    "graphicOrderInteraction",
    `<qti-graphic-order-interaction response-identifier="R">${IMAGE}<qti-hotspot-choice ${HOTSPOT}/></qti-graphic-order-interaction>`,
  ],
  [
    "hotspotInteraction",
    `<qti-hotspot-interaction response-identifier="R">${IMAGE}<qti-hotspot-choice ${HOTSPOT}/></qti-hotspot-interaction>`,
  ],
  [
    "hottextInteraction",
    '<qti-hottext-interaction response-identifier="R"><p><qti-hottext identifier="A">a</qti-hottext></p></qti-hottext-interaction>',
  ],
  [
    "inlineChoiceInteraction",
    '<p><qti-inline-choice-interaction response-identifier="R"><qti-inline-choice identifier="A">a</qti-inline-choice></qti-inline-choice-interaction></p>',
  ],
  [
    "matchInteraction",
    `<qti-match-interaction response-identifier="R"><qti-simple-match-set>${ASSOCIABLE}</qti-simple-match-set><qti-simple-match-set>${ASSOCIABLE}</qti-simple-match-set></qti-match-interaction>`,
  ],
  [
    "mediaInteraction",
    '<qti-media-interaction response-identifier="R" autostart="true"><video src="a.mp4"/></qti-media-interaction>',
  ],
  ["orderInteraction", `<qti-order-interaction response-identifier="R">${CHOICE}</qti-order-interaction>`],
  [
    "portableCustomInteraction",
    '<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="urn:x"><qti-interaction-markup/></qti-portable-custom-interaction>',
  ],
  [
    "positionObjectInteraction",
    `<qti-position-object-stage>${IMAGE}<qti-position-object-interaction response-identifier="R">${IMAGE}</qti-position-object-interaction></qti-position-object-stage>`,
  ],
  [
    "selectPointInteraction",
    `<qti-select-point-interaction response-identifier="R">${IMAGE}</qti-select-point-interaction>`,
  ],
  ["sliderInteraction", '<qti-slider-interaction response-identifier="R" lower-bound="0" upper-bound="1"/>'],
  ["textEntryInteraction", textEntry("R")],
  ["uploadInteraction", '<qti-upload-interaction response-identifier="R"/>'],
];

describe("deriving QTI metadata", () => {
  it("derives the metadata of a choice item with a correct response, feedback and response processing", () => {
    expect(
      derive({
        declarations: response("RESPONSE", true),
        body: `<p>Which?</p>${choice}<qti-feedback-block outcome-identifier="FEEDBACK" identifier="x" show-hide="show"/>`,
        processing: "<qti-response-processing/>",
      }),
    ).toEqual({
      itemTemplate: false,
      timeDependent: false,
      composite: false,
      interactionTypes: ["choiceInteraction"],
      portableCustomInteractionContext: undefined,
      feedbackType: "nonadaptive",
      solutionAvailable: true,
      scoringModes: ["responseprocessing"],
      toolName: undefined,
      toolVersion: undefined,
    });
  });

  it("takes timeDependent from the attribute of the item", () => {
    const read = (value: string): boolean | undefined => {
      const document = readAsi(
        `<qti-assessment-item xmlns="${ASI}" identifier="i" title="t" time-dependent="${value}"/>`,
      );
      return document.kind === "item" ? deriveQtiMetadata(document.item).timeDependent : undefined;
    };
    expect(read("true")).toBe(true);
    expect(read("false")).toBe(false);
  });

  it("derives each of the 22 interaction types from its element", () => {
    expect(INTERACTION_OF_TYPE.map(([type]) => type).sort()).toEqual([...INTERACTION_TYPES].sort());
    for (const [type, markup] of INTERACTION_OF_TYPE) {
      expect(derive({ body: markup }).interactionTypes, type).toEqual([type]);
    }
  });

  it("finds interactions nested in the markup of the body, and lists each type once in document order", () => {
    const metadata = derive({
      body: `<div>${textEntry("A")}<table><tr><td>${choice}</td></tr></table>${textEntry("B")}</div>`,
    });
    expect(metadata.interactionTypes).toEqual(["textEntryInteraction", "choiceInteraction"]);
    expect(metadata.composite).toBe(true);
  });

  it("is not composite with one interaction or none, and ignores elements of other namespaces that look like interactions", () => {
    expect(derive({ body: choice }).composite).toBe(false);
    expect(derive({ body: "<p>No interaction.</p>" })).toMatchObject({ composite: false, interactionTypes: [] });
    expect(
      derive({
        body: '<qti-custom-interaction response-identifier="R"><x:qti-choice-interaction xmlns:x="urn:x"/></qti-custom-interaction>',
      }),
    ).toMatchObject({ composite: false, interactionTypes: ["customInteraction"] });
  });

  it("is none without feedback, and nonadaptive or adaptive with feedback, by the attribute adaptive", () => {
    const feedback =
      '<qti-feedback-inline outcome-identifier="FEEDBACK" identifier="x" show-hide="show">Right</qti-feedback-inline>';
    const modal =
      '<qti-modal-feedback outcome-identifier="FEEDBACK" identifier="x" show-hide="show"><qti-content-body/></qti-modal-feedback>';
    expect(derive({ body: choice }).feedbackType).toBe("none");
    expect(derive({ attributes: 'adaptive="true"', body: choice }).feedbackType).toBe("none");
    expect(derive({ body: `<p>${feedback}</p>` }).feedbackType).toBe("nonadaptive");
    expect(derive({ modalFeedback: modal }).feedbackType).toBe("nonadaptive");
    expect(derive({ attributes: 'adaptive="true"', body: `<p>${feedback}</p>` }).feedbackType).toBe("adaptive");
    expect(derive({ attributes: 'adaptive="true"', modalFeedback: modal }).feedbackType).toBe("adaptive");
    expect(derive({ attributes: 'adaptive="false"', modalFeedback: modal }).feedbackType).toBe("nonadaptive");
  });

  it("has a solution when every declared response has a correct response, and none without a declared response or with a missing one", () => {
    expect(derive({ declarations: response("A", true) + response("B", true) }).solutionAvailable).toBe(true);
    expect(derive({ declarations: response("A", true) + response("B") }).solutionAvailable).toBe(false);
    expect(derive({ declarations: response("A") }).solutionAvailable).toBe(false);
    expect(derive().solutionAvailable).toBe(false);
  });

  it("has a solution that template processing sets, and is an item template when it has template processing", () => {
    const declarations = `${response("A")}<qti-template-declaration identifier="N" cardinality="single" base-type="identifier"/>`;
    const template = (rule: string): string => `<qti-template-processing>${rule}</qti-template-processing>`;
    const setCorrect =
      '<qti-set-correct-response identifier="A"><qti-base-value base-type="identifier">X</qti-base-value></qti-set-correct-response>';
    const setOther =
      '<qti-set-template-value identifier="N"><qti-base-value base-type="identifier">X</qti-base-value></qti-set-template-value>';
    const nested = `<qti-template-condition><qti-template-if><qti-is-null><qti-variable identifier="N"/></qti-is-null>${setCorrect}</qti-template-if></qti-template-condition>`;
    expect(derive({ declarations, template: template(setCorrect) })).toMatchObject({
      itemTemplate: true,
      solutionAvailable: true,
    });
    expect(derive({ declarations, template: template(nested) })).toMatchObject({
      itemTemplate: true,
      solutionAvailable: true,
    });
    expect(derive({ declarations, template: template(setOther) })).toMatchObject({
      itemTemplate: true,
      solutionAvailable: false,
    });
    expect(derive({ declarations })).toMatchObject({ itemTemplate: false, solutionAvailable: false });
  });

  it("has the scoring modes of the response processing and of the outcomes scored outside, in the order of the vocabulary", () => {
    const outcome = (scored: string): string =>
      `<qti-outcome-declaration identifier="O${scored}" cardinality="single" base-type="float" external-scored="${scored}"/>`;
    expect(derive().scoringModes).toEqual([]);
    expect(derive({ processing: "<qti-response-processing/>" }).scoringModes).toEqual(["responseprocessing"]);
    expect(derive({ declarations: outcome("human") }).scoringModes).toEqual(["human"]);
    expect(derive({ declarations: outcome("externalMachine") }).scoringModes).toEqual(["externalmachine"]);
    expect(
      derive({ declarations: outcome("externalMachine") + outcome("human"), processing: "<qti-response-processing/>" })
        .scoringModes,
    ).toEqual(["human", "externalmachine", "responseprocessing"]);
  });

  it("gives the type identifier of the first portable custom interaction, and no interaction kind", () => {
    const pci = (identifier: string): string =>
      `<qti-portable-custom-interaction response-identifier="R" custom-interaction-type-identifier="${identifier}" module="m"><qti-interaction-markup/></qti-portable-custom-interaction>`;
    expect(derive({ body: pci("urn:pci:shading") + pci("urn:pci:other") }).portableCustomInteractionContext).toEqual({
      customTypeIdentifier: "urn:pci:shading",
    });
    expect(derive({ body: choice }).portableCustomInteractionContext).toBeUndefined();
  });

  it("takes the tool name and version of the item, when they fit 256 characters, and has no vendor", () => {
    expect(derive({ attributes: 'tool-name="Authoring" tool-version="2.1"' })).toMatchObject({
      toolName: "Authoring",
      toolVersion: "2.1",
    });
    const long = "a".repeat(257);
    expect(derive({ attributes: `tool-name="${long}" tool-version="${"b".repeat(256)}"` })).toMatchObject({
      toolName: undefined,
      toolVersion: "b".repeat(256),
    });
    expect(derive()).not.toHaveProperty("toolVendor");
  });

  it("derives metadata that writeQtiMetadata writes and readQtiMetadata reads back", () => {
    const metadata = derive({
      attributes: 'tool-name="T"',
      declarations: response("R", true),
      body: `${choice}${textEntry("B")}`,
      processing: "<qti-response-processing/>",
    });
    expect(readQtiMetadata(parseXml(serializeXml(writeQtiMetadata(metadata))))).toEqual(metadata);
  });

  it("derives the same metadata whatever the interactions in the body, as the statements of the schema say", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...INTERACTION_TYPES.filter((type) => type !== "portableCustomInteraction")), {
          maxLength: 5,
        }),
        fc.boolean(),
        fc.boolean(),
        (types, adaptive, feedback) => {
          const markup = (type: string): string =>
            INTERACTION_OF_TYPE.find(([candidate]) => candidate === type)?.[1] ?? "";
          const body =
            types.map(markup).join("") +
            (feedback ? '<qti-feedback-block outcome-identifier="F" identifier="x" show-hide="show"/>' : "");
          const metadata = derive({ attributes: `adaptive="${adaptive}"`, body });
          expect(metadata.interactionTypes).toEqual([...new Set(types)]);
          expect(metadata.composite).toBe(types.length > 1);
          expect(metadata.feedbackType).toBe(!feedback ? "none" : adaptive ? "adaptive" : "nonadaptive");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("throws a DataError for an argument that is not an item model", () => {
    for (const item of ["null", '"x"', "{}", '{"responseDeclarations":[],"outcomeDeclarations":[]}']) {
      expect(() => deriveQtiMetadata(JSON.parse(item)), item).toThrow(DataError);
    }
  });
});

const lomXml = `<lom:lom xmlns:lom="${LOM_NAMESPACE}">
  <lom:general>
    <lom:identifier><lom:catalog>c</lom:catalog><lom:entry>qti_v2_item_01</lom:entry></lom:identifier>
    <lom:identifier><lom:catalog>only a catalog</lom:catalog></lom:identifier>
    <lom:title><lom:string language="en">Metadata Example Item #1</lom:string><lom:string xml:lang="id">Contoh</lom:string><lom:string>None</lom:string></lom:title>
    <lom:description><lom:string>ignored</lom:string></lom:description>
  </lom:general>
</lom:lom>`;

describe("the general category of a LOM", () => {
  it("reads the entries of the identifiers and the strings of the title, with their languages", () => {
    expect(readLomGeneral(parseXml(lomXml))).toEqual({
      identifiers: ["qti_v2_item_01"],
      titles: [
        { language: "en", text: "Metadata Example Item #1" },
        { language: "id", text: "Contoh" },
        { text: "None" },
      ],
    });
  });

  it("returns empty lists for a lom without a general category", () => {
    expect(readLomGeneral(parseXml(`<lom xmlns="${LOM_NAMESPACE}"/>`))).toEqual({ identifiers: [], titles: [] });
  });
});

describe("reading QTI metadata", () => {
  it("reads the QTI metadata of the 1EdTech metaData example from its text", () => {
    const metadata = qti(`
      <timeDependent>false</timeDependent>
      <interactionType>choiceInteraction</interactionType>
      <feedbackType>nonadaptive</feedbackType>
      <solutionAvailable>true</solutionAvailable>
      <toolName>XMLSPY</toolName>
      <toolVersion>5.4</toolVersion>
      <toolVendor>ALTOVA</toolVendor>`);
    expect(metadata).toEqual({
      timeDependent: false,
      interactionTypes: ["choiceInteraction"],
      feedbackType: "nonadaptive",
      solutionAvailable: true,
      scoringModes: [],
      toolName: "XMLSPY",
      toolVersion: "5.4",
      toolVendor: "ALTOVA",
    });
  });

  it("reads itemTemplate, composite and several scoring modes", () => {
    const metadata = qti(
      "<itemTemplate>1</itemTemplate><composite> true </composite><scoringMode>human</scoringMode><scoringMode>responseprocessing</scoringMode>",
    );
    expect(metadata).toMatchObject({
      itemTemplate: true,
      composite: true,
      scoringModes: ["human", "responseprocessing"],
    });
  });

  it("reads the context of a portable custom interaction", () => {
    const metadata = qti(
      "<portableCustomInteractionContext><customTypeIdentifier>urn:x</customTypeIdentifier><interactionKind>sound</interactionKind></portableCustomInteractionContext>",
    );
    expect(metadata.portableCustomInteractionContext).toEqual({
      customTypeIdentifier: "urn:x",
      interactionKind: "sound",
    });
  });

  it("accepts each of the 22 interaction types and no other", () => {
    expect(INTERACTION_TYPES).toHaveLength(22);
    for (const type of INTERACTION_TYPES)
      expect(qti(`<interactionType>${type}</interactionType>`).interactionTypes).toEqual([type]);
    expect(issueRule(() => qti("<interactionType>choice</interactionType>"))).toBe("assesskit/metadata/invalid-text");
    expect(issueRule(() => qti("<interactionType>choiceinteraction</interactionType>"))).toBe(
      "assesskit/metadata/invalid-text",
    );
  });

  it("accepts the three feedback types and no other", () => {
    expect(FEEDBACK_TYPES).toEqual(["adaptive", "nonadaptive", "none"]);
    for (const type of FEEDBACK_TYPES) expect(qti(`<feedbackType>${type}</feedbackType>`).feedbackType).toBe(type);
    expect(issueRule(() => qti("<feedbackType>other</feedbackType>"))).toBe("assesskit/metadata/invalid-text");
  });

  it("accepts the three scoring modes and no other", () => {
    expect(SCORING_MODES).toEqual(["human", "externalmachine", "responseprocessing"]);
    for (const mode of SCORING_MODES) expect(qti(`<scoringMode>${mode}</scoringMode>`).scoringModes).toEqual([mode]);
    expect(issueRule(() => qti("<scoringMode>externalMachine</scoringMode>"))).toBe("assesskit/metadata/invalid-text");
  });

  it("takes a tool string of 256 characters and rejects one of 257", () => {
    expect(qti(`<toolName>${"a".repeat(256)}</toolName>`).toolName).toHaveLength(256);
    expect(issueRule(() => qti(`<toolVersion>${"a".repeat(257)}</toolVersion>`))).toBe(
      "assesskit/metadata/invalid-text",
    );
    expect(qti(`<toolVendor>${"\u{1F600}".repeat(256)}</toolVendor>`).toolVendor).toHaveLength(512);
  });

  it("reads a normalized string without its tabs and line ends", () => {
    const metadata = qti(
      "<portableCustomInteractionContext><interactionKind>a\tb\nc</interactionKind></portableCustomInteractionContext>",
    );
    expect(metadata.portableCustomInteractionContext?.interactionKind).toBe("a b c");
  });

  it("names the document and the position of a problem", () => {
    const error = thrownAs(ReadError, () => qti("<timeDependent>maybe</timeDependent>", "item.xml"));
    expect(error.issues[0]).toMatchObject({
      severity: "error",
      rule: "assesskit/metadata/invalid-text",
      location: { path: "item.xml", line: 1 },
    });
    expect(error.message).toContain("true or false");
  });

  it("rejects an element the schema does not declare, a foreign one and a repeated one", () => {
    expect(issueRule(() => qti("<other/>"))).toBe("assesskit/metadata/unexpected-element");
    expect(issueRule(() => qti('<x xmlns="urn:x"/>'))).toBe("assesskit/metadata/unexpected-element");
    expect(issueRule(() => qti("<composite>true</composite><composite>false</composite>"))).toBe(
      "assesskit/metadata/unexpected-element",
    );
    expect(issueRule(() => qti("<feedbackType>none</feedbackType><feedbackType>none</feedbackType>"))).toBe(
      "assesskit/metadata/unexpected-element",
    );
  });
});

/** Texts of JSON that are not QTI metadata: a field of the wrong type, a term outside its vocabulary, a long tool string. */
const INVALID_QTI_METADATA: readonly string[] = (() => {
  const valid: QtiMetadata = { interactionTypes: [], scoringModes: [] };
  return [
    "{}",
    JSON.stringify({ ...valid, interactionTypes: "choiceInteraction" }),
    JSON.stringify({ ...valid, interactionTypes: ["choice"] }),
    JSON.stringify({ ...valid, scoringModes: ["Human"] }),
    JSON.stringify({ ...valid, feedbackType: "other" }),
    JSON.stringify({ ...valid, composite: "true" }),
    JSON.stringify({ ...valid, toolName: 3 }),
    JSON.stringify({ ...valid, toolName: "a".repeat(257) }),
    JSON.stringify({ ...valid, portableCustomInteractionContext: { customTypeIdentifier: 3 } }),
    JSON.stringify({ ...valid, portableCustomInteractionContext: "x" }),
    "null",
    "3",
  ];
})();

describe("checking QTI metadata", () => {
  it("accepts any QTI metadata that the reader can return", () => {
    fc.assert(
      fc.property(qtiMetadata, (metadata) => {
        expect(() => checkQtiMetadata(metadata)).not.toThrow();
      }),
    );
  });

  it("throws a DataError for a field of the wrong type, a term outside its vocabulary and a long tool string", () => {
    for (const metadata of INVALID_QTI_METADATA) {
      expect(() => checkQtiMetadata(JSON.parse(metadata)), metadata).toThrow(DataError);
    }
  });
});

describe("writing QTI metadata", () => {
  it("writes the children in the order of the schema, whatever the order of the fields", () => {
    const element = writeQtiMetadata({
      toolVendor: "v",
      feedbackType: "none",
      composite: false,
      interactionTypes: ["choiceInteraction", "textEntryInteraction"],
      scoringModes: ["human"],
      itemTemplate: true,
    });
    expect(element.children.map((child) => (child.kind === "element" ? child.name : child.kind))).toEqual([
      "itemTemplate",
      "composite",
      "interactionType",
      "interactionType",
      "feedbackType",
      "scoringMode",
      "toolVendor",
    ]);
    expect(element).toMatchObject({ namespace: QTI_METADATA_NAMESPACE, name: "qtiMetadata" });
  });

  it("reads back what it writes, through XML text", () => {
    fc.assert(
      fc.property(qtiMetadata, (metadata) => {
        expect(readQtiMetadata(parseXml(serializeXml(writeQtiMetadata(metadata))))).toEqual(metadata);
      }),
      { numRuns: 200 },
    );
  });

  it("throws a DataError for metadata that checkQtiMetadata rejects", () => {
    for (const metadata of INVALID_QTI_METADATA) {
      expect(() => writeQtiMetadata(JSON.parse(metadata)), metadata).toThrow(DataError);
    }
  });
});

describe("reading resource metadata", () => {
  const resourceMetadata = (inner: string): XmlElement =>
    parseXml(
      `<metadata xmlns="${CP_NAMESPACE}" xmlns:qmd="${QTI_METADATA_NAMESPACE}" xmlns:csmd="${CSM_NAMESPACE}" xmlns:lom="${LOM_NAMESPACE}">${inner}</metadata>`,
    );
  const full = `<qmd:qtiMetadata><qmd:composite>false</qmd:composite></qmd:qtiMetadata>
    <csmd:curriculumStandardsMetadataSet><csmd:curriculumStandardsMetadata><csmd:setOfGUIDs><csmd:labelledGUID><csmd:GUID>g</csmd:GUID></csmd:labelledGUID></csmd:setOfGUIDs></csmd:curriculumStandardsMetadata></csmd:curriculumStandardsMetadataSet>
    <lom:lom><lom:general><lom:title><lom:string>t</lom:string></lom:title></lom:general></lom:lom>`;

  it("reads the QTI metadata, the curriculum standards and the LOM of a metadata element", () => {
    const metadata = readResourceMetadata(resourceMetadata(full));
    expect(metadata.qti).toMatchObject({ composite: false });
    expect(metadata.curriculumStandards?.standards).toHaveLength(1);
    expect(metadata.lom?.name).toBe("lom");
  });

  it("keeps each LOM category as XML", () => {
    const categories = [
      "lifeCycle",
      "metaMetadata",
      "technical",
      "educational",
      "rights",
      "relation",
      "annotation",
      "classification",
    ];
    const inner = categories
      .map((name) => `<lom:${name}><lom:description><lom:string>${name}</lom:string></lom:description></lom:${name}>`)
      .join("");
    const metadata = readResourceMetadata(resourceMetadata(`<lom:lom>${inner}</lom:lom>`));
    const kept = metadata.lom?.children.flatMap((child) => (child.kind === "element" ? [child.name] : []));
    expect(kept).toEqual(categories);
  });

  it("reads an external metadata file: the root lom holds the QTI metadata and the curriculum standards", () => {
    const external = parseXml(
      `<lom xmlns="${LOM_NAMESPACE}" xmlns:qmd="${QTI_METADATA_NAMESPACE}" xmlns:csmd="${CSM_NAMESPACE}"><educational/><qmd:qtiMetadata><qmd:composite>false</qmd:composite></qmd:qtiMetadata></lom>`,
    );
    const metadata = readResourceMetadata(external);
    expect(metadata.qti?.composite).toBe(false);
    expect(metadata.lom?.children.flatMap((child) => (child.kind === "element" ? [child.name] : []))).toEqual([
      "educational",
    ]);
  });

  it("reads a metadata element without children", () => {
    expect(readResourceMetadata(resourceMetadata(""))).toEqual({});
  });

  it("rejects an element that the metadata of a resource does not have, a part twice and parts out of order", () => {
    const rule = (inner: string): string | undefined => issueRule(() => readResourceMetadata(resourceMetadata(inner)));
    expect(rule("<other/>")).toBe("assesskit/metadata/unexpected-element");
    expect(rule("<lom:lom/><lom:lom/>")).toBe("assesskit/metadata/unexpected-element");
    expect(rule("<qmd:qtiMetadata/><qmd:qtiMetadata/>")).toBe("assesskit/metadata/unexpected-element");
    expect(rule("<lom:lom/><qmd:qtiMetadata/>")).toBe("assesskit/metadata/unexpected-element");
    expect(rule("<csmd:curriculumStandardsMetadataSet/><qmd:qtiMetadata/>")).toBe(
      "assesskit/metadata/unexpected-element",
    );
    expect(rule("text")).toBe("assesskit/metadata/unexpected-text");
  });

  it("rejects an external metadata file that has the QTI metadata or the curriculum standards twice", () => {
    const external = (inner: string): XmlElement =>
      parseXml(
        `<lom xmlns="${LOM_NAMESPACE}" xmlns:qmd="${QTI_METADATA_NAMESPACE}" xmlns:csmd="${CSM_NAMESPACE}">${inner}</lom>`,
      );
    expect(issueRule(() => readResourceMetadata(external("<qmd:qtiMetadata/><qmd:qtiMetadata/>")))).toBe(
      "assesskit/metadata/duplicate-element",
    );
    expect(
      issueRule(() =>
        readResourceMetadata(external("<csmd:curriculumStandardsMetadataSet/><csmd:curriculumStandardsMetadataSet/>")),
      ),
    ).toBe("assesskit/metadata/duplicate-element");
  });

  it("reports the path the caller gives in the location of an issue", () => {
    const error = thrownAs(ReadError, () =>
      readResourceMetadata(resourceMetadata("<other/>"), { path: "imsmanifest.xml" }),
    );
    expect(error.issues[0]?.location?.path).toBe("imsmanifest.xml");
  });

  it("throws a DataError for an argument of another type", () => {
    for (const input of ["null", '"x"', "[]"]) expect(() => readResourceMetadata(JSON.parse(input))).toThrow(DataError);
    expect(() => readResourceMetadata(resourceMetadata(""), { path: JSON.parse("3") })).toThrow(
      "The option path must be a string, found 3.",
    );
    expect(() => readResourceMetadata(resourceMetadata(""), JSON.parse("null"))).toThrow(
      "The options must be an object, found null.",
    );
  });
});

describe("writing resource metadata", () => {
  it("writes a metadata element of the content package namespace in the order of the CP schema", () => {
    const element = writeResourceMetadata({
      lom: parseXml(`<lom xmlns="${LOM_NAMESPACE}"/>`),
      curriculumStandards: { standards: [{ guidSets: [{ labelledGuids: [{ guid: "g" }] }] }] },
      qti: { interactionTypes: [], scoringModes: [], composite: true },
    });
    expect(element).toMatchObject({ namespace: CP_NAMESPACE, name: "metadata" });
    expect(element.children.map((child) => (child.kind === "element" ? child.name : ""))).toEqual([
      "qtiMetadata",
      "curriculumStandardsMetadataSet",
      "lom",
    ]);
  });

  it("reads back what it writes", () => {
    fc.assert(
      fc.property(
        fc.record({
          qti: fc.option(qtiMetadata, { nil: undefined }),
          curriculumStandards: fc.option(curriculumStandardsSet, { nil: undefined }),
          lom: fc.option(lom, { nil: undefined }),
        }),
        (metadata) => {
          const read = readResourceMetadata(parseXml(serializeXml(writeResourceMetadata(metadata))));
          expect({ ...read, lom: read.lom && bare(read.lom) }).toEqual({
            ...metadata,
            lom: metadata.lom && bare(metadata.lom),
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("throws a DataError for a lom that is not a lom element and for the wrong types", () => {
    for (const metadata of [
      '{"lom":{"kind":"element","namespace":"","name":"lom","attributes":[],"children":[]}}',
      '{"lom":3}',
      "null",
      '"x"',
    ]) {
      expect(() => writeResourceMetadata(JSON.parse(metadata)), metadata).toThrow(DataError);
    }
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = new URL("../../../docs/runtime/metadata.md", import.meta.url);
    const asi = await import("../src/asi/index.js");
    const metadata = await import("../src/metadata/index.js");
    const modules = { "@assesskit/runtime/asi": asi, "@assesskit/runtime/metadata": metadata };
    expect(
      await runGuideSamples(guide, { ...modules, "@assesskit/runtime/xml": await import("../src/xml/index.js") }),
    ).toBeGreaterThan(0);
  });
});
