---
"@assesskit/player": major
---

A player for QTI 3.0 assessments in the browser, built on `@assesskit/runtime`. It draws items, stimuli and every
interaction, hosts portable custom interactions in a sandboxed frame, applies personal needs and preferences, and runs a
session with navigation, timers, review and feedback, in English and Indonesian. For exams it has the session host, the asset
gate that serves package files, scoring for raters with an accessible rating form for a scoring rubric (`mountRatingForm`), and adaptive testing. The
subpath `@assesskit/player/cat-rest` has both sides of the REST binding of CAT 1.0, `createRestCatPort` for the client of the remote
CAT engines that the host configured, which it reaches by the reference that a package names, and `createCatRestHandler` for the engine side, over web `Request` and `Response`, whose `authorize` step answers 401, 403 or with the port of the caller, and which refuses a body above `maxBodyBytes` as it arrives and one with more JSON tokens than `maxTokens` before it parses it. It stays on servers, because the client holds an OAuth
client secret. The session host and a practice session offer the host side of a session (`HostSession`) alike, through
`session(id)` and `host`: the host supplies external scores and reads pending work, scorer views and results, and a practice
session reports the events of each step to a listener. Session calls take an `AbortSignal`. With the option `cat`, a session host and a local session answer their own CAT
requests. `mountItem` shows the content and the interactions of one item alone, for a page with many items, with one status
region and a focus that moves only into a dialog of modal feedback. A practice session and a session host take `maxIdle`,
which counts a gap above it as suspended, and the host refuses it unless candidates may suspend. The player runs in
Chromium 111, Firefox 115 and Safari 16.4, and later versions, and is tested with axe-core
at WCAG 2.2 levels A and AA. It is not certified by 1EdTech.

LTI and Caliper are in [interopkit](https://github.com/interopkit/interopkit) as `@interopkit/tool-integration` and
`@interopkit/learning-analytics`. The player keeps four ports: `LtiLogin` and the frame of an LTI item (`player`),
`forward.log` and `createToolScoreIntake` with `ToolScoreStore` (`server`), and `sessionScore` (`scoring`). The mapping of
delivery events to Caliper events, the outbox and the jobs that publish a grade are in the example
`examples/player/lms-integration`. `forward` takes only `log`, `HostApplyOptions.scoredBy` is a non-empty string, and `LtiLogin`
takes a `signal`. The CAT client refuses a redirect (`redirect: "manual"`) with a `ServiceError`.

After the end of a test that the engine lets the candidate review, the navigation map lists the items presented and reviews the
one chosen.

A candidate whom a proctor paused learns of the resume through `SessionClient.refresh`, which sends a view request to
`SessionHost.handle`; the player asks on a button, when the page becomes visible and every `resumeCheckMs`. The asset gate
serves the files of a package with `Content-Security-Policy: sandbox`, so that a hostile page runs no script on the asset
origin. A mount can use the element of a destroyed mount again, importing the package where there is no document is safe, and
`mountDelivery` holds the player in a `region` under a heading of level 2 unless `landmark` and `headingLevel` say otherwise.

A recording names its file as it starts, and its bytes follow: `MountFiles` has `reserve` and `fill` (required unless `hooks.record` is
`false`), the response holds the reserved file from the start of the recording, and a time limit, a proctor, Next or the end of the mount
that stops the recording leaves the answer in the results while the bytes arrive. The attributes `data-ak-record-start`,
`data-ak-record-limit` and `data-ak-record-once` of `qti-upload-interaction` start a recording by itself after a countdown, limit it to
at most `MAX_RECORDING_SECONDS`, and allow one recording only.

`LocalStore.save` takes `{ state, events }`: the state and the events of the step that made it, in one write. `toSupplyScores` reads only the `id`,
`outcome` and `declaration` of its request, so that a rater's page passes the fields of a `Submission`. The option `cat` of a session host and of a local session is a
`CatSessionPort`. `data-ak-count="words"` on an extended text shows the words typed, with the message `counterWords`; the text areas and the editor ask the browser for no
spell check, correction, capital letters or completion, and the support `spell-checker-on-screen` turns the spell check on.

The content root gives a tablist the keys of the ARIA tabs pattern, keeps the tab of a stimulus that items share, and lets the
candidate sort a table by a column that has `aria-sort`. The custom supports `ext:highlighter` and `ext:eliminator` put a
highlighter, which marks the words of the item and keeps them by item and stimulus, and an answer eliminator, which crosses out
choices, in the toolbar. With the option `marking`, `mountDelivery` offers Mark for review in a nonlinear part, and the map names
a marked item. The guide of the server has the recipe of a review step with a cap on changes, as a wrapper of the `Engine`.
The frame of a portable custom interaction takes a relative URL from `assets`, resolved against the base URL of the page, and
refuses at mount a module of the package on an origin that the frame loads no scripts from, the origin of `staticUrl` and
`origins`. The counters of an extended text are labels before the number (`Words: 1`), so that no noun has to agree with it.

A WAV recording that has not started in 5 seconds, because the audio context stays suspended where the device has no audio output or the worklet does not load, stops waiting: the player says that the recording could not start (`uploadNotStarted`), reports an `AssesskitError` to `hooks.onError`, lets go of the context and the microphone, and leaves Record available.

The panel of the supports has a list for each setting that the candidate may change while its support is on, and sends the
choice as the runtime's `support-settings` action, so that the state keeps it for later items and after a reload: the 14 color
themes of the best practices guide, so that a candidate can change the theme at any time and go back to the default colors, and
the amount of magnification from 100 to 400 percent, of all content or of text and of images apart, as the guide asks, and the
rate, pitch, volume, link indication and typing echo of the voice that reads aloud.
`mountSupportPanel` takes `onSettings` and `language`, a host that draws its own control sends the action through the session
client, and `player.css` has the palettes under `data-ak-theme`. The two gray themes keep the 3:1 to 4:1 of the guide, below WCAG
on purpose. At 400 percent the content reflows in a page 1280 pixels wide with no scrolling in two directions.

The tools build in the scientific calculator beside the basic and standard ones, for an item's `qti-calculator-type` or the
`calculator-type` of the profile: the keys of the best practices guide (inverse and hyperbolic functions, trigonometry in
degrees, radians or gradians, π and e, squares, cubes, powers and roots, logarithms, the reciprocal, the factorial,
permutations, combinations and parentheses), the order of operations, and a line of the operations that wait. Each number of a
calculator keeps all its digits for the next operation. The slot `scientific-calculator` of a host replaces the built-in one;
the graphing calculator stays a slot of the host.

A candidate whose profile has breaks may send `suspend` and `resume` to a session host beside its `clientActions`, so that the
candidate pauses the exam and returns to every response with the clocks stopped meanwhile; `profileBreaks: false` leaves those
breaks to the proctor.
