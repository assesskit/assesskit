---
"@assesskit/runtime": minor
---

The schemas of the keys that the scoring operators read hold each field's default, and both a call and an item read a key through them. `buildOperatorCall` still writes every field, and its attribute `options` is the same, byte for byte. An item whose attribute leaves a field out is now read with the field at its default, where it was refused before.
