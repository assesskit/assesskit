---
"@assesskit/player": major
---

The options of `mountDelivery` and `mountItem` are flat: `customInteraction`, `voice` and `onError` are options of both, and `ltiLogin` and `tools` options of `mountDelivery`, where they were in `hooks`, which is gone. `mountItem` takes `MountOptions`, which holds `client` too; `ItemMountOptions` is gone, and `DeliveryOptions` extends `MountOptions`.

An upload of audio offers a recording when the `files` of a mount have `reserve` and `fill`, which come together: a host that offers no recording leaves both out. The option `record` of the mounts (`hooks.record`) is gone, with its refusal.

The option `resumeCheckMs` of `mountDelivery` is gone: the player checks a test that a proctor paused every 30 seconds, as it did by default, besides the button and the return of the page.

`Mounted` is `settled` and `destroy`: `update(view)` is gone. A mount follows its session client, and a host that has views of its own shows them through a `SessionClient` of its own.
