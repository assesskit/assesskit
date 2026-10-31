---
"@assesskit/player": major
---

The errors `AccessError`, `LtiError` and `ServiceError`, which extend `AssesskitError` of `@assesskit/runtime/errors`, the
interface messages in English and
Indonesian with `selectMessages`, and the protocol between a browser and a session host: `Caller`, `ActionEnvelope` and
`ViewEnvelope` with their checks. The browser code runs in Chromium 111, Firefox 115 and Safari 16.4, and later versions.
The stylesheet `@assesskit/player/player.css` of a content root: the themes, the QTI 3 shared vocabulary and the PNP
presentation.

The frame of portable custom interactions (`player`): `mountPciFrame` puts an interaction in a sandboxed `iframe` of an
opaque origin that restricts itself with a content security policy, loads its modules with RequireJS from primary and
fallback locations, provides the communication bridge `qtiCustomInteractionContext`, and reports the response, the state,
the height and the validity methods to the player. It takes the interaction as the runtime reads it and locates its modules under
the asset prefix of the package with the runtime's module resolution. The variables travel as the JSON of BPIG Appendix C that
the runtime writes and reads, and the host's asynchronous storage serves the file callbacks of that codec: the bytes of files go
to the interaction before it starts, and the files it gives are stored before the response is delivered, as a value of the
declaration. The static files of the frame are exported as `pci-frame/*`.

The tools of an item (`player`): `mountTools` shows a rule, a protractor, basic and standard calculators, a line reader,
answer masking, digital and physical materials, and slots for the tools that the host provides, for the companion
materials that the runtime reads and the supports of a candidate's profile.

The tool role of LTI 1.3 in `@assesskit/player/lti`: the third-party initiated login with a state cookie or with the
platform's browser storage (LTI Client Side OIDC), the validation of the launch, a key set cache, the response to a Deep
Linking request and the access token of the client-credentials grant. The tokens, the assertions, the hints and the key sets
are handled by jose, a runtime dependency, which verifies RS256 only for the keys of platforms and tools and checks `iss`, `aud`,
`sub` and `exp`.

Computer adaptive testing on the server (`cat`): `restCatPort` speaks the REST/JSON binding of CAT 1.0 to one remote
engine over HTTPS with OAuth 2.0 client credentials, and `deployCatSections` creates the sections of a package's adaptive
selections at the engine and checks their pool. `measurekitCatPort` and `measurekitPanelPort` of `@assesskit/player/cat/measurekit`
implement the runtime's `CatPort` in process over measurekit, for item-level adaptive sections and multistage panels, with the
`SectionStore` of parsed sections and the `scalingConstant` of a bank on the normal-ogive metric. measurekit is an optional peer
dependency that only that subpath loads.
Mathematics and speech (`player`): `createMathTypesetter` typesets MathML with MathJax 4, which it loads from the host's URL
when a root has an expression, adopts MathJax's styles into shadow roots and leaves expressions with elementary math to the
browser. `buildSpeechRequest` reads a range of content into an SSML 1.1 document and plain text, applying SSML, `data-ssml`,
pronunciation lexicons (`parseLexicon`), suppression by reading type, content roles and the restriction types of the spoken
support. `webSpeech` voices a request with the Web Speech API, `echoTyping` repeats typing as the support asks, and
`applyReadingType` applies the reading type to the accessibility tree.

The platform role of LTI 1.3 in `@assesskit/player/lti`, which launches the tools of LTI items: the login with a signed,
single-use hint, the authorization that works with cookies blocked and answers with a page under a strict policy, the key set,
the token endpoint, and the line item and the scores of the grade services. The platform's handlers refuse a configuration in
which two of its origin, the player's and the assets' coincide.

The renderer of content (`player`): `createBodyRenderer` builds the DOM for the runtime's typed content nodes with `createElementNS`,
keeping the attributes of the model, ARIA and `data-*` attributes, resolving every reference through the package's `assets`
and the allowed origins, drawing an `object` by its type, and handing interactions to renderers that other units register.
`createContentRoot` shows an item with its stimuli, rubric and test feedback in a contained shadow root, with its sanitized
stylesheets, MathJax typesetting, a notice that withholds media where a hazard remains, cards on demand
(`ContentRoot.card`) and modal feedback in a dialog (`ContentRoot.showFeedback`).

Caliper 1.2 in `@assesskit/player/caliper`: `caliperEvents` maps the events of a step of a delivery session to the events of the
Assessment Profile (AssessmentEvent Started, Paused, Resumed and Submitted, AssessmentItemEvent Started, Skipped and Completed,
NavigationEvent NavigatedTo), `caliperGrade` gives the GradeEvent Graded of the Grading Profile for a score, and every identifier is a
name-based UUID of version 5 of the `uuid` package, a runtime dependency, over the session, the step and the position, so that
reporting a step again gives the same events. `caliperEvents` and `caliperGrade` answer synchronously. `sendCaliper` posts them
in an envelope to an endpoint over HTTPS with a bearer token. `forwardEvents` in `@assesskit/player/server` gives every
event of a step to the host's log, whatever its type, and the events that Caliper has a counterpart for to the endpoint.

The interactions of text, choice and files (`player`): `createInteractionRenderers` draws choice, order, associate, match, gap
match, inline choice, text entry, extended text, hot text, slider, end attempt, media, upload and custom interactions as elements
that extend `InteractionElement`. The host gives an element the descriptor of the runtime, the response and whether the candidate can
respond, and hears `ak-response` and `ak-end-attempt`. A response that the runtime finds not valid gets a hint in text, tied to the
controls, in the words of the item where it has some; the limits are told before; and the interactions that put choices in places
work by pick-up and place, by keyboard and by drag, never only by drag. Text entry reads numbers with the runtime's `numericRecord`,
extended text has plain, preformatted and XHTML formats with counters, media counts plays as the response and keeps the pause
attributes in both spellings, and upload sends files through the host's storage and records audio with `MediaRecorder`, or as WAV
through the audio worklet that the package exports as `recorder-worklet.js`.

The player shell (`player`): `mountDelivery` shows a session with a navigation map, timers with warnings 300 and 60 seconds
before a limit, actions with refusal messages and confirmations, review, solution, comments and attempts, in status regions that
never take the focus, and runs portable custom interactions with their state. It mounts the supports of the candidate: the panel, with a button for each option that sends the `support` action and the state of the other supports, the look, the size of media, the cards, reading aloud with the pronunciation lexicons of the item, and the notice of the variant; and the tools of the item and the profile (`hooks.tools` gives the tools of the host). Before a request that submits or leaves the item it waits for the interactions to hand over their responses (`settled`), so that a drawing that is still being stored is not missed; `Mounted.settled()` lets a host with its own chrome do the same. The session clients (`client`):
`createRemoteSession` sends envelopes with autosave and resends a request whose answer was lost, and `createLocalSession` runs
the runtime's engine on the device for practice and previews. The session host of exam mode (`server`): `createSessionHost` binds a
session to the principal that started it, applies a client-action policy that leaves `suspend` and `resume` to the proctor,
saves by version with bounded retries, schedules time-outs and answers a repeated sequence number with the stored answer.
`createAssetGate` serves package files only under signed prefixes in the path, never a file that can hold a key, and signs the
files of the candidate for five minutes.

External scoring in `@assesskit/player/scoring`: `toSubmission` turns the runtime's scorer view of one scoring request into a
`Submission` that is JSON as it is, with the outcome and its declaration, the covers as parts with their `presented` flag and
value, the rubric for the scorer, and for each covered item its body as the candidate saw it, its template values and its
correct responses, all values as the runtime's wire values. `toSupplyScores` builds the `supply-scores` action for one value and checks
it against the declaration, which the engine accepts after the test ended and replaces when it is supplied again.
`checkSubmission` in `@assesskit/player/protocol` checks a submission that arrived as JSON, and `mountSubmission` in
`@assesskit/player/player` shows it read-only to a rater in a shadow root, with the body and the rubric in content roots,
each response of the outcome, the correct responses, and files as images, players or links.

The graphic interactions (`player`): `createInteractionRenderers` also draws the hotspot, select point, graphic order, graphic
associate, graphic gap match, position object and drawing interactions as elements of the same kind. Their coordinates are
measured in the pixels the author declared for the image. A graphic associate dims the hotspots that the runtime's rules leave no pair
for, and a hotspot with a maximum of one choice clears when it is chosen again. Every interaction is answered with single clicks or
the keyboard alone, a drag has a choose-then-place form, and targets smaller than 24 pixels are enlarged. The drawing stores the
picture, in the media type of the image, through the host's `files`, and `settled()` of its element tells the host when it has.

The supports of a candidate (`player`), applied from the `SupportView`s of the runtime's view: `presentationOf` and
`applyPresentation` set the themes, colors, text appearance, zoom, single column and keyword emphasis that `player.css`
reads, on a content root and, through `PciFrame.setPresentation`, inside the frame of a portable custom interaction while it
runs. `mountSupportPanel` shows the supports that are options as toggle buttons that ask the host for the `support` action, and lists the others with their state.
`mountContentSupports` shows the cards of the catalogs in popups that meet WCAG 1.4.13, in place of the content or beside
it, shows caption and description tracks, and shows the alternative text of images. `mountSpoken` has the controls of
reading aloud, a word-by-word cursor and the typing echo, and takes the pronunciation lexicons of each item with `setLexicons`, and `mountVariantNotice` shows the variant that the runtime delivered with
its language. The tools take the supports of the view as they are. The content root has a `stage`, the element that holds the item and
that tools lie over, and `setMediaScale`, which enlarges media sized in pixels without drawing the item again. The documents of a view name the
pronunciation lexicons of the item (`lexicons`), and `createLocalSession` takes them from the host with its `lexicons` option.

LTI scores and LTI items. `publishScore` in `@assesskit/player/lti` posts the score of a finished test to the line item of
the launch that started it: `scoreGiven` is `SCORE` raised to 0, with `scoreMaximum` from `MAXSCORE` or the line item,
`gradingProgress` is `PendingManual` while a person must score, `Pending` while a scoring service must and `FullyGraded`
after, and only the results that the session host returned are accepted. `ltiPlatformFrame` and `platformStorage` serve the
frame of an LTI item: the player's `ltiLogin` hook shows the tool in a sandboxed frame beside a hidden frame of the platform's
storage page, which answers `lti.put_data` and `lti.get_data` for the tool's login, and refuses a tool served from the origin
of the page or of the assets. `createLtiScoreIntake` in `@assesskit/player/server` keeps the latest score of each line item
by its time and supplies a final score to the `SCORE` and `MAXSCORE` requests of the item.
