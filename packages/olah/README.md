# olah

A QTI 3.0 runtime for JavaScript and TypeScript: it reads, writes, validates and executes assessment items, tests,
content packages and results, and runs a test session without presentation. It is under development; this version has
the foundation, the `values` module, a secure XML reader and writer, validation against the official XSD schemas, the typed
model of assessment documents with its reader and writer, the readers and writers of results, usage data and personal needs
and preferences, QTI content packages with their metadata, the port to computer adaptive testing engines, template,
response and outcome processing, the planning of a test session, the interactions with their rules of validity, portable
custom interactions, the content an item shows, the validator, and the command line `olah` that validates packages and
documents. The core runs in any JavaScript runtime; the `node` and `cli` subpaths need Node.js 22 or later.

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

Template and response processing run on the model, with the six standard templates built in:

```ts
import { createRandom } from "@luthfanwakan/olah";
import { readAsi } from "@luthfanwakan/olah/asi";
import { createItemVariables, runResponseProcessing } from "@luthfanwakan/olah/processing";
import { single } from "@luthfanwakan/olah/values";

const document = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="capital" title="Capital" time-dependent="false">
  <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
    <qti-correct-response><qti-value>paris</qti-value></qti-correct-response>
  </qti-response-declaration>
  <qti-outcome-declaration identifier="SCORE" cardinality="single" base-type="float"/>
  <qti-item-body><p>Which city is the capital of France?</p></qti-item-body>
  <qti-response-processing template="https://purl.imsglobal.org/spec/qti/v3p0/rptemplates/match_correct.xml"/>
</qti-assessment-item>`);
if (document.kind === "item") {
  const { item } = document;
  const variables = createItemVariables(item);
  const responses = new Map(variables.responses).set("RESPONSE", single("identifier", "paris"));
  const { outcomes } = runResponseProcessing(item, { ...variables, responses }, { random: createRandom(1) });
  outcomes.get("SCORE"); // { cardinality: "single", baseType: "float", value: 1 }
}
```

## CLI

The package installs the program `olah`. It validates a package or an XML document against the official schemas, which it
downloads once, and with the semantic checks of `validate`:

```bash
npx olah schemas fetch
npx olah validate packaging/simple/simple.zip
```

```text
packaging/simple/simple.zip: valid (0 errors, 0 warnings)
```

| Command              | Argument or option    | Default                                                                                             |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `olah validate`      | `<path>`              | required: a ZIP file, an unpacked package directory or one XML document                             |
|                      | `--schemas <dir>`     | `olah/schemas/<version>` in the user cache directory, where `olah schemas fetch` writes the schemas |
|                      | `--format text\|json` | `text`                                                                                              |
| `olah schemas fetch` | `--dir <dir>`         | the same cache directory                                                                            |
| `olah --help`        |                       | prints the commands                                                                                 |

The exit code is 0 when the content has no issue with severity error, 1 when it has one, and 2 when the command line is
wrong, the path cannot be read or is refused, or the schemas are missing. `--format json` prints
`{ tool, version, target, valid, summary: { errors, warnings }, issues }`. `olah schemas fetch` is the only code in olah that
uses the network. [CLI](docs/cli.md) has the checks, the output and the cache directory of each platform.

## API

| Import                            | Contents                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@luthfanwakan/olah`              | Everything below except `node`; `createRandom`, `restoreRandom`, `Random`, `SeededRandom`; `Issue`; `OlahError` and its subclasses                                                                                |
| `@luthfanwakan/olah/asi`          | `readAsi`, `writeAsi`, `AsiDocument`, the model of every assessment and content element, `BodyNode`, `Interaction`, `Expression`, `readScoreCovers`, `scoreCoversBlock`, `walkDocument`                           |
| `@luthfanwakan/olah/results`      | `readResults`, `writeResults` and the model of a Results Reporting document                                                                                                                                       |
| `@luthfanwakan/olah/usage`        | `readUsageData`, `writeUsageData`, the model of usage data, and the vocabularies of item statistics                                                                                                               |
| `@luthfanwakan/olah/pnp`          | `readPnp`, `writePnp`, `resolveSupports` and the model of a personal needs and preferences profile                                                                                                                |
| `@luthfanwakan/olah/metadata`     | `readResourceMetadata`, `writeResourceMetadata`, `deriveQtiMetadata`, QTI metadata, LOM, curriculum standards and the accessibility description of a variant                                                      |
| `@luthfanwakan/olah/package`      | `readManifest`, `readPackage`, `writePackage`, `packageResolvers`, `dependencyClosure`, `readLtiLink`, `DEFAULT_ZIP_LIMITS`                                                                                       |
| `@luthfanwakan/olah/cat`          | `CatPort`, `sectionData`, `isSessionEnd`, `checkPool`, `catMetadata` and the models of the requests and responses of a CAT engine                                                                                 |
| `@luthfanwakan/olah/interactions` | `describeInteractions`, `checkBindings`, `checkResponse`, `answeredStatus`, `shuffleChoices`, `presentChoices`, `numericRecord` and the descriptors of the 22 interactions                                        |
| `@luthfanwakan/olah/pci`          | `encodePciValue`, `decodePciValue` with file callbacks, `parseModuleResolution`, `resolvePciModules`, `pciProperties`, `checkPortableInteraction`                                                                 |
| `@luthfanwakan/olah/content`      | `resolveContent`, `formatPrintedVariable`, `isShown`, feedback, rubric, `selectCard`, `catalogsFor` and `hazardExposure`                                                                                          |
| `@luthfanwakan/olah/processing`   | `createItemVariables`, `runTemplateProcessing`, `runResponseProcessing`, `runOutcomeProcessing`, `evaluate`, `evaluateTestExpression`, `TestScope`, `STANDARD_TEMPLATES`, `OPERATOR_SIGNATURES`, custom operators |
| `@luthfanwakan/olah/validate`     | `validateAsi`, `validateTest`, `validatePackage`, `validateResults`, `validatePnp`, `validatePnpNamespace`: the rule sets of BIND §5, the static types of processing, test structure, covers, packages            |
| `@luthfanwakan/olah/delivery`     | `resolveStructure`, `planTest`, `planItems`, `nextItem`, `previousItem`, `sessionControl`, `timeLimits`, `additionalTestingTime` and the types of the structure and the plan                                      |
| `@luthfanwakan/olah/values`       | Base types, cardinalities, values and NULL, lexical forms, `matchValues`, `promote`, the JSON codec of BPIG Appendix C and the wire value, `compileXsdRegex`                                                      |
| `@luthfanwakan/olah/xml`          | `parseXml`, `serializeXml`, `resolveIncludes`, `ElementReader`, `buildElement`, `DEFAULT_XML_LIMITS` and the tree types                                                                                           |
| `@luthfanwakan/olah/node`         | Node.js only: `SCHEMA_FILES`, `loadSchemaSet`, `validateXmlFiles`, `readPackageFile`, `writePackageFile`                                                                                                          |
| `@luthfanwakan/olah/cli`          | Node.js only: `runCli` and `RunCliOptions`, the command line `olah`                                                                                                                                               |

The errors are `DataError` for a wrong argument, `ReadError` for a document that cannot be read, `SecurityError` for
input that breaks a limit and `ProcessingError` for a condition that processing does not define as NULL. Validation does
not throw: it returns `Issue`s, each with the specification reference that defines the rule.

## Documentation

- [Architecture](docs/architecture.md): principles, layers, errors and determinism.
- [ASI](docs/asi.md): the model of assessment documents and their content, the reader and the writer, the covers of external scores, and the element table.
- [Processing](docs/processing.md): the variables, template, response and outcome processing, the expressions, the standard templates and the decisions where the specifications are silent.
- [Validate](docs/validate.md): the rule sets of BIND §5, the static types of processing, test structure, covers, packages, results and profiles, with every issue code and the decisions.
- [Delivery](docs/delivery.md): the plan of a test session: section references, selection, ordering, item instances, pre-conditions and branch rules, item session control and time limits.
- [Values](docs/values.md): the model, lexical forms, the JSON forms and the regular expressions.
- [XML](docs/xml.md): the tree, the encodings, the limits, the writer, XInclude and the readers of models.
- [Results](docs/results.md): the model of a Results Reporting document, its values and its rules.
- [Usage data](docs/usage.md): item statistics, their values and mappings.
- [Interactions](docs/interactions.md): the descriptors of the 22 interactions, their bindings, the rules of validity, shuffling and numeric text.
- [PCI](docs/pci.md): the JSON of variables with file callbacks, module resolution, properties and checks of a portable custom interaction.
- [Content](docs/content.md): visibility, printed variables and their number formats, rubric views, catalogs and cards, and hazards.
- [PNP](docs/pnp.md): the supports, the sets, custom supports and the resolution of a profile.
- [Metadata](docs/metadata.md): QTI metadata, LOM, curriculum standards and the accessibility description.
- [Package](docs/package.md): the manifest, ZIP archives and their checks, paths, documents, resolvers, dependencies and LTI links.
- [CAT](docs/cat.md): the port to a CAT engine, section data, item stages, the pool check and the metadata JSON.
- [Node.js](docs/node.md): getting the schemas, choosing the schema of a document, issues, the engine, and package files.
- [CLI](docs/cli.md): `olah validate` and `olah schemas fetch`, their checks, output, exit codes and defaults.
- [Evidence](docs/evidence.md): how every construct is tested, and how to refresh the corpus and the fixtures.
- [Conformance](docs/conformance.md): the inventory, the certification features and the accepted differences.

## License

[Apache License 2.0](../../LICENSE). QTI and 1EdTech are trademarks of 1EdTech Consortium, Inc.; see [NOTICE](NOTICE).
