---
"@assesskit/player": major
---

`ServiceError` is no longer exported from `@assesskit/player`: import it from `@assesskit/runtime/errors`.

`@assesskit/player/protocol` exports the wire types and the `LTI_*` names only: `checkActionEnvelope`, `checkViewEnvelope`, `checkCaller`, `checkAllowList`, `checkLtiFrame`, `checkSubmission`, `isOfficialResult`, `resolveViewDocuments`, `DocumentSource` and `ItemDocuments` are no longer exported, because what receives a value already runs its check (`SessionHost.handle`, `createRemoteSession`, `mountSubmission`, the LTI slot, `buildSessionScore`), and `checkRefusal` is gone, because `checkViewEnvelope` reads a refusal. `REFUSAL_REASONS` stays.

`buildSpeechRequest`, `SpeechOptions`, `echoTyping`, `TypingEchoOptions` and `applyReadingType` are no longer exported from `@assesskit/player/player`: `mountSpoken` holds all three, and a host replaces the voice through `SpeechHook`, which gets the request. `mountSpoken` checks the items of its `lexicons` option when it mounts (it checked only that the option was an array).

`AUTOSAVE_MS`, `FLUSH_BEFORE_DEADLINE_MS` (`@assesskit/player/client`), `MAX_SAVE_RETRIES`, `DEFAULT_TTL_SECONDS`, `DEFAULT_UPLOAD_TTL_SECONDS` and `collectAssetPrefixes` (`@assesskit/player/server`) are no longer exported: no consumer reads them, the guides state each value, and the session host collects the prefixes itself.

The option that holds catalogs by language is `catalogs` (was `messages`) on `mountDelivery`, `mountItem`, `mountSubmission` and `mountRatingForm`, as `selectMessages` calls it; `messages` keeps meaning one `Messages` everywhere else.

`mountPciFrame`, `PciFrame`, `PciFrameOptions`, `PciEvent`, `PciFailure`, `PciFiles`, `PciRequestedStatus`, `PciStatus`, `PciVariable`, `MIN_PCI_HEIGHT` and `MAX_PCI_HEIGHT` are no longer exported from `@assesskit/player/player`, and the 132 lines that checked the options of the frame are gone: `mountItem` and `mountDelivery` host each portable custom interaction in the same frame, from a view. The origins that a mount gives to the frames are the normalized `URL.origin` of the option `origins`.

`createBodyRenderer`, `BodyRenderer`, `BodyRendererOptions`, `InteractionRenderer`, `InteractionRenderers`, `createInteractionRenderers`, `InteractionOptions`, `InteractionFiles`, `defineElements`, `InteractionElement`, `RESPONSE_EVENT`, `ResponseEvent`, `ResponseDetail`, `END_ATTEMPT_EVENT`, `EndAttemptEvent`, `EndAttemptDetail` and `MAX_RECORDING_SECONDS` are no longer exported from `@assesskit/player/player`, and the option `interactions` of `createContentRoot` and `mountSubmission` is gone: `mountItem` and `mountDelivery` draw all 20 interactions, `createContentRoot` draws content (an interaction is a placeholder in it, as it is in `mountSubmission`, which shows the response beside it), and a session of one's own goes through `SessionClient`. `CustomInteractionHook` and `CustomInteractionState` stay for `qti-custom-interaction`.

`TOOL_SUPPORT_NAMES`, `ToolSupportName`, `mountVariantNotice`, `VariantNotice` and `VariantNoticeOptions` are no longer exported from `@assesskit/player/player`: the mounts draw the notice of the variant, and `ToolSlots` and its types stay as the host's hook for the elective tools.
