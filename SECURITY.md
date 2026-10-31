# Security

Report vulnerabilities privately through the repository's security advisory form rather than a public issue. Include the
version, the document or the sequence of actions that shows the problem, and what it lets an attacker do.

Every input is untrusted: packages, documents, personal needs profiles, results, candidate responses, client actions and what
callbacks and resolvers return. The sections below state the controls of the runtime and what a deployment adds; the sections that
start with the player state those of the player.

Points to be aware of when deploying the runtime:

- **No I/O.** The runtime core reads no files, makes no network requests, reads no environment variables, reads no clock and
  runs no code it is given. Only the `node` and `cli` modules use Node.js. `node` reads only the paths it is given.
- **No fetching.** Absolute URLs in content are data. The core never fetches them, and callers supply the callbacks that
  resolve references. The only network access in the runtime is the command `assesskit schemas fetch`: it downloads the addresses of
  `SCHEMA_FILES`, which the command line cannot change, and writes a file only when its SHA-256 is the pinned one.
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
- **Processing.** Processing runs no code it is given: a custom operator is a function the caller registers, and what it
  returns is checked like any input. `qti-template-constraint` runs template processing at most 100 times (INFO section 5.150),
  and a container that an expression builds, such as the result of `qti-repeat`, is limited by `maxContainerSize`; a
  larger one is a `SecurityError`. Expressions are no deeper than the document they were read from, which `maxDepth`
  limits.
- **Portable custom interactions.** The core runs no PCI code: module locations are data, and loading and sandboxing the
  modules is the player's. `parseModuleResolution` reads JSON only, and a module id such as `__proto__` stays data in a
  `Map`. `decodePciValue` checks everything a module returns before it becomes a value, and refuses a file that is not
  `{ data, mime, name }` and a duration with years or months; the bytes of a file go to a callback of the host and never
  into a value. A package path from a configuration file is still untrusted: the host serves only paths of the package.
- **Printed variables.** A `format` runs on the runtime's own arithmetic, over the exact value of the number, and a width or
  precision above 1,100 is ignored, so that a document cannot make the formatter allocate gigabytes.
- **XML.** `parseXml` rejects every DOCTYPE with a `SecurityError`, so no entity is declared, expanded or read (XXE and
  entity expansion, BPIG section 6.7). It reads only the five predefined entities and character references. It also limits the
  document before and while it builds the tree, and refuses what the parser lets through and a tree could not keep: a lone
  surrogate, a namespace declaration with white space at its start or end, and a qualified name that is not made of two
  names. `resolveIncludes` calls only the resolver the caller passes, rejects `xpointer`, detects loops and counts the nodes
  of the result.
- **Schemas.** The runtime ships no schema. `loadSchemaSet` checks the SHA-256 of every file it reads against the list in
  `SCHEMA_FILES`, and again when it compiles a file. `validateXmlFiles` parses every document with `parseXml` first and
  runs libxml2 with network access and external entities off. A document has no way to name another schema file than the
  pinned ones.
- **Command line.** `assesskit validate` reads the path it is given and the schema directory, and no other file: an `xi:include`
  of a lone document is not resolved. It refuses a package that breaks a rule of **Packages** below, and an XML file above
  `maxBytes` of `parseXml` before it reads the file, with the exit code 2.
- **Packages.** `readPackage` and `readPackageFile` check a package before they read a file of it (section 2.6, BPIG section 6.7). An archive
  entry whose name is absolute, leaves the package with `..`, or has a backslash, a drive letter or a control character
  rejects the archive (zip-slip), as do two entries with one normalized name, a symbolic link, and an encrypted entry. The
  entry count, the declared sizes and the compression ratio are checked from the central directory, and the bytes are counted
  again while an entry inflates, so that a header that understates a size cannot make the output larger. A package directory is
  read with `lstat` and `realpath`: a symbolic link or a file that is not a regular file rejects it, and a file replaced by a
  link after the listing is not followed. A reference in a document that leaves the package, and an `xi:include` that names a
  file outside it, are never resolved; a file that many includes of a document name is read and parsed once. A package
  directory that another process can change while the runtime reads it is not protected against a race.
- **Server mode.** The answer keys and the seed of an exam session must not reach the candidate's device. Run the engine on
  the server and send the client views only: the view is built field by field from an allowlist, with no correct response
  (outside the solution state the item session control allows), processing, mapping, outcome or template value, hidden
  content or metadata but the hazards, and a property test searches every view of random sessions for marked key material.
  In device mode the engine, the items with their keys and the seed are in the client, which is fit for practice only.
  `createRandom` is not cryptographic: selections and shuffles are reproducible from the seed.
- **Client actions.** `parseCandidateAction` checks the shape, the types and the size of an action from a client (see
  **Default limits**) and refuses the actions of the host (`time`, `supply-scores`, `cat-response`) and any `at`; the server
  stamps the time. The engine checks every action against the rules and answers a refusal, never a state change, and an
  out-of-range integer response is a refusal. The engine does not decide which candidate actions a client may send: it
  applies `suspend` and `resume`, which stop the clock, from whoever sends them, so a deployment that must not let candidates
  pause filters them before it applies them (the exam default of the player does).
- **Resolvers and callbacks.** The functions a host passes in (`resolvers`, `resolveTemplate`, `customOperators`, the file
  callbacks of PCI values, `CatPort`) are the host's code and run with its authority. What they return is data and is checked
  where it is used. A resolver returns its value synchronously.
- **Scoring.** `scorerView` holds the correct responses, so it belongs on the server. `supply-scores` is a host action: accept
  a score only from the scorer or the tool it belongs to.

## The player: the frame of portable custom interactions

A portable custom interaction is code of the package, and it runs in the candidate's browser. The player runs each one in an
`iframe` with `sandbox="allow-scripts"` and no `allow-same-origin`, so the code has an opaque origin: no cookie, storage or
access to the player. The frame restricts itself with a content security policy before it loads the code: no connection,
frame, form or `base`, no inline script and no `eval`, and scripts, styles, images, media and fonts only from the asset
origin and the origins the host allows. The frame refuses to start where the browser does not apply the policy.

- Serve `pci-frame/*` and `player.css` from the asset origin, outside the asset gate. They hold no package data.
- Put the origin of `staticUrl` in the `frame-src` of the page that mounts the player. A module can navigate its own frame,
  and that directive stops it from going to another site.
- Allow other origins in `origins` only for hosts that you trust to serve scripts.
- The code is visible to the candidate: keep answer keys in response processing, which the asset gate never serves.

## The player: the interactions

An upload interaction can record the candidate's voice, and a WAV recording loads a script into an audio worklet.

- The microphone is asked for only when the candidate presses Record in an upload interaction, and a visible indicator shows
  while it records. A recording that is not finished is discarded when the candidate leaves the page. Set `record: false` of
  `createInteractionRenderers` to offer no recording.
- Put the origin of `staticUrl` in the `script-src` of the page, because a worklet is a script. `recorder-worklet.js` holds no
  package data and reaches no network; serve it from the asset origin, like `pci-frame/*`.
- Recordings and files go only to the host's storage through `files.upload`; the state and the results hold references. The
  player writes nothing to `localStorage`.
- The editor of an XHTML answer writes only `p`, `br`, `strong`, `em`, `u`, `ul`, `ol`, `li`, `sub` and `sup`, with no attribute, and a
  response that holds anything else is shown as its text. A host that shows a response to a rater treats it as it treats
  any answer: untrusted text.

## The player: the session host and the asset gate

In an exam the engine, the seeds and the answer keys stay on the server ([server.md](docs/player/server.md)). The
browser code imports only the wire functions of the runtime's `delivery`, and a test fails if the bundle of the player and the remote
session holds any file of the engine. Practice runs the engine on the device, so its keys are visible there.

- The host's authentication gives `{ session, principal }` to every call. Envelopes carry no session identifier, and a
  request for a session that is not bound to the principal, or that does not exist, is the same `AccessError`: map it to 403
  and tell nothing else. `start` never rebinds a session.
- A client may not send `suspend` or `resume` in an exam, because the runtime counts suspended time nowhere. Breaks are the proctor's.
  Keep the proctor's and the scheduler's endpoints away from candidates.
- The stores must make `create` and `save` atomic across processes, so that a version conflict is a conflict and a session is
  started once.
- Serve package files only through the asset gate ([asset-gate.md](docs/player/asset-gate.md)), from an origin
  without cookies. A token is in the path and names a session, a prefix and an expiry (an hour by default). The gate sends
  `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; do not strip them. Keep the HMAC key out of the
  browser and rotate it to end every token.
- The gate never serves the manifest, a file of a QTI resource type, a file that an adaptive section names, or an XML file in a
  namespace of QTI data. Keys stay safe by type and content, not by what a view references: a file under a prefix that no view
  references is served, so keep one folder for each item and its media.
- The files of the candidate have tokens of their own, valid for five minutes, and are served in a sandbox.

## The player: the LTI tool role

A learning platform launches the player through the browser of the candidate, so the launch is untrusted until `ltiLaunch` has
checked it ([lti.md](docs/player/lti.md)). The checks bind a launch to the browser that logged in, to the platform's
key, to the tool's client and deployment, and to one use.

- Serve the login URL and the launch URL over HTTPS, and limit the size of a request body: the handlers read what the host
  gives them.
- `LtiStore.delete` must be atomic, and expired logins deleted. A login completes once because only one caller's `delete`
  returns `true`.
- Without third-party cookies, the launch is tied to the browser by the platform's storage, and the tool accepts the second
  post of that path only from the origin of its own launch URL. Pass the `origin` header of the request to `ltiLaunch`.
- The two pages of that path carry a content security policy that allows their one script by hash, and encode every value.
  A host that adds headers must not weaken them.
- The platform's key set is fetched from the URL of a registration, over HTTPS, without redirects, with a time limit and at
  most 64 KiB. A token cannot choose the URL, and only RS256 with an RSA key of 2,048 bits or more verifies.
- The tool's private key is the host's to keep. It signs client assertions and Deep Linking responses, which expire after
  five minutes.

## The player: CAT engines

`restCatPort` sends a candidate's results and an OAuth bearer token to a remote engine, so it is built to send them to one
place only.

- It serves the one `endpoint` that the host configures. The `qti-adaptive-engine-ref` of a package is the package's word:
  a request for another prefix is a `DataError`, and nothing leaves. Give each trusted engine its own port.
- The endpoint and the token URL must be `https`. Redirects are errors, so a redirect cannot carry the token to another
  address or from HTTPS to HTTP. Every request is aborted after `timeoutMs`.
- The personal needs and preferences of a candidate go to the engine only with `sharePnp: true`.
- The client secret goes only to the token URL, as HTTP Basic credentials.

An engine that the host runs in process, behind the runtime's `CatPort`, sends nothing. The `sessionState` that it returns is kept
in the delivery state, so keep it on the server like the seed of an exam session, and keep the engine's own store of the
parameters of the items and the settings of the test there too.

## The player: Caliper

`sendCaliper` sends events about a candidate and a bearer token to a Caliper endpoint that the host configures
([caliper.md](docs/player/caliper.md)).

- The endpoint must be `https`. A redirect is an error, so it cannot carry the token to another address. Every call is
  aborted after `timeoutMs`.
- The candidate is the IRI that the host gives as `actor`. Give an opaque identifier, such as `urn:uuid:` and a UUID that the
  host keeps in its own records, never an email address, a name or an identifier that another service knows. The
  identifiers that the player makes (events, attempts, scores, items and sections) are UUIDs of names that hold the session
  identifier and the item reference, and the session identifier does not leave the server in them.
- The events hold times, the identifiers of item references and sections, and, for `caliperGrade`, the score that the host
  gives. They hold no response, no answer key and no personal needs and preferences. Call `caliperGrade` only for a score that
  the endpoint may know.
- The token goes only in the `Authorization` header of that endpoint. A `ServiceError` carries the endpoint's answer as
  `body`: log it as untrusted text.

## The player: external scoring

A `Submission` of `toSubmission` carries what a rater needs to score a response, which includes the correct responses of the
items and the rubric for the scorer ([scoring.md](docs/player/scoring.md)).

- Give a submission only to authorized raters, through an endpoint that checks the rater: never in a candidate's view, in the
  candidate's session or to the candidate's browser. It is not a view of the candidate.
- `mountSubmission` draws the content of a submission with the renderer of the player, so the content is sanitized as a
  candidate's is. It draws a file that a candidate submitted as an image, audio, video or a link, and never in a frame, because
  the candidate chose its bytes and its media type. The URL of a file comes from the host's `files.url`, which must give an
  `http` or `https` URL. Serve the files of candidates from an origin that is not the host's page, with `nosniff` and a
  `Content-Disposition` that downloads what the display does not play.
- The text of a response is data: the display sets it as text and never as markup.
- `toSupplyScores` checks a score against the declaration, but the host decides who may score. The engine
  trusts a score it is given, so authenticate the rater and log who supplied it.

## The player: content

The content of an item comes from a package and is untrusted. The renderer builds it with `createElementNS` from the runtime's typed
nodes and never with `innerHTML`, and keeps only the attributes listed in
[content](docs/player/content.md#attributes): no event handler, no `style`, no attribute of another namespace.
An element of any namespace but MathML, SSML and CML is left out with what it holds, so a script, an SVG or a frame in
the content is not built, even from a view that a reader of the runtime would have refused. A reference goes through one policy:
a path in the package is resolved and given to `assets`, an origin must be listed in `origins`, and `javascript:`, `vbscript:`,
`blob:` and every `data:` URL but a raster image are refused. A file embedded by an `object` runs nothing: a page is in a
frame with an empty `sandbox`, and a file of another type is a link.

Item stylesheets are fetched with no credentials and no referrer and are cleaned on their parsed rules (`@import`, rules
for `:host`, and every `url()` and loader outside the stylesheet's origin and `origins` go), and they are adopted into the
shadow root of the item only. Because the root's host has `contain: layout paint` and `isolation: isolate`, the
fixed-position CSS of an item cannot cover the page.

Serve the files of a package from an origin of their own and put it, and the origins in `origins`, in the `img-src`,
`media-src`, `font-src`, `frame-src` and `connect-src` of the page (the last for the stylesheets), and answer the
stylesheets with CORS headers. A page with a strict `style-src` needs nothing for item stylesheets: they are constructed
sheets, not `<style>` elements or attributes.

## The player: MathJax and speech

MathJax is code that the host chooses and serves: the player loads the script from the URL it is given and bundles none. Serve
MathJax and its fonts from the asset origin, from the files of the pinned version of the npm package `mathjax`, and put
that origin in the `script-src`, `font-src` and `connect-src` of the page and `blob:` in its `worker-src`
([math](docs/player/math.md#serving-mathjax)). The player sets MathJax's fonts to the host, so that it reaches no CDN. A
page loads MathJax from one URL.

A speech request is made from the content of the page and goes to the voice of the host. The `ssml` holds only the SSML
elements and attributes of SSML 1.1 that the ASI schema allows, with every value escaped, and an `audio` keeps its source
only for an `http` or `https` URL. Lexicons are parsed by the runtime's XML reader, with its limits, and become `sub` and `phoneme`
in the request, so that a voice fetches no lexicon.

## The player: the LTI platform role

The player launches the tools of LTI items from pages and endpoints of its own ([lti-platform.md](docs/player/lti-platform.md)).
A tool is code of another party, and its frame has `allow-same-origin`: it is the same origin as any page of the platform
on the player's origin, so the platform's handlers must never share that origin.

- Serve the platform's handlers from an origin of their own, which is neither the player's nor the assets', and serve
  nothing else from it. Every handler refuses a configuration in which two of the three coincide, and a request whose URL is for
  another origin; pass the public URL of the request.
- The authorization binds to a signed, single-use `lti_message_hint`, not to a cookie, so it works where the browser
  withholds third-party cookies. `once` must be atomic across the host's processes; a hint lasts five minutes.
- The hints, the line item identifiers and the access tokens are signed with the hint key and not encrypted: the tool can read
  the session, the item and the principal in them. Use identifiers that the tool may know. Changing the hint key ends them.
- The page that posts the `id_token` allows its one script by hash, forms only to the origin of the redirect URI and framing
  only by the player, and every value in it is encoded. Do not add headers that weaken the policy.
- A score reaches the host only from the tool of its line item, for the user of its launch, through a token with the
  `score` scope. Keep the latest score by `timestampMs`, and use only a score that is `FullyGraded`.

## Default limits

Every limit is a positive integer that a caller can replace per call, field by field, with the option named above its table;
a limit left out keeps its default. Input over a limit is a `SecurityError` whose `limit` is the limit's name, except a
regular expression, which is a `DataError` from `compileXsdRegex` and a `ProcessingError` in processing, and an action of a
client, which is a `DataError` from `parseCandidateAction`. Each default is a safety factor over the largest value among the
1EdTech QTI 3.0 examples, where the examples have one.

XML (`XmlLimits`; option `limits` of `parseXml`, `resolveIncludes`, `readAsi`, `readManifest` and the other readers, and
`xmlLimits` of `readPackage`, `openPackage` and `readPackageFile`):

| Limit             | Default    | Unit       | Largest example | Applies to                                                                  |
| ----------------- | ---------- | ---------- | --------------- | --------------------------------------------------------------------------- |
| `maxBytes`        | 33,554,432 | bytes      | 32 KiB          | One XML document.                                                           |
| `maxDepth`        | 256        | levels     | 16              | The nesting of elements in a document, and in a document with its includes. |
| `maxAttributes`   | 256        | attributes | 12              | One element.                                                                |
| `maxNodes`        | 1,000,000  | nodes      | 1,126           | A tree, and a tree with its includes resolved.                              |
| `maxIncludeDepth` | 8          | levels     | none            | The nesting of `xi:include`.                                                |

Archives and package directories (`ZipLimits`; option `limits` of `readPackage` and `readPackageFile`):

| Limit           | Default       | Unit    | Largest example | Applies to                                                                                               |
| --------------- | ------------- | ------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `maxEntries`    | 100,000       | entries | 99              | Entries of an archive, directories included; files and directories of a package directory.               |
| `maxEntryBytes` | 536,870,912   | bytes   | 5.0 MiB         | The uncompressed bytes of one file.                                                                      |
| `maxTotalBytes` | 2,147,483,648 | bytes   | 11.0 MB         | The uncompressed bytes of all files.                                                                     |
| `maxRatio`      | 250           | ratio   | 27.9            | The uncompressed size of an entry over its compressed size; entries of 102,400 bytes or less are exempt. |

The ratio 27.9 is that of a 7.5 KB entry; the entries above the exemption reach 3.6.

Processing (`ProcessingLimits`; option `limits` of the processing context and of `createEngine`):

| Limit              | Default | Unit   | Largest example | Applies to                                                     |
| ------------------ | ------- | ------ | --------------- | -------------------------------------------------------------- |
| `maxContainerSize` | 10,000  | values | 9               | The values of a container that a processing expression builds. |

Test plans (`PlanLimits`; option `limits` of `planTest` and of `createEngine`, which takes both kinds of limits):

| Limit          | Default | Unit  | Largest example | Applies to                                                                                         |
| -------------- | ------- | ----- | --------------- | -------------------------------------------------------------------------------------------------- |
| `maxPlanNodes` | 10,000  | nodes | 24              | The sections and items of a test plan, so that a selection with replacement cannot exhaust memory. |

Actions of a client (`ActionLimits`; option `limits` of `parseCandidateAction`):

| Limit               | Default   | Unit       | Largest example | Applies to                                                                                                                                    |
| ------------------- | --------- | ---------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxActionSize`     | 4,194,304 | JSON nodes | none            | One action: each string, number, boolean, `null`, array and object counts 1, and each string and property name adds its length in code units. |
| `maxPciStateLength` | 1,048,576 | characters | none            | The state of one portable custom interaction, in code units.                                                                                  |

Regular expressions (`XsdRegexLimits`; option `limits` of `compileXsdRegex`, whose defaults `qti-pattern-match` uses):

| Limit       | Default | Unit   | Largest example | Applies to                                                           |
| ----------- | ------- | ------ | --------------- | -------------------------------------------------------------------- |
| `maxStates` | 100,000 | states | none            | The automaton of a pattern, once its counted repeats are expanded.   |
| `maxDepth`  | 100     | levels | none            | The nesting of groups and character class subtractions in a pattern. |

These numbers are fixed and cannot be replaced:

| Number    | Applies to                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 100       | Runs of template processing for its constraints (INFO section 5.150), fixed by the specification.                                   |
| 256       | Levels of the JSON content of a view that `viewFromJson` reads, the depth that the XML reader allows.                               |
| 1,100     | The width and the precision of a printed variable format; a larger one is ignored.                                                  |
| 1,000,000 | Entries, states and transitions together, that the matcher of a pattern keeps of its automaton; beyond it the matcher starts again. |

Measured on Node.js 26 with documents built to reach each XML limit, a document at the limits takes under 2.5 seconds and
250 MB of heap to read. An archive or a container at the limits is bounded by its size: an entry is inflated in steps of
8 KiB of input and never beyond the size its header declares.

## Runtime dependencies

The packages that the runtime and the player load at run time are pinned to exact versions:

| Package        | Version | License | Used by                                                                                                                                                                                                                                            |
| -------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saxes`        | 6.0.0   | ISC     | `xml`: a namespace-aware parser that rejects documents that are not well-formed. It expands no entity but the five predefined ones and reads no DTD. It has not changed since 2021; if a defect needs a fix, the runtime forks it.                 |
| `xmlchars`     | 2.2.0   | MIT     | `xml`: the character and name tables of XML 1.0 (a dependency of `saxes`, also used by the writer).                                                                                                                                                |
| `fflate`       | 0.8.3   | MIT     | `package`: inflates the entries of ZIP archives in steps of 8 KiB, so that the output can be counted, and deflates the entries that `writePackage` writes. The runtime reads the central directory itself.                                         |
| `libxml2-wasm` | 0.7.2   | MIT     | `node`: libxml2 2.15.1 compiled to WebAssembly, which compiles and runs the XSD schemas.                                                                                                                                                           |
| `valibot`      | 1.5.0   | MIT     | The runtime and the player: the schemas that read untrusted JSON (actions, views, state, envelopes, answers of services, options). One function in `checks.ts` turns the first issue into a `DataError` that names its path. It has no dependency. |
| `jose`         | 6.2.12  | MIT     | The player `lti`: signs and verifies the JWS and JWT of LTI messages, assertions and hints (algorithm allowlist, `crit`, `iss`, `aud`, `sub`, `exp`), computes JWK thumbprints and fetches key sets. Web Crypto only.                              |
| `uuid`         | 14.0.3  | MIT     | The player `caliper`: the name-based UUID of version 5 (RFC 9562) of the identifiers of events, attempts, scores, items and sections.                                                                                                              |
