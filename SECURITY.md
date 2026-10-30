# Security

Report vulnerabilities privately through the repository's security advisory form rather than a public issue.

Points to be aware of when deploying olah:

- **No I/O.** The olah core reads no files, makes no network requests, reads no environment variables, reads no clock and
  runs no code it is given. Only the `node` and `cli` modules use Node.js. `node` reads only the paths it is given.
- **No fetching.** Absolute URLs in content are data. The core never fetches them, and callers supply the callbacks that
  resolve references.
- **CAT engines.** The core never calls a CAT engine. `qti-adaptive-engine-ref` names the URL prefix of an engine, so a
  document chooses where a host sends a candidate's results. A host that implements `CatPort` checks the prefix against
  the engines it trusts before it sends a request.
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
- **Packages.** `readPackage` and `readPackageFile` check a package before they read a file of it (§2.6, BPIG §6.7). An archive
  entry whose name is absolute, leaves the package with `..`, or has a backslash, a drive letter or a control character
  rejects the archive (zip-slip), as do two entries with one normalized name, a symbolic link, and an encrypted entry. The
  entry count, the declared sizes and the compression ratio are checked from the central directory, and the bytes are counted
  again while an entry inflates, so that a header that understates a size cannot make the output larger. A package directory is
  read with `lstat` and `realpath`: a symbolic link or a file that is not a regular file rejects it, and a file replaced by a
  link after the listing is not followed. A reference in a document that leaves the package, and an `xi:include` that names a
  file outside it, are never resolved. A package directory that another process can change while olah reads it is not protected
  against a race.

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

The limits of archives and package directories, `ZipLimits`, are about 1,000 times the entries of the largest package of the
examples (99), 100 times its largest entry (5.0 MiB), 200 times its size (11.0 MB) and 9 times its largest compression ratio
(27.9, on a 7.5 KB entry; 3.6 on the entries above the exemption).

| Limit           | Default       | Applies to                                                                                               |
| --------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `maxEntries`    | 100,000       | Entries of an archive, directories included; files and directories of a package directory.               |
| `maxEntryBytes` | 536,870,912   | The uncompressed bytes of one file.                                                                      |
| `maxTotalBytes` | 2,147,483,648 | The uncompressed bytes of all files.                                                                     |
| `maxRatio`      | 250           | The uncompressed size of an entry over its compressed size; entries of 102,400 bytes or less are exempt. |

## Runtime dependencies

The packages that olah loads at run time are pinned to exact versions:

| Package        | Version | License | Used by                                                                                                                                                                                                                     |
| -------------- | ------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saxes`        | 6.0.0   | ISC     | `xml`: a namespace-aware parser that rejects documents that are not well-formed. It expands no entity but the five predefined ones and reads no DTD. It has not changed since 2021; if a defect needs a fix, olah forks it. |
| `xmlchars`     | 2.2.0   | MIT     | `xml`: the character and name tables of XML 1.0 (a dependency of `saxes`, also used by the writer).                                                                                                                         |
| `fflate`       | 0.8.3   | MIT     | `package`: inflates the entries of ZIP archives in steps of 8 KiB, so that the output can be counted, and deflates the entries that `writePackage` writes. olah reads the central directory itself.                         |
| `libxml2-wasm` | 0.7.2   | MIT     | `node`: libxml2 2.15.1 compiled to WebAssembly, which compiles and runs the XSD schemas.                                                                                                                                    |
