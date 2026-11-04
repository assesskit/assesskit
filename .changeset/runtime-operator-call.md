---
"@assesskit/runtime": major
---

`buildOperatorCall` reads a call and its follow-through with strict schemas, so a misspelled `followThrough` is refused and not ignored. A call that is not an object or names an unknown operator now reports `The call is invalid`.
