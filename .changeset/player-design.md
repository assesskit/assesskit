---
"@assesskit/player": major
---

The options of `mountDelivery` and `mountItem` are flat: `customInteraction`, `voice` and `onError` are options of both, and `ltiLogin` and `tools` options of `mountDelivery`, where they were in `hooks`, which is gone. `mountItem` takes `MountOptions`, which holds `client` too; `ItemMountOptions` is gone, and `DeliveryOptions` extends `MountOptions`.

An upload of audio offers a recording when the `files` of a mount have `reserve` and `fill`, which come together: a host that offers no recording leaves both out. The option `record` of the mounts (`hooks.record`) is gone, with its refusal.

The option `resumeCheckMs` of `mountDelivery` is gone: the player checks a test that a proctor paused every 30 seconds, as it did by default, besides the button and the return of the page.

`Mounted` is `settled` and `destroy`: `update(view)` is gone. A mount follows its session client, and a host that has views of its own shows them through a `SessionClient` of its own.

The step feed of `createSessionHost` is the option `onStep`, a `StepSink`: `forward: { log }` and `ForwardOptions` are gone.

The option `profileBreaks` of `createSessionHost` is gone, with the behavior of its default: a candidate whose profile has breaks (`environment` with `breaks`) may send `suspend` and `resume`. A program whose breaks all go through the proctor leaves `breaks` out of the profile that it starts the session with.

`BROWSER_CLOCK` (`@assesskit/player/client`) and `SYSTEM_CLOCK` (`@assesskit/player/server`) are no longer exported: they were one clock under two names, and the default of every `clock` option is the clock of the machine, `Date.now()`, as before. `Clock` is exported from `@assesskit/player/protocol` only.

`createAssetGate` takes a `clock`, the session host's, and `sign`, `signFile` and `serve` no longer take `now`: `sign(session, prefixes, options?)`, `signFile(session, file, options?)` and `serve(request, options?)`.

`createCatRestHandler(options)` takes no port: `authorize` answers `{ port }` with the port that serves the request, the engine or the port of the caller, and `true` is no longer a decision (`false` stays the bare 401). A host with one engine answers `{ port: engine }`; the stub port that refused everything for a mistaken `true` is no longer needed.

The option `engines` of `createRestCatPort` is a `CatEngineResolver` only, and `CatEngines` is gone: a host with a fixed set passes `(reference) => engines.get(reference)` over its `Map`, keyed by references without trailing slashes. Each engine is checked by the same schema at its first use, and a duplicate reference is no longer refused at creation.

`@assesskit/player/protocol` no longer exports `REFUSAL_REASONS`: import it from `@assesskit/runtime/delivery/wire`, which owns it, as `CANDIDATE_ACTION_TYPES`. `SuppliedGrade.scorer` is the runtime's `Scorer`, and `ToolSlots` is `Readonly<Partial<Record<SlotTool, ToolSlot>>>`, the same keys.
