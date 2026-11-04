import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runGuideSamples } from "../../../scripts/guide-samples.js";
import {
  type AssessmentResult,
  buildContainer,
  buildRecord,
  buildSingle,
  DataError,
  type ItemResult,
  RESULTS_NAMESPACE,
  readResults,
  writeResults,
  XSI_NAMESPACE,
} from "../src/index.js";
import { assessmentResult } from "./arbitraries/results.js";
import { withoutPositions } from "./arbitraries/xml.js";
import { fuzzReader } from "./fuzz.js";
import { issueOf } from "./read-failure.js";

const SCHEMA_LOCATION = `${RESULTS_NAMESPACE} https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_resultv3p0_v1p0.xsd`;
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';
const DATESTAMP = "2020-08-25T18:19:20";

/** Parses JSON text, which is how plain JavaScript passes a value of the wrong type. */
function json<T = never>(text: string): T {
  return JSON.parse(text);
}

/** Returns a value that the test knows is not NULL. */
function nonNull<T>(value: T | null): T {
  if (value === null) throw new Error("The test builds a NULL.");
  return value;
}

/** A document with an empty context and the given body. */
const report = (body = "", context = "<context/>"): string =>
  `<assessmentResult xmlns="${RESULTS_NAMESPACE}">${context}${body}</assessmentResult>`;

/** The item result of a document whose body is one item result. */
function itemResult(
  inner: string,
  attributes = `identifier="Q1" datestamp="${DATESTAMP}" sessionStatus="final"`,
): ItemResult {
  const [first] = readResults(report(`<itemResult ${attributes}>${inner}</itemResult>`)).itemResults;
  if (first === undefined) throw new Error("The document has no item result.");
  return first;
}

/** A document with the given variable in an item result. */
const withVariable = (variable: string): string =>
  report(`<itemResult identifier="Q1" datestamp="${DATESTAMP}" sessionStatus="final">${variable}</itemResult>`);

/** The text that `writeResults` writes for a result with only these item results. */
function written(itemResults: readonly ItemResult[]): string {
  return writeResults({ context: { sessionIdentifiers: [] }, itemResults });
}

const item = (fields: Partial<ItemResult> = {}): ItemResult => ({
  identifier: "Q1",
  datestamp: DATESTAMP,
  sessionStatus: "final",
  variables: [],
  supports: [],
  ...fields,
});

describe("reading results", () => {
  it("reads the context with its candidate and sessions", () => {
    const result = readResults(
      report(
        "",
        '<context sourcedId="johnsmith1"><sessionIdentifier sourceID="http://www.imsglobal.org/" identifier="EXAMPLE"/><sessionIdentifier sourceID="urn:b" identifier="S2"/></context>',
      ),
    );
    expect(result).toEqual({
      context: {
        sourcedId: "johnsmith1",
        sessionIdentifiers: [
          { sourceId: "http://www.imsglobal.org/", identifier: "EXAMPLE" },
          { sourceId: "urn:b", identifier: "S2" },
        ],
      },
      itemResults: [],
    });
  });

  it("reads a context that knows nothing, which the schema still requires", () => {
    expect(readResults(report())).toEqual({ context: { sessionIdentifiers: [] }, itemResults: [] });
  });

  it("reads a test result with its variables and supports", () => {
    const result = readResults(
      report(
        `<testResult identifier="SAMPLE" datestamp="${DATESTAMP}"><responseVariable identifier="duration" cardinality="single" baseType="duration"><candidateResponse><value>100</value></candidateResponse></responseVariable><outcomeVariable identifier="SCORE" cardinality="single" baseType="float"><value>0</value></outcomeVariable><support name="spoken" assignment="assigned"/></testResult>`,
      ),
    );
    expect(result.testResult).toEqual({
      identifier: "SAMPLE",
      datestamp: DATESTAMP,
      variables: [
        {
          kind: "response",
          identifier: "duration",
          cardinality: "single",
          baseType: "duration",
          candidateResponse: buildSingle("duration", 100),
          extensions: [],
        },
        {
          kind: "outcome",
          identifier: "SCORE",
          cardinality: "single",
          baseType: "float",
          value: buildSingle("float", 0),
        },
      ],
      supports: [{ name: "spoken", assignment: "assigned" }],
    });
  });

  it("reads an item result with its attributes, in the order of the document", () => {
    const result = readResults(
      report(
        `<itemResult identifier="Q01" sequenceIndex="1" datestamp="${DATESTAMP}" sessionStatus="final"/><itemResult identifier="Q01" sequenceIndex="1" datestamp="2020-08-25T18:19:21" sessionStatus="pendingSubmission"/>`,
      ),
    );
    expect(result.itemResults).toEqual([
      {
        identifier: "Q01",
        sequenceIndex: 1,
        datestamp: DATESTAMP,
        sessionStatus: "final",
        variables: [],
        supports: [],
      },
      {
        identifier: "Q01",
        sequenceIndex: 1,
        datestamp: "2020-08-25T18:19:21",
        sessionStatus: "pendingSubmission",
        variables: [],
        supports: [],
      },
    ]);
  });

  it("keeps the four kinds of variable in the order of the document, because the schema lets them mix", () => {
    const { variables } = itemResult(
      '<outcomeVariable identifier="a" cardinality="single" baseType="integer"/><templateVariable identifier="b" cardinality="single" baseType="integer"/><responseVariable identifier="c" cardinality="single" baseType="integer"><candidateResponse/></responseVariable><contextVariable identifier="d" cardinality="single" baseType="integer"/>',
    );
    expect(variables.map(({ kind, identifier }) => [kind, identifier])).toEqual([
      ["outcome", "a"],
      ["template", "b"],
      ["response", "c"],
      ["context", "d"],
    ]);
  });

  it("reads a response variable with its choice order and statuses", () => {
    // The response variable of 1EdTech's results/report.xml.
    const [variable] = itemResult(
      '<responseVariable identifier="RESPONSE" cardinality="single" baseType="identifier" choiceSequence="D B C A" scoreStatus="scored" answeredStatus="answered"><correctResponse><value>A</value></correctResponse><candidateResponse><value>A</value></candidateResponse></responseVariable>',
    ).variables;
    expect(variable).toEqual({
      kind: "response",
      identifier: "RESPONSE",
      cardinality: "single",
      baseType: "identifier",
      choiceSequence: ["D", "B", "C", "A"],
      scoreStatus: "scored",
      answeredStatus: "answered",
      correctResponse: { value: buildSingle("identifier", "A") },
      candidateResponse: buildSingle("identifier", "A"),
      extensions: [],
    });
  });

  it("reads the interpretation of a correct response and its several values", () => {
    const [variable] = itemResult(
      '<responseVariable identifier="R" cardinality="multiple" baseType="identifier"><correctResponse interpretation="the odd ones"><value>A</value><value>C</value></correctResponse><candidateResponse/></responseVariable>',
    ).variables;
    expect(variable).toMatchObject({
      correctResponse: { interpretation: "the odd ones", value: buildContainer("multiple", "identifier", ["A", "C"]) },
      candidateResponse: null,
    });
  });

  it("reads the candidate response as NULL when it has no value, and as every cardinality otherwise", () => {
    const candidate = (cardinality: string, baseType: string, values: string): unknown => {
      const [variable] = itemResult(
        `<responseVariable identifier="R" cardinality="${cardinality}" baseType="${baseType}"><candidateResponse>${values}</candidateResponse></responseVariable>`,
      ).variables;
      return variable !== undefined && variable.kind === "response" ? variable.candidateResponse : undefined;
    };
    expect(candidate("single", "integer", "")).toBeNull();
    expect(candidate("single", "integer", "<value>5</value>")).toEqual(buildSingle("integer", 5));
    expect(candidate("multiple", "identifier", "<value>B</value><value>A</value><value>B</value>")).toEqual(
      buildContainer("multiple", "identifier", ["B", "A", "B"]),
    );
    expect(candidate("ordered", "point", "<value>1 2</value><value>3 4</value>")).toEqual(
      buildContainer("ordered", "point", [
        [1, 2],
        [3, 4],
      ]),
    );
  });

  it("reads the fields of a record by their identifiers and base types", () => {
    const [variable] = itemResult(
      '<responseVariable identifier="R" cardinality="record"><candidateResponse><value fieldIdentifier="x" baseType="integer">3</value><value fieldIdentifier="note" baseType="string">hi there</value></candidateResponse></responseVariable>',
    ).variables;
    expect(variable).toMatchObject({
      cardinality: "record",
      candidateResponse: buildRecord([
        ["x", nonNull(buildSingle("integer", 3))],
        ["note", nonNull(buildSingle("string", "hi there"))],
      ]),
    });
  });

  it("reads the attributes of an outcome variable that the declaration gives it", () => {
    const [variable] = itemResult(
      '<outcomeVariable identifier="SCORE" cardinality="single" baseType="float" view="candidate scorer" interpretation="the score" longInterpretation="http://example.com/score" normalMaximum="10" normalMinimum="0" masteryValue="6.5" external-scored="human" variable-identifier-ref="RESPONSE"><value>7</value></outcomeVariable>',
    ).variables;
    expect(variable).toEqual({
      kind: "outcome",
      identifier: "SCORE",
      cardinality: "single",
      baseType: "float",
      value: buildSingle("float", 7),
      view: ["candidate", "scorer"],
      interpretation: "the score",
      longInterpretation: "http://example.com/score",
      normalMaximum: 10,
      normalMinimum: 0,
      masteryValue: 6.5,
      externalScored: "human",
      variableIdentifierRef: "RESPONSE",
    });
  });

  it("keeps the elements of outcomeInformation as they are, and tells an empty one from a missing one", () => {
    const outcome = (inner: string): unknown =>
      itemResult(`<outcomeVariable identifier="O" cardinality="single" baseType="float">${inner}</outcomeVariable>`)
        .variables[0];
    expect(outcome("")).not.toHaveProperty("outcomeInformation");
    expect(outcome("<outcomeInformation/>")).toMatchObject({ outcomeInformation: [] });
    expect(
      withoutPositions(outcome('<outcomeInformation><x:note xmlns:x="urn:x">why</x:note></outcomeInformation>')),
    ).toMatchObject({
      outcomeInformation: [
        {
          kind: "element",
          namespace: "urn:x",
          name: "note",
          prefix: "x",
          children: [{ kind: "text", value: "why" }],
        },
      ],
    });
  });

  it("reads template and context variables with their values", () => {
    const { variables } = itemResult(
      '<templateVariable identifier="T" cardinality="single" baseType="integer"><value>4</value></templateVariable><contextVariable identifier="C" cardinality="ordered" baseType="string"><value>a</value><value>b</value></contextVariable>',
    );
    expect(variables).toEqual([
      {
        kind: "template",
        identifier: "T",
        cardinality: "single",
        baseType: "integer",
        value: buildSingle("integer", 4),
      },
      {
        kind: "context",
        identifier: "C",
        cardinality: "ordered",
        baseType: "string",
        value: buildContainer("ordered", "string", ["a", "b"]),
      },
    ]);
  });

  it("reads the lexical form of every base type", () => {
    const valueRead = (baseType: string, text: string): unknown => {
      const variable = itemResult(
        `<outcomeVariable identifier="O" cardinality="single" baseType="${baseType}"><value>${text}</value></outcomeVariable>`,
      ).variables[0];
      return variable !== undefined && variable.kind === "outcome" ? variable.value : undefined;
    };
    expect(valueRead("boolean", "1")).toEqual(buildSingle("boolean", true));
    expect(valueRead("integer", " +12 ")).toEqual(buildSingle("integer", 12));
    expect(valueRead("float", "1.5e2")).toEqual(buildSingle("float", 150));
    expect(valueRead("float", "-INF")).toEqual(buildSingle("float", Number.NEGATIVE_INFINITY));
    expect(valueRead("string", "  keeps  space ")).toEqual(buildSingle("string", "  keeps  space "));
    expect(valueRead("identifier", "choice_A")).toEqual(buildSingle("identifier", "choice_A"));
    expect(valueRead("uri", " http://a.b/c ")).toEqual(buildSingle("uri", "http://a.b/c"));
    expect(valueRead("point", "118 184")).toEqual(buildSingle("point", [118, 184]));
    expect(valueRead("pair", "W G1")).toEqual(buildSingle("pair", ["W", "G1"]));
    expect(valueRead("directedPair", "G1 W")).toEqual(buildSingle("directedPair", ["G1", "W"]));
    expect(valueRead("duration", "100")).toEqual(buildSingle("duration", 100));
  });

  it("reads a file value as a reference with the content type of unknown bytes", () => {
    const variable = itemResult(
      '<outcomeVariable identifier="O" cardinality="single" baseType="file"><value> uploads/essay.pdf </value></outcomeVariable>',
    ).variables[0];
    expect(variable).toMatchObject({
      value: { value: { reference: "uploads/essay.pdf", mimeType: "application/octet-stream" } },
    });
  });

  it("reads a duration as the ISO 8601 form that 1EdTech's own example writes", () => {
    const duration = (text: string): unknown =>
      itemResult(
        `<outcomeVariable identifier="O" cardinality="single" baseType="duration"><value>${text}</value></outcomeVariable>`,
      ).variables[0];
    expect(duration("PT2M0.049722S")).toMatchObject({ value: buildSingle("duration", 120.049722) });
    expect(duration("PT9.590316S")).toMatchObject({ value: buildSingle("duration", 9.590316) });
  });

  it("reads the empty string as NULL for a single value and keeps leading and trailing white space of a string", () => {
    const [variable] = itemResult(
      '<outcomeVariable identifier="O" cardinality="single" baseType="string"><value></value></outcomeVariable>',
    ).variables;
    expect(variable).toMatchObject({ value: null });
  });

  it("reads the comment of the candidate, which comes after the variables and before the supports", () => {
    const result = itemResult(
      '<outcomeVariable identifier="O" cardinality="single" baseType="float"/><candidateComment>The question was unclear.</candidateComment><support name="spoken" assignment="assigned"/>',
    );
    expect(result.candidateComment).toBe("The question was unclear.");
    expect(result.supports).toEqual([{ name: "spoken", assignment: "assigned" }]);
  });

  it("reads the supports used with their setting and language", () => {
    const { supports } = itemResult(
      '<support name="item-translation" assignment="inherit" value="ko" xml:lang="ko"/><support name="magnification" assignment="universal"/>',
    );
    expect(supports).toEqual([
      { name: "item-translation", assignment: "inherit", value: "ko", language: "ko" },
      { name: "magnification", assignment: "universal" },
    ]);
  });

  it("reads text, bytes and a parsed element", () => {
    const text = report();
    expect(readResults(new TextEncoder().encode(text))).toEqual(readResults(text));
  });

  it("ignores xsi:schemaLocation, which tells a schema processor where the schema is", () => {
    const text = `<assessmentResult xmlns="${RESULTS_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}" xsi:schemaLocation="${SCHEMA_LOCATION}"><context/></assessmentResult>`;
    expect(readResults(text)).toEqual({ context: { sessionIdentifiers: [] }, itemResults: [] });
  });

  it("keeps the elements of other namespaces after the candidate response, where the schema allows them", () => {
    const [variable] = itemResult(
      '<responseVariable identifier="R" cardinality="single" baseType="string"><candidateResponse/><x:trace xmlns:x="urn:x"/></responseVariable>',
    ).variables;
    expect(variable).toMatchObject({ extensions: [{ name: "trace", namespace: "urn:x" }] });
  });
});

describe("vocabularies", () => {
  const SessionStatuses = [
    "initial",
    "pendingSubmission",
    "pendingResponseProcessing",
    "pendingExternalScoring",
    "final",
  ];
  const AnsweredStatuses = ["answered", "attempted", "presented", "notpresented"];
  const ScoreStatuses = ["notscored", "scored"];
  const Assignments = ["assigned", "inherit", "prohibited", "universal"];

  /** An item result with a response variable and a support that carry the given terms. */
  const termsDocument = ({
    status = "final",
    answered = "answered",
    score = "scored",
    assignment = "assigned",
  } = {}): string =>
    report(
      `<itemResult identifier="Q" datestamp="${DATESTAMP}" sessionStatus="${status}"><responseVariable identifier="R" cardinality="single" baseType="integer" scoreStatus="${score}" answeredStatus="${answered}"><candidateResponse/></responseVariable><support name="s" assignment="${assignment}"/></itemResult>`,
    );

  it("accepts the five terms of SessionStatusEnum and no other", () => {
    for (const status of SessionStatuses)
      expect(readResults(termsDocument({ status })).itemResults[0]?.sessionStatus).toBe(status);
    for (const status of ["Final", "pending", "", "completed"]) {
      expect(issueOf(() => readResults(termsDocument({ status })))).toMatchObject({
        rule: "assesskit/results/invalid-attribute",
      });
    }
  });

  it("accepts the four terms of AnsweredStatusEnum and no other", () => {
    for (const answered of AnsweredStatuses) {
      const variable = readResults(termsDocument({ answered })).itemResults[0]?.variables[0];
      expect(variable).toMatchObject({ answeredStatus: answered });
    }
    expect(() => readResults(termsDocument({ answered: "skipped" }))).toThrow(
      'must be "answered", "attempted", "presented" or "notpresented", found "skipped"',
    );
  });

  it("accepts the two terms of ScoreStatusEnum and no other", () => {
    for (const score of ScoreStatuses) {
      const variable = readResults(termsDocument({ score })).itemResults[0]?.variables[0];
      expect(variable).toMatchObject({ scoreStatus: score });
    }
    expect(() => readResults(termsDocument({ score: "unmarked" }))).toThrow(
      'must be "notscored" or "scored", found "unmarked"',
    );
  });

  it("accepts the four terms of AssignmentEnum and no other", () => {
    for (const assignment of Assignments) {
      expect(readResults(termsDocument({ assignment })).itemResults[0]?.supports[0]).toEqual({ name: "s", assignment });
    }
    expect(() => readResults(termsDocument({ assignment: "required" }))).toThrow(
      'must be "assigned", "inherit", "prohibited" or "universal", found "required"',
    );
  });

  it("writes the terms of the vocabularies and refuses any other", () => {
    for (const sessionStatus of SessionStatuses)
      expect(written([item({ sessionStatus: json(JSON.stringify(sessionStatus)) })])).toContain(
        `sessionStatus="${sessionStatus}"`,
      );
    expect(() => written([item({ sessionStatus: json('"Final"') })])).toThrow(
      'The sessionStatus of the item result "Q1" must be "initial", "pendingSubmission", "pendingResponseProcessing", "pendingExternalScoring" or "final", found "Final".',
    );
    const withStatuses = (answeredStatus: string, scoreStatus: string, assignment: string): string =>
      written([
        item({
          variables: [
            {
              kind: "response",
              identifier: "R",
              cardinality: "single",
              baseType: "integer",
              candidateResponse: null,
              answeredStatus: json(JSON.stringify(answeredStatus)),
              scoreStatus: json(JSON.stringify(scoreStatus)),
              extensions: [],
            },
          ],
          supports: [{ name: "s", assignment: json(JSON.stringify(assignment)) }],
        }),
      ]);
    for (const answeredStatus of AnsweredStatuses)
      expect(withStatuses(answeredStatus, "scored", "assigned")).toContain(`answeredStatus="${answeredStatus}"`);
    for (const scoreStatus of ScoreStatuses)
      expect(withStatuses("answered", scoreStatus, "assigned")).toContain(`scoreStatus="${scoreStatus}"`);
    for (const assignment of Assignments)
      expect(withStatuses("answered", "scored", assignment)).toContain(`assignment="${assignment}"`);
    expect(() => withStatuses("skipped", "scored", "assigned")).toThrow(DataError);
    expect(() => withStatuses("answered", "unmarked", "assigned")).toThrow(DataError);
    expect(() => withStatuses("answered", "scored", "required")).toThrow(DataError);
  });

  it("accepts the six views and the two ways of external scoring, and no other", () => {
    const outcome = (attributes: string): unknown =>
      readResults(withVariable(`<outcomeVariable identifier="O" cardinality="single" baseType="float" ${attributes}/>`))
        .itemResults[0]?.variables[0];
    expect(outcome('view="author candidate proctor scorer testConstructor tutor"')).toMatchObject({
      view: ["author", "candidate", "proctor", "scorer", "testConstructor", "tutor"],
    });
    expect(outcome('external-scored="externalMachine"')).toMatchObject({ externalScored: "externalMachine" });
    expect(() => outcome('view="candidate reviewer"')).toThrow('A view must be "author", "candidate"');
    expect(() => outcome('external-scored="machine"')).toThrow('must be "externalMachine" or "human", found "machine"');
  });
});

describe("writing results", () => {
  it("always writes the context, empty when nothing is known, because the schema requires it", () => {
    expect(writeResults({ context: { sessionIdentifiers: [] }, itemResults: [] })).toBe(
      `${DECLARATION}<assessmentResult xsi:schemaLocation="${SCHEMA_LOCATION}" xmlns="${RESULTS_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}"><context/></assessmentResult>`,
    );
  });

  it("writes the example of RR in the order and with the attributes of the schema", () => {
    const text = writeResults({
      context: {
        sourcedId: "johnsmith1",
        sessionIdentifiers: [{ sourceId: "http://www.imsglobal.org/", identifier: "EXAMPLE" }],
      },
      testResult: { identifier: "SAMPLE", datestamp: DATESTAMP, variables: [], supports: [] },
      itemResults: [item({ sequenceIndex: 1, candidateComment: "unclear" })],
    });
    expect(text).toBe(
      `${DECLARATION}<assessmentResult xsi:schemaLocation="${SCHEMA_LOCATION}" xmlns="${RESULTS_NAMESPACE}" xmlns:xsi="${XSI_NAMESPACE}"><context sourcedId="johnsmith1"><sessionIdentifier sourceID="http://www.imsglobal.org/" identifier="EXAMPLE"/></context><testResult identifier="SAMPLE" datestamp="${DATESTAMP}"/><itemResult identifier="Q1" sequenceIndex="1" datestamp="${DATESTAMP}" sessionStatus="final"><candidateComment>unclear</candidateComment></itemResult></assessmentResult>`,
    );
  });

  it("writes a response variable with its choice order, correct response and candidate response", () => {
    const text = written([
      item({
        variables: [
          {
            kind: "response",
            identifier: "RESPONSE",
            cardinality: "multiple",
            baseType: "identifier",
            choiceSequence: ["D", "B", "A"],
            scoreStatus: "scored",
            answeredStatus: "answered",
            correctResponse: {
              interpretation: "the first two",
              value: nonNull(buildContainer("multiple", "identifier", ["A", "B"])),
            },
            candidateResponse: buildContainer("multiple", "identifier", ["B", "A"]),
            extensions: [],
          },
        ],
      }),
    ]);
    expect(text).toContain(
      '<responseVariable identifier="RESPONSE" cardinality="multiple" baseType="identifier" choiceSequence="D B A" scoreStatus="scored" answeredStatus="answered"><correctResponse interpretation="the first two"><value>A</value><value>B</value></correctResponse><candidateResponse><value>B</value><value>A</value></candidateResponse></responseVariable>',
    );
  });

  it("writes a NULL as a variable without value elements, and a record with the base type of each field", () => {
    const text = written([
      item({
        variables: [
          {
            kind: "response",
            identifier: "A",
            cardinality: "single",
            baseType: "string",
            candidateResponse: null,
            extensions: [],
          },
          {
            kind: "response",
            identifier: "B",
            cardinality: "record",
            candidateResponse: buildRecord([
              ["x", nonNull(buildSingle("integer", 3))],
              ["y", nonNull(buildSingle("string", "a<b"))],
            ]),
            extensions: [],
          },
        ],
      }),
    ]);
    expect(text).toContain(
      '<responseVariable identifier="A" cardinality="single" baseType="string"><candidateResponse/>',
    );
    expect(text).toContain(
      '<candidateResponse><value fieldIdentifier="x" baseType="integer">3</value><value fieldIdentifier="y" baseType="string">a&lt;b</value></candidateResponse>',
    );
  });

  it("writes an outcome variable with the attributes of its declaration, and outcomeInformation", () => {
    const text = written([
      item({
        variables: [
          {
            kind: "outcome",
            identifier: "SCORE",
            cardinality: "single",
            baseType: "float",
            value: buildSingle("float", 7),
            view: ["candidate", "scorer"],
            interpretation: "the score",
            longInterpretation: "http://example.com/score",
            normalMaximum: 10,
            normalMinimum: 0,
            masteryValue: 6.5,
            externalScored: "human",
            variableIdentifierRef: "RESPONSE",
            outcomeInformation: [],
          },
        ],
      }),
    ]);
    expect(text).toContain(
      '<outcomeVariable identifier="SCORE" cardinality="single" baseType="float" view="candidate scorer" interpretation="the score" longInterpretation="http://example.com/score" normalMaximum="10" normalMinimum="0" masteryValue="6.5" external-scored="human" variable-identifier-ref="RESPONSE"><value>7</value><outcomeInformation/></outcomeVariable>',
    );
  });

  it("writes template and context variables", () => {
    const text = written([
      item({
        variables: [
          {
            kind: "template",
            identifier: "T",
            cardinality: "single",
            baseType: "integer",
            value: buildSingle("integer", 4),
          },
          { kind: "context", identifier: "C", cardinality: "single", baseType: "integer", value: null },
        ],
      }),
    ]);
    expect(text).toContain(
      '<templateVariable identifier="T" cardinality="single" baseType="integer"><value>4</value></templateVariable><contextVariable identifier="C" cardinality="single" baseType="integer"/>',
    );
  });

  it("writes a file value as its reference alone, without its content type or name", () => {
    const file = buildSingle("file", {
      reference: "uploads/essay.pdf",
      mimeType: "application/pdf",
      fileName: "essay.pdf",
    });
    const text = written([
      item({ variables: [{ kind: "outcome", identifier: "F", cardinality: "single", baseType: "file", value: file }] }),
    ]);
    expect(text).toContain("<value>uploads/essay.pdf</value>");
    expect(text).not.toContain("pdf</value>essay");
    expect(text).not.toContain("application/pdf");
  });

  it("writes a duration as seconds and numbers so that they read back exactly", () => {
    const text = written([
      item({
        variables: [
          {
            kind: "outcome",
            identifier: "D",
            cardinality: "single",
            baseType: "duration",
            value: buildSingle("duration", 120.049722),
          },
          {
            kind: "outcome",
            identifier: "N",
            cardinality: "single",
            baseType: "float",
            value: buildSingle("float", Number.NaN),
          },
          {
            kind: "outcome",
            identifier: "Z",
            cardinality: "single",
            baseType: "float",
            value: buildSingle("float", -0),
          },
        ],
      }),
    ]);
    expect(text).toContain("<value>120.049722</value>");
    expect(text).toContain("<value>NaN</value>");
    expect(text).toContain("<value>-0</value>");
  });

  it("writes the newlines of an essay as they are, which a schema-aware consumer reads as spaces", () => {
    const essay = nonNull(buildSingle("string", "line one\nline two"));
    const text = written([
      item({
        variables: [{ kind: "outcome", identifier: "E", cardinality: "single", baseType: "string", value: essay }],
      }),
    ]);
    expect(text).toContain("<value>line one\nline two</value>");
    expect(readResults(text).itemResults[0]?.variables[0]).toMatchObject({ value: essay });
  });

  it("writes the supports used", () => {
    expect(
      written([item({ supports: [{ name: "item-translation", assignment: "inherit", value: "ko", language: "ko" }] })]),
    ).toContain('<support name="item-translation" assignment="inherit" value="ko" xml:lang="ko"/>');
  });

  it("writes elements of other namespaces after the candidate response", () => {
    const [extension] = (
      readResults(
        withVariable(
          '<responseVariable identifier="R" cardinality="single" baseType="string"><candidateResponse/><x:trace xmlns:x="urn:x"/></responseVariable>',
        ),
      ).itemResults[0]?.variables ?? []
    ).flatMap((variable) => (variable.kind === "response" ? variable.extensions : []));
    expect(extension).toBeDefined();
    const text = written([
      item({
        variables: [
          {
            kind: "response",
            identifier: "R",
            cardinality: "single",
            baseType: "string",
            candidateResponse: null,
            extensions: extension ? [extension] : [],
          },
        ],
      }),
    ]);
    expect(text).toContain('<candidateResponse/><x:trace xmlns:x="urn:x"/></responseVariable>');
  });
});

describe("errors", () => {
  it("refuses a root that is not assessmentResult of the RR namespace, naming the namespace and the position", () => {
    expect(issueOf(() => readResults('<usageData xmlns="urn:x"/>'))).toEqual({
      severity: "error",
      rule: "assesskit/results/not-results",
      message: `The root element must be assessmentResult in the namespace ${RESULTS_NAMESPACE}, found {urn:x}usageData.`,
      location: { line: 1, column: 1, element: "usageData" },
    });
    expect(() => readResults(`<result xmlns="${RESULTS_NAMESPACE}"/>`)).toThrow("found result.");
  });

  it("refuses an example of RR that is not well-formed", () => {
    expect(issueOf(() => readResults('<assessmentResult xmlns="x">\n<context>\n</assessmentResult>'))).toMatchObject({
      rule: "assesskit/xml/not-well-formed",
      location: { line: 3 },
    });
  });

  it("refuses a document without a context, which the schema requires", () => {
    expect(issueOf(() => readResults(`<assessmentResult xmlns="${RESULTS_NAMESPACE}"/>`))).toMatchObject({
      rule: "assesskit/results/missing-element",
      message: "The element assessmentResult needs the element context, found no more elements.",
    });
  });

  it("refuses a missing or malformed attribute with the element and the rule", () => {
    expect(issueOf(() => readResults(report('<itemResult identifier="Q" sessionStatus="final"/>')))).toMatchObject({
      rule: "assesskit/results/missing-attribute",
      message: "The element itemResult needs the attribute datestamp.",
      location: { element: "assessmentResult/itemResult" },
    });
    expect(() =>
      readResults(report(`<itemResult identifier="1Q" datestamp="${DATESTAMP}" sessionStatus="final"/>`)),
    ).toThrow('The attribute identifier of the element itemResult is invalid. The text "1Q" is not an identifier');
    expect(() =>
      readResults(report('<itemResult identifier="Q" datestamp="yesterday" sessionStatus="final"/>')),
    ).toThrow('The text "yesterday" is not a date and time such as 2020-08-25T18:19:20.');
    expect(() =>
      readResults(
        report(`<itemResult identifier="Q" sequenceIndex="1.5" datestamp="${DATESTAMP}" sessionStatus="final"/>`),
      ),
    ).toThrow("The attribute sequenceIndex of the element itemResult is invalid.");
  });

  it("refuses an integer beyond the safe integers", () => {
    expect(() =>
      readResults(
        report(
          `<itemResult identifier="Q" sequenceIndex="9007199254740993" datestamp="${DATESTAMP}" sessionStatus="final"/>`,
        ),
      ),
    ).toThrow("expected an integer from -9007199254740991 to 9007199254740991");
  });

  it("refuses an attribute, an element or text that the schema does not allow at that place", () => {
    expect(() =>
      readResults(report(`<itemResult identifier="Q" datestamp="${DATESTAMP}" sessionStatus="final" extra="1"/>`)),
    ).toThrow("The element itemResult has the attribute extra, which the schema does not define for it.");
    expect(() =>
      readResults(report('<testResult identifier="T" datestamp="2020-01-01T00:00:00"><itemResult/></testResult>')),
    ).toThrow("The element itemResult is not allowed in testResult at this place.");
    expect(() =>
      readResults(
        report(
          `<itemResult identifier="Q" datestamp="${DATESTAMP}" sessionStatus="final"><candidateComment>a</candidateComment><outcomeVariable identifier="O" cardinality="single" baseType="float"/></itemResult>`,
        ),
      ),
    ).toThrow("The element outcomeVariable is not allowed in itemResult at this place.");
    expect(() => readResults(report("loose text"))).toThrow(
      "The element assessmentResult has text, but it contains elements only.",
    );
  });

  it("refuses a response variable without a candidate response, which the schema requires", () => {
    expect(() =>
      readResults(withVariable('<responseVariable identifier="R" cardinality="single" baseType="string"/>')),
    ).toThrow("The element responseVariable needs the element candidateResponse, found no more elements.");
  });

  it("refuses a correct response without a value", () => {
    expect(() =>
      readResults(
        withVariable(
          '<responseVariable identifier="R" cardinality="single" baseType="string"><correctResponse/><candidateResponse/></responseVariable>',
        ),
      ),
    ).toThrow("The element correctResponse needs a value.");
  });

  it("refuses a variable without a base type unless it is a record", () => {
    expect(
      issueOf(() => readResults(withVariable('<outcomeVariable identifier="O" cardinality="single"/>'))),
    ).toMatchObject({
      rule: "assesskit/results/missing-attribute",
    });
    expect(() => readResults(withVariable('<outcomeVariable identifier="O" cardinality="record"/>'))).not.toThrow();
  });

  it("refuses a value that is not of its base type, several values for a single variable, and a repeated field", () => {
    const outcome = (cardinality: string, baseType: string, values: string): string =>
      withVariable(
        `<outcomeVariable identifier="O" cardinality="${cardinality}"${baseType === "" ? "" : ` baseType="${baseType}"`}>${values}</outcomeVariable>`,
      );
    expect(issueOf(() => readResults(outcome("single", "integer", "<value>five</value>")))).toMatchObject({
      rule: "assesskit/results/invalid-value",
    });
    expect(() => readResults(outcome("single", "boolean", "<value>maybe</value>"))).toThrow("is not a boolean");
    expect(() => readResults(outcome("single", "integer", "<value>1</value><value>2</value>"))).toThrow(
      "A variable of cardinality single has at most one value.",
    );
    expect(() => readResults(outcome("multiple", "string", "<value>a</value><value></value>"))).toThrow(
      "A container cannot hold an empty string, which is NULL.",
    );
    expect(() =>
      readResults(
        outcome(
          "record",
          "",
          '<value fieldIdentifier="x" baseType="integer">1</value><value fieldIdentifier="x" baseType="integer">2</value>',
        ),
      ),
    ).toThrow('A record cannot have the field "x" twice.');
    expect(() => readResults(outcome("record", "", "<value>1</value>"))).toThrow(
      "A value of a variable of cardinality record needs the attributes fieldIdentifier and baseType.",
    );
    expect(() => readResults(outcome("single", "integer", '<value baseType="integer">1</value>'))).toThrow(
      "A value of a variable that is not a record has no baseType: only the fields of a record have.",
    );
    expect(() => readResults(outcome("single", "duration", "<value>P1Y</value>"))).toThrow("years or months");
  });

  it("refuses an element inside a value", () => {
    expect(() =>
      readResults(
        withVariable(
          '<outcomeVariable identifier="O" cardinality="single" baseType="string"><value><b/></value></outcomeVariable>',
        ),
      ),
    ).toThrow("The element value has the element b, but it contains text only.");
  });

  it("refuses input that is not text, bytes or an element, and a model that is not a result", () => {
    expect(() => readResults(json("null"))).toThrow(DataError);
    expect(() => readResults(json("5"))).toThrow(
      "The results to read must be a string, a Uint8Array or an XmlElement, found 5.",
    );
    expect(() => writeResults(json("null"))).toThrow("The result must be an object, found null.");
    expect(() => writeResults(json("{}"))).toThrow("The context of a result must be an object, found undefined.");
    expect(() => writeResults(json('{"context":{"sessionIdentifiers":{}},"itemResults":[]}'))).toThrow(
      "The sessionIdentifiers of the context must be an array, found an object.",
    );
    expect(() => writeResults(json('{"context":{"sessionIdentifiers":[]},"itemResults":null}'))).toThrow(
      "The itemResults of the result must be an array, found null.",
    );
  });

  it("refuses a model with a field of the wrong type or outside its vocabulary", () => {
    const base = { context: { sessionIdentifiers: [] }, itemResults: [] } satisfies AssessmentResult;
    expect(() => writeResults({ ...base, context: { sourcedId: json("5"), sessionIdentifiers: [] } })).toThrow(
      DataError,
    );
    expect(() => writeResults({ ...base, context: { sourcedId: "1bad", sessionIdentifiers: [] } })).toThrow(
      'A value of base type identifier must be an identifier, found "1bad".',
    );
    expect(() => written([item({ datestamp: "2021-02-29T00:00:00" })])).toThrow(
      'The datestamp of the item result "Q1" must be a date and time such as 2020-08-25T18:19:20, found "2021-02-29T00:00:00".',
    );
    expect(() => written([item({ sequenceIndex: 1.5 })])).toThrow(DataError);
    expect(() => written([item({ variables: json('[{"kind":"other"}]') })])).toThrow(
      'The kind of a variable must be "response", "outcome", "template" or "context", found "other".',
    );
    expect(() => written([item({ variables: json("[5]") })])).toThrow("A variable must be an object, found 5.");
    expect(() => written([item({ candidateComment: json("5") })])).toThrow(DataError);
  });

  it("refuses a value that is not of the type its variable declares, and a type without a base type", () => {
    const variable = (cardinality: string, baseType: string | undefined, value: unknown): ItemResult =>
      item({ variables: json(JSON.stringify([{ kind: "template", identifier: "T", cardinality, baseType, value }])) });
    expect(() => written([variable("single", "float", buildSingle("integer", 1))])).toThrow(
      'The value of the template variable "T" is single integer, but the variable declares single float.',
    );
    expect(() => written([variable("multiple", "integer", buildSingle("integer", 1))])).toThrow(
      "declares multiple integer",
    );
    expect(() => written([variable("single", undefined, null)])).toThrow(
      'The base type of the template variable "T" is missing: only a variable of cardinality record may leave it out.',
    );
    expect(() =>
      written([variable("single", "integer", { cardinality: "single", baseType: "integer", value: "x" })]),
    ).toThrow(DataError);
    expect(() => written([variable("circle", "integer", null)])).toThrow(
      'The cardinality of the template variable "T" must be',
    );
  });

  it("refuses a correct response that is NULL", () => {
    const response = json<ItemResult["variables"]>(
      '[{"kind":"response","identifier":"R","cardinality":"single","baseType":"string","candidateResponse":null,"correctResponse":{"value":null},"extensions":[]}]',
    );
    expect(() => written([item({ variables: response })])).toThrow(
      'The correct response of the response variable "R" needs a value; it is never NULL.',
    );
  });

  it("refuses extensions that are not elements of another namespace", () => {
    const response = (extensions: string): ItemResult["variables"] =>
      json(
        `[{"kind":"response","identifier":"R","cardinality":"single","baseType":"string","candidateResponse":null,"extensions":${extensions}}]`,
      );
    expect(() =>
      written([
        item({ variables: response('[{"kind":"element","namespace":"","name":"x","attributes":[],"children":[]}]') }),
      ]),
    ).toThrow("must hold elements of a namespace other than the report's");
    expect(() => written([item({ variables: response("5") })])).toThrow(DataError);
  });

  it("refuses text that XML 1.0 cannot carry", () => {
    const text = nonNull(buildSingle("string", "bell\u0007"));
    expect(() =>
      written([
        item({
          variables: [{ kind: "outcome", identifier: "S", cardinality: "single", baseType: "string", value: text }],
        }),
      ]),
    ).toThrow("has the character U+0007, which XML 1.0 does not allow.");
  });
});

describe("the guide", () => {
  it("shows the results that its samples give", async () => {
    const guide = readFileSync(new URL("../../../docs/runtime/results.md", import.meta.url), "utf8");
    const results = await import("../src/results/index.js");
    expect(await runGuideSamples(guide, { "@assesskit/runtime/results": results })).toBeGreaterThan(0);
  });
});

describe("properties", () => {
  it("reads back the document that it writes", () => {
    fc.assert(
      fc.property(assessmentResult({ extensions: true }), (model) => {
        expect(withoutPositions(readResults(writeResults(model)))).toEqual(model);
      }),
      { numRuns: 300 },
    );
  });

  it("reads a mutated document or refuses it with a ReadError or a SecurityError, and throws nothing else", () => {
    fuzzReader(assessmentResult({ extensions: true }).map(writeResults), readResults);
  });

  it("writes the same text for a model that it has read as for the model it was read from", () => {
    fc.assert(
      fc.property(assessmentResult({ extensions: true }), (model) => {
        const text = writeResults(model);
        expect(writeResults(readResults(text))).toBe(text);
      }),
      { numRuns: 200 },
    );
  });
});
