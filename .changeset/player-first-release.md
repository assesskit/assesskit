---
"@assesskit/player": major
---

A player for QTI 3.0 assessments in the browser, built on `@assesskit/runtime`. It draws items, stimuli and every
interaction, hosts portable custom interactions in a sandboxed frame, applies personal needs and preferences, and runs a
session with navigation, timers, review and feedback, in English and Indonesian. For exams it has the session host, the asset
gate that serves package files, scoring for raters, adaptive testing, LTI 1.3 as tool and platform, and Caliper events. The
client of a remote CAT engine is the subpath `@assesskit/player/cat-rest`, which stays on servers because it holds an OAuth
client secret. The session host and a practice session offer the host side of a session (`HostSession`) alike, through
`session(id)` and `host`: the host supplies external scores and reads pending work, scorer views and results, and a practice
session reports the events of each step to a listener. Session calls take an `AbortSignal`. With the option `cat`, a session host and a local session answer their own CAT
requests. The player runs in
Chromium 111, Firefox 115 and Safari 16.4, and later versions, and is tested with axe-core
at WCAG 2.2 levels A and AA. It is not certified by 1EdTech.
