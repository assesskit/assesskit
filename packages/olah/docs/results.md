# Results

`results` reads and writes Results Reporting (RR): the report on a candidate's session, with the test result, the result of
each item instance and every variable. It imports `xml` and `values` and runs in any JavaScript runtime.

| Export                                                                                                                  | Purpose                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readResults(input)`                                                                                                    | Reads text, bytes or a parsed element into an `AssessmentResult`.                                                                                         |
| `writeResults(result)`                                                                                                  | Writes an `AssessmentResult` as a document that the RR schema accepts.                                                                                    |
| `RESULTS_NAMESPACE`                                                                                                     | The namespace of the RR schema.                                                                                                                           |
| `AssessmentResult`, `ResultContext`, `TestResult`, `ItemResult`, `SessionIdentifier`, `SupportUse`                      | The model.                                                                                                                                                |
| `ResultVariable`, `ResponseVariable`, `OutcomeVariable`, `TemplateVariable`, `ContextVariable`, `ResultCorrectResponse` | The variables.                                                                                                                                            |
| `SessionStatus`, `AnsweredStatus`, `ScoreStatus`, `SupportAssignment`, `OutcomeView`, `OutcomeScorer`                   | The vocabularies, with the lists `SESSION_STATUSES`, `ANSWERED_STATUSES`, `SCORE_STATUSES`, `SUPPORT_ASSIGNMENTS`, `OUTCOME_VIEWS` and `OUTCOME_SCORERS`. |

## Example

```ts
import { readResults, writeResults } from "@luthfanwakan/olah/results";

const result = readResults(`<assessmentResult xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0">
  <context sourcedId="johnsmith1"/>
  <itemResult identifier="Q01" sequenceIndex="1" datestamp="2020-08-25T18:18:40" sessionStatus="final">
    <responseVariable identifier="RESPONSE" cardinality="single" baseType="identifier" choiceSequence="D B C A">
      <correctResponse><value>A</value></correctResponse>
      <candidateResponse><value>B</value></candidateResponse>
    </responseVariable>
    <outcomeVariable identifier="SCORE" cardinality="single" baseType="float"><value>0</value></outcomeVariable>
  </itemResult>
</assessmentResult>`);

result.itemResults[0]?.sessionStatus; // "final"
result.itemResults[0]?.variables[0];
// {
//   kind: "response", identifier: "RESPONSE", cardinality: "single", baseType: "identifier",
//   correctResponse: { value: { cardinality: "single", baseType: "identifier", value: "A" } },
//   candidateResponse: { cardinality: "single", baseType: "identifier", value: "B" },
//   choiceSequence: ["D", "B", "C", "A"], extensions: []
// }

writeResults({ context: { sessionIdentifiers: [] }, itemResults: [] });
// <?xml version="1.0" encoding="UTF-8"?>
// <assessmentResult xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqti_result_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_resultv3p0_v1p0.xsd" xmlns="http://www.imsglobal.org/xsd/imsqti_result_v3p0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><context/></assessmentResult>
```

## Model

| Type                                  | Fields                                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AssessmentResult`                    | `context`, `testResult?`, `itemResults`                                                                                                                                                                                                          |
| `ResultContext`                       | `sourcedId?`, `sessionIdentifiers`: `{ sourceId, identifier }[]`                                                                                                                                                                                 |
| `TestResult`                          | `identifier`, `datestamp`, `variables`, `supports`                                                                                                                                                                                               |
| `ItemResult`                          | `identifier`, `sequenceIndex?`, `datestamp`, `sessionStatus`, `variables`, `candidateComment?`, `supports`                                                                                                                                       |
| `SupportUse`                          | `name`, `assignment`, `value?`, `language?`                                                                                                                                                                                                      |
| `ResponseVariable`                    | `kind: "response"`, `identifier`, `cardinality`, `baseType?`, `correctResponse?`, `candidateResponse`, `choiceSequence?`, `scoreStatus?`, `answeredStatus?`, `extensions`                                                                        |
| `OutcomeVariable`                     | `kind: "outcome"`, `identifier`, `cardinality`, `baseType?`, `value`, `view?`, `interpretation?`, `longInterpretation?`, `normalMaximum?`, `normalMinimum?`, `masteryValue?`, `externalScored?`, `variableIdentifierRef?`, `outcomeInformation?` |
| `TemplateVariable`, `ContextVariable` | `kind: "template"` or `"context"`, `identifier`, `cardinality`, `baseType?`, `value`                                                                                                                                                             |

- A value is a `Value` of `values`, or `null` for NULL. `candidateResponse` and `value` are never `undefined`.
- The variables of a result keep the order of the document, because the schema lets the four kinds mix.
- An optional field the document leaves out is absent from the model, never `undefined`.
- `datestamp` is an `xs:dateTime` with a four-digit year, such as `2020-08-25T18:19:20`; olah never reads a clock, so
  the caller supplies it.
- `extensions` and `outcomeInformation` hold elements of other namespaces as `XmlElement`s, the only places the schema
  allows them (S14). An element read by `parseXml` keeps its `line` and `column`.

## Rules

| Rule                                                                                                                                                                                        | Source                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `context` is required, so `writeResults` always writes it, empty when nothing is known. A report is never placed in a package.                                                              | RR §2.3.1, BIND §7     |
| A variable has a `cardinality` and, except for a record, a `baseType`. A record's `value` elements name their field and base type; any other `value` has neither.                           | RR §2.4.3, RR §2.6.6   |
| A value is read and written in the lexical form of its base type ([values](values.md)). No `value` element is NULL, and so is an empty `string`. A single variable has at most one `value`. | INFO §8.13, INFO §8.16 |
| A `file` is written as its reference alone and reads back with the content type `application/octet-stream`; the host keeps the bytes.                                                       | D7, G10                |
| A `duration` is written as seconds. It is read as seconds, or as an ISO 8601 duration without years and months, which 1EdTech's `conformance-use-case-1.xml` writes.                        | INFO §8.13, G14        |
| A `value` is an `xs:normalizedString`: olah writes it as given, so a consumer that applies the schema reads a newline in an essay as a space.                                               | G36                    |
| An integer outside the safe integers is a `ReadError`.                                                                                                                                      | D3                     |
| The namespace is strict: a root in another namespace is a `ReadError`. The writer names the schema in `xsi:schemaLocation`.                                                                 | D6                     |
| The reader refuses an attribute, element or text that the schema does not define at that place, so nothing in a document is dropped without notice.                                         | RR XSD                 |

## Vocabularies

| Type                | List                  | Terms                                                                                          | Source    |
| ------------------- | --------------------- | ---------------------------------------------------------------------------------------------- | --------- |
| `SessionStatus`     | `SESSION_STATUSES`    | `initial`, `pendingSubmission`, `pendingResponseProcessing`, `pendingExternalScoring`, `final` | RR §2.7.7 |
| `AnsweredStatus`    | `ANSWERED_STATUSES`   | `answered`, `attempted`, `presented`, `notpresented`                                           | RR §2.7.1 |
| `ScoreStatus`       | `SCORE_STATUSES`      | `notscored`, `scored`                                                                          | RR §2.7.6 |
| `SupportAssignment` | `SUPPORT_ASSIGNMENTS` | `assigned`, `inherit`, `prohibited`, `universal`                                               | RR §2.7.2 |
| `OutcomeView`       | `OUTCOME_VIEWS`       | `author`, `candidate`, `proctor`, `scorer`, `testConstructor`, `tutor`                         | RR XSD    |
| `OutcomeScorer`     | `OUTCOME_SCORERS`     | `externalMachine`, `human`                                                                     | RR XSD    |

## Errors

`readResults` throws `ReadError`; its `issues` hold one issue with the code, the rule, the line and column, and the element
path, such as `assessmentResult/itemResult`. `writeResults` throws `DataError` for a model that is not a result: a field of
the wrong type, an identifier that is not one, a date that is not an `xs:dateTime`, a value that is not of the type its
variable declares, a term outside its vocabulary, or text with a character that XML 1.0 does not allow.

| Code                                | Meaning                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `olah/results/not-results`          | The root is not `assessmentResult` of the RR namespace.                               |
| `olah/results/missing-attribute`    | A required attribute is missing, such as `datestamp`, or `baseType` outside a record. |
| `olah/results/invalid-attribute`    | An attribute is not valid: an identifier, a date, a number or a term.                 |
| `olah/results/unexpected-attribute` | An attribute that the schema does not define at that element.                         |
| `olah/results/missing-element`      | A required element is missing, such as `context` or `candidateResponse`.              |
| `olah/results/unexpected-element`   | An element that the schema does not allow at that place.                              |
| `olah/results/repeated-element`     | Several values for a single variable.                                                 |
| `olah/results/unexpected-text`      | Text in an element that contains elements only.                                       |
| `olah/results/invalid-value`        | A `value` that is not of its base type, or a record that repeats a field.             |
