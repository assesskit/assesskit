# Speech

A candidate whose spoken support has the reading type `computer-read-aloud` hears the content read by a voice that the
player controls ([BPIG] §5.2.1). A candidate with the reading type `screen-reader` reads the page with their own screen
reader, which reads the DOM with its ARIA, labels and visually hidden text. This guide covers the first: the request the
player makes for a voice, the voices, and the typing echo. It also covers what the player does to the DOM for the
second.

```ts
import { EN_MESSAGES } from "@luthfanwakan/tempuh";
import { buildSpeechRequest, parseLexicon, webSpeech } from "@luthfanwakan/tempuh/player";

const host = document.createElement("div");
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `<p>Sigmund <span data-ssml='{"sub":{"alias":"Froyd"}}'>Freud</span> works at the W3C.</p>`;
document.body.append(host);

const lexicon = parseLexicon(`<lexicon xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" version="1.0"
  alphabet="ipa" xml:lang="en"><lexeme><grapheme>W3C</grapheme><alias>World Wide Web Consortium</alias></lexeme></lexicon>`);

const range = document.createRange();
range.selectNodeContents(root);
const request = buildSpeechRequest(range, {
  settings: { readingType: "computer-read-aloud", restrictionTypes: [], speechRate: 240 },
  messages: EN_MESSAGES,
  language: "en",
  lexicons: [lexicon],
});
request?.text; // "Sigmund Froyd works at the World Wide Web Consortium."
request?.ssml; // <speak version="1.1" xml:lang="en" xmlns="http://www.w3.org/2001/10/synthesis"><p>Sigmund <sub alias="Froyd">Freud</sub> works at the <sub alias="World Wide Web Consortium">W3C</sub>.</p></speak>
request?.rate; // 240

if (request) await webSpeech().speak(request);
```

## The request

`buildSpeechRequest(range, options)` reads the content of a range in reading order and returns a `SpeechRequest`, or
`undefined` when there is nothing to say. The range is a content root (`selectNodeContents`), a paragraph, a selection
or a word.

| Option     | Type             | Meaning                                                                       |
| ---------- | ---------------- | ----------------------------------------------------------------------------- |
| `settings` | `SpeechSettings` | The candidate's spoken support; olah's `Spoken` fits                          |
| `messages` | `{ speechLink }` | The interface text; `Messages` fits                                           |
| `language` | `string`         | The language of content that states none, a BCP 47 tag                        |
| `lexicons` | `Lexicon[]`      | The pronunciation lexicons of the item, in order of preference. Default: none |

It throws `DataError` when `range` is not a `Range` or an option is not valid. `SpeechSettings` holds the fields of
olah's `Spoken` that decide the reading, all optional: `readingType`, `restrictionTypes`, `speechRate`, `pitch`,
`volume`, `linkIndication` and `typingEcho`.

| `SpeechRequest` field | Meaning                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ssml`                | The content as an SSML 1.1 document, valid against the SSML 1.1 schema, with one `p` for each paragraph                                  |
| `text`                | The content as plain text for a voice that ignores SSML: `sub` aliases and lexicon aliases replace the text, one line for each paragraph |
| `lang`                | The language of the first text read, from `lang` or `xml:lang`, else the option `language`                                               |
| `rate`                | Words per minute (BPIG §5.2.1.4); absent when the support sets none                                                                      |
| `pitch`               | From 0 to 1 (BPIG §5.2.1.5); absent when the support sets none                                                                           |
| `volume`              | From 0 to 1 (BPIG §5.2.1.6); absent when the support sets none                                                                           |

The request is `undefined` for a candidate whose reading type is `screen-reader`, which is also the default when the
support names none, because the screen reader reads the page. It is `undefined` for `word-by-word` when the range holds
more than one word.

## What is read

The reading follows the DOM, so it reads what the renderer made. The renderer builds every element with its namespace
(`createElementNS`): SSML in the SSML namespace, MathML in the MathML namespace.

| Content                                                       | Read                                                                                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Text                                                          | With white space reduced to a space, and the lexicons applied                                                              |
| `hidden`, `aria-hidden="true"`, `qti-hidden`, `display: none` | Left out, with everything in it                                                                                            |
| `qti-visually-hidden`                                         | Read: it is there for assistive technology (VOCAB §1.1.6.1)                                                                |
| `data-qti-suppress-tts` of `computer-read-aloud` or `all`     | Left out. `screen-reader` is left out of the accessibility tree, below (VOCAB §1.1.1.3)                                    |
| `data-qti-a11y-content-role="screen-reader-orientation"`      | Left out: it is guidance for screen reader users, which a candidate who looks at the screen does not need (VOCAB §1.1.1.5) |
| `data-qti-a11y-content-role="long-description"`               | Read where it stands, unless `data-qti-suppress-tts` suppresses it, as BPIG §5.2.1.9 does                                  |
| `img`                                                         | The `alt` text, which BPIG §5.1.1 says read aloud candidates get                                                           |
| Text `input` and `textarea`                                   | The value the candidate typed (BPIG §5.2.1.1)                                                                              |
| `math`                                                        | Its `alttext`, else its text. After MathJax, the speech of its `mjx-speech` ([mathematics](math.md))                       |
| `br`                                                          | A pause: `break`                                                                                                           |
| Other HTML elements that are not inline                       | A paragraph of their own; inline elements and the elements of other namespaces sit in the line                             |

Characters that XML 1.0 does not allow are left out.

### SSML

An element of the ASI schema's SSML ([INFO] §2.13.2) keeps its meaning and its attributes (SSML 1.1 §3): `audio`,
`break`, `emphasis`, `mark`, `p`, `phoneme`, `prosody`, `s`, `say-as`, `sub` and `voice`. The text of the element is
read as the text. An element is dropped and its text kept when it lacks an attribute it needs, as `sub` lacks `alias`,
and an attribute that SSML does not define is dropped. An `audio` keeps its `src` only when it is an `http` or `https`
URL, which the renderer resolved to the asset origin; otherwise the voice says the fallback content (SSML 1.1 §3.3.1).
The elements that hold text only, `phoneme`, `say-as` and `sub`, take the text of everything inside. The SSML is not
displayed: the elements are inline, and only their text shows.

### `data-ssml`

The attribute holds JSON with the functions `break`, `phoneme`, `prosody`, `say-as` and `sub` ([DSSML] §2). Content must
not hold what DSSML does not define (DSSML §4.2), so a value that is not valid JSON, has an unknown function, property
or value, or lacks a needed property has no effect, and the element is read as it is. `emphasis` with the `level` of
SSML 1.1 is accepted too, because the example of BPIG §5.2.1.8 uses it. A `prosody` rate is one of SSML 1.1 §3.2.4: a
label or a percentage.

Several functions in one value nest in a fixed order, from the outside: `prosody`, `emphasis`, `say-as`, `phoneme`,
`sub`. A `break` is empty and comes before the content. An element with `data-ssml` is read in the line, not as a
paragraph of its own. SSML and `data-ssml` apply only when the range holds all of the element; a range that cuts through
an element reads its text.

### Lexicons

`parseLexicon(source)` reads a PLS 1.0 document: the package resource of type `pls` that an item depends on ([BPIG]
§5.2.1.8). It throws `DataError` when the document is not a lexicon with `version="1.0"`, an `alphabet` and an
`xml:lang`. The entries follow PLS 1.0 §4: every grapheme of a lexeme gets its pronunciation, which is the first with
`prefer="true"`, else the first in document order, taking the lexemes of the same grapheme together. A lexeme with a
`role` is left out, because roles select a pronunciation by part of speech, which the player does not know.

A lexicon applies to text of its language, compared by the primary subtag: `en-US` applies to `en-GB`. Matching follows
PLS 1.0 Appendix C, which is informative: by whole tokens, the longest sequence first, with equal characters, so case
and accents count, and a run of white space is one space. A token is a run of characters between white space, and an
entry may leave out the punctuation around it, so `W3C` matches `(W3C),`. A phrase must lie in one text: it does not
match across an element. Text that SSML or `data-ssml` already pronounces is left as it is. The first lexicon that has
the words wins.

An alias becomes a `sub` and a phoneme becomes a `phoneme` in the `ssml`, so that a voice that takes SSML needs no
lexicon and fetches nothing. The `text` has the alias.

In the player, `mountDelivery` reads the lexicons of the item shown: the files of the resources of type `pls` that the
item's resource depends on, which the documents of the view name (`documents.lexicons`, [protocol](protocol.md#documents)).
It loads them through the gate when the item changes, reads each file once, leaves out a file that is missing or is not a
PLS document, and gives the others to reading aloud in the order of the dependencies. An item with none is read with none.

## Restriction types

The restriction types of the support apply together ([BPIG] §5.2.1.2). A term the player does not know, such as
`ext:iowa-reading`, has no effect.

| Term                       | Effect                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `unrestricted`             | Everything is read                                                                                                                     |
| `word-by-word`             | Only one word at a time: a range with more than one word gives no request. The caller makes the range for the word the candidate chose |
| `directions-only`          | Only the rubric blocks (`qti-rubric-block`) are read, which hold the instructions to the candidate. A range inside one is read         |
| `skip-math-equations`      | MathML, and the output of MathJax, are left out                                                                                        |
| `skip-chemistry-equations` | Chemical Markup Language, the elements in the namespace `http://www.xml-cml.org/schema`, is left out                                   |

## Link indication

| Term              | Effect                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `speak-link`      | The word `link` (the message `speechLink`) comes before the text of a link                                          |
| `different-voice` | The text of a link is in a `voice` with `variant="2"` (SSML 1.1 §3.2.1). A voice without SSML says it as other text |
| `sound-effect`    | Like `speak-link`: tempuh has no sound to play, and the link is still marked                                        |
| `none`            | No indication                                                                                                       |

A link is an `a` with an `href`.

## Voices

A voice is a `SpeechHook`: `speak(request)` says a request, stopping what it said first, and resolves when it ends or is
stopped; `stop()` stops it. The host's text-to-speech that takes SSML uses `request.ssml` and keeps everything:
phonemes, prosody, breaks, the voice of links. The default is `webSpeech()`, the Web Speech API of the browser, which
ignores SSML.

`webSpeech()` speaks `request.text`, in which the aliases stand in for the text they replace. It maps the request to an
utterance:

| Request  | Utterance                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| `lang`   | `lang`                                                                                                            |
| `rate`   | `rate`: words per minute divided by 180, which PNP takes as the default, within 0.1 and 10                        |
| `pitch`  | `pitch`: twice the value, because PNP runs from 0 to 1 with 0.5 as the default, and Web Speech from 0 to 2 with 1 |
| `volume` | `volume`, as it is                                                                                                |

A field that the request lacks stays the voice's own. `speak` rejects with `DataError` for a request that is not one,
and with `TempuhError` when the voice fails; a stop is not a failure. Phonemes, prosody, breaks, the voice of links and
the language of parts are lost with `webSpeech()`; use a host voice for full fidelity.

## Typing echo

`echoTyping(field, options)` says what the candidate types in a text input or a text area, as the support's `typingEcho`
says ([BPIG] §5.2.1.3), and returns a function that stops it.

| `echo`                 | The voice says                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `characters`           | Each character as it is typed, spelled out in SSML; the message `typingSpace` for a space |
| `words`                | Each word when a character that is not a letter, a mark or a number ends it               |
| `characters-and-words` | Each character, and the word in place of the character that ends it                       |
| `none`                 | Nothing                                                                                   |

Only typed characters are echoed, not pasted or deleted text. A voice that fails does not stop the typing. The options
are `hook`, `echo`, `messages` (`{ typingSpace }`) and `language`, which a `lang` of the field's ancestors replaces. It
throws `DataError` when the field is not an `input` or a `textarea` or an option is not valid.

## The accessible structure

`applyReadingType(root, readingType)` sets `aria-hidden="true"` where the reading type of the support asks the content
to be out of the accessibility tree that a screen reader reads ([BPIG] §5.2.1.9, [VOCAB] §1.1.1.3, §1.1.1.5):

| Reading type          | Hidden                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `screen-reader`       | Elements with `data-qti-suppress-tts` of `screen-reader` or `all` |
| `computer-read-aloud` | Elements with the content role `screen-reader-orientation`        |
| `undefined`           | Nothing: the candidate has no spoken support                      |

It removes what an earlier call set and nothing else: an `aria-hidden` of the content stays. Call it again when the
support changes or the content is replaced. It throws `DataError` for a value that is neither a reading type nor
`undefined`.
