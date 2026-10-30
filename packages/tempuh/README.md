# tempuh

The player for QTI 3.0 content built on [olah](https://github.com/luthfanwakan/olah/tree/main/packages/olah): rendering,
the PCI host, accessibility applied in the UI and the server-side integrations. olah owns the QTI semantics and tempuh
owns the interface and the network, so tempuh never evaluates an expression, decides what is visible or valid, chooses a
variant, or holds an answer key outside olah's solution view.

The package is under development, private and not published. This version has the foundation: the errors, the interface
messages in English and Indonesian, the protocol between a browser and a session host, and the stylesheet of a content
root. It also has the frame of portable custom interactions: a sandboxed frame with its own content security policy,
RequireJS loading with fallback locations, and the communication bridge of the QTI 3.0 Best Practices and Implementation
Guide (§3.7.12). It also has the tools of an item: a rule, a protractor, basic and standard calculators, a line reader, answer
masking, materials, and slots for the tools that the host provides. It also has the tool role of LTI 1.3: the launch of a test by a learning platform, with its login, Deep Linking
response and access token. On the server it has the CAT engines for olah's `CatPort`:
item-level adaptive sections and multistage panels over takar, a client of the REST binding of CAT 1.0, and the deployment of a
package's adaptive sections.

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

| Import                             | Contents                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@luthfanwakan/tempuh`             | `TempuhError`, `DataError`, `AccessError`, `LtiError`, `ServiceError`; `Messages`, `EN_MESSAGES`, `ID_MESSAGES`, `selectMessages`                                                                                           |
| `@luthfanwakan/tempuh/player`      | `mountPciFrame`, `PciFrame`, `PciFrameOptions`, `PciModules`, `PciEvent`, `MIN_PCI_HEIGHT`, `MAX_PCI_HEIGHT`; `mountTools`, `ToolsInput`, `ToolSupport`, `ToolsOptions`, `ToolSlots`, `SlotTool`; the types of their fields |
| `@luthfanwakan/tempuh/protocol`    | `Caller`, `ActionEnvelope`, `ViewEnvelope` and `checkCaller`, `checkActionEnvelope`, `checkViewEnvelope`                                                                                                                    |
| `@luthfanwakan/tempuh/lti`         | `ltiLogin`, `ltiLaunch`, `deepLinkResponse`, `ltiAccessToken`, `createJwksCache` and the types of their arguments and results                                                                                               |
| `@luthfanwakan/tempuh/cat`         | `takarCatPort`, `takarPanelPort`, `restCatPort`, `deployCatSections`; `SectionStore`, `StoredSection`, `PanelParameters`, `OAuthClientCredentials`, `CatFetch`; the types of their options and results                      |
| `@luthfanwakan/tempuh/player.css`  | The stylesheet of a content root: themes, the QTI 3 shared vocabulary and the PNP presentation                                                                                                                              |
| `@luthfanwakan/tempuh/pci-frame/*` | The static files of the frame: `frame.html`, `require.js` and `bridge.js`                                                                                                                                                   |

## Documentation

- [Architecture](docs/architecture.md): principles, layers and errors.
- [Baseline](docs/baseline.md): the browser baseline, the banned features and how they are tested.
- [Portable custom interactions](docs/pci.md): the frame, its policy, loading, events and serving the files.
- [Protocol](docs/protocol.md): the caller and the envelopes.
- [LTI](docs/lti.md): the tool role of LTI 1.3, its checks and its deployment.
- [CAT](docs/cat.md): the CAT engines over takar and over REST, the section store and the deployment of a package.
- [Messages](docs/messages.md): the interface text and the choice of a catalog by language.
- [Styling](docs/styling.md): `player.css`, its themes, the PNP properties, the parts and the vocabulary.
- [Tools](docs/tools.md): the tools of an item, how they are shown and operated.
- [Evidence](docs/evidence.md): the inventory of rows and WCAG criteria, and the coverage gate.
