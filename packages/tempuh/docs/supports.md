# Supports

A candidate's personal needs and preferences (PNP) arrive in olah's view as `SupportView`s: a `name`, a `state`, whether
the support is `active`, and the `settings` of the profile ([BPIG] §5). tempuh applies each support that is on. It does not
decide which candidate has which support, and it does not choose the variant: olah does both, and tempuh shows the result.

| Part                                  | What it does                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `presentationOf`, `applyPresentation` | The look: themes, colors, text size and face, spacing, zoom, single column, keyword emphasis |
| `mountSupportPanel`                   | The buttons that turn the supports that are options on and off                               |
| `mountContentSupports`                | Cards of the catalog, text tracks of media and the alternative text of images                |
| `mountSpoken`                         | Reading aloud: the controls, the word-by-word cursor, the typing echo and the reading type   |
| `mountVariantNotice`                  | The variant that olah delivered, and its language                                            |
| `PciFrame.setPresentation`            | The look inside the frame of a portable custom interaction ([PCI](pci.md))                   |
| `mountTools`                          | The tools that supports put on the screen ([tools](tools.md))                                |

The parts do not navigate and do not build the chrome. The chrome mounts them, calls `update` with `view.supports` for every
view, and sends the `support` action when a part asks for one ([in the player](#in-the-player)).

```ts
import { selectMessages } from "@luthfanwakan/tempuh";
import {
  applyPresentation,
  createContentRoot,
  mountContentSupports,
  mountSupportPanel,
  presentationOf,
} from "@luthfanwakan/tempuh/player";
import type { SupportView } from "@luthfanwakan/olah/delivery";

declare const chrome: HTMLElement; // in the page
declare const host: HTMLElement; // the host of the content root
declare const root: ReturnType<typeof createContentRoot>;
declare function send(action: { type: "support"; name: string; active: boolean }): void;

const messages = selectMessages("en");
const panel = mountSupportPanel(chrome, {
  messages,
  onSupport: (name, active) => send({ type: "support", name, active }),
});
const content = mountContentSupports(root, { messages });

// For every view, after `root.show(...)` has settled:
function apply(supports: readonly SupportView[]): void {
  applyPresentation(host, presentationOf(supports));
  panel.update(supports);
  content.update(supports);
}

presentationOf([
  { name: "high-contrast", state: "option", active: true },
  { name: "magnification", state: "active", active: true },
]);
// attributes: Map { "data-tempuh-contrast" => "high" }, properties: Map { "--tempuh-text-zoom" => "2" }
```

## In the player

`mountDelivery` ([delivery](delivery.md)) is a chrome that mounts the parts and feeds them `view.supports` of every view. A
host that draws its own chrome (`chrome: false`) keeps the parts that act on the content and mounts the panel itself.

| Part                   | Where it is                                      | When it is updated                                                                       |
| ---------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `applyPresentation`    | The host of the content root, and the PCI frames | When the supports of the view differ from the last view's                                |
| `mountSupportPanel`    | Above the content, in a region named Supports    | With every view. Not drawn with `chrome: false`                                          |
| `mountVariantNotice`   | Above the content                                | With every view                                                                          |
| `mountContentSupports` | The content root                                 | When the content was drawn again or the supports of the view differ from the last view's |
| `mountSpoken`          | Above the content, and the content root          | Together with `mountContentSupports`                                                     |

- **Options** are the supports whose state is `option`. A button sends `{ type: "support", name, active }` through the session
  client, so in an exam the host receives it like any other action (the default client-action policy allows it). The button
  follows the next view, and a refusal such as `support-not-available` is said in the status region.
- **Other supports** have no control. A support that is `active` or `assigned` shows by what it changes, and a prohibited one
  changes nothing.
- **Answers do not undo the supports.** A view that carries only an answer has the supports of the view before, so the cards,
  text tracks and reading controls stay as they are, and a popup that the candidate opened stays open.
- **The voice** of reading aloud is `hooks.voice`, by default the voice of the browser ([speech](speech.md)). The shell gives
  it no pronunciation lexicons.
- **Not mounted by the shell:** the tools ([tools](tools.md)), which a host mounts with `mountTools`, and the scale of the
  pixel sizes of media (`mediaScale` is fixed when a content root is created), so that a magnification enlarges the text and
  not the media that state their size in pixels.

## The support action

olah turns a support on or off for the `support` action `{ type: "support", name, active }`, and only when the support's
state is `option` (BPIG §5.3). It refuses the action for a prohibited support, one that is on from the start and one that
is assigned with `support-not-available`, and records the supports that were on for the item in the results (E28).

- The panel and the tools ask; they never decide. A button shows the `active` flag of the last input, and it calls
  `onSupport(name, !active)` when pressed. The host sends the action, and the next view says whether it took effect.
- A prohibited support has no control. A support that is `active` or `assigned` has none either, because olah would
  refuse it.
- The panel does not list the supports that the toolbar of the tools turns on and off (`line-reader`, `answer-masking`,
  `calculator-on-screen` and the on-screen tools but the glossary), so that no support has two controls.

## The look

`presentationOf(supports)` builds a `Presentation`: the attributes and custom properties that [player.css](styling.md)
reads. `applyPresentation(target, presentation)` sets them on the host of a content root, or on the `html` element of a
frame, and takes off those that an earlier presentation set. Other attributes and properties of the element stay.

| Support                   | Attribute or property                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `high-contrast`           | `data-tempuh-contrast="high"`                                                                                    |
| `invert-display-polarity` | `data-tempuh-polarity="inverted"`; `--tempuh-fg` and `--tempuh-bg` from `foreground` and `background`            |
| `text-appearance`         | `--tempuh-fg` (`fontColor`), `--tempuh-bg` (`backgroundColor`), `--tempuh-font-scale` (`fontSize` over 12)       |
|                           | `--tempuh-font-family` (`fontFace`), `--tempuh-line-height`, `--tempuh-line-spacing`                             |
|                           | `--tempuh-letter-spacing` and `--tempuh-word-spacing` in ems; `data-tempuh-uniform-font`, `data-tempuh-wrapping` |
| `magnification`           | `--tempuh-text-zoom` from `allContent`, or from `text`                                                           |
| `layout-single-column`    | `data-tempuh-single-column`                                                                                      |
| `keyword-emphasis`        | `data-tempuh-keyword-emphasis`                                                                                   |

`mediaScaleOf(supports)` gives the factor for the pixel sizes of media, from `allContent` or `nonText`; it is the
`mediaScale` option of the content root ([content](content.md)), and it is 1 without a magnification.

| Case                                                              | Reading                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A support that is off, or prohibited                              | Sets nothing                                                                                                        |
| `text-appearance` and `invert-display-polarity` both give a color | The color of `text-appearance` wins                                                                                 |
| A magnification without a positive `zoomAmount`                   | 200 percent, the enlargement that WCAG 1.4.4 asks the text to survive                                               |
| `fontSize`                                                        | Points, with 12 as 1: the PNP schema gives 12 as the default size and no unit; a size of 0 or less asks for nothing |
| `letterSpacing` and `wordSpacing`                                 | Ems: the schema gives a float and no unit                                                                           |
| `lineHeight` and `lineSpacing`                                    | A multiple of the base height of 1.5, and ems added to it (BPIG §5.2.9.7.6–7, as `player.css` reads them)           |
| A font name                                                       | Quoted as a CSS string, with the backslash and the quote escaped and control characters turned into spaces          |

## The panel

`mountSupportPanel(host, options)` puts a region named Supports into `host`, with a toggle button (`aria-pressed`) for each
support whose state is `option`. It adopts its stylesheet into the document or shadow root of `host`.

| Option      | Type                                           | Meaning                                                            |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `messages`  | `Messages`                                     | The text of the interface; the supports are named in its language. |
| `onSupport` | `(name: SupportName, active: boolean) => void` | Called when the candidate asks to turn a support on or off.        |

`update(supports)` shows the buttons for the supports of the view, in their order, and keeps the focus on the button that
has it. A custom support (BPIG §5.4) is named by the local name of its element. `destroy()` takes the panel away.

## Cards

A catalog gives the content of a support for an element that names it with `data-catalog-idref` (BPIG §3.7.10). A `qti-card`
names one of 15 supports or an extension (the `support` of the schema). `mountContentSupports(root, options)` shows the
cards of the supports that are on, with `ContentRoot.card`; the card is chosen by the language of the support.

| Option     | Type       | Meaning                    |
| ---------- | ---------- | -------------------------- |
| `messages` | `Messages` | The text of the interface. |

`update(supports)` replaces what an earlier call applied. Call it after `show` of the root settles, and again when the
supports change. `destroy()` gives the content back as the root drew it.

| Support                                                               | The card shows                                                                                         | Row |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --- |
| `glossary-on-screen`                                                  | in a popup, on request                                                                                 | T76 |
| `keyword-translation`                                                 | in a popup, on request, in the language of the support                                                 | T77 |
| `linguistic-guidance`, `additional-directions`, `keyboard-directions` | in a popup, on request                                                                                 | T78 |
| A custom support (`ext:`)                                             | in a popup, on request                                                                                 |     |
| `high-contrast`                                                       | in place of the content                                                                                | T79 |
| `simplified-graphics`, `simplified-language-portions`                 | in place of the content                                                                                | T80 |
| `sign-language`                                                       | beside the content, the entry of the language of the support                                           | T81 |
| `audio-description`, `transcript`                                     | beside the content                                                                                     | T82 |
| `long-description`                                                    | beside the content; visually hidden unless `hideVisually` is `false`                                   | T84 |
| `braille`                                                             | beside the content; the text is visually hidden unless the delivery is `embossed`, the files are links | T83 |
| `tactile`                                                             | beside the content; its files are links                                                                | T83 |
| `spoken`                                                              | not shown: a card for the voice of a host                                                              |     |

The language of a card is that of `keyword-translation` or `sign-language` for their own cards, else that of the
`item-translation` support when it is on, else none, which gives the default entry of the card (olah's `selectCard`).

Beside the content means inside the element at its end, or after it when the element cannot hold content (`img`, `video`,
`audio`, `object`, `iframe`, `canvas`, `svg`, `math`, `input`, `select`, `textarea`, `br`, `hr`). The card is a `div` of the
class `tempuh-card` with `role="group"`, named after the support and with `data-tempuh-card`.

In place of the content means the children of the element are replaced, and come back when the support goes. The face of a
choice (`.tempuh-face`) is replaced and its control stays. A picture or media is hidden and the card stands after it. An
element that holds a control and has no face keeps its content, and its card comes beside it.

Two supports without a card also change the content:

| Support             | Effect                                                                                                          | Row |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | --- |
| `captions`          | The `captions` and `subtitles` text tracks of `audio` and `video` are `showing`; they get their mode back later | T82 |
| `audio-description` | The `descriptions` text tracks are `showing`; the browser decides how it presents their cues                    | T82 |
| `alternative-text`  | The `alt` of each image stands after it as text; an empty `alt`, which marks decoration, gets nothing           | T84 |

### Media

The player of a media interaction ([interactions](interactions.md)) and the supports share the text tracks and the
recording, so that a support does not play beside the player.

- The captions and the audio description buttons of the player show the mode of the tracks, whoever set it: with the
  support `captions` on, the button of the captions is pressed, and the candidate can still turn the captions off with it.
- The media of a `sign-language` or an `audio-description` card is the recording of the element in another form, so it
  follows the recording of the element when the element has one: it plays, pauses, seeks and changes speed with it. It has
  no controls and no sound of its own while it follows, so that the candidate cannot play it beyond `max-plays` or through a
  pause the item forbids. Without a recording to follow it keeps its controls.
- The transcript card stands inside the media interaction, after the player.

### Popups

A popup meets WCAG 1.4.13 (content on hover or focus). The button that opens it is inside the element, named after the
support. The popup is a group with a Close button.

| Rule        | Behavior                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Shows       | While the pointer is over the button or the popup, while the focus is in either, and after the button is pressed                             |
| Dismissible | Escape, whatever has the focus or the pointer, and the Close button, hide it without moving either. It shows again after both have left      |
| Hoverable   | The popup touches the button, so the pointer goes onto it without leaving both; the pointer may rest on it                                   |
| Persistent  | A press keeps it until a second press, Escape or Close, or until the focus leaves it; otherwise it stays while the pointer or focus is there |
| Place       | Script puts it inside the host of the root, which clips at its border box: below the button, above when there is more room there, shifted in |
| Focus       | Dismissing with the focus in the popup gives the focus to the button                                                                         |

## Reading aloud

`mountSpoken(host, root, options)` applies the spoken support to a content root and puts the controls into `host`.

| Option     | Type                 | Meaning                                                                     |
| ---------- | -------------------- | --------------------------------------------------------------------------- |
| `messages` | `Messages`           | The text of the interface.                                                  |
| `language` | `string`             | The language of content that states none, a BCP 47 tag.                     |
| `voice`    | `SpeechHook`         | The voice: a host's text-to-speech, or `webSpeech()` ([speech](speech.md)). |
| `lexicons` | `readonly Lexicon[]` | The pronunciation lexicons of the item. Default: none.                      |

`update(supports)` reads the `spoken` support that is on. Call it after `show` of the root settles, and again when the
supports change. It throws `DataError` for settings that reading aloud cannot use, such as a pitch above 1.

| Reading type                           | What it does                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `screen-reader`, or none (the default) | No controls. `applyReadingType` keeps what `data-qti-suppress-tts` marks out of the accessibility tree                                     |
| `computer-read-aloud`                  | A group Spoken with Read aloud and Stop reading. Read aloud reads the content with the settings of the support; the voice gets the request |
| No spoken support                      | No controls; the voice is stopped                                                                                                          |

With the restriction type `word-by-word` the group also has Previous word and Next word, which read the word before and
after the one read last, and Read aloud reads that word again. The candidate chooses the word with them because a
selection inside a shadow root cannot be read in every browser. A word that the speech model leaves out is skipped. The
text of the word shows in an output, which also says when there is nothing to read or the voice failed.

With a `typingEcho` other than `none`, `echoTyping` repeats what the candidate types in the text areas and text inputs of
the root, and stops when the support goes.

## The variant

`mountVariantNotice(host, options)` shows which version of a question olah delivered (`CandidateItem.variant`, B100). olah
chooses it at the first presentation, from the hazards the candidate avoids and the language of the `item-translation`
support, and fixes it for the session. tempuh shows the choice and decides nothing.

| Option     | Type       | Meaning                                                                       |
| ---------- | ---------- | ----------------------------------------------------------------------------- |
| `messages` | `Messages` | The text of the interface.                                                    |
| `language` | `string`   | The language of the interface, in which the language of the variant is named. |

`update(variant)` takes `CandidateItem.variant`. For a variant with a language it says, in a note, "Language of this
version: Indonesian", with the name in the language of the interface and marked with the language it names (WCAG 3.1.2). A
variant without a language says that an adapted version is shown. `undefined`, the question itself, shows nothing. The
`language` of a variant also belongs in the `language` of `RootContent`, so that the content has the right `lang`
([content](content.md)). The hazards that remain after the choice are the notice of the content root.

## Input requirements

`input-requirements` asks for full keyboard control or full mouse control (BPIG §5.2). Every control of these parts works
with the keyboard alone and with the pointer alone, so the support changes nothing: buttons are buttons, the popup opens on
hover and on focus, and Escape has the Close button as its pointer equivalent.

## Where the sources differ

| Case                                                              | Reading                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The design lists `captions` and `alternative-text` with the cards | The schema gives a `qti-card` no such `support`; they act on text tracks and on `alt` |
| BPIG leaves the presentation of a card to the platform            | The table above                                                                       |
| `item-translation` has a language but no card                     | Its language chooses the entry of the cards of supports that have none of their own   |
| The PNP schema gives no unit for sizes and spacing                | Points over 12 for the font size, ems for the spacing                                 |

## Evidence

`pnpm test:browser` mounts every part in Chromium, Firefox and WebKit, runs axe at WCAG 2.2 A and AA on each of them
(popups open, in the themes), presses real keys and pointer buttons, and drives them with olah's engine: a click on the
panel sends the `support` action, and the next view applies the support. The popup tests cover the three conditions of
1.4.13. A running frame of a portable custom interaction takes a new look (`pci` in `player.browser.test.ts`).
