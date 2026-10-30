---
"@luthfanwakan/tempuh": major
---

The errors (`TempuhError`, `DataError`, `AccessError`, `LtiError`, `ServiceError`), the interface messages in English and
Indonesian with `selectMessages`, and the protocol between a browser and a session host: `Caller`, `ActionEnvelope` and
`ViewEnvelope` with their checks. The browser code runs in Chromium 111, Firefox 115 and Safari 16.4, and later versions.
The stylesheet `@luthfanwakan/tempuh/player.css` of a content root: the themes, the QTI 3 shared vocabulary and the PNP
presentation.

The frame of portable custom interactions (`player`): `mountPciFrame` puts an interaction in a sandboxed `iframe` of an
opaque origin that restricts itself with a content security policy, loads its modules with RequireJS from primary and
fallback locations, provides the communication bridge `qtiCustomInteractionContext`, and reports the response, the state,
the height and the validity methods to the player. It takes the interaction as olah reads it and locates its modules under
the asset prefix of the package with olah's module resolution. The variables travel as the JSON of BPIG Appendix C that
olah writes and reads, and the host's asynchronous storage serves the file callbacks of that codec: the bytes of files go
to the interaction before it starts, and the files it gives are stored before the response is delivered, as a value of the
declaration. The static files of the frame are exported as `pci-frame/*`.

The tools of an item (`player`): `mountTools` shows a rule, a protractor, basic and standard calculators, a line reader,
answer masking, digital and physical materials, and slots for the tools that the host provides, for the companion
materials that olah reads and the supports of a candidate's profile.

The tool role of LTI 1.3 in `@luthfanwakan/tempuh/lti`: the third-party initiated login with a state cookie or with the
platform's browser storage (LTI Client Side OIDC), the validation of the launch, a key set cache, the response to a Deep
Linking request and the access token of the client-credentials grant.

Computer adaptive testing on the server (`cat`): `takarCatPort` and `takarPanelPort` implement olah's `CatPort` in process over
takar, for item-level adaptive sections and multistage panels, with the `SectionStore` of parsed sections and the
`scalingConstant` of a bank on the normal-ogive metric. `restCatPort` speaks the REST/JSON binding of CAT 1.0 to one remote
engine over HTTPS with OAuth 2.0 client credentials, and `deployCatSections` creates the sections of a package's adaptive
selections at the engine and checks their pool. takar is a runtime dependency.
Mathematics and speech (`player`): `createMathTypesetter` typesets MathML with MathJax 4, which it loads from the host's URL
when a root has an expression, adopts MathJax's styles into shadow roots and leaves expressions with elementary math to the
browser. `buildSpeechRequest` reads a range of content into an SSML 1.1 document and plain text, applying SSML, `data-ssml`,
pronunciation lexicons (`parseLexicon`), suppression by reading type, content roles and the restriction types of the spoken
support. `webSpeech` voices a request with the Web Speech API, `echoTyping` repeats typing as the support asks, and
`applyReadingType` applies the reading type to the accessibility tree.

The platform role of LTI 1.3 in `@luthfanwakan/tempuh/lti`, which launches the tools of LTI items: the login with a signed,
single-use hint, the authorization that works with cookies blocked and answers with a page under a strict policy, the key set,
the token endpoint, and the line item and the scores of the grade services. The platform's handlers refuse a configuration in
which two of its origin, the player's and the assets' coincide.

The renderer of content (`player`): `createBodyRenderer` builds the DOM for olah's typed content nodes with `createElementNS`,
keeping the attributes of the model, ARIA and `data-*` attributes, resolving every reference through the package's `assets`
and the allowed origins, drawing an `object` by its type, and handing interactions to renderers that other units register.
`createContentRoot` shows an item with its stimuli, rubric and test feedback in a contained shadow root, with its sanitized
stylesheets, MathJax typesetting, a notice that withholds media where a hazard remains, cards on demand
(`ContentRoot.card`) and modal feedback in a dialog (`ContentRoot.showFeedback`).

Caliper 1.2 in `@luthfanwakan/tempuh/caliper`: `caliperEvents` maps the events of a step of a delivery session to the events of the
Assessment Profile (AssessmentEvent Started, Paused, Resumed and Submitted, AssessmentItemEvent Started, Skipped and Completed,
NavigationEvent NavigatedTo), `caliperGrade` gives the GradeEvent Graded of the Grading Profile for a score, and every identifier is a
name-based UUID of version 5 over the session, the step and the position, so that reporting a step again gives the same events.
`sendCaliper` posts them in an envelope to an endpoint over HTTPS with a bearer token. `forwardEvents` in
`@luthfanwakan/tempuh/server` gives every event of a step to the host's log, whatever its type, and the events that Caliper has a
counterpart for to the endpoint.

The interactions of text, choice and files (`player`): `createInteractionRenderers` draws choice, order, associate, match, gap
match, inline choice, text entry, extended text, hot text, slider, end attempt, media, upload and custom interactions as elements
that extend `InteractionElement`. The host gives an element the descriptor of olah, the response and whether the candidate can
respond, and hears `tempuh-response` and `tempuh-end-attempt`. A response that olah finds not valid gets a hint in text, tied to the
controls, in the words of the item where it has some; the limits are told before; and the interactions that put choices in places
work by pick-up and place, by keyboard and by drag, never only by drag. Text entry reads numbers with olah's `numericRecord`,
extended text has plain, preformatted and XHTML formats with counters, media counts plays as the response and keeps the pause
attributes in both spellings, and upload sends files through the host's storage and records audio with `MediaRecorder`, or as WAV
through the audio worklet that the package exports as `recorder-worklet.js`.
