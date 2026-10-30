# asi

`@luthfanwakan/olah/asi` reads and writes the assessment documents of QTI 3.0 (ASI): items, stimuli, tests, sections,
outcome declarations, response processing templates and outcome processing. Its model has a property for every attribute
and child element of the ASI schema, with types derived from the same table that drives the reader, the writer and the
generators of the tests. It imports `xml` and `values` and runs in any JavaScript runtime.

| Export                                         | Purpose                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `readAsi(input, options?)`                     | Reads text, bytes or a parsed tree into an `AsiDocument`.                                                |
| `writeAsi(document)`                           | Writes an `AsiDocument` as XML in UTF-8.                                                                 |
| `AsiDocument`, `ReadAsiOptions`                | The seven document kinds, and the options of the reader.                                                 |
| `ASI_NAMESPACE`                                | The namespace of every element of an assessment document.                                                |
| `AssessmentItem`, `AssessmentTest`, …          | The model of each element of the rows A1 to A130 of the inventory, such as `ResponseCondition`.          |
| `Expression`, `NumericExpression`              | The 64 expressions, and the 44 that yield numbers.                                                       |
| `ResponseRule`, `OutcomeRule`, `TemplateRule`  | The rules of the three kinds of processing.                                                              |
| `ElementModel`                                 | The model of any element of the table.                                                                   |
| `BodyNode`                                     | A node of body content, kept as XML.                                                                     |
| `readScoreCovers(test)`, `scoreCoversBlock(…)` | The covers of externally scored outcomes: read them from a test, build the rubric block that names them. |
| `ScoreCover`                                   | One covered response.                                                                                    |

## Example

```ts
import { readAsi, writeAsi } from "@luthfanwakan/olah/asi";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="capital" title="Capital" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>Paris</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-item-body><p>Which city is the capital of France?</p></qti-item-body>
  <qti-response-processing>
    <qti-response-condition>
      <qti-response-if>
        <qti-match><qti-variable identifier="RESPONSE"/><qti-correct identifier="RESPONSE"/></qti-match>
        <qti-set-outcome-value identifier="SCORE"><qti-base-value base-type="float">1</qti-base-value></qti-set-outcome-value>
      </qti-response-if>
    </qti-response-condition>
  </qti-response-processing>
</qti-assessment-item>`);

if (document.kind === "item") {
  const { item } = document;
  item.kind; // "assessment-item"
  item.timeDependent; // false
  item.responseDeclarations[0]?.correctResponse?.values; // [{ kind: "value", value: "Paris" }]
  const [rule] = item.responseProcessing?.rules ?? [];
  if (rule?.kind === "response-condition") {
    rule.responseIf.condition; // { kind: "match", operands: [{ kind: "variable", identifier: "RESPONSE" }, { kind: "correct", identifier: "RESPONSE" }] }
  }
}

writeAsi(document); // '<?xml version="1.0" encoding="UTF-8"?>\n<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" …'
```

## The model

Every element is an object with the properties below, and the types are derived from the element table
(`src/asi/element-table.ts`), so a property exists exactly when the schema has the attribute or child element.

| Part of the element                         | Property of the model                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| The element                                 | `kind`: its name without `qti-`, such as `"assessment-item"` or `"and"`. Every model has it.                                                       |
| An attribute                                | Its name in camel case: `max-attempts` is `maxAttempts`. `xml:lang` is `language` and `xml:base` is `xmlBase`. Omitted when the document omits it. |
| Child elements, one kind, at most one       | The element's name in camel case, omitted when there is none: `timeLimits`, `body`.                                                                |
| Child elements, one kind, several           | The plural, always an array: `responseDeclarations`, `weights`, `mapEntries`.                                                                      |
| Child elements, several kinds in a place    | One array in document order: `children` of a section, `rules` of a processing, `operands` of an operator.                                          |
| The expression of a condition or operator   | `operand` for one, `operands` for several, `condition` for the `if` of a condition, `expression` for the value of a rule.                          |
| Attributes the schema allows beyond its own | `extensions`: `XmlAttribute`s in document order, such as `data-*` attributes.                                                                      |
| Elements of other namespaces                | `extensionElements`: `XmlElement`s, where the schema allows them. An `xi:include` is an `XmlElement` in the array of its place.                    |
| Text                                        | `value`.                                                                                                                                           |
| Flow content                                | `children`: `BodyNode`s.                                                                                                                           |

The values of attributes follow their types in the schema:

| Type in the schema                         | Value                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| String, identifier, URI                    | `string`, as written                                                                          |
| Boolean                                    | `boolean`                                                                                     |
| Integer, double                            | `number`; a double may be `Infinity`, `-Infinity` or `NaN`; an integer must be a safe integer |
| Enumeration                                | The term; where the vocabulary can be extended (`use`, `support`), also `ext:` terms          |
| List (`class`, `view`, `category`)         | `readonly` array of the items                                                                 |
| Number or variable (`min`, `figures`, `n`) | `number`, or the identifier of the variable as a `string`                                     |

Defaults of the schema are not applied: an attribute the document omits is omitted from the model, and
`writeAsi` does not write it (G11: the information model, not the schema, says what `normal-minimum` means when it is
absent). The semantic modules apply defaults with their sources.

### Flow content

The text and elements of bodies stay XML: the `qti-item-body`, the `qti-stimulus-body`, and the `qti-content-body` and
`qti-html-content` of feedback, rubric blocks and cards. They hold HTML, MathML, SSML, interactions and feedback, which the
model keeps as `XmlNode`s (`BodyNode`) with the namespace and prefix as written. The model carries no source positions and
no namespace declarations; `writeAsi` declares a namespace on the element that uses it.

### Extensions and includes

Where the schema has a wildcard, attributes and elements of other namespaces are kept as written. Where the schema allows
`xi:include` (sections, rules, bodies), the model keeps it as an `XmlElement` of the XInclude namespace. To read the included
content, resolve the includes of the tree with `resolveIncludes` of [xml](xml.md) and pass the result to `readAsi`.

## Reading

`readAsi` reads the elements of the ASI namespace by name, whatever their prefix, and accepts documents written for 3.0.0 and
3.0.1, which share the namespace. It ignores `xsi:schemaLocation`. It throws a `ReadError` when it cannot map a document to the
model; each issue has the code, a sentence, the schema file as `source`, and the path, line, column and element path.

| Code                         | When                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `olah/asi/document-element`  | The root is not one of the seven document elements in the ASI namespace.                               |
| `olah/asi/attribute`         | An attribute the schema does not have, and no wildcard allows.                                         |
| `olah/asi/missing-attribute` | A required attribute is absent.                                                                        |
| `olah/asi/invalid-value`     | A value is not in the lexical form of its type, or not one of the terms of its vocabulary.             |
| `olah/asi/element`           | A child element the type does not contain, too many of one, or an element in an empty or text element. |
| `olah/asi/missing-element`   | A required single child element is absent.                                                             |
| `olah/asi/text`              | Text where only elements go, or in an empty element.                                                   |
| `olah/asi/exclusive`         | Two child elements the schema allows only one of, such as an adaptive selection and a selection.       |

The reader is not a validator. It does not check the order of child elements, the minimum of a list, patterns such as
identifiers and MIME types, ranges such as `xs:int`, the uniqueness of `id`s, or the rules of BIND §5. `validateXmlFiles` of
[node](node.md) checks the schema, and the `validate` module the rest. A value that must be a number or a boolean cannot
be represented otherwise, so it is checked. A DOCTYPE or a document over a limit is a `SecurityError` of the XML reader.

The schema defines the target value of a `qti-match-table-entry` as one of the base type names, which cannot be intended;
olah follows the schema, so another text is an `olah/asi/invalid-value`.

## Writing

`writeAsi` writes the document with `xmlns`, `xmlns:xsi` and `xsi:schemaLocation` that names the 3.0.1 ASI schema (BPIG
§1.1.5). Attributes and child elements are in the order of the schema, so a valid model gives a valid document. It throws a
`DataError` for a model that is not the model of its element: a property the element does not have, a missing required
property, a value of the wrong type, a `kind` that does not match, or more members than a place takes.

## Covers

QTI has no element that says which responses an externally scored outcome of a test rates. olah records it with a rubric
block of the test, which the schema accepts and other tools show to scorers (an olah convention, not part of QTI):

```xml
<qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="CONTENT">
  <qti-content-body>
    <p>Rate content once, across both writing tasks.</p>
    <ul>
      <li data-item-ref="W1" data-response-identifier="RESPONSE">Task 1: essay</li>
      <li data-item-ref="W2" data-response-identifier="RESPONSE">Task 2: letter</li>
    </ul>
  </qti-content-body>
</qti-rubric-block>
```

The block stays an ordinary `RubricBlock` in `test.rubricBlocks`; `readScoreCovers` derives the covers from it and nothing is
copied into the model.

```ts
import { readAsi, readScoreCovers } from "@luthfanwakan/olah/asi";

const document =
  readAsi(`<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="essays" title="Essays">
  <qti-outcome-declaration identifier="CONTENT" cardinality="single" base-type="float" external-scored="human"/>
  <qti-rubric-block view="scorer" use="scoring" class="external-score-covers" data-outcome-identifier="CONTENT">
    <qti-content-body>
      <p>Rate content once, across both writing tasks.</p>
      <ul>
        <li data-item-ref="W1" data-response-identifier="RESPONSE">Task 1: essay</li>
        <li data-item-ref="W2" data-response-identifier="RESPONSE">Task 2: letter</li>
      </ul>
    </qti-content-body>
  </qti-rubric-block>
  <qti-test-part identifier="P1" navigation-mode="linear" submission-mode="individual">
    <qti-assessment-section identifier="S1" title="Writing" visible="true">
      <qti-assessment-item-ref identifier="W1" href="w1.xml"/>
      <qti-assessment-item-ref identifier="W2" href="w2.xml"/>
    </qti-assessment-section>
  </qti-test-part>
</qti-assessment-test>`);

if (document.kind === "test") {
  readScoreCovers(document.test);
  // Map { "CONTENT" => [
  //   { itemRef: "W1", responseIdentifier: "RESPONSE", label: "Task 1: essay" },
  //   { itemRef: "W2", responseIdentifier: "RESPONSE", label: "Task 2: letter" },
  // ] }
}
```

| Rule                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ |
| A block covers when it is a rubric block of the test and its class has the token `external-score-covers`.                      |
| It names the outcome in `data-outcome-identifier`; blocks without it, and rubric blocks of parts and sections, are not covers. |
| A cover is a `li` of a `ul` that is a child of the content body, with `data-item-ref` and `data-response-identifier`.          |
| The label is the text of the `li` with white space normalized, and absent when empty.                                          |
| Several blocks for one outcome add their covers in document order.                                                             |

`scoreCoversBlock(outcome, covers, notes?)` builds the block: `view="scorer"`, `use="scoring"`, the class token, the
attribute, the notes, then the list. Identifiers must be identifiers; labels are written with white space normalized.

## The element table

`src/asi/element-table.ts` is generated by `pnpm asi-table` from the pinned ASI schema (`imsqti_asiv3p0p1_v1p0.xsd`; run
`pnpm schemas` first). It holds the element types reachable from the seven document elements without entering flow
content: for each type its attributes (name, property, use, default, type), its child elements in slots (property,
accepted elements, limits, exclusions), whether it takes wildcards, and its content (`empty`, `text`, `flow` or `slots`).
The reader, the writer, the types of the model and the generators of the tests all read this one table; a test fails when
the committed file differs from the schema.

`scripts/asi-table.ts` names what the schema leaves open: the property of a slot that holds several kinds of elements, and the
property of elements whose plural is not a word to add `s` to. A schema that needs a name the script lacks stops the script
with the slot to name. `pnpm test:xsd` compares the committed table with the one the script generates.
