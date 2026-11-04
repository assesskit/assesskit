---
"@assesskit/player": major
---

`ServiceError` is no longer exported from `@assesskit/player`: import it from `@assesskit/runtime/errors`.

`@assesskit/player/protocol` exports the wire types and the `LTI_*` names only: `checkActionEnvelope`, `checkViewEnvelope`, `checkCaller`, `checkAllowList`, `checkLtiFrame`, `checkSubmission`, `isOfficialResult`, `resolveViewDocuments`, `DocumentSource` and `ItemDocuments` are no longer exported, because what receives a value already runs its check (`SessionHost.handle`, `createRemoteSession`, `mountSubmission`, the LTI slot, `buildSessionScore`), and `checkRefusal` is gone, because `checkViewEnvelope` reads a refusal. `REFUSAL_REASONS` stays.
