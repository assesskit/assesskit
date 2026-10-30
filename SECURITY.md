# Security

Report vulnerabilities privately through the repository's security advisory form rather than a public issue.

Points to be aware of when deploying olah:

- **No I/O.** The olah core reads no files, makes no network requests, reads no environment variables, reads no clock and
  runs no code it is given. Only the `node` and `cli` modules use Node.js. `node` reads only the paths it is given.
- **No fetching.** Absolute URLs in content are data. The core never fetches them, and callers supply the callbacks that
  resolve references.
- **Untrusted input.** Every input is untrusted: documents, packages, actions and what callbacks return. Entry points
  validate their input and throw `DataError` on malformed data, so data from users or files can be passed in directly.
- **Randomness.** `createRandom` is a seeded generator whose draws are reproducible from the seed. It is not
  cryptographically secure. Selections and shuffles that use it can be reproduced by anyone who knows the seed, so keep the
  seed of an exam session on the server.
- **Regular expressions.** Patterns that authors write, such as `qti-pattern-match` and `pattern-mask`, run on a
  linear-time automaton, never on a backtracking `RegExp`, so no pattern or text can make a match take exponential time.
  `compileXsdRegex` limits the size of the automaton (`maxStates`) and the nesting of the pattern (`maxDepth`); both have
  defaults and a `DataError` reports a pattern above them. The time of a match is linear in the text and the memory a
  match keeps is bounded, whatever the pattern.
- **XML.** `parseXml` rejects every DOCTYPE with a `SecurityError`, so no entity is declared, expanded or read (XXE and
  entity expansion, BPIG §6.7). It reads only the five predefined entities and character references. It also limits the
  document before and while it builds the tree. `resolveIncludes` calls only the resolver the caller passes, rejects
  `xpointer`, detects loops and counts the nodes of the result.
- **Schemas.** olah ships no schema. `loadSchemaSet` checks the SHA-256 of every file it reads against the list in
  `SCHEMA_FILES`, and again when it compiles a file. `validateXmlFiles` parses every document with `parseXml` first and
  runs libxml2 with network access and external entities off. A document has no way to name another schema file than the
  pinned ones.

## Default limits

Every limit is a positive integer that a caller can replace per call with the option `limits`. The defaults are about
1,000 times the largest document of the 1EdTech QTI 3.0 examples for size and node count, 16 times its depth and 20 times
its attributes on an element.

| Limit             | Default    | Applies to                                                                  |
| ----------------- | ---------- | --------------------------------------------------------------------------- |
| `maxBytes`        | 33,554,432 | The bytes of one XML document.                                              |
| `maxDepth`        | 256        | The nesting of elements in a document, and in a document with its includes. |
| `maxAttributes`   | 256        | The attributes on one element.                                              |
| `maxNodes`        | 1,000,000  | The nodes of a tree, and of a tree with its includes resolved.              |
| `maxIncludeDepth` | 8          | The nesting of `xi:include`.                                                |

## Runtime dependencies

The packages that olah loads at run time are pinned to exact versions:

| Package        | Version | License | Used by                                                                                                                                                                                                                     |
| -------------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saxes`        | 6.0.0   | ISC     | `xml`: a namespace-aware parser that rejects documents that are not well-formed. It expands no entity but the five predefined ones and reads no DTD. It has not changed since 2021; if a defect needs a fix, olah forks it. |
| `xmlchars`     | 2.2.0   | MIT     | `xml`: the character and name tables of XML 1.0 (a dependency of `saxes`, also used by the writer).                                                                                                                         |
| `libxml2-wasm` | 0.7.2   | MIT     | `node`: libxml2 2.15.1 compiled to WebAssembly, which compiles and runs the XSD schemas.                                                                                                                                    |
