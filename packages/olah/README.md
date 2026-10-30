# olah

A QTI 3.0 runtime for JavaScript and TypeScript: it reads, writes, validates and executes assessment items, tests,
content packages and results, and runs a test session without presentation. It is under development; this version has
the foundation, the `values` module, a secure XML reader and writer, validation against the official XSD schemas, the typed
model of assessment documents with its reader and writer, the readers and writers of results, usage data and personal needs
and preferences, QTI content packages with their metadata, and the port to computer adaptive testing engines.
The core runs in any JavaScript runtime; the `node` subpath needs Node.js 22 or later.

```bash
npm install @luthfanwakan/olah
```

olah is not certified by 1EdTech. [Conformance](docs/conformance.md) lists every construct of the QTI 3.0
specifications with the evidence for it.

## Example

```ts
import { createRandom, restoreRandom } from "@luthfanwakan/olah";

const random = createRandom(42);
random.uniform(); // 0.6606157208001621
const saved = random.state(); // [3799000961, 1141679633, 2034301298, 2592122788]
random.uniform(); // 0.1117019639532224

// Continues where the state was taken, so a stored session never draws differently.
restoreRandom(saved).uniform(); // 0.1117019639532224
```

Equal seeds give equal sequences in every runtime, and the same sequence as takar's `createRandom`.

Values, and the regular expressions of XML Schema that run in linear time:

```ts
import { compileXsdRegex, container, matchValues } from "@luthfanwakan/olah/values";

const a = container("multiple", "identifier", ["A", "B", "B"]);
const b = container("multiple", "identifier", ["B", "A", "B"]);
if (a !== null && b !== null) matchValues(a, b); // true

compileXsdRegex("(a+)+$").matches("a".repeat(100_000)); // false, in milliseconds
```

XML is read into an immutable tree with namespaces, written back, and validated against the official schemas, which olah
does not ship (`pnpm schemas` downloads them in this repository):

```ts
import { loadSchemaSet, validateXmlFiles } from "@luthfanwakan/olah/node";
import { parseXml, serializeXml } from "@luthfanwakan/olah/xml";

const item = parseXml(
  '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="capital"/>',
);
item.name; // "qti-assessment-item"
serializeXml(item); // '<?xml version="1.0" encoding="UTF-8"?>\n<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="capital"/>'

const schemas = await loadSchemaSet("./schemas");
const issues = await validateXmlFiles(schemas, [{ path: "items/capital.xml", content: serializeXml(item) }]);
issues.map(({ message }) => message.split(": ")[1]);
// ["The attribute 'title' is required but missing.", "The attribute 'time-dependent' is required but missing."]
schemas.close();
```

Assessment documents are read into a typed model and written back:

```ts
import { readAsi, writeAsi } from "@luthfanwakan/olah/asi";

const document = readAsi(
  '<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="capital" title="Capital" time-dependent="false"><qti-item-body><p>Which city?</p></qti-item-body></qti-assessment-item>',
);
if (document.kind === "item") {
  document.item.identifier; // "capital"
  document.item.timeDependent; // false
  document.item.body?.kind; // "item-body"
}
writeAsi(document).includes(
  'xsi:schemaLocation="http://www.imsglobal.org/xsd/imsqtiasi_v3p0 https://purl.imsglobal.org/spec/qti/v3p0/schema/xsd/imsqti_asiv3p0p1_v1p0.xsd"',
); // true
```

## API

| Import                        | Contents                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@luthfanwakan/olah`          | Everything below except `node`; `createRandom`, `restoreRandom`, `Random`, `SeededRandom`; `Issue`; `OlahError` and its subclasses                           |
| `@luthfanwakan/olah/asi`      | `readAsi`, `writeAsi`, `AsiDocument`, the model of every assessment element, `Expression`, the rule types, `readScoreCovers`, `scoreCoversBlock`             |
| `@luthfanwakan/olah/results`  | `readResults`, `writeResults` and the model of a Results Reporting document                                                                                  |
| `@luthfanwakan/olah/usage`    | `readUsageData`, `writeUsageData`, the model of usage data, and the vocabularies of item statistics                                                          |
| `@luthfanwakan/olah/pnp`      | `readPnp`, `writePnp`, `resolveSupports` and the model of a personal needs and preferences profile                                                           |
| `@luthfanwakan/olah/metadata` | `readResourceMetadata`, `writeResourceMetadata`, `deriveQtiMetadata`, QTI metadata, LOM, curriculum standards and the accessibility description of a variant |
| `@luthfanwakan/olah/package`  | `readManifest`, `readPackage`, `writePackage`, `packageResolvers`, `dependencyClosure`, `readLtiLink`, `DEFAULT_ZIP_LIMITS`                                  |
| `@luthfanwakan/olah/cat`      | `CatPort`, `sectionData`, `isSessionEnd`, `checkPool`, `catMetadata` and the models of the requests and responses of a CAT engine                            |
| `@luthfanwakan/olah/values`   | Base types, cardinalities, values and NULL, lexical forms, `matchValues`, `promote`, the JSON codec of BPIG Appendix C and the wire value, `compileXsdRegex` |
| `@luthfanwakan/olah/xml`      | `parseXml`, `serializeXml`, `resolveIncludes`, `ElementReader`, `buildElement`, `DEFAULT_XML_LIMITS` and the tree types                                      |
| `@luthfanwakan/olah/node`     | Node.js only: `SCHEMA_FILES`, `loadSchemaSet`, `validateXmlFiles`, `readPackageFile`, `writePackageFile`                                                     |

The errors are `DataError` for a wrong argument, `ReadError` for a document that cannot be read, `SecurityError` for
input that breaks a limit and `ProcessingError` for a condition that processing does not define as NULL. Validation does
not throw: it returns `Issue`s, each with the specification reference that defines the rule.

## Documentation

- [Architecture](docs/architecture.md): principles, layers, errors and determinism.
- [ASI](docs/asi.md): the model of assessment documents, the reader and the writer, the covers of external scores, and the element table.
- [Values](docs/values.md): the model, lexical forms, the JSON forms and the regular expressions.
- [XML](docs/xml.md): the tree, the encodings, the limits, the writer, XInclude and the readers of models.
- [Results](docs/results.md): the model of a Results Reporting document, its values and its rules.
- [Usage data](docs/usage.md): item statistics, their values and mappings.
- [PNP](docs/pnp.md): the supports, the sets, custom supports and the resolution of a profile.
- [Metadata](docs/metadata.md): QTI metadata, LOM, curriculum standards and the accessibility description.
- [Package](docs/package.md): the manifest, ZIP archives and their checks, paths, documents, resolvers, dependencies and LTI links.
- [CAT](docs/cat.md): the port to a CAT engine, section data, item stages, the pool check and the metadata JSON.
- [Node.js](docs/node.md): getting the schemas, choosing the schema of a document, issues, the engine, and package files.
- [Evidence](docs/evidence.md): how every construct is tested, and how to refresh the corpus and the fixtures.
- [Conformance](docs/conformance.md): the inventory, the certification features and the accepted differences.

## License

[Apache License 2.0](../../LICENSE). QTI and 1EdTech are trademarks of 1EdTech Consortium, Inc.; see [NOTICE](NOTICE).
