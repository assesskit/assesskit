import fc from "fast-check";
import type {
  AssessmentResult,
  ContextVariable,
  ItemResult,
  OutcomeVariable,
  ResponseVariable,
  ResultContext,
  ResultVariable,
  SupportUse,
  TemplateVariable,
  TestResult,
} from "../../src/results/index.js";
import type { BaseType, Cardinality, Value } from "../../src/values/index.js";
import type { XmlElement } from "../../src/xml/index.js";
import {
  baseType,
  defined,
  double,
  identifier,
  optional,
  recordValue,
  safeInteger,
  text,
  uri,
  valueArbitrary,
} from "./values.js";
import { extensionElement } from "./xml.js";

const SESSION_STATUSES = [
  "initial",
  "pendingSubmission",
  "pendingResponseProcessing",
  "pendingExternalScoring",
  "final",
] as const;
const ANSWERED_STATUSES = ["answered", "attempted", "presented", "notpresented"] as const;
const SCORE_STATUSES = ["notscored", "scored"] as const;
const ASSIGNMENTS = ["assigned", "inherit", "prohibited", "universal"] as const;
const VIEWS = ["author", "candidate", "proctor", "scorer", "testConstructor", "tutor"] as const;
const EXTERNAL_SCORINGS = ["externalMachine", "human"] as const;

const pad = (value: number, length: number): string => String(value).padStart(length, "0");

/** An `xs:dateTime` that the RR schema accepts: four-digit year, optional fraction and time zone. */
const datestamp: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 1, max: 9999 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
    fraction: fc.option(
      fc.integer({ min: 0, max: 999 }).map((value) => `.${pad(value, 3)}`),
      { nil: "" },
    ),
    zone: fc.constantFrom("", "Z", "+01:00", "-05:30", "+14:00"),
  })
  .map(
    ({ year, month, day, hour, minute, second, fraction, zone }) =>
      `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}${fraction}${zone}`,
  );

/** A variable's type with two values of it, one for a response and one for its correct response. */
interface Typed {
  readonly cardinality: Cardinality;
  readonly baseType: BaseType | undefined;
  readonly value: Value | null;
  readonly other: Value | null;
}

const typed: fc.Arbitrary<Typed> = fc.oneof(
  fc
    .tuple(fc.constantFrom<"single" | "multiple" | "ordered">("single", "multiple", "ordered"), baseType)
    .chain(([cardinality, type]) =>
      fc
        .tuple(valueArbitrary(cardinality, type), valueArbitrary(cardinality, type))
        .map(([value, other]) => ({ cardinality, baseType: type, value, other })),
    ),
  fc
    .tuple(recordValue, recordValue)
    .map(([value, other]): Typed => ({ cardinality: "record", baseType: undefined, value, other })),
);

/**
 * Arbitrary results. `extensions` adds elements of another namespace where the schema's wildcards allow them; a schema that
 * does not know the namespace rejects those, so XSD tests leave them out.
 */
export function assessmentResult(options: { readonly extensions: boolean }): fc.Arbitrary<AssessmentResult> {
  const extensions: fc.Arbitrary<XmlElement[]> = options.extensions
    ? fc.array(extensionElement, { maxLength: 2 })
    : fc.constant([]);

  const responseVariable: fc.Arbitrary<ResponseVariable> = fc
    .record({
      identifier,
      typed,
      interpretation: optional(text),
      choiceSequence: optional(fc.array(identifier, { maxLength: 4 })),
      scoreStatus: optional(fc.constantFrom(...SCORE_STATUSES)),
      answeredStatus: optional(fc.constantFrom(...ANSWERED_STATUSES)),
      extensions,
    })
    .map(({ identifier: id, typed: type, interpretation, ...rest }) =>
      defined<ResponseVariable>({
        kind: "response",
        identifier: id,
        cardinality: type.cardinality,
        baseType: type.baseType,
        correctResponse: type.other === null ? undefined : defined({ interpretation, value: type.other }),
        candidateResponse: type.value,
        ...rest,
      }),
    );

  const outcomeVariable: fc.Arbitrary<OutcomeVariable> = fc
    .record({
      identifier,
      typed,
      view: optional(fc.uniqueArray(fc.constantFrom(...VIEWS), { maxLength: 3 })),
      interpretation: optional(text),
      longInterpretation: optional(uri),
      normalMaximum: optional(double),
      normalMinimum: optional(double),
      masteryValue: optional(double),
      externalScored: optional(fc.constantFrom(...EXTERNAL_SCORINGS)),
      variableIdentifierRef: optional(identifier),
      outcomeInformation: optional(extensions),
    })
    .map(({ typed: type, ...rest }) =>
      defined<OutcomeVariable>({
        kind: "outcome",
        ...rest,
        cardinality: type.cardinality,
        baseType: type.baseType,
        value: type.value,
      }),
    );

  const valuedVariable = (kind: "template" | "context"): fc.Arbitrary<TemplateVariable | ContextVariable> =>
    fc.record({ identifier, typed }).map(({ identifier: id, typed: type }) =>
      defined<TemplateVariable | ContextVariable>({
        kind,
        identifier: id,
        cardinality: type.cardinality,
        baseType: type.baseType,
        value: type.value,
      }),
    );

  const variables: fc.Arbitrary<ResultVariable[]> = fc.array(
    fc.oneof(responseVariable, outcomeVariable, valuedVariable("template"), valuedVariable("context")),
    { maxLength: 4 },
  );

  const support: fc.Arbitrary<SupportUse> = fc
    .record({
      name: identifier,
      assignment: fc.constantFrom(...ASSIGNMENTS),
      value: optional(text),
      language: optional(fc.constantFrom("en", "pt-BR", "ase", "")),
    })
    .map((fields) => defined<SupportUse>(fields));

  const supports = fc.array(support, { maxLength: 3 });

  const itemResult: fc.Arbitrary<ItemResult> = fc
    .record({
      identifier,
      sequenceIndex: optional(safeInteger),
      datestamp,
      sessionStatus: fc.constantFrom(...SESSION_STATUSES),
      variables,
      candidateComment: optional(text),
      supports,
    })
    .map((fields) => defined<ItemResult>(fields));

  const testResult: fc.Arbitrary<TestResult> = fc.record({ identifier, datestamp, variables, supports });

  const context: fc.Arbitrary<ResultContext> = fc
    .record({
      sourcedId: optional(identifier),
      sessionIdentifiers: fc.array(fc.record({ sourceId: uri, identifier }), { maxLength: 3 }),
    })
    .map((fields) => defined<ResultContext>(fields));

  return fc
    .record({ context, testResult: optional(testResult), itemResults: fc.array(itemResult, { maxLength: 3 }) })
    .map((fields) => defined<AssessmentResult>(fields));
}
