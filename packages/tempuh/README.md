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
masking, materials, and slots for the tools that the host provides. It also has LTI 1.3: the tool role, the launch of a test by a learning platform, with its login, Deep Linking
response and access token, and the platform role, which launches the tools of LTI items. On the server it has the CAT engines for olah's `CatPort`:
item-level adaptive sections and multistage panels over takar, a client of the REST binding of CAT 1.0, and the deployment of a
package's adaptive sections. It also has Caliper 1.2: the events of a session as Caliper events of the Assessment Profile and the
Grading Profile, identifiers that stay the same when a step is reported again, the sensor that sends them, and the forwarding
of each step's events to the host's log and to Caliper.
Mathematics is typeset with MathJax 4, loaded from the host's URL when an item has an expression, and speech is read aloud from SSML, `data-ssml` and pronunciation lexicons through a voice of the host or the browser.
Content is drawn by a renderer from olah's typed nodes, with a policy for attributes and references that keeps script out, and a content root that shows an item with its stimuli in a shadow root, with sanitized stylesheets, cards on demand, a hazard notice and modal feedback.
The interactions that take text, choices and files are drawn too: choice, order, associate, match, gap match, inline choice, text entry, extended text, hot text, slider, end attempt, media, upload with recording, and the hook for custom interactions. Each is an element that the host gives a descriptor and a value and that sends the responses back, with hints for a response that breaks a rule and a way to answer without a drag.

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

| Import                                     | Contents                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@luthfanwakan/tempuh`                     | `TempuhError`, `DataError`, `AccessError`, `LtiError`, `ServiceError`; `Messages`, `EN_MESSAGES`, `ID_MESSAGES`, `selectMessages`                                                                                                                                                                  |
| `@luthfanwakan/tempuh/player`              | `mountPciFrame`, `PciFrame`, `PciFrameOptions`, `PciEvent`, `PciVariable`, `PciFiles`, `MIN_PCI_HEIGHT`, `MAX_PCI_HEIGHT`; `mountTools`, `ToolsInput`, `ToolSupport`, `ToolsOptions`, `ToolSlots`, `SlotTool`; the types of their fields                                                           |
| `@luthfanwakan/tempuh/player`              | `createContentRoot`, `ContentRoot`, `ContentRootOptions`, `RootContent`, `ContentPart`, `StylesheetFetch`; `createBodyRenderer`, `BodyRenderer`, `BodyRendererOptions`, `InteractionRenderer`, `InteractionRenderers`                                                                              |
| `@luthfanwakan/tempuh/player`              | `createInteractionRenderers`, `InteractionOptions`, `InteractionFiles`, `CustomInteractionHook`, `CustomInteractionState`, `defineElements`, `InteractionElement`, `ResponseEvent`, `ResponseDetail`, `RESPONSE_EVENT`, `EndAttemptEvent`, `EndAttemptDetail`, `END_ATTEMPT_EVENT`                 |
| `@luthfanwakan/tempuh/player`              | `createMathTypesetter`, `MathTypesetter`                                                                                                                                                                                                                                                           |
| `@luthfanwakan/tempuh/player`              | `buildSpeechRequest`, `SpeechOptions`, `SpeechRequest`, `SpeechSettings`, `SpeechHook`, `webSpeech`, `echoTyping`, `TypingEchoOptions`, `applyReadingType`, `parseLexicon`, `Lexicon`, `Pronunciation`                                                                                             |
| `@luthfanwakan/tempuh/protocol`            | `Caller`, `ActionEnvelope`, `ViewEnvelope` and `checkCaller`, `checkActionEnvelope`, `checkViewEnvelope`                                                                                                                                                                                           |
| `@luthfanwakan/tempuh/lti`                 | Tool role: `ltiLogin`, `ltiLaunch`, `deepLinkResponse`, `ltiAccessToken`, `createJwksCache`. Platform role: `ltiPlatformLogin`, `ltiPlatformAuthorize`, `platformJwks`, `platformToken`, `agsLineItem`, `agsScores`, `readAgsScore`, `platformEndpoints`. The types of their arguments and results |
| `@luthfanwakan/tempuh/cat`                 | `takarCatPort`, `takarPanelPort`, `restCatPort`, `deployCatSections`; `SectionStore`, `StoredSection`, `PanelParameters`, `OAuthClientCredentials`, `CatFetch`; the types of their options and results                                                                                             |
| `@luthfanwakan/tempuh/caliper`             | `caliperEvents`, `caliperGrade`, `sendCaliper`, `CALIPER_CONTEXT`; `CaliperEvent`, `CaliperEntity`, `CaliperContext`, `CaliperParties`, `CaliperGrade`, `SendCaliperOptions`, `CaliperFetch`                                                                                                       |
| `@luthfanwakan/tempuh/server`              | `forwardEvents`, `StepEvents`, `ForwardOptions`, `CaliperForwarding`                                                                                                                                                                                                                               |
| `@luthfanwakan/tempuh/player.css`          | The stylesheet of a content root: themes, the QTI 3 shared vocabulary and the PNP presentation                                                                                                                                                                                                     |
| `@luthfanwakan/tempuh/pci-frame/*`         | The static files of the frame: `frame.html`, `require.js` and `bridge.js`                                                                                                                                                                                                                          |
| `@luthfanwakan/tempuh/recorder-worklet.js` | The program of the audio worklet of a WAV recording                                                                                                                                                                                                                                                |

## Documentation

- [Architecture](docs/architecture.md): principles, layers and errors.
- [Baseline](docs/baseline.md): the browser baseline, the banned features and how they are tested.
- [Content](docs/content.md): the renderer, the content root, references, stylesheets, cards and feedback.
- [Portable custom interactions](docs/pci.md): the frame, its policy, loading, events and serving the files.
- [Mathematics](docs/math.md): MathJax by URL, shadow roots, elementary math and braille.
- [Speech](docs/speech.md): the speech request, SSML, `data-ssml`, lexicons, restriction types, voices and the typing echo.
- [Protocol](docs/protocol.md): the caller and the envelopes.
- [LTI](docs/lti.md): the tool role of LTI 1.3, its checks and its deployment.
- [LTI platform](docs/lti-platform.md): the platform role, its three origins, the signed hints, the token endpoint and the grade services.
- [CAT](docs/cat.md): the CAT engines over takar and over REST, the section store and the deployment of a package.
- [Caliper](docs/caliper.md): the mapping from the events of a session, the identifiers, scores, sending, and forwarding a step's events.
- [Interactions](docs/interactions.md): the elements of the interactions, their responses, hints and keys, the board, media, upload and recording.
- [Messages](docs/messages.md): the interface text and the choice of a catalog by language.
- [Styling](docs/styling.md): `player.css`, its themes, the PNP properties, the parts and the vocabulary.
- [Tools](docs/tools.md): the tools of an item, how they are shown and operated.
- [Evidence](docs/evidence.md): the inventory of rows and WCAG criteria, and the coverage gate.
