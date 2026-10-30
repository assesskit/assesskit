// cspell:ignore Gxvb foob fooba
// biome-ignore-all lint/style/useNamingConvention: The names of the JSON fields are those of the binding.
import { Buffer } from "node:buffer";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type AdaptiveSelection,
  ASI_NAMESPACE,
  type AssessmentResult,
  type AssessmentSection,
  assessmentResultFromJson,
  assessmentResultToJson,
  type CatPort,
  type CreateSectionResponse,
  type CreateSessionRequest,
  type CreateSessionResponse,
  catMetadata,
  checkPool,
  container,
  DataError,
  type GetSectionResponse,
  isSessionEnd,
  itemStageFromJson,
  type QtiMetadata,
  readAsi,
  readResults,
  record,
  type SectionData,
  type SubmitResultsRequest,
  type SubmitResultsResponse,
  sectionData,
  single,
  writeResults,
} from "../src/index.js";
import { qtiMetadata } from "./arbitraries/metadata.js";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const REFS = `<qti-adaptive-engine-ref identifier="engine" href="http://example.org/engine"/>
  <qti-adaptive-settings-ref identifier="settings" href="settings.data"/>
  <qti-usagedata-ref identifier="usagedata" href="usagedata.xml"/>
  <qti-metadata-ref identifier="metadata" href="metadata.json"/>`;

/** The item identifiers of the sample test of CAT §2.5. */
const SAMPLE_ITEMS = ["item434", "item065", "item365", "item347", "item653", "item656"];

const itemRefs = (identifiers: readonly string[]): string =>
  identifiers
    .map((identifier) => `<qti-assessment-item-ref identifier="${identifier}" href="${identifier}.xml"/>`)
    .join("");

/** A section document as CAT §2.1 and §2.5 show it, in the namespace of the ASI schema. */
function sectionOf(selection: string, content: string): AssessmentSection {
  const document = readAsi(
    `<qti-assessment-section xmlns="${ASI_NAMESPACE}" identifier="sec" title="Adaptive Section" visible="true">${selection}${content}</qti-assessment-section>`,
  );
  if (document.kind !== "section") throw new Error(`Expected a section, found ${document.kind}.`);
  return document.section;
}

function selectionOf(content = REFS): AdaptiveSelection {
  const { adaptiveSelection } = sectionOf(`<qti-adaptive-selection>${content}</qti-adaptive-selection>`, "");
  if (adaptiveSelection === undefined) throw new Error("The section has no adaptive selection.");
  return adaptiveSelection;
}

const SAMPLE = sectionOf(`<qti-adaptive-selection>${REFS}</qti-adaptive-selection>`, itemRefs(SAMPLE_ITEMS));

describe("checkPool", () => {
  it("[C2] reports nothing when the item references and the pool agree, as CAT §2.1 requires (§2.5 sample)", () => {
    expect(checkPool(SAMPLE, { itemIdentifiers: SAMPLE_ITEMS })).toEqual([]);
  });

  it("[C2] ignores the order of the pool and the stage length, and a pool that lists an item twice", () => {
    const pool = { itemIdentifiers: [...SAMPLE_ITEMS].reverse().concat("item434"), stageLength: 0 };
    expect(checkPool(SAMPLE, pool)).toEqual([]);
  });

  it("[C2] reports an item reference that the pool lacks: the engine can never select it (CAT §2.2)", () => {
    const issues = checkPool(SAMPLE, {
      itemIdentifiers: SAMPLE_ITEMS.filter((identifier) => identifier !== "item365"),
    });
    expect(issues).toEqual([
      {
        severity: "error",
        code: "olah/cat/item-not-in-pool",
        message: expect.stringContaining(
          'lists the item "item365", which the item pool of the CAT engine does not contain',
        ),
        source: "CAT §2.1, §2.2",
        location: { element: "qti-assessment-section/qti-assessment-item-ref" },
      },
    ]);
  });

  it("[C2] reports an item of the pool that the section does not list: the engine could select it (CAT §2.2)", () => {
    const issues = checkPool(SAMPLE, { itemIdentifiers: [...SAMPLE_ITEMS, "item999"] });
    expect(issues).toEqual([
      {
        severity: "error",
        code: "olah/cat/item-not-in-section",
        message: expect.stringContaining('contains the item "item999", which the adaptive section "sec" does not list'),
        source: "CAT §2.1, §2.2",
        location: { element: "qti-assessment-section" },
      },
    ]);
  });

  it("[C2] reports the item references first and the pool after, each in list order", () => {
    const section = sectionOf("", itemRefs(["a", "b", "c"]));
    const issues = checkPool(section, { itemIdentifiers: ["z", "c", "y"] });
    expect(issues.map(({ code, message }) => [code, /"(\w)"/.exec(message)?.[1]])).toEqual([
      ["olah/cat/item-not-in-pool", "a"],
      ["olah/cat/item-not-in-pool", "b"],
      ["olah/cat/item-not-in-section", "z"],
      ["olah/cat/item-not-in-section", "y"],
    ]);
  });

  it("[C2] reports every item reference when the pool is empty, absent or null", () => {
    for (const pool of [{}, { itemIdentifiers: [] }, { itemIdentifiers: null }]) {
      expect(checkPool(SAMPLE, pool).map(({ code }) => code)).toEqual(
        Array(SAMPLE_ITEMS.length).fill("olah/cat/item-not-in-pool"),
      );
    }
  });

  it("[C2] counts only the item references that are children: an adaptive section has no nested sections (CAT §2.3)", () => {
    const section = sectionOf(
      "",
      `${itemRefs(["a"])}<qti-assessment-section identifier="inner" title="i" visible="true">${itemRefs(["b"])}</qti-assessment-section>`,
    );
    expect(checkPool(section, { itemIdentifiers: ["a", "b"] }).map(({ code }) => code)).toEqual([
      "olah/cat/item-not-in-section",
    ]);
  });

  it("[C2] reports an item reference that two children repeat once", () => {
    const section = sectionOf("", itemRefs(["a", "a"]));
    expect(checkPool(section, { itemIdentifiers: [] })).toHaveLength(1);
  });

  it("[C2] throws a DataError for arguments of other types", () => {
    const pool = { itemIdentifiers: SAMPLE_ITEMS };
    expect(() => checkPool(json("null"), pool)).toThrow(DataError);
    expect(() => checkPool(json("null"), pool)).toThrow("The section must be an object, found null.");
    expect(() => checkPool(json("{}"), pool)).toThrow(
      "The identifier of the section must be a string, found undefined.",
    );
    expect(() => checkPool(json('{"identifier":"s","children":"a"}'), pool)).toThrow(
      'The property children of the section must be an array, found "a".',
    );
    expect(() => checkPool(json('{"identifier":"s","children":[1]}'), pool)).toThrow(
      "A child of the section must be an object, found 1.",
    );
    expect(() =>
      checkPool(json('{"identifier":"s","children":[{"kind":"assessment-item-ref","identifier":5}]}'), pool),
    ).toThrow("The identifier of an item reference must be a string, found 5.");
    expect(() => checkPool(SAMPLE, json("null"))).toThrow("The pool must be an object, found null.");
    expect(() => checkPool(SAMPLE, json('{"itemIdentifiers":"a"}'))).toThrow(
      'The itemIdentifiers of the pool must be an array or null, found "a".',
    );
    expect(() => checkPool(SAMPLE, json('{"itemIdentifiers":[1]}'))).toThrow(
      "An item identifier of the pool must be a string, found 1.",
    );
    expect(() => checkPool(SAMPLE, json('{"stageLength":"1"}'))).toThrow(
      'The stageLength of the pool must be a non-negative integer or null, found "1".',
    );
  });
});

describe("catMetadata", () => {
  const Complete: QtiMetadata = {
    itemTemplate: true,
    timeDependent: false,
    composite: true,
    interactionTypes: ["choiceInteraction", "textEntryInteraction"],
    portableCustomInteractionContext: { customTypeIdentifier: "urn:example", interactionKind: "x" },
    feedbackType: "adaptive",
    solutionAvailable: true,
    scoringModes: ["responseprocessing", "human"],
    toolName: "Editor",
    toolVersion: "1.2",
    toolVendor: "Example",
  };

  it("[C11] binds QTI metadata to the fields of CAT Appendix B", () => {
    const result = catMetadata([{ identifier: "item434", metadata: Complete }]);
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      itemMetadata: [
        {
          identifier: "item434",
          itemTemplate: true,
          timeDependent: false,
          composite: true,
          interactionType: ["choiceInteraction", "textEntryInteraction"],
          feedbackType: "adaptive",
          solutionAvailable: true,
          scoringMode: ["responseprocessing", "human"],
          toolName: "Editor",
          toolVersion: "1.2",
          toolVendor: "Example",
        },
      ],
    });
  });

  it("[C11] leaves out what the QTI metadata omits, but keeps an empty list of interactions (CAT App. B)", () => {
    const result = catMetadata([{ identifier: "i", metadata: { interactionTypes: [], scoringModes: [] } }]);
    expect(JSON.parse(JSON.stringify(result))).toEqual({ itemMetadata: [{ identifier: "i", interactionType: [] }] });
  });

  it("[C11] keeps the items in the order given, and gives no item metadata for no items", () => {
    const metadata: QtiMetadata = { interactionTypes: [], scoringModes: [] };
    const result = catMetadata(["b", "a", "c"].map((identifier) => ({ identifier, metadata })));
    expect(result.itemMetadata.map(({ identifier }) => identifier)).toEqual(["b", "a", "c"]);
    expect(catMetadata([])).toEqual({ itemMetadata: [] });
  });

  it("[C11] encodes the metadata files of an item and of the section in base64 with their type", () => {
    const metadata: QtiMetadata = { interactionTypes: [], scoringModes: [] };
    const lom = { type: "lom", content: bytes("<lom/>") };
    const csmd = { type: "csmd", content: bytes("<csmd/>") };
    const result = catMetadata([{ identifier: "i", metadata, externalMetadata: [lom] }], { externalMetadata: [csmd] });
    // The base64 of "<lom/>" and "<csmd/>".
    expect(result.externalMetadata).toEqual([{ type: "csmd", content: "PGNzbWQvPg==" }]);
    expect(result.itemMetadata[0]?.externalMetadata).toEqual([{ type: "lom", content: "PGxvbS8+" }]);
  });

  it("[C11] puts the metadata of the section before the metadata of the items", () => {
    const result = catMetadata([], { externalMetadata: [{ type: "lom", content: bytes("") }] });
    expect(Object.keys(result)).toEqual(["externalMetadata", "itemMetadata"]);
    expect(result.externalMetadata).toEqual([{ type: "lom", content: "" }]);
  });

  it("[C11] throws a DataError for an identifier that two items share (CAT App. B: unique)", () => {
    const metadata: QtiMetadata = { interactionTypes: [], scoringModes: [] };
    expect(() =>
      catMetadata([
        { identifier: "a", metadata },
        { identifier: "a", metadata },
      ]),
    ).toThrow('The identifiers of the items must be unique (CAT App. B), found "a" twice.');
  });

  it("[C11] throws a DataError for arguments of other types", () => {
    const metadata: QtiMetadata = { interactionTypes: [], scoringModes: [] };
    expect(() => catMetadata(json("{}"))).toThrow("The items must be an array, found an object.");
    expect(() => catMetadata(json("null"))).toThrow(DataError);
    expect(() => catMetadata([], json("null"))).toThrow("The options must be an object, found null.");
    expect(() => catMetadata([], json('{"externalMetadata":null}'))).toThrow(
      "The option externalMetadata must be an array, found null.",
    );
    expect(() => catMetadata(json("[5]"))).toThrow("The item at index 0 must be an object, found 5.");
    expect(() => catMetadata(json('[{"identifier":5}]'))).toThrow(
      "The identifier of the item at index 0 must be a string, found 5.",
    );
    expect(() => catMetadata(json('[{"identifier":"a"}]'))).toThrow(
      "The QTI metadata must be an object, found undefined.",
    );
    expect(() =>
      catMetadata(json('[{"identifier":"a","metadata":{"interactionTypes":["boxInteraction"],"scoringModes":[]}}]')),
    ).toThrow('An interaction type must be "associateInteraction"');
    expect(() => catMetadata([{ identifier: "a", metadata, externalMetadata: json("{}") }])).toThrow(
      "The externalMetadata of the item at index 0 must be an array, found an object.",
    );
    expect(() => catMetadata([], { externalMetadata: json("[null]") })).toThrow(
      "The metadata file at index 0 of the option externalMetadata must be an object, found null.",
    );
    expect(() => catMetadata([], { externalMetadata: json('[{"type":1}]') })).toThrow(
      "The type of the metadata file at index 0 of the option externalMetadata must be a string, found 1.",
    );
    expect(() => catMetadata([], { externalMetadata: json('[{"type":"lom","content":"<lom/>"}]') })).toThrow(
      'The content of the metadata file at index 0 of the option externalMetadata must be a Uint8Array, found "<lom/>".',
    );
  });
});

describe("isSessionEnd", () => {
  it("[C8][C4] ends the session when the response has no next stage (CAT §3.4: omitted, null or empty nextItems)", () => {
    expect(isSessionEnd(undefined)).toBe(true);
    expect(isSessionEnd(null)).toBe(true);
    expect(isSessionEnd({})).toBe(true);
  });

  it("[C8] ends the session for a stage without items and with a null or zero stage length (CAT §4.2)", () => {
    expect(isSessionEnd({ itemIdentifiers: null, stageLength: null })).toBe(true);
    expect(isSessionEnd({ itemIdentifiers: [], stageLength: 0 })).toBe(true);
    expect(isSessionEnd({ itemIdentifiers: [] })).toBe(true);
  });

  it("[C8] continues the session for a stage with items, repeated ones included (CAT §4.2)", () => {
    expect(isSessionEnd({ itemIdentifiers: ["item434"], stageLength: 1 })).toBe(false);
    expect(isSessionEnd({ itemIdentifiers: ["a", "a"], stageLength: 2 })).toBe(false);
    expect(isSessionEnd({ itemIdentifiers: ["a"] })).toBe(false);
  });

  it("[C8] ends the session for a stage without items whatever its stage length, because nothing is left to present", () => {
    expect(isSessionEnd({ itemIdentifiers: [], stageLength: 3 })).toBe(true);
  });

  it("[C8] throws a DataError for a stage of another type", () => {
    expect(() => isSessionEnd(json('"a"'))).toThrow('The stage must be an object, found "a".');
    expect(() => isSessionEnd(json("[]"))).toThrow("The stage must be an object, found an array.");
    expect(() => isSessionEnd(json('{"itemIdentifiers":"a"}'))).toThrow(
      'The itemIdentifiers of the stage must be an array or null, found "a".',
    );
    expect(() => isSessionEnd(json('{"itemIdentifiers":["a",2]}'))).toThrow(
      "An item identifier of the stage must be a string, found 2.",
    );
    for (const stageLength of ['"1"', "-1", "1.5", "true"]) {
      expect(() => isSessionEnd(json(`{"stageLength":${stageLength}}`))).toThrow(
        "The stageLength of the stage must be a non-negative integer or null",
      );
    }
  });
});

/** A CAT engine that follows CAT §4.2's shortest session and records what it receives. */
class ScriptedEngine implements CatPort {
  readonly calls: unknown[][] = [];
  readonly submitted: SubmitResultsRequest[] = [];
  private deployed: SectionData | undefined;

  async createSection(prefix: string, data: SectionData): Promise<CreateSectionResponse> {
    this.calls.push(["createSection", prefix, data]);
    this.deployed = data;
    return { sectionIdentifier: "S1" };
  }

  async getSection(prefix: string, sectionIdentifier: string): Promise<GetSectionResponse> {
    this.calls.push(["getSection", prefix, sectionIdentifier]);
    if (this.deployed === undefined) throw new Error("404 Not Found");
    return { sectionData: this.deployed, items: { itemIdentifiers: SAMPLE_ITEMS } };
  }

  async createSession(
    prefix: string,
    sectionIdentifier: string,
    request: CreateSessionRequest,
  ): Promise<CreateSessionResponse> {
    this.calls.push(["createSession", prefix, sectionIdentifier, request]);
    return {
      sessionIdentifier: "T1",
      nextItems: { itemIdentifiers: ["item434"], stageLength: 1 },
      sessionState: "state-1",
    };
  }

  async submitResults(
    prefix: string,
    sectionIdentifier: string,
    sessionIdentifier: string,
    request: SubmitResultsRequest,
  ): Promise<SubmitResultsResponse> {
    this.calls.push(["submitResults", prefix, sectionIdentifier, sessionIdentifier]);
    this.submitted.push(request);
    return { nextItems: null };
  }

  async endSession(prefix: string, sectionIdentifier: string, sessionIdentifier: string): Promise<void> {
    this.calls.push(["endSession", prefix, sectionIdentifier, sessionIdentifier]);
  }

  async endSection(prefix: string, sectionIdentifier: string): Promise<void> {
    this.calls.push(["endSection", prefix, sectionIdentifier]);
  }
}

const PREFIX = "http://example.org/engine";
const TIME = "2026-10-30T10:00:00";

/** The minimal results report of CAT §4.3.1 for one answered and one skipped item. */
const MINIMAL_REPORT: AssessmentResult = {
  context: { sessionIdentifiers: [] },
  itemResults: [
    {
      identifier: "item434",
      sequenceIndex: 1,
      datestamp: TIME,
      sessionStatus: "final",
      variables: [
        {
          kind: "response",
          identifier: "numAttempts",
          cardinality: "single",
          baseType: "integer",
          candidateResponse: single("integer", 1),
          extensions: [],
        },
        {
          kind: "response",
          identifier: "duration",
          cardinality: "single",
          baseType: "duration",
          candidateResponse: single("duration", 12.5),
          extensions: [],
        },
        {
          kind: "outcome",
          identifier: "completionStatus",
          cardinality: "single",
          baseType: "string",
          value: single("string", "completed"),
        },
        { kind: "outcome", identifier: "SCORE", cardinality: "single", baseType: "float", value: single("float", 1) },
      ],
      supports: [],
    },
    // A skipped item: a positive sequence index, status initial, no response and no SCORE.
    { identifier: "item065", sequenceIndex: 2, datestamp: TIME, sessionStatus: "initial", variables: [], supports: [] },
  ],
};

const DATESTAMP = "2026-10-30T10:05:00";

/** A result as the delivery engine reports it (RR §2.3.1), with every kind of variable the binding has a place for. */
const RESULT: AssessmentResult = {
  context: {
    sourcedId: "candidate1",
    sessionIdentifiers: [{ sourceId: "https://delivery.example", identifier: "session1" }],
  },
  testResult: {
    identifier: "test1",
    datestamp: DATESTAMP,
    variables: [
      { kind: "outcome", identifier: "TOTAL", cardinality: "single", baseType: "float", value: single("float", 1) },
      { kind: "context", identifier: "LEVEL", cardinality: "single", baseType: "integer", value: single("integer", 2) },
    ],
    supports: [{ name: "spoken", assignment: "assigned" }],
  },
  itemResults: [
    {
      identifier: "i1",
      sequenceIndex: 1,
      datestamp: DATESTAMP,
      sessionStatus: "final",
      variables: [
        {
          kind: "response",
          identifier: "RESPONSE",
          cardinality: "single",
          baseType: "identifier",
          candidateResponse: single("identifier", "B"),
          correctResponse: { interpretation: "The capital", value: single("identifier", "A") },
          choiceSequence: ["B", "A"],
          scoreStatus: "scored",
          answeredStatus: "answered",
          extensions: [],
        },
        { kind: "template", identifier: "N", cardinality: "single", baseType: "integer", value: single("integer", 4) },
        {
          kind: "outcome",
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          value: single("float", 0),
          view: ["candidate", "scorer"],
          normalMaximum: 1,
          externalScored: "human",
          variableIdentifierRef: "RESPONSE",
        },
      ],
      candidateComment: "Unsure",
      supports: [{ name: "spoken", assignment: "assigned" }],
    },
    {
      identifier: "i2",
      sequenceIndex: 2,
      datestamp: DATESTAMP,
      sessionStatus: "pendingExternalScoring",
      variables: [
        {
          kind: "response",
          identifier: "PAIRS",
          cardinality: "multiple",
          baseType: "pair",
          candidateResponse: container("multiple", "pair", [
            ["A", "B"],
            ["C", "D"],
          ]),
          extensions: [],
        },
        {
          kind: "response",
          identifier: "NOTHING",
          cardinality: "single",
          baseType: "string",
          candidateResponse: null,
          extensions: [],
        },
        {
          kind: "outcome",
          identifier: "DETAIL",
          cardinality: "record",
          value: record([
            ["points", single("float", 1.5)],
            ["label", { cardinality: "single", baseType: "string", value: "ok" }],
          ]),
        },
      ],
      supports: [],
    },
  ],
};

/** The same result in the JSON of the binding (https://www.imsglobal.org/spec/cat/v1p0/bind, §5.2.8, §5.3, §6.11). */
const RESULT_JSON = {
  context: {
    sourcedId: "candidate1",
    sessionIdentifiers: [{ sourceID: "https://delivery.example", identifier: "session1" }],
  },
  testResult: {
    identifier: "test1",
    datestamp: DATESTAMP,
    responseVariables: [],
    templateVariables: [],
    outcomeVariables: [{ identifier: "TOTAL", cardinality: "single", baseType: "float", value: [{ value: "1" }] }],
  },
  itemResult: [
    {
      identifier: "i1",
      sequenceIndex: 1,
      datestamp: DATESTAMP,
      sessionStatus: "final",
      responseVariables: [
        {
          identifier: "RESPONSE",
          cardinality: "single",
          baseType: "identifier",
          choiceSequence: ["B", "A"],
          correctResponse: { interpretation: "The capital", value: [{ value: "A" }] },
          candidateResponse: { value: [{ value: "B" }] },
        },
      ],
      templateVariables: [{ identifier: "N", cardinality: "single", baseType: "integer", value: [{ value: "4" }] }],
      outcomeVariables: [
        {
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          view: ["candidate", "scorer"],
          normalMaximum: 1,
          value: [{ value: "0" }],
        },
      ],
      candidateComment: "Unsure",
    },
    {
      identifier: "i2",
      sequenceIndex: 2,
      datestamp: DATESTAMP,
      sessionStatus: "pendingResponseProcessing",
      responseVariables: [
        {
          identifier: "PAIRS",
          cardinality: "multiple",
          baseType: "pair",
          candidateResponse: { value: [{ value: "A B" }, { value: "C D" }] },
        },
        { identifier: "NOTHING", cardinality: "single", baseType: "string", candidateResponse: { value: [] } },
      ],
      templateVariables: [],
      outcomeVariables: [
        {
          identifier: "DETAIL",
          cardinality: "record",
          value: [
            { fieldIdentifier: "points", baseType: "float", value: "1.5" },
            { fieldIdentifier: "label", baseType: "string", value: "ok" },
          ],
        },
      ],
    },
  ],
};

describe("assessmentResultToJson, assessmentResultFromJson and itemStageFromJson", () => {
  it("[C9][G21] writes an assessment result in the JSON of the binding: itemResult, sourceID, and the three lists of variables", () => {
    expect(JSON.parse(JSON.stringify(assessmentResultToJson(RESULT)))).toEqual(RESULT_JSON);
  });

  it("[C9][G21] writes NULL as the absence of a value, and the status that waits for external scoring as pending processing", () => {
    const written = JSON.parse(JSON.stringify(assessmentResultToJson(RESULT)));
    expect(written.itemResult[1].responseVariables[1].candidateResponse).toEqual({ value: [] });
    expect(written.itemResult[1].sessionStatus).toBe("pendingResponseProcessing");
    expect(JSON.stringify(written)).not.toContain("externalScored");
    expect(JSON.stringify(written)).not.toContain("LEVEL");
  });

  it("[C9][G21] reads the assessment result of an engine, with the lists of variables joined, and no context as no sessions", () => {
    const read = assessmentResultFromJson({
      testResult: {
        identifier: "t",
        datestamp: DATESTAMP,
        outcomeVariables: [
          {
            identifier: "THETA",
            cardinality: "single",
            baseType: "float",
            value: [{ value: "0.42" }],
            interpretation: "Ability",
            normalMinimum: -4,
            view: ["tutor"],
          },
          { identifier: "SE", cardinality: "single", baseType: "float", value: [] },
        ],
      },
      itemResult: [
        {
          identifier: "i1",
          sequenceIndex: 3,
          datestamp: DATESTAMP,
          sessionStatus: "initial",
          responseVariables: [
            {
              identifier: "R",
              cardinality: "ordered",
              baseType: "identifier",
              candidateResponse: { value: [{ value: "B" }, { value: "A" }] },
              correctResponse: { value: [{ value: "A" }, { value: "B" }] },
              choiceSequence: ["B", "A"],
            },
          ],
          templateVariables: [
            {
              identifier: "T",
              cardinality: "record",
              value: [{ fieldIdentifier: "f", baseType: "point", value: "1 2" }],
            },
          ],
          candidateComment: "hi",
        },
      ],
    });
    expect(read).toEqual({
      context: { sessionIdentifiers: [] },
      testResult: {
        identifier: "t",
        datestamp: DATESTAMP,
        variables: [
          {
            kind: "outcome",
            identifier: "THETA",
            cardinality: "single",
            baseType: "float",
            value: single("float", 0.42),
            interpretation: "Ability",
            normalMinimum: -4,
            view: ["tutor"],
          },
          { kind: "outcome", identifier: "SE", cardinality: "single", baseType: "float", value: null },
        ],
        supports: [],
      },
      itemResults: [
        {
          identifier: "i1",
          sequenceIndex: 3,
          datestamp: DATESTAMP,
          sessionStatus: "initial",
          variables: [
            {
              kind: "response",
              identifier: "R",
              cardinality: "ordered",
              baseType: "identifier",
              candidateResponse: container("ordered", "identifier", ["B", "A"]),
              correctResponse: { value: container("ordered", "identifier", ["A", "B"]) },
              choiceSequence: ["B", "A"],
              extensions: [],
            },
            {
              kind: "template",
              identifier: "T",
              cardinality: "record",
              value: record([["f", single("point", [1, 2])]]),
            },
          ],
          candidateComment: "hi",
          supports: [],
        },
      ],
    });
  });

  it("[C9][G21] reads the context of an engine with its source identifiers", () => {
    const read = assessmentResultFromJson({
      context: { sourcedId: "c1", sessionIdentifiers: [{ sourceID: "https://engine.example", identifier: "s1" }] },
    });
    expect(read).toEqual({
      context: { sourcedId: "c1", sessionIdentifiers: [{ sourceId: "https://engine.example", identifier: "s1" }] },
      itemResults: [],
    });
  });

  it("[C9][G21] rejects a result of the wrong form", () => {
    const variable = { identifier: "V", cardinality: "single", baseType: "float", value: [{ value: "1" }] };
    const itemResult = { identifier: "i", datestamp: DATESTAMP, sessionStatus: "final" };
    const withOutcome = (outcome: unknown): unknown => ({
      itemResult: [{ ...itemResult, outcomeVariables: [outcome] }],
    });
    const rejects: readonly (readonly [unknown, RegExp])[] = [
      [json("null"), /^The assessmentResult must be an object/],
      [{ itemResult: "x" }, /^The itemResult of a result must be an array/],
      [
        { itemResult: [{ ...itemResult, sessionStatus: "done" }] },
        /^The sessionStatus of an itemResult must be one of/,
      ],
      [
        { itemResult: [{ ...itemResult, sequenceIndex: -1 }] },
        /^The sequenceIndex of an itemResult must be a non-negative integer/,
      ],
      [{ itemResult: [{ identifier: "", datestamp: DATESTAMP }] }, /^The identifier of an itemResult/],
      [{ testResult: { identifier: "t" } }, /^The datestamp of the testResult/],
      [{ context: { sessionIdentifiers: [{ identifier: "s" }] } }, /^The sourceID of a session identifier/],
      [withOutcome({ ...variable, cardinality: "many" }), /^The cardinality of the outcome variable "V" must be/],
      [
        withOutcome({ ...variable, baseType: "number" }),
        /^The baseType of the outcome variable "V" must be a base type/,
      ],
      [withOutcome({ ...variable, baseType: undefined }), /is required unless its cardinality is record/],
      [
        withOutcome({ ...variable, value: [{ value: "1" }, { value: "2" }] }),
        /has the cardinality single and 2 values/,
      ],
      [withOutcome({ ...variable, value: [{ value: "one" }] }), /is not a float/],
      [withOutcome({ ...variable, value: [{ value: 1 }] }), /^A value of the outcome variable "V" must be a string/],
      [withOutcome({ ...variable, value: "1" }), /^The value of the outcome variable "V" must be an array/],
      [withOutcome({ ...variable, view: ["everyone"] }), /^A view of the outcome variable "V" must be one of/],
      [
        withOutcome({ ...variable, normalMaximum: "1" }),
        /^The normalMaximum of the outcome variable "V" must be a number/,
      ],
      [withOutcome({ ...variable, cardinality: "record", value: [{ value: "1" }] }), /^The fieldIdentifier of a field/],
      [
        withOutcome({ ...variable, cardinality: "record", value: [{ fieldIdentifier: "f", value: "1" }] }),
        /^The baseType of a field/,
      ],
      [
        withOutcome({
          ...variable,
          cardinality: "record",
          value: [{ fieldIdentifier: "f", baseType: "string", value: "" }],
        }),
        /cannot be an empty string/,
      ],
      [withOutcome(5), /^The outcome variables must be objects/],
      [
        { itemResult: [{ ...itemResult, responseVariables: [{ ...variable, candidateResponse: 5 }] }] },
        /^The candidateResponse of the response variable "V"/,
      ],
      [
        {
          itemResult: [
            { ...itemResult, responseVariables: [{ ...variable, candidateResponse: {}, choiceSequence: [5] }] },
          ],
        },
        /^A choice of the response variable "V" must be a string/,
      ],
      [
        {
          itemResult: [
            { ...itemResult, responseVariables: [{ ...variable, candidateResponse: {}, correctResponse: 5 }] },
          ],
        },
        /^The correctResponse of the response variable/,
      ],
    ];
    for (const [result, message] of rejects) {
      expect(() => assessmentResultFromJson(result), JSON.stringify(result)).toThrow(message);
    }
    expect(() => assessmentResultToJson(json("null"))).toThrow(DataError);
    expect(() => assessmentResultToJson(json('{"context":{},"itemResults":"x"}'))).toThrow(DataError);
  });

  it("[C8] reads an item stage with absent or null fields as the stage that ends the session", () => {
    expect(itemStageFromJson({}, "stage")).toEqual({ itemIdentifiers: null, stageLength: null });
    expect(itemStageFromJson({ itemIdentifiers: null, stageLength: null }, "stage")).toEqual({
      itemIdentifiers: null,
      stageLength: null,
    });
    expect(itemStageFromJson({ itemIdentifiers: ["a"], stageLength: 1 }, "stage")).toEqual({
      itemIdentifiers: ["a"],
      stageLength: 1,
    });
    expect(() => itemStageFromJson({ stageLength: -1 }, "stage")).toThrow(/^The stageLength of the stage/);
    expect(() => itemStageFromJson(json("[]"), "stage")).toThrow(DataError);
  });
});

describe("CatPort", () => {
  it("[C1][C2][C7][U10] deploys the section data of the files, and the pool Get Section returns agrees with the section", async () => {
    const engine = new ScriptedEngine();
    const data = sectionData(selectionOf(), {
      settings: bytes("{}"),
      usageData: bytes("<usageData/>"),
      metadata: bytes("{}"),
    });
    const { sectionIdentifier } = await engine.createSection(PREFIX, data);
    const { sectionData: deployed, items } = await engine.getSection(PREFIX, sectionIdentifier);
    expect(engine.calls[0]).toEqual([
      "createSection",
      PREFIX,
      { sectionConfiguration: "e30=", qtiUsagedata: "PHVzYWdlRGF0YS8+", qtiMetadata: "e30=" },
    ]);
    expect(deployed).toBe(data);
    expect(checkPool(SAMPLE, items)).toEqual([]);
  });

  it("[C3][C4][C5][C6][C8] runs the shortest session of CAT §4.2: one stage, one Submit Results that ends it", async () => {
    const engine = new ScriptedEngine();
    const created = await engine.createSession(PREFIX, "S1", {});
    expect(isSessionEnd(created.nextItems)).toBe(false);
    const answered = await engine.submitResults(PREFIX, "S1", created.sessionIdentifier, {
      assessmentResult: MINIMAL_REPORT,
      sessionState: created.sessionState,
    });
    expect(isSessionEnd(answered.nextItems)).toBe(true);
    await engine.endSession(PREFIX, "S1", created.sessionIdentifier);
    await engine.endSection(PREFIX, "S1");
    expect(engine.calls).toEqual([
      ["createSession", PREFIX, "S1", {}],
      ["submitResults", PREFIX, "S1", "T1"],
      ["endSession", PREFIX, "S1", "T1"],
      ["endSection", PREFIX, "S1"],
    ]);
    expect(engine.submitted[0]?.sessionState).toBe("state-1");
  });

  it("[C9][G21] carries the typed Assessment Result of the minimal report unchanged: the JSON form is a codec apart", async () => {
    const engine = new ScriptedEngine();
    await engine.submitResults(PREFIX, "S1", "T1", { assessmentResult: MINIMAL_REPORT });
    expect(engine.submitted[0]?.assessmentResult).toBe(MINIMAL_REPORT);
  });

  it("[C9][G21] makes the minimal report a Results Reporting document with the variables CAT §4.3.1 requires", () => {
    const report = readResults(writeResults(MINIMAL_REPORT));
    const [answered, skipped] = report.itemResults;
    expect(answered?.variables.map(({ identifier }) => identifier)).toEqual([
      "numAttempts",
      "duration",
      "completionStatus",
      "SCORE",
    ]);
    expect(answered?.variables.at(-1)).toMatchObject({ cardinality: "single", baseType: "float" });
    expect(skipped).toMatchObject({ sequenceIndex: 2, sessionStatus: "initial", variables: [] });
  });
});

describe("sectionData", () => {
  // RFC 4648 §10 test vectors, which CAT §1.5 names as its base64 variant.
  it.each([
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ])("[C7] encodes the settings file %j as the base64 %j of RFC 4648 §10", (text, expected) => {
    const data = sectionData(selectionOf(), { settings: bytes(text), usageData: bytes(""), metadata: bytes("") });
    expect(data.sectionConfiguration).toBe(expected);
  });

  it("[C7] encodes every byte value, with the digits + and / and the padding of the end", () => {
    const all = Uint8Array.from({ length: 256 }, (_, value) => value);
    const data = sectionData(selectionOf(), { settings: all, usageData: bytes(""), metadata: bytes("") });
    expect(data.sectionConfiguration).toBe(Buffer.from(all).toString("base64"));
  });

  it("[C7] gives the section data of CAT §4.1: the three fields, each the base64 of the file", () => {
    const data = sectionData(selectionOf(), { settings: bytes("S"), usageData: bytes("U"), metadata: bytes("M") });
    expect(data).toEqual({ sectionConfiguration: "Uw==", qtiUsagedata: "VQ==", qtiMetadata: "TQ==" });
  });

  it("[U10] sends the usage data file when the selection has a qti-usagedata-ref (CAT §2.2)", () => {
    const usage = bytes('<usageData xmlns="http://www.imsglobal.org/xsd/imsqti_usagedata_v3p0"/>');
    const selection = selectionOf(
      `${REFS.split("\n")[0]}<qti-usagedata-ref identifier="usagedata" href="usagedata.xml"/>`,
    );
    const data = sectionData(selection, { settings: bytes("S"), usageData: usage });
    expect(Buffer.from(data.qtiUsagedata ?? "", "base64")).toEqual(Buffer.from(usage));
    expect(data).not.toHaveProperty("qtiMetadata");
  });

  it("[C7] sends no usage data or metadata when the selection references none (CAT §4.1: otherwise omitted)", () => {
    const selection = selectionOf('<qti-adaptive-engine-ref identifier="engine" href="http://example.org/engine"/>');
    expect(sectionData(selection, { settings: bytes("S") })).toEqual({ sectionConfiguration: "Uw==" });
  });

  it("[C7] sends the settings file whether or not the selection references it, because Section Data requires it", () => {
    const selection = selectionOf('<qti-adaptive-engine-ref identifier="engine" href="http://example.org/engine"/>');
    expect(selection.adaptiveSettingsRef).toBeUndefined();
    expect(sectionData(selection, { settings: bytes("") }).sectionConfiguration).toBe("");
  });

  it("[U10][C7] throws a DataError for a referenced file that is missing and for a file that nothing references", () => {
    const withUsage = selectionOf(
      `<qti-adaptive-engine-ref identifier="e" href="e"/><qti-usagedata-ref identifier="u" href="u.xml"/>`,
    );
    const withMetadata = selectionOf(
      `<qti-adaptive-engine-ref identifier="e" href="e"/><qti-metadata-ref identifier="m" href="m.json"/>`,
    );
    const bare = selectionOf('<qti-adaptive-engine-ref identifier="e" href="e"/>');
    const settings = bytes("S");
    expect(() => sectionData(withUsage, { settings })).toThrow(
      "The selection has a qti-usagedata-ref, so the file usageData is required (CAT §4.1), found nothing.",
    );
    expect(() => sectionData(withMetadata, { settings })).toThrow(
      "The selection has a qti-metadata-ref, so the file metadata is required",
    );
    expect(() => sectionData(bare, { settings, usageData: bytes("U") })).toThrow(
      "The selection has no qti-usagedata-ref, so the file usageData must be omitted (CAT §4.1), found an object.",
    );
    expect(() => sectionData(bare, { settings, metadata: bytes("M") })).toThrow(
      "The selection has no qti-metadata-ref, so the file metadata must be omitted",
    );
  });

  it("[C7] throws a DataError for arguments of other types", () => {
    const settings = bytes("S");
    expect(() => sectionData(json("null"), { settings })).toThrow("The selection must be an object, found null.");
    expect(() => sectionData(json('{"kind":"selection"}'), { settings })).toThrow(
      'The selection must be a qti-adaptive-selection, found the kind "selection".',
    );
    expect(() => sectionData(selectionOf(), json("null"))).toThrow("The files must be an object, found null.");
    expect(() => sectionData(selectionOf(), json("{}"))).toThrow(
      "The file settings must be a Uint8Array, found undefined.",
    );
    expect(() => sectionData(selectionOf(), json('{"settings":"{}"}'))).toThrow(
      'The file settings must be a Uint8Array, found "{}".',
    );
    expect(() => sectionData(selectionOf(), { settings, usageData: json("null"), metadata: bytes("") })).toThrow(
      "The file usageData must be a Uint8Array, found null.",
    );
    expect(() => sectionData(selectionOf(), { settings, usageData: bytes(""), metadata: json('"m"') })).toThrow(
      'The file metadata must be a Uint8Array, found "m".',
    );
    expect(() =>
      sectionData(json('{"kind":"adaptive-selection","usagedataRef":5}'), { settings, usageData: bytes("") }),
    ).toThrow("The qti-usagedata-ref of the selection must be an object, found 5.");
  });
});

describe("properties", () => {
  it("[C7] encodes any bytes as the base64 of the Node.js implementation, in a size that grows by four thirds", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (content) => {
        const { sectionConfiguration } = sectionData(
          selectionOf('<qti-adaptive-engine-ref identifier="e" href="e"/>'),
          { settings: content },
        );
        expect(sectionConfiguration).toBe(Buffer.from(content).toString("base64"));
        expect(sectionConfiguration.length).toBe(Math.ceil(content.length / 3) * 4);
      }),
    );
  });

  it("[C7] encodes a file of several megabytes", () => {
    const large = Uint8Array.from({ length: 5_000_001 }, (_, index) => (index * 31) % 251);
    const { sectionConfiguration } = sectionData(selectionOf('<qti-adaptive-engine-ref identifier="e" href="e"/>'), {
      settings: large,
    });
    expect(sectionConfiguration).toBe(Buffer.from(large).toString("base64"));
  });

  const identifiers = fc.array(fc.constantFrom("a", "b", "c", "d", "e", "f"), { maxLength: 8 });

  it("[C2] reports exactly the identifiers that one side lists and the other does not", () => {
    fc.assert(
      fc.property(identifiers, identifiers, (listed, pooled) => {
        const issues = checkPool(sectionOf("", itemRefs(listed)), { itemIdentifiers: pooled });
        const missingFromPool = new Set(listed.filter((identifier) => !pooled.includes(identifier)));
        const missingFromSection = new Set(pooled.filter((identifier) => !listed.includes(identifier)));
        expect(issues.filter(({ code }) => code === "olah/cat/item-not-in-pool")).toHaveLength(missingFromPool.size);
        expect(issues.filter(({ code }) => code === "olah/cat/item-not-in-section")).toHaveLength(
          missingFromSection.size,
        );
      }),
    );
  });

  it("[C8] ends the session exactly when a stage lists no item", () => {
    const stage = fc.record(
      {
        itemIdentifiers: fc.option(fc.array(fc.string({ maxLength: 4 }), { maxLength: 3 }), { nil: undefined }),
        stageLength: fc.option(fc.nat(5), { nil: undefined }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(stage, (value) => {
        expect(isSessionEnd(value)).toBe((value.itemIdentifiers ?? []).length === 0);
      }),
    );
  });

  it("[C11] gives JSON that keeps the identifiers and the interactions of any QTI metadata", () => {
    fc.assert(
      fc.property(fc.array(qtiMetadata, { maxLength: 4 }), (metadata) => {
        const items = metadata.map((entry, index) => ({ identifier: `item${index}`, metadata: entry }));
        const parsed = JSON.parse(JSON.stringify(catMetadata(items)));
        expect(parsed.itemMetadata.map((item: { identifier: string }) => item.identifier)).toEqual(
          items.map(({ identifier }) => identifier),
        );
        expect(parsed.itemMetadata.map((item: { interactionType: string[] }) => item.interactionType)).toEqual(
          metadata.map(({ interactionTypes }) => interactionTypes),
        );
      }),
    );
  });
});
