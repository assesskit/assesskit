# Styling

`@luthfanwakan/tempuh/player.css` is the stylesheet of a content root: the base look, the QTI 3 shared vocabulary of
[VOCAB] §1 and §2, the interaction classes of [BPIG] App. B, and the presentation that a candidate's PNP asks for. It is
one file, without `@import`, so that a constructed stylesheet can hold it.

| Context                     | How the stylesheet is used                                      |
| --------------------------- | --------------------------------------------------------------- |
| A content root (an item)    | The shadow root of the item adopts it. `:host` is the root.     |
| The document of a PCI frame | The frame links it. `:root` is the root.                        |
| The host page               | Never. Its rules for `:root` and `body` would restyle the page. |

```ts
import css from "@luthfanwakan/tempuh/player.css?inline"; // any bundler that imports a file as text

const host = document.createElement("div");
const root = host.attachShadow({ mode: "open" });
const sheet = new CSSStyleSheet();
sheet.replaceSync(css);
root.adoptedStyleSheets = [sheet];
```

A content root has `contain: layout paint` and `isolation: isolate`, so fixed-position item CSS cannot cover the chrome.
Paint containment clips at the border box, so the root has padding of the width of a focus ring.

WebKit applies a change of the viewport to the media queries of an adopted sheet only for the roots that hold it at that
time. A root that appears after a resize can lay out for the old width. Keep the sheet adopted by one root that lives as
long as the player does.

## Themes

A theme is a palette. The other colors derive from it with `color-mix()`, so a color that the player sets stays in step.
Set the attributes on the host of the root, or on `<html>` of a frame.

| Attribute                         | Text on background     | Accent    | Borders and focus ring            |
| --------------------------------- | ---------------------- | --------- | --------------------------------- |
| none                              | `#1a1a1a` on white     | `#0b57d0` | the text, 62% over the background |
| `data-tempuh-polarity="inverted"` | `#f2f2f2` on `#121212` | `#8ab4f8` | as above                          |
| `data-tempuh-contrast="high"`     | black on white         | `#0000b3` | the text, 2px borders, 4px ring   |
| both                              | white on black         | `#ffff00` | as above                          |

In every theme the text has at least 7:1 against the background, the accent and the muted text at least 4.5:1, and the
borders, the focus ring and the selection lines at least 3:1 (WCAG 1.4.3, 1.4.11). The tests check each pair.

## What the player sets

The player sets these on the host of the root, as inline custom properties on the same element as the attributes. A
property that is not set has its default.

| PNP support                            | Property or attribute                                | Value, default                                               |
| -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `invert-display-polarity`              | `data-tempuh-polarity`; `--tempuh-fg`, `--tempuh-bg` | `inverted`; the colors of the profile. Default: off          |
| `high-contrast`                        | `data-tempuh-contrast`                               | `high`. Default: off                                         |
| `text-appearance` colors               | `--tempuh-fg`, `--tempuh-bg`                         | Colors. Default: the theme's                                 |
| `text-appearance` font size            | `--tempuh-font-scale`                                | A number that multiplies the size. Default: `1`              |
| `text-appearance` font face            | `--tempuh-font-family`                               | A font family list. Default: `system-ui, sans-serif`         |
| `text-appearance` line height          | `--tempuh-line-height`                               | A number that multiplies the base of 1.5. Default: `1`       |
| `text-appearance` line spacing         | `--tempuh-line-spacing`                              | Ems added to the line height. Default: `0`                   |
| `text-appearance` letter spacing       | `--tempuh-letter-spacing`                            | A length. Default: `normal`                                  |
| `text-appearance` word spacing         | `--tempuh-word-spacing`                              | A length. Default: `normal`                                  |
| `text-appearance` uniform sizing       | `data-tempuh-uniform-font`                           | Present: every size is the body size. Default: absent        |
| `text-appearance` wrapping             | `data-tempuh-wrapping`                               | Present: text wraps, whatever the item says. Default: absent |
| `magnification` of text or all content | `--tempuh-text-zoom`                                 | A number that multiplies the size. Default: `1`              |
| `layout-single-column`                 | `data-tempuh-single-column`                          | Present: one column. Default: absent                         |
| `keyword-emphasis`                     | `data-tempuh-keyword-emphasis`                       | Present: `.qti-keyword-emphasis` shows. Default: absent      |

The base size is `1rem`, so a root inside a root does not multiply a zoom twice. Magnification of non-text content has no
form in CSS inside the baseline, because `zoom` needs Firefox 126: the renderer multiplies the pixel sizes it gives media by its
`mediaScale` option ([content](content.md)).

These values are not PNP and complete the markup:

| Name                                            | Set by the player to                                                                               | Default |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------- |
| `--tempuh-rows`                                 | The rows of a vertical choice stack: `ceil(choices / columns)`. CSS cannot count children          | `1`     |
| `--tempuh-choices-width`                        | `data-choices-container-width` as a length, such as `188px`. Typed `attr()` is not in the baseline | `auto`  |
| `--tempuh-sticky-top`, `--tempuh-sticky-bottom` | The heights of the sticky chrome, so that a focused element scrolls clear of it (WCAG 2.4.11)      | `0px`   |
| `data-tempuh-placing` on a graphic gap match    | Present while the candidate places a choice                                                        | absent  |

## Parts

The vocabulary classes sit on QTI elements, such as `qti-choice-interaction`. The stylesheet needs these parts of an
interaction, which are classes of the player and not of the item:

| Class            | What it is                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `tempuh-control` | The native control of a choice, hot text or hotspot. It comes first, and its face follows it.          |
| `tempuh-face`    | What the candidate sees of it: the text of a choice, a hot text, or the outline of a hotspot.          |
| `tempuh-choices` | The container of the choices of an order, gap match or graphic gap match, and the first set of a match |
| `tempuh-targets` | The container of the targets, and the second set of a match                                            |
| `tempuh-target`  | One target of an order                                                                                 |

The content root ([content](content.md)) builds these parts around the content, which the stylesheet lays out:

| Class or attribute                  | What it is                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `tempuh-content`                    | The container of everything the root shows; it carries `lang`.                                                         |
| `tempuh-hazards`                    | The notice of a hazard that remains: a border and text, so that it does not rely on color.                             |
| `tempuh-rubric`                     | The rubric of the test, above the stimuli.                                                                             |
| `tempuh-main`                       | Holds the stimuli and the item. With `data-tempuh-stimuli` it is two columns from 48rem, and one with a single column. |
| `tempuh-stimuli`, `tempuh-stimulus` | The column of the stimuli, and one stimulus.                                                                           |
| `tempuh-body`                       | The item.                                                                                                              |
| `tempuh-test-feedback`              | The region of the test feedback, after the item.                                                                       |
| `tempuh-dialog`                     | The dialog of modal feedback, with a backdrop of its own.                                                              |
| `data-tempuh-placeholder`           | An interaction that no renderer has drawn.                                                                             |
| `data-use` on `qti-rubric-block`    | `instructions`, `scoring` or `navigation`.                                                                             |

```html
<qti-choice-interaction class="qti-labels-upper-alpha qti-labels-suffix-period qti-input-control-hidden">
  <qti-prompt>Which?</qti-prompt>
  <qti-simple-choice>
    <input class="tempuh-control" type="radio" name="r" aria-label="First">
    <div class="tempuh-face">First</div>
  </qti-simple-choice>
</qti-choice-interaction>
```

A hidden control is visually hidden, stays in the tab order, and shows its focus and its state on its face. The choices
come first in the markup, for a screen reader, and `qti-choices-bottom` and `qti-choices-right` move them only for the
eye. A hot text, a hotspot and a choice use the state of the control: `:checked` and `:focus-visible`.

## The vocabulary

| Group                                               | Classes                                                                                                                             | Source                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Accessibility                                       | `qti-hidden`, `qti-visually-hidden`, `qti-keyword-emphasis`                                                                         | §1.1.1, §2.1                           |
| Text, boxes, alignment                              | `qti-underline`, `qti-italic`, `qti-bordered`, `qti-well`, `qti-align-*`, `qti-valign-*`                                            | §1.1.2–4, §2.12                        |
| Layout                                              | `qti-layout-row`, `qti-layout-col1` to `12`, `qti-layout-offset1` to `11`                                                           | §1.1.3, §2.11                          |
| Display, flex, spacing, size, indent                | `qti-display-*`, `qti-flex-*`, `qti-margin-*`, `qti-padding-*`, `qti-height-*`, `qti-width-*`, `qti-fullwidth`, `qti-text-indent-*` | §2.1–2.9                               |
| Lists                                               | `qti-list-style-type-*`                                                                                                             | §1.1.7, §2.10                          |
| Vertical writing                                    | `qti-writing-mode-*`, `qti-float-*`, `qti-text-orientation-upright`, `qti-text-combine-upright-all`                                 | §1.1.5, §2.13–2.16                     |
| Choice                                              | `qti-labels-*`, `qti-labels-suffix-*`, `qti-orientation-*`, `qti-choices-stacking-1` to `5`, `qti-input-control-hidden`             | §1.2.1                                 |
| Text entry, inline choice, gap                      | `qti-input-width-1` to `72`                                                                                                         | §1.2.2, §1.2.4, §1.2.7                 |
| Extended text                                       | `qti-height-lines-3`, `-6`, `-15`                                                                                                   | §1.2.3                                 |
| Vertical choice, text, extended text, inline choice | `qti-writing-orientation-vertical-rl`, `-lr`, `qti-labels-cjk-ideographic`                                                          | §1.2.1.9, §1.2.2.3, §1.2.3.4, §1.2.7.3 |
| Match, gap match, graphic gap match, order          | `qti-choices-top`, `-bottom`, `-left`, `-right`; `qti-match-tabular`, `qti-header-hidden`                                           | §1.2.4, §1.2.8–10                      |
| Order targets                                       | `qti-labels-*` and `qti-labels-suffix-*` on `qti-order-interaction`                                                                 | §1.2.9.1–2                             |
| Hotspot, graphic gap match, hot text                | `qti-selections-light`, `-dark`, `qti-unselected-hidden`, `qti-input-control-hidden`                                                | §1.2.5, §1.2.6, §1.2.10                |

The messages (`data-max-selections-message`, `data-patternmask-message`, `data-prompt`, `data-first-column-header`), the
counters (`qti-counter-up` and `-down`) and the media attributes are behavior of the elements, so the stylesheet does not
read them.

## Where the sources differ

| Case                                                                                                                                                                  | Reading                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| §1.1.5.1 names `qti-writing-mode-vertical-tb`, §2.13 `qti-writing-mode-horizontal-tb`                                                                                 | Both set `horizontal-tb`                                                                      |
| §1.1.7 lists `kannada`, `katakana` and `katakana-iroha`, §2.10 lacks them; §2.10 has `ethiopic-halehame*`, `hangul`, `hangul-consonant` and `urdu`, §1.1.7 lacks them | Every name of both is a class                                                                 |
| `qti-input-width-40` is in the summary tables and §1.2.4.3, not in §1.2.2.1                                                                                           | A class of every interaction                                                                  |
| `qti-gap-placement` is in the summary tables, with no definition                                                                                                      | Not styled                                                                                    |
| §2.11 has pixel widths, `.container` and `.container-fluid` (Bootstrap 2)                                                                                             | A twelve-column grid of fractions with a gutter; the containers are not vocabulary            |
| §2.3 and §2.4 define `s` and `e` as left and right for left-to-right text                                                                                             | Logical: the start and the end of the line                                                    |
| §1.2.8.2: `qti-header-hidden` does not display the header row                                                                                                         | The row is visually hidden and stays for a screen reader ([VOCAB] §1.2.8.2 warns of the loss) |
| §1.2.6.3: `qti-unselected-hidden` on a hot text shows "no buttons"                                                                                                    | It hides the controls too                                                                     |
| §1.2.5.1, §1.2.10.3: hidden selections show on focus; a graphic gap match also while placing                                                                          | `:focus-visible`, `:checked` and `data-tempuh-placing`                                        |
| `qti-labels-*` without a class                                                                                                                                        | No label: BPIG leaves the default to the platform                                             |

Below 48rem, about the 767px of §2.11, and for a candidate who wants a single column, rows, stacks and containers become
one column. A horizontal stack folds the same way, for BPIG §3.2.1 advises vertical choices where a row would leave the
viewport.

## Evidence

`pnpm test:browser` renders fixtures of every class in Chromium, Firefox and WebKit, runs axe on them, and checks WCAG 2.2
1.4.1, 1.4.3, 1.4.4, 1.4.10, 1.4.11, 1.4.12, 2.4.7, 2.4.11 (the sticky chrome) and 2.5.8 in every theme. Run
`pnpm exec playwright install` first. `pnpm compat:engines` loads the stylesheet in Chromium 111, Firefox 115 and WebKit
16.4.
