# olah

A QTI 3.0 runtime for JavaScript and TypeScript: it reads, writes, validates and executes assessment items, tests,
content packages and results, and runs a test session without presentation. It is under development; this version has
the foundation and the `values` module. It runs in any JavaScript runtime.

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

## API

| Import                      | Contents                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@luthfanwakan/olah`        | Everything below; `createRandom`, `restoreRandom`, `Random`, `SeededRandom`; `Issue`; `OlahError` and its subclasses                                         |
| `@luthfanwakan/olah/values` | Base types, cardinalities, values and NULL, lexical forms, `matchValues`, `promote`, the JSON codec of BPIG Appendix C and the wire value, `compileXsdRegex` |

The errors are `DataError` for a wrong argument, `ReadError` for a document that cannot be read, `SecurityError` for
input that breaks a limit and `ProcessingError` for a condition that processing does not define as NULL. Validation does
not throw: it returns `Issue`s, each with the specification reference that defines the rule.

## Documentation

- [Architecture](docs/architecture.md): principles, layers, errors and determinism.
- [Values](docs/values.md): the model, lexical forms, the JSON forms and the regular expressions.
- [Evidence](docs/evidence.md): how every construct is tested, and how to refresh the corpus and the fixtures.
- [Conformance](docs/conformance.md): the inventory, the certification features and the accepted differences.

## License

[Apache License 2.0](../../LICENSE). QTI and 1EdTech are trademarks of 1EdTech Consortium, Inc.; see [NOTICE](NOTICE).
