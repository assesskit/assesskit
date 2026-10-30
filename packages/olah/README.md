# olah

A QTI 3.0 runtime for JavaScript and TypeScript: it reads, writes, validates and executes assessment items, tests,
content packages and results, and runs a test session without presentation. It is under development; this version has
the foundation, the `values` module, a secure XML reader and writer, and validation against the official XSD schemas.
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

## API

| Import                      | Contents                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@luthfanwakan/olah`        | Everything below except `node`; `createRandom`, `restoreRandom`, `Random`, `SeededRandom`; `Issue`; `OlahError` and its subclasses                           |
| `@luthfanwakan/olah/values` | Base types, cardinalities, values and NULL, lexical forms, `matchValues`, `promote`, the JSON codec of BPIG Appendix C and the wire value, `compileXsdRegex` |
| `@luthfanwakan/olah/xml`    | `parseXml`, `serializeXml`, `resolveIncludes`, `DEFAULT_XML_LIMITS` and the tree types                                                                       |
| `@luthfanwakan/olah/node`   | Node.js only: `SCHEMA_FILES`, `loadSchemaSet`, `validateXmlFiles`                                                                                            |

The errors are `DataError` for a wrong argument, `ReadError` for a document that cannot be read, `SecurityError` for
input that breaks a limit and `ProcessingError` for a condition that processing does not define as NULL. Validation does
not throw: it returns `Issue`s, each with the specification reference that defines the rule.

## Documentation

- [Architecture](docs/architecture.md): principles, layers, errors and determinism.
- [Values](docs/values.md): the model, lexical forms, the JSON forms and the regular expressions.
- [XML](docs/xml.md): the tree, the encodings, the limits, the writer and XInclude.
- [Node.js](docs/node.md): getting the schemas, choosing the schema of a document, issues, and the engine.
- [Evidence](docs/evidence.md): how every construct is tested, and how to refresh the corpus and the fixtures.
- [Conformance](docs/conformance.md): the inventory, the certification features and the accepted differences.

## License

[Apache License 2.0](../../LICENSE). QTI and 1EdTech are trademarks of 1EdTech Consortium, Inc.; see [NOTICE](NOTICE).
