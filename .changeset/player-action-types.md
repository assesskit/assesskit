---
"@assesskit/player": major
---

`@assesskit/player/server` no longer exports `CANDIDATE_ACTION_TYPES`: the list has one owner, `@assesskit/runtime/delivery/wire`, which now exports it. A host that allows every action imports it from there. `EXAM_CLIENT_ACTIONS` and `CandidateActionType` stay.
