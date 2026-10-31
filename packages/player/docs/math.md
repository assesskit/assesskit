# Mathematics

QTI 3 writes mathematics as MathML ([INFO] §2.3.3). Every baseline browser renders MathML Core by itself. The player
typesets it with [MathJax](https://www.mathjax.org) 4 when the host gives it the URL of MathJax, which gives the page
one look in all browsers, the layout of MathML that the browsers lack, and the speech and braille that MathJax's Speech
Rule Engine (SRE) makes. The player does not bundle MathJax. It loads MathJax from that URL, once, and only for content that
has an expression.

```ts
import { createMathTypesetter } from "@assesskit/player/player";

const typesetter = createMathTypesetter("https://assets.example/mathjax/mml-chtml.js");

const host = document.createElement("div");
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `<p>Half of x is <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>x</mi><mn>2</mn></mfrac></math>.</p>`;
document.body.append(host);

await typesetter.typeset(root);
root.querySelector("mjx-speech")?.getAttribute("aria-label"); // "x over 2, math"
root.querySelector("mjx-speech")?.getAttribute("aria-braillelabel"); // "⠹⠭⠌⠆⠼"
```

## Serving MathJax

The tested version is MathJax 4.1.3 (Apache-2.0), from the npm package `mathjax`. The host serves the files of the
package and of the font package that it depends on, in the layout that npm gives them, side by side:

| Served at                                             | From                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------- |
| `https://assets.example/mathjax/`                     | the files of the package `mathjax`, with `mml-chtml.js` at its root |
| `https://assets.example/@mathjax/mathjax-newcm-font/` | the package `@mathjax/mathjax-newcm-font`                           |

The URL that the player takes is that of `mml-chtml.js`, the combined component with the MathML input, the CHTML output, the
menu and the accessibility extensions. The player configures MathJax before it loads, so that it does not typeset the page
and takes its fonts from `../@mathjax` relative to the component, not from the CDN that MathJax uses by default. MathJax
finds the rest of its files, the SRE worker and its speech rules in `sre/`, relative to the component too. After
loading, nothing in MathJax's configuration reaches another origin. The player sets the global `MathJax` configuration of
the page before it loads the script (`startup`, `loader.paths.fonts` and `options.renderActions`), so a configuration
that the page set for MathJax is replaced.

The page that mounts the player needs, in its content security policy:

| Directive     | Source           | Why                                                                                     |
| ------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `script-src`  | the asset origin | `mml-chtml.js`, and `sre/speech-worker.js`, which the worker loads with `importScripts` |
| `worker-src`  | `blob:`          | MathJax starts its speech worker from a `blob:` URL that imports the script above       |
| `font-src`    | the asset origin | the font files                                                                          |
| `connect-src` | the asset origin | the speech rules in `sre/mathmaps/`, which the worker reads                             |

MathJax also adds `<style>` elements and style attributes to the page; a policy with a strict `style-src` must allow
them.

## `createMathTypesetter(url)`

| Parameter | Type     | Meaning                                              |
| --------- | -------- | ---------------------------------------------------- |
| `url`     | `string` | The absolute `http` or `https` URL of `mml-chtml.js` |

It throws `DataError` when `url` is not such a URL. MathJax is a global of the page, so a page uses one URL: a
typesetter for another URL rejects with `DataError` once MathJax has been requested.

`typeset(root)` takes a content root, a shadow root or an element, and typesets the `math` elements below it in place.
It rejects with `DataError` when `root` is neither. It rejects with `AssesskitError` when MathJax cannot be loaded or the
script is not MathJax 4 with the CHTML output; the expressions then stay MathML, which the browser renders. A failure is
final for the page: later calls reject without another request.

## What it does

- **On demand.** `typeset` looks for MathML elements first. A root with none loads nothing and resolves. The first root with
  one loads MathJax, and every later root uses it.
- **In a shadow root.** MathJax takes elements, not a shadow root, so `typeset` passes the child elements of a shadow root.
  MathJax writes its styles to the head of the document, and they do not reach a shadow root. `typeset` adopts a
  constructed stylesheet with the same rules into the root and replaces it after every typesetting, because MathJax adds
  the rule of a character when the character is first used. It adds the rules with `insertRule`, which its element's
  `textContent` does not show, so `typeset` reads them from the sheet.
- **Elementary math stays MathML.** MathJax 4 does not implement the elements of elementary math (MathML 3 §3.6): `mstack`,
  `mlongdiv`, `msgroup`, `msrow`, `mscarries`, `mscarry` and `msline`. It would replace the whole expression by a "Math
  input error". `typeset` leaves an expression that has one of them alone, with a render action of MathJax that removes
  it from the expressions found, and the browser renders it as MathML Core. The content stays in the document for a screen
  reader that reads MathML.
- **Speech and braille.** MathJax makes the speech and the braille of each expression with SRE, in a worker, and sets them on
  its `mjx-speech` element: `aria-label` holds the speech and `aria-braillelabel` the braille. They are there when
  `typeset` resolves. The read-aloud request of the player ([speech](speech.md)) uses the speech of an expression.

## Braille

MathJax's SRE has speech rules for braille in two codes, in `sre/mathmaps/`: `nemeth.json` and `euro.json`.

| Code     | Result in MathJax 4.1.3                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Nemeth   | Works, and it is the default. `x+1` gives ⠭⠬⠂, `x²` gives ⠭⠘⠆, `1/2` gives ⠹⠂⠌⠆⠼ and `√x` gives ⠜⠭⠻, as the Nemeth Code writes them |
| UEB math | Not available. The menu of MathJax offers UEB, but the SRE has no UEB map, and the label that results is words, not braille         |
| Euro     | In the SRE; the vocabulary of PNP's `math-type` has no term for it                                                                  |

A candidate whose PNP asks for UEB math therefore gets Nemeth braille labels unless the player removes them. The player
decides: the labels are the `aria-braillelabel` attributes of the `mjx-speech` elements.

## Accessibility

An expression becomes a `mjx-container` that takes the keyboard focus, with the visual output hidden from the
accessibility tree (`aria-hidden`) and an `mjx-speech` element of `role="img"` that names it. axe-core at WCAG 2.2 A and
AA reports no violation for it in a shadow root.
