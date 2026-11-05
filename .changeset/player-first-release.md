---
"@assesskit/player": major
---

A player for QTI 3.0 assessments in the browser, built on `@assesskit/runtime`. It draws items, stimuli and every
interaction, hosts portable custom interactions in a sandboxed frame, applies personal needs and preferences, and runs a
session with navigation, timers, review and feedback, in English and Indonesian: the player carries English, and the
Indonesian catalog is the module `@assesskit/player/messages-id`, which a host passes as the catalog for `id` in the option
`catalogs` or to `selectMessages(language, { catalogs })`, so that a host loads only the languages it shows. For exams it has
the session host, the asset gate that serves package files, scoring for raters with an accessible rating form for a scoring
rubric (`mountRatingForm`), and adaptive testing. The player runs in Chromium 111, Firefox 115 and Safari 16.4, and later
versions, and is tested with axe-core at WCAG 2.2 levels A and AA. It is not certified by 1EdTech.

The remote session of an exam page is `@assesskit/player/client`, and the local session of practice is
`@assesskit/player/client/local`, so that a page imports only the session it runs: the client of an exam page holds no
engine in any bundler, and the local session loads the engine with `import()` at its first call. The session host and a
practice session offer the host side of a session (`HostSession`) alike, through `session(id)` and `host`: the host
supplies external scores and reads pending work, scorer views and results, and a practice session reports the events of each
step to a listener. The step feed of `createSessionHost` is the option `onStep`, a `StepSink`. With the option `cat`, a
`CatSessionPort`, a session host and a local session answer their own CAT requests. A practice session and a session host
take `maxIdleMs`, which counts a gap above it as suspended, and the host refuses it unless candidates may suspend; they take
a `clock`, by default the clock of the machine. `createSessionHost` takes a `scheduler`, which a host of untimed practice
leaves out: without one it refuses an engine whose test has a maximum time anywhere (`Engine.hasMaximumTime`) with a
`DataError`, so that no candidate meets the refusal halfway through a sitting. A candidate whose profile has breaks (the
support `environment` with `breaks` on) may send `suspend` and `resume` to a session host beside its `clientActions`, and
comes back to every response with the clocks stopped meanwhile; a program whose breaks all go through the proctor leaves
`breaks` out of the profile. `createSessionHost` and `createRemoteSession` check their `limits` as they are made, so that a misspelled limit fails
there and not at each action. `LocalStore.save` takes `{ state, events }`: the state and the events of the step that made
it, in one write. Every call that waits on a store, a service or the host takes the `CallOptions` of
`@assesskit/runtime/checks`, with its `signal`, and every options object is read by a strict reader that refuses an option
the function does not take, whatever its type.

`mountDelivery` and `mountItem` take flat options: `client`, `catalogs`, `customInteraction`, `voice`, `onError` and the
others of `MountOptions` for both, and `ltiLogin`, `tools`, `marking`, `landmark` and `headingLevel` for `mountDelivery`.
A mount returns `settled` and `destroy`, and follows its session client; a host that has views of its own shows them through
a `SessionClient` of its own. `mountItem` shows the content and the interactions of one item alone, for a page with many
items, with one status region and a focus that moves only into a dialog of modal feedback. Both mounts draw all 20
interactions, host each portable custom interaction in the same frame from a view, draw the notice of a variant, and adopt
the stylesheets of the test before those of the item, in the content root and in the frames, and the gate signs the folder
that holds them. `createContentRoot` draws content, in which an interaction is a placeholder, as it is in `mountSubmission`,
which shows the response beside it. `mountDelivery` holds the player in a `region` under a heading of level 2 unless
`landmark` and `headingLevel` say otherwise, and a mount can use the element of a destroyed mount again. After the end of a
test that the engine lets the candidate review, the navigation map lists the items presented and reviews the one chosen.
With the option `marking`, `mountDelivery` offers Mark for review in a nonlinear part, and the map names a marked item. A
candidate whom a proctor paused learns of the resume through `SessionClient.refresh`, which sends a view request to
`SessionHost.handle`; the player asks on a button, when the page becomes visible and every 30 seconds. The status lines, the
line of the timer warnings, the line of an upload, which holds its status, its clock and the stored file in the height of a
button, and the notice of a media interaction whose rules can hold its playback keep their room whether or not they hold
text, so that writing a message moves nothing under a pointer; a line stays announced (`role="status"`).

The frame of a portable custom interaction takes a relative URL from `assets`, resolved against the base URL of the page,
and refuses at mount a module of the package on an origin that the frame loads no scripts from, the origin of `staticUrl`
and `origins`; the origins that a mount gives to the frames are the normalized `URL.origin` of the option `origins`. The asset
gate serves the files of a package with `Content-Security-Policy: sandbox`, so that a hostile page runs no script on the
asset origin; `createAssetGate` takes the session host's `clock`, and `sign(session, prefixes, options?)`,
`signFile(session, file, options?)` and `serve(request, options?)` read it. `checkViewEnvelope` refuses an asset prefix that
is not a directory, empty or ending in `/`, as the gate signs them, which refuses `__proto__`, `prototype` and `constructor`,
and `checkSubmission` reads the content as a view carries it, so a property with one of those names at any depth, and
`null`, are refused. A QTI metadata record and its context of a portable custom interaction refuse a list.

An upload of audio offers a recording when the `files` of a mount have `reserve` and `fill`, which come together: a host that
offers no recording leaves both out. A recording names its file as it starts, and its bytes follow: the response holds the
reserved file from the start of the recording, and a time limit, a proctor, Next or the end of the mount that stops the
recording leaves the answer in the results while the bytes arrive. The attributes `data-ak-record-start`,
`data-ak-record-limit` and `data-ak-record-once` of `qti-upload-interaction` start a recording by itself after a countdown,
limit it to at most 600 seconds, and allow one recording only. A WAV recording that has not started in 5 seconds, because the
audio context stays suspended where the device has no audio output or the worklet does not load, stops waiting: the player
says that the recording could not start (`uploadNotStarted`), reports an `AssesskitError` to `onError`, lets go of the
context and the microphone, and leaves Record available. `data-ak-count="words"` on an extended text shows the words typed,
with the message `counterWords`, as a label before the number (`Words: 1`); the text areas and the editor ask the browser for
no spell check, correction, capital letters or completion, and the support `spell-checker-on-screen` turns the spell check
on.

The content root gives a tablist the keys of the ARIA tabs pattern, keeps the tab of a stimulus that items share, and lets
the candidate sort a table by a column that has `aria-sort`. The custom supports `ext:highlighter` and `ext:eliminator` put
a highlighter, which marks the words of the item and keeps them by item and stimulus, and an answer eliminator, which crosses
out choices, in the toolbar. `ToolSlots` has one documented, optional property for each elective tool of the host, of the
type `ToolSlot`. The tools build in the scientific calculator beside the basic and standard ones, for an item's
`qti-calculator-type` or the `calculator-type` of the profile: the keys of the best practices guide (inverse and hyperbolic
functions, trigonometry in degrees, radians or gradians, π and e, squares, cubes, powers and roots, logarithms, the
reciprocal, the factorial, permutations, combinations and parentheses), the order of operations, and a line of the
operations that wait. Each number of a calculator keeps all its digits for the next operation. The slot
`scientific-calculator` of a host replaces the built-in one; the graphing calculator stays a slot of the host.

The panel of the supports has a list for each setting that the candidate may change while its support is on, and sends the
choice as the runtime's `support-settings` action, so that the state keeps it for later items and after a reload: the 14
color themes of the best practices guide and the size of text, so that a candidate can change them at any time and go back
to the default colors, the amount of magnification from 100 to 400 percent, of all content or of text and of images apart,
as the guide asks, the rate, pitch, volume, link indication and typing echo of the voice that reads aloud, and the delivery,
grade, kind and mathematics of braille, which choose the files of a braille or tactile card through
`ContentRoot.card(idref, support, { language, braille })`. `mountSupportPanel` takes `onSettings` and `language`, a host
that draws its own control sends the action through the session client, and `player.css` has the palettes under
`data-ak-theme`. The two gray themes keep the 3:1 to 4:1 of the guide, below WCAG on purpose. At 400 percent the content
reflows in a page 1280 pixels wide with no scrolling in two directions. `mountSpoken` reads aloud, echoes typing and applies
the reading type, checks the items of its `lexicons` option when it mounts, and a host replaces the voice through
`SpeechHook`, which gets the request.

The subpath `@assesskit/player/cat-rest` has both sides of the REST binding of CAT 1.0. `createRestCatPort` is the client of
the remote CAT engines that the host configured, which it reaches by the reference that a package names through the option
`engines`, a `CatEngineResolver`; it passes the signal of a call to its request and to the resolver, ends the call's wait for
a token without stopping the token request that the calls share, and refuses a redirect (`redirect: "manual"`) with a
`ServiceError` and an answer with more JSON tokens than `maxTokens`. It stays on servers, because it holds an OAuth client
secret. `createCatRestHandler(options)` is the engine side, over web `Request` and `Response`: its `authorize` step answers
`{ port }` with the port that serves the request, `false` for a bare 401, or `{ denied }` for a 401 of an invalid token or a
403 of a missing scope, and the handler gives the port the signal of the request. It answers 413 for a body above `maxBodyBytes` as it arrives or with more JSON tokens than `maxTokens` before it
parses it, and 400 for a property named `__proto__`, `prototype` or `constructor` at any depth of a body; an answer of an
engine or a token endpoint with one of those names is a `DataError`. `deployCatSections(pkg, port, { signal })` deploys the
sections of a package. A refused answer of a CAT engine is a `DataError` inside the loop's `ServiceError`.

`AccessError` and the errors of the runtime take `ErrorOptions` last, and an error that reports another holds it as `cause`.
`AccessError.reason` is the exported union `AccessErrorReason`: `not-bound` or `session-exists`. The refusal of a view
envelope is `{ reason, message }`, with the reasons of `REFUSAL_REASONS` of `@assesskit/runtime/delivery/wire`, which also
owns `CANDIDATE_ACTION_TYPES`; `@assesskit/player/server` has `EXAM_CLIENT_ACTIONS` and `CandidateActionType`.
`@assesskit/player/protocol` exports the wire types and the `LTI_*` names, and `Clock`; what receives a value runs its check
(`SessionHost.handle`, `createRemoteSession`, `mountSubmission`, the LTI slot, `buildSessionScore`). Every function is named
by what it does, with one verb for one meaning: `readLexicon`, `createWebSpeech`, `resolvePresentation`, `mediaScale` and
`listScopes`, and from `@assesskit/player/scoring` `buildSubmission`, `buildSupplyScores`, which reads only the `id`,
`outcome` and `declaration` of its request, so that a rater's page passes the fields of a `Submission`, and
`buildSessionScore`.

LTI and Caliper are in [interopkit](https://github.com/interopkit/interopkit) as `@interopkit/tool-integration` and
`@interopkit/learning-analytics`. The player keeps four ports: `LtiLogin`, which takes a `signal`, and the frame of an LTI item
(`player`), the option `onStep` and `createToolScoreIntake` with `ToolScoreStore` (`server`), and `buildSessionScore`
(`scoring`). The mapping of delivery events to Caliper events, the outbox and the jobs that publish a grade are in the
example `examples/player/lms-integration`. `HostApplyOptions.scoredBy` is a non-empty string.
