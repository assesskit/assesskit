---
"@assesskit/player": major
---

A player for QTI 3.0 assessments in the browser, built on `@assesskit/runtime`. It draws items, stimuli and every
interaction, hosts portable custom interactions in a sandboxed frame, applies personal needs and preferences, and runs a
session with navigation, timers, review and feedback, in English and Indonesian. For exams it has the session host, the asset
gate that serves package files, scoring for raters with an accessible rating form for a scoring rubric (`mountRatingForm`), and adaptive testing. The
subpath `@assesskit/player/cat-rest` has both sides of the REST binding of CAT 1.0, `restCatPort` for the client of a remote
CAT engine and `catRestHandler` for the engine side, over web `Request` and `Response`. It stays on servers, because the client holds an OAuth
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
