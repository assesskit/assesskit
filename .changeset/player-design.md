---
"@assesskit/player": major
---

The options of `mountDelivery` and `mountItem` are flat: `customInteraction`, `voice` and `onError` are options of both, and `ltiLogin` and `tools` options of `mountDelivery`, where they were in `hooks`, which is gone. `mountItem` takes `MountOptions`, which holds `client` too; `ItemMountOptions` is gone, and `DeliveryOptions` extends `MountOptions`.

An upload of audio offers a recording when the `files` of a mount have `reserve` and `fill`, which come together: a host that offers no recording leaves both out. The option `record` of the mounts (`hooks.record`) is gone, with its refusal.
