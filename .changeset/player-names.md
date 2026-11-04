---
"@assesskit/player": major
---

Every function is named by what it does, with one verb for one meaning: `readLexicon` (was `parseLexicon`), `createWebSpeech` (was `webSpeech`), `resolvePresentation` (was `presentationOf`), `mediaScale` (was `mediaScaleOf`), `listScopes` (was `scopesOf`), `resolveViewDocuments` (was `viewDocuments`), and from `@assesskit/player/scoring` `buildSubmission` (was `toSubmission`), `buildSupplyScores` (was `toSupplyScores`) and `buildSessionScore` (was `sessionScore`). The runtime functions that the player calls are renamed as well, see the changeset of `@assesskit/runtime`. No old name is kept as an alias.

The options of a call that waits on a store, a service or the host are `CallOptions`, with their `signal` (was `SessionCallOptions`, a name that the ports of files, assets and tool scores did not fit). The option that counts a long gap as a suspension carries its unit: `maxIdleMs`, in milliseconds, of `createLocalSession` and `createSessionHost` (was `maxIdle`).
