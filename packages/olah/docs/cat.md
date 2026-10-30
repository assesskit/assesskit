# CAT

`cat` is olah's side of computer adaptive testing (CAT 1.0), which QTI 3.0 references through `qti-adaptive-selection`: the
port to a CAT engine, the models of its requests and responses, the JSON form of the assessment result and the item stage,
the section data that configures a section, the check of its item pool and the metadata file. It imports `values`, `asi`,
`results` and `metadata` and runs in any JavaScript runtime. olah
makes no network request and implements no CAT algorithm: the host implements `CatPort`, for example over an IRT library
or over the REST API of CAT 1.0.

| Export                                                                                           | Purpose                                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `CatPort`                                                                                        | The six requests of a CAT engine, which the host implements.                                |
| `sectionData(selection, files)`                                                                  | Builds the `SectionData` of Create Section from the files of an adaptive section.           |
| `isSessionEnd(stage)`                                                                            | Tells whether a stage, or a missing one, ends the session.                                  |
| `checkPool(section, pool)`                                                                       | Compares the item references of an adaptive section with the pool that Get Section returns. |
| `catMetadata(items, options?)`                                                                   | Builds the metadata JSON of CAT Appendix B from the QTI metadata of the items.              |
| `assessmentResultToJson(result)`, `assessmentResultFromJson(json)`                               | Write and read an assessment result in the JSON of the public binding.                      |
| `itemStageFromJson(json, noun)`                                                                  | Reads an item stage of the binding.                                                         |
| `SectionData`, `ItemStage`, `PriorDataEntry`                                                     | The data types of CAT §4.                                                                   |
| `CreateSectionResponse`, `GetSectionResponse`                                                    | The answers to Create Section and Get Section.                                              |
| `CreateSessionRequest`, `CreateSessionResponse`, `SubmitResultsRequest`, `SubmitResultsResponse` | The bodies and answers of Create Session and Submit Results.                                |
| `CatResponse`                                                                                    | What the host answers to a request of the delivery engine.                                  |
| `SectionFiles`, `CatPoolItem`, `CatMetadataFile`, `CatMetadataOptions`                           | The arguments of `sectionData` and `catMetadata`.                                           |
| `CatMetadata`, `CatItemMetadata`, `CatExternalMetadata`                                          | The metadata JSON.                                                                          |

## Example

An adaptive section lists the items of the pool and names the files that configure it. `sectionData` turns the files into
the body of Create Section, and `checkPool` compares the section with the pool that the engine reports.

```ts
import { readAsi } from "@luthfanwakan/olah/asi";
import { catMetadata, checkPool, isSessionEnd, sectionData } from "@luthfanwakan/olah/cat";

const document = readAsi(`<qti-assessment-section xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="sec" title="Adaptive" visible="true">
  <qti-adaptive-selection>
    <qti-adaptive-engine-ref identifier="engine" href="http://example.org/engine"/>
    <qti-adaptive-settings-ref identifier="settings" href="settings.data"/>
    <qti-metadata-ref identifier="metadata" href="metadata.json"/>
  </qti-adaptive-selection>
  <qti-assessment-item-ref identifier="item434" href="item434.xml"/>
  <qti-assessment-item-ref identifier="item065" href="item065.xml"/>
</qti-assessment-section>`);

if (document.kind === "section") {
  const { section } = document;
  const { adaptiveSelection } = section;
  const metadata = catMetadata([
    {
      identifier: "item434",
      metadata: { interactionTypes: ["choiceInteraction"], scoringModes: ["responseprocessing"] },
    },
    { identifier: "item065", metadata: { interactionTypes: [], scoringModes: [] } },
  ]);
  JSON.stringify(metadata);
  // {"itemMetadata":[{"identifier":"item434","interactionType":["choiceInteraction"],"scoringMode":["responseprocessing"]},
  //   {"identifier":"item065","interactionType":[]}]}

  const encoder = new TextEncoder();
  if (adaptiveSelection !== undefined) {
    sectionData(adaptiveSelection, {
      settings: encoder.encode("{}"),
      metadata: encoder.encode(JSON.stringify(metadata)),
    });
    // { sectionConfiguration: "e30=", qtiMetadata: "eyJpdGVtTWV0YWRhdGEi..." }
  }

  checkPool(section, { itemIdentifiers: ["item434", "item999"] }).map(({ code }) => code);
  // ["olah/cat/item-not-in-pool", "olah/cat/item-not-in-section"]
}

isSessionEnd({ itemIdentifiers: ["item434"], stageLength: 1 }); // false
isSessionEnd({ itemIdentifiers: [] }); // true
isSessionEnd(null); // true
```

## The port

`CatPort` has one method for each endpoint of CAT §3. Every method takes `prefix` first: the URL prefix that
`qti-adaptive-engine-ref` gives. A document names the prefix, so the host checks it against the engines it trusts before it
sends a candidate's results there.

| Method                                                                 | Request                                | Spec | Made by                       |
| ---------------------------------------------------------------------- | -------------------------------------- | ---- | ----------------------------- |
| `createSection(prefix, data)`                                          | `POST {prefix}/sections`               | §3.1 | the host, once, at deployment |
| `getSection(prefix, sectionIdentifier)`                                | `GET {prefix}/sections/{id}`           | §3.2 | the host, to verify the pool  |
| `createSession(prefix, sectionIdentifier, request)`                    | `POST {prefix}/sections/{id}/sessions` | §3.3 | the delivery engine           |
| `submitResults(prefix, sectionIdentifier, sessionIdentifier, request)` | `POST …/sessions/{id}/results`         | §3.4 | the delivery engine           |
| `endSession(prefix, sectionIdentifier, sessionIdentifier)`             | `DELETE …/sessions/{id}`               | §3.5 | the delivery engine           |
| `endSection(prefix, sectionIdentifier)`                                | `DELETE /sections/{id}`                | §3.6 | the host                      |

- Create Section is not idempotent: the host makes it once and gives the returned identifier to the delivery definition.
- A missing `sessionState` in an answer means there is none. A stateless engine sends one, and the next Submit Results
  request returns it unchanged (CAT §3.3, §3.4).
- The port carries the typed `AssessmentResult` of [results](results.md). [JSON binding](#json-binding) writes and reads it in
  the form of the public binding. The binding declares `datestamp` as `format: date-time`, RFC 3339 with an offset, while an
  `xs:dateTime` of Results Reporting may lack one; the reports that the delivery engine builds always have `Z`.
- The HTTP client, access tokens, OAuth and HTTPS (CAT §5) are the adapter's concern.

## Section data

`sectionData(selection, files)` builds the body of Create Section (CAT §2.2, §4.1). Each field is the base64 (RFC 4648, with
padding) of the file that a reference of the `qti-adaptive-selection` names.

| Field                  | File              | Rule                                                                         |
| ---------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `sectionConfiguration` | `files.settings`  | Always sent, whether or not the selection has a `qti-adaptive-settings-ref`. |
| `qtiUsagedata`         | `files.usageData` | Sent when the selection has a `qti-usagedata-ref`, and only then.            |
| `qtiMetadata`          | `files.metadata`  | Sent when the selection has a `qti-metadata-ref`, and only then.             |

The files are bytes, which the host reads from the package or from wherever each `href` points. The usage data
is the XML of [usage](usage.md) (`writeUsageData`), whose statistics the engine may use as its item parameters. The metadata is
the JSON of `catMetadata`. A file that the selection does not reference, or a referenced file that is missing, is a
`DataError`.

## Item stages

An `ItemStage` lists the identifiers of the items to present, in order, and a `stageLength` hint: the number of items the
candidate should answer before the delivery engine submits (CAT §4.2). Get Section reports the whole pool as one stage.

`isSessionEnd(stage)` is true for a `null` or `undefined` stage, and for a stage that lists no item, whatever its
`stageLength`: CAT §3.4 ends the session by an omitted, `null` or empty `nextItems`, and §4.2 also by an empty list with a
`null` or zero length. An identifier may occur more than once; the delivery engine then instances the item as in a
selection with replacement. A stage that is not an object, whose identifiers are not strings or whose length is not a
non-negative integer or `null` is a `DataError`.

## Pool check

`checkPool(section, pool)` compares the `qti-assessment-item-ref` children of an adaptive section with the pool of Get
Section. The two lists must agree (CAT §2.1, §2.2). The result is empty, or has one error for each identifier that only one
side lists, first the item references and then the pool, each in list order.

| Code                           | Meaning                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `olah/cat/item-not-in-pool`    | The section lists an item that the pool lacks: the engine can never select it.                             |
| `olah/cat/item-not-in-section` | The pool has an item that the section does not list: the engine can select it, and it cannot be presented. |

An adaptive section has no nested sections (CAT §2.3), so only the item references that are children count. The section must
have its includes resolved, as `QtiPackage.document` has. An identifier counts once however often a side lists it.

## JSON binding

`assessmentResultToJson(result)` and `assessmentResultFromJson(json)` convert an assessment result to and from the JSON
of the public REST binding of CAT 1.0 (<https://www.imsglobal.org/spec/cat/v1p0/bind>, §5 and Appendix B1.2). The OpenAPI
files that the binding names do not serve, so its listing in Appendix B1.2 is the source of the field names.
`itemStageFromJson(json, noun)` reads an item stage; `noun` names it in the error message, such as `nextItems of the
answer`. The functions make no request: the adapter that talks to the engine owns the transport.

| olah                         | Binding                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `itemResults`                | `itemResult`                                                                                        |
| `variables` of a result      | `responseVariables`, `templateVariables`, `outcomeVariables`                                        |
| `SessionIdentifier.sourceId` | `sourceID`                                                                                          |
| A value                      | `value`: a list of `{ value }` in lexical form; a record's fields add `fieldIdentifier`, `baseType` |
| NULL                         | An empty `value` list                                                                               |

- **Left out.** The binding has no field for context variables, supports, `scoreStatus`, `answeredStatus`,
  `externalScored`, `variableIdentifierRef` and `outcomeInformation`, so `assessmentResultToJson` does not write them and
  `assessmentResultFromJson` leaves them empty.
- **Status.** The `sessionStatus` of the binding lacks `pendingExternalScoring`; it is written as
  `pendingResponseProcessing`.
- **Context.** An engine may leave out the context of the result it returns (CAT §4.3.2). The model requires one, so the
  result then has no session identifiers.
- **Order.** The three lists of variables are joined in the order responses, templates, outcomes.
- **Stage.** `itemIdentifiers` and `stageLength` may be absent or `null`, which is the stage that ends the session (CAT
  §4.2); they are read as `null`.

```ts
import { assessmentResultFromJson, assessmentResultToJson } from "@luthfanwakan/olah/cat";
import { single } from "@luthfanwakan/olah/values";

const result = {
  context: { sessionIdentifiers: [{ sourceId: "https://delivery.example", identifier: "s1" }] },
  itemResults: [
    {
      identifier: "q1",
      sequenceIndex: 1,
      datestamp: "2026-10-30T10:00:00Z",
      sessionStatus: "final" as const,
      variables: [
        {
          kind: "outcome" as const,
          identifier: "SCORE",
          cardinality: "single" as const,
          baseType: "float" as const,
          value: single("float", 1),
        },
      ],
      supports: [],
    },
  ],
};
const json = assessmentResultToJson(result);
assessmentResultFromJson(JSON.parse(JSON.stringify(json))).itemResults[0]?.identifier; // "q1"
```

## Metadata JSON

`catMetadata(items, options?)` builds the content of the file that `qti-metadata-ref` references, in the JSON binding of CAT
Appendix B. The appendix is non-normative. Write the result with `JSON.stringify` in UTF-8 and pass the bytes as
`files.metadata`.

| Binding field                                | From                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `itemMetadata[].identifier`                  | `CatPoolItem.identifier`, unique in the list.                                                       |
| `itemTemplate`, `timeDependent`, `composite` | The fields of `QtiMetadata` of that name.                                                           |
| `interactionType`                            | `interactionTypes`; an empty array says that the item has no interaction.                           |
| `feedbackType`, `solutionAvailable`          | The fields of that name.                                                                            |
| `scoringMode`                                | `scoringModes`; left out when empty.                                                                |
| `toolName`, `toolVersion`, `toolVendor`      | The fields of that name.                                                                            |
| `itemMetadata[].externalMetadata`            | `CatPoolItem.externalMetadata`: files with a `type` and their base64 `content`, left out when none. |
| `externalMetadata`                           | The option `externalMetadata`: the same for the section as a whole, left out when none.             |

A field that the QTI metadata omits is left out of the JSON. The portable custom interaction context has no field in the
binding and is not carried. The reserved types of an external file are `lom` (IEEE LOM XML) and `csmd` (curriculum standards
metadata XML); any other type is allowed by agreement. The content is bytes: serialize LOM or curriculum standards with
`serializeXml` of [xml](xml.md). An item whose QTI metadata is not valid, or a repeated identifier, is a `DataError`.

## Out of scope

| Construct                                                                                                 | Owner                                     |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| The delivery of a session: when each request is made, the merge of the engine's outcomes into the results | `delivery`                                |
| The HTTP client of the REST binding, access tokens, OAuth, HTTPS (CAT §5)                                 | The adapter in tempuh                     |
| `adaptiveItemSelection` inside the `selection` of QTI 2.x                                                 | QTI 2.x content, which olah does not read |
| The algorithm that selects items                                                                          | The CAT engine                            |

## Errors

All functions throw `DataError` for an argument of the wrong type, as plain JavaScript or JSON passes it, and the readers
of the binding for JSON that is not the binding's; the messages say what is wrong and what is expected. Only `checkPool` returns `Issue`s, with the source `CAT §2.1, §2.2`.
