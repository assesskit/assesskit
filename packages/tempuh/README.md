# tempuh

The player for QTI 3.0 content built on [olah](https://github.com/luthfanwakan/olah/tree/main/packages/olah): rendering,
the PCI host, accessibility applied in the UI and the server-side integrations. olah owns the QTI semantics and tempuh
owns the interface and the network, so tempuh never evaluates an expression, decides what is visible or valid, chooses a
variant, or holds an answer key outside olah's solution view.

The package is under development, private and not published. This version has the foundation: the errors, the interface
messages in English and Indonesian, and the protocol between a browser and a session host.

## Browser baseline

The browser code runs in Chromium 111, Firefox 115 and Safari 16.4, and later versions. [Baseline](docs/baseline.md) lists
what that allows, the features it bans and how the baseline is tested.

## Example

```ts
import { selectMessages } from "@luthfanwakan/tempuh";
import { checkActionEnvelope } from "@luthfanwakan/tempuh/protocol";

selectMessages("id-ID").toolRule; // "Penggaris"

const envelope: unknown = JSON.parse('{"seq":3,"action":{"type":"move"}}');
checkActionEnvelope(envelope);
envelope.seq; // 3
```

## API

| Import                          | Contents                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@luthfanwakan/tempuh`          | `TempuhError`, `DataError`, `AccessError`, `LtiError`, `ServiceError`; `Messages`, `EN_MESSAGES`, `ID_MESSAGES`, `selectMessages` |
| `@luthfanwakan/tempuh/protocol` | `Caller`, `ActionEnvelope`, `ViewEnvelope` and `checkCaller`, `checkActionEnvelope`, `checkViewEnvelope`                          |

## Documentation

- [Architecture](docs/architecture.md): principles, layers and errors.
- [Baseline](docs/baseline.md): the browser baseline, the banned features and how they are tested.
- [Protocol](docs/protocol.md): the caller and the envelopes.
- [Messages](docs/messages.md): the interface text and the choice of a catalog by language.
- [Evidence](docs/evidence.md): the inventory of rows and WCAG criteria, and the coverage gate.
