---
"@assesskit/runtime": minor
---

`Engine.apply` and `stamp` read an action through one schema, the one that `readCandidateAction` reads, in place of a second checker written by hand. An action that either refused before is refused still, now with the message of that schema: `The action is invalid at active: expected true or false, found "yes".` in place of `The active of support must be a boolean, found "yes".`, and likewise for the fields of `move`, `support`, `support-settings`, `set-responses`, `supply-scores` and `cat-response`. A field that is missing reads `missing the property`. `writeCandidateAction` refuses a property that the action's type does not have, which it dropped before; the time `at` is still not written. `@assesskit/runtime/delivery/wire` exports `CANDIDATE_ACTION_TYPES`, the types of the actions of a candidate in the order of a view.
