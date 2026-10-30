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
the height and the validity methods to the player. The static files of the frame are exported as `pci-frame/*`.

The tools of an item (`player`): `mountTools` shows a rule, a protractor, basic and standard calculators, a line reader,
answer masking, digital and physical materials, and slots for the tools that the host provides, for the companion
materials that olah reads and the supports of a candidate's profile.
