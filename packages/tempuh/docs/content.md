# Content

The content of an item is the typed tree that olah's `asi` reads: text, HTML elements, QTI elements, interactions, and
MathML and SSML kept as XML. `createBodyRenderer` of `@luthfanwakan/tempuh/player` builds the DOM for such nodes, and
`createContentRoot` shows an item with its stimuli in a shadow root of its own. They draw what olah's engine resolved
(feedback, template content, printed values and hidden choices, `resolveContent` of olah); they decide nothing of QTI.

```ts
import { readAsi } from "@luthfanwakan/olah/asi";
import { selectMessages } from "@luthfanwakan/tempuh";
import { createContentRoot } from "@luthfanwakan/tempuh/player";
import css from "@luthfanwakan/tempuh/player.css?inline"; // any bundler that imports a file as text

const parsed = readAsi(`<qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0"
    identifier="map" title="Map" adaptive="false" time-dependent="false">
  <qti-item-body>
    <p lang="en">Look at <img src="images/map.png" alt="A map" width="120"/> and <a href="files/data.pdf" onclick="alert(1)">the data</a>.</p>
  </qti-item-body>
</qti-assessment-item>`);
if (parsed.kind !== "item" || parsed.item.body === undefined) throw new Error("The document is not an item.");

const player = new CSSStyleSheet();
player.replaceSync(css);
const host = document.createElement("div");
document.body.append(host);

const root = createContentRoot(host, {
  messages: selectMessages("en"),
  assets: (path) => `https://assets.example/g/token/${path}`,
  fetch: (url, request) => fetch(url, request),
  stylesheet: player,
});
await root.show({ body: { nodes: parsed.item.body.children, base: "items/map/item.xml" } });

root.root.querySelector(".tempuh-body")?.innerHTML;
// <p lang="en">Look at <img src="https://assets.example/g/token/items/map/images/map.png" alt="A map" width="120"> and
// <a href="https://assets.example/g/token/items/map/files/data.pdf" target="_blank" rel="noopener noreferrer">the data</a>.</p>
```

The `onclick` is not in the DOM: the renderer keeps the attributes of [Attributes](#attributes) and no other.

## The content root

`createContentRoot(host, options)` attaches an open shadow root to `host` and returns a `ContentRoot`. An item and its
stimuli share one root, so that `label for`, `aria-describedby` and `data-catalog-idref` resolve between them. The item's
stylesheets neither leak into the page nor take their rules from it. `player.css` gives the host `contain: layout paint` and
`isolation: isolate`, so that the fixed-position CSS of an item cannot cover the page's chrome ([styling](styling.md)).

| Option         | Type                          | Meaning                                                                                                                                               |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages`     | `Messages`                    | The text of the interface, from `selectMessages`.                                                                                                     |
| `assets`       | `(path: string) => string`    | Turns the path of a file in the package into the URL to load it from.                                                                                 |
| `fetch`        | `StylesheetFetch`             | Loads item stylesheets; `fetch` of the page fits. It is called with `credentials: "omit"` and `referrerPolicy: "no-referrer"`.                        |
| `stylesheet`   | `CSSStyleSheet`               | The player's stylesheet, built from `player.css`. Every root adopts it first. Keep one root that lives as long as the player ([styling](styling.md)). |
| `origins`      | `readonly string[]`           | The origins besides the package's that content may reference, such as `https://media.example`. Default: none.                                         |
| `interactions` | `InteractionRenderers`        | The renderers of interactions by kind. Default: none, so that each interaction is a placeholder.                                                      |
| `view`         | `View`                        | The view whose rubric blocks are drawn. Default: `candidate`.                                                                                         |
| `mediaScale`   | `number`                      | The factor for the pixel `width` and `height` of images, video and objects, which the magnification of non-text content sets. Default: `1`.           |
| `fileUrl`      | `(file: FileValue) => string` | The URL of a file value that a printed variable prints, such as an upload under review. Default: none, so that a file prints as its name.             |
| `typesetter`   | `MathTypesetter`              | From `createMathTypesetter` ([math](math.md)). Default: none, so that the browser renders MathML.                                                     |

`root.show(content)` replaces what the root showed. The DOM is built before the promise settles; the promise settles when
the item's stylesheets are adopted and the expressions are typeset.

| Field          | Type                          | Meaning                                                                                                                          |
| -------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `body`         | `{ nodes, base? }`            | The body of the item. `base` is the path in the package of its document; relative references resolve against it. Default: none.  |
| `stimuli`      | `readonly { nodes, base? }[]` | The stimuli the item shares, in order. They stand beside the item at 48rem and wider, and above it otherwise. Default: none.     |
| `rubric`       | `{ nodes, base? }`            | The rubric of the test, its part and its sections for the view, before the stimuli. Default: none.                               |
| `testFeedback` | `readonly TestFeedback[]`     | The test feedback that is shown, in a region labelled Feedback after the item. Default: none.                                    |
| `stylesheets`  | `readonly string[]`           | The paths in the package of the stylesheets of the item. Default: none.                                                          |
| `catalogs`     | `readonly Catalog[]`          | The catalogs of the item, for `card`. Default: none.                                                                             |
| `hazards`      | `readonly HazardExposure[]`   | The hazards of the delivered content from olah's `hazardExposure`. Default: none.                                                |
| `language`     | `string`                      | The language of the content, such as that of the delivered variant; it becomes `lang` of the content. Default: that of the host. |
| `variables`    | `ContentVariables`            | The variables that printed variables still in the content read. Default: none.                                                   |

`show` throws `DataError` for content of another type. It rejects with `TempuhError` when a stylesheet cannot be fetched or
MathJax cannot be loaded; the content is on the screen by then, the stylesheets that loaded are adopted and the
expressions stay MathML. A stylesheet that failed is fetched again by the next `show`.

| Member                            | Meaning                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `root`                            | The shadow root.                                                                                      |
| `card(idref, support, language?)` | The card that the catalogs of the shown content have for a support ([Catalogs](#catalogs-and-cards)). |
| `showFeedback(feedback)`          | Shows modal feedback in a dialog and resolves when the candidate closes it ([Feedback](#feedback)).   |
| `destroy()`                       | Takes the content and the listeners away. The shadow root stays, empty.                               |

A link to an `id` of the content (`href="#note"`) moves the focus to that element inside the shadow root. The browser
cannot find the target of the fragment inside it and would only change the address of the page.

## Where it appears

| Part                     | Markup                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The content              | `div.tempuh-content`, with `lang` when the content states a language.                                                                                                    |
| The notice of a hazard   | `div.tempuh-hazards` with `role="note"`, first.                                                                                                                          |
| The rubric               | `div.tempuh-rubric`.                                                                                                                                                     |
| The stimuli and the body | `div.tempuh-main`, with `data-tempuh-stimuli` when there are stimuli; `div.tempuh-stimuli` holds one `section.tempuh-stimulus` for each, and `div.tempuh-body` the item. |
| The test feedback        | `section.tempuh-test-feedback`, labelled Feedback, with `h2` for a title.                                                                                                |
| The dialog               | `dialog.tempuh-dialog`, a sibling of the content in the shadow root.                                                                                                     |

## The renderer

`createBodyRenderer(options)` returns a `BodyRenderer` with two methods.

| Method                          | Meaning                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `nodes(nodes)`                  | Renders the nodes, in order. It throws `DataError` for a node that is not an object whose `kind` names an element.    |
| `element(name, node, children)` | Builds the element `name` for a node, around the children given, with the attributes the renderer keeps for the node. |

Its options are those of the root's table without `fetch`, `stylesheet` and `typesetter`, and with these:

| Option          | Type               | Meaning                                                                                             |
| --------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `base`          | `string`           | The path in the package of the document the nodes come from. Default: `""`, the package root.       |
| `withholdMedia` | `boolean`          | Whether media and animation are withheld because a hazard remains. Default: `false`.                |
| `variables`     | `ContentVariables` | The variables that printed variables still in the nodes read. Default: none, so they print nothing. |

### What a node becomes

| Node                                               | DOM                                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Text                                               | A text node.                                                                                                                                   |
| An HTML element (the 76 of the ASI schema)         | The element of the same name, with the attributes below. `th` keeps `scope` and `td` keeps `headers`, `colspan` and `rowspan`.                 |
| A QTI element                                      | `qti-` and its kind, with the common attributes. Its content is the nodes below it, in the order the model keeps them.                         |
| An interaction                                     | The element a registered renderer builds, else a placeholder: `qti-` and its kind with `data-tempuh-placeholder`, around its content.          |
| `qti-printed-variable`                             | `qti-printed-variable` with olah's text; see [Printed variables](#printed-variables).                                                          |
| `qti-rubric-block`                                 | `qti-rubric-block` with `data-use` when the view lists the block; see [Rubric](#rubric).                                                       |
| `audio`, `video`                                   | The element with `controls`; its `source` and `track` children keep their attributes.                                                          |
| `img`                                              | `img`; where a hazard remains, an image that can move becomes its `alt` text.                                                                  |
| `object`                                           | By its `type`; see [Embedded files](#embedded-files).                                                                                          |
| MathML, SSML and CML                               | `createElementNS` with the namespace of the source, so that the typesetter and the speech model find them. `xml:lang` stays.                   |
| Any other XML element, such as `xi:include` or SVG | Not drawn, with what it holds.                                                                                                                 |
| `qti-stylesheet`, `qti-catalog-info`, `param`      | Not drawn: the root loads the stylesheets it is given, the candidate asks for cards, and parameters are for plug-ins that tempuh does not run. |

The elements of QTI that hold blocks (`qti-rubric-block`, `qti-feedback-block`, `qti-template-block`, `qti-content-body`,
`qti-modal-feedback`, `qti-test-feedback`, `qti-html-content`) are blocks, and `qti-feedback-inline`,
`qti-template-inline` and `qti-printed-variable` stay inline. A `label` inside an interaction is the `qti-label` of an
inline choice, not the HTML element.

### Attributes

The renderer builds the attributes from the typed node, never from markup, and keeps only these.

| Attributes                                                                                                                            | On                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `id`, `class`, `dir`, `role`, every `aria-*`, `data-catalog-idref`, `data-qti-suppress-tts`, `data-ssml`                              | Every element                              |
| `lang`, from `xml:lang` or `lang`; `xml:lang` wins where both are given (HTML Standard §3.2.6.2)                                      | Every element                              |
| `data-*` with letters, digits, `_`, `.` and `-`, such as `data-selected_color`                                                        | Every element                              |
| `aria-X` from `data-qti-aria-X`, unless the element has `aria-X` ([VOCAB] §1.1.1.4)                                                   | Every element                              |
| `href`, `type`, `src`, `srcset`, `sizes`, `media`, `poster`, `preload`, `loop`, `muted`, `width`, `height`, `alt`, `longdesc`, `cite` | HTML elements that the schema gives them   |
| `controls`, `default`, `open`, read by their presence: `false` leaves them off                                                        | `audio`, `video`, `track`, `details`       |
| `span`, `headers`, `scope`, `abbr`, `axis`, `rowspan`, `colspan`, `align`, `valign`, `summary`, `title`, `srclang`, `kind`, `label`   | `col`, `td`, `th`, `table`, `bdo`, `track` |

Everything else is left out: event handlers, `style`, `autoplay`, `crossorigin`, `mediagroup`, the attributes of other
namespaces, and every attribute that only a QTI element reads (`response-identifier`, `shuffle`, `max-choices` and the
rest). An attribute whose name the DOM would refuse is dropped; it does not throw.

### References

`href`, `src`, `srcset`, `poster`, `longdesc`, `cite` and the `data` of an object go through one policy.

| The reference is                                                     | Result                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A path without scheme or host, such as `images/a.png` or `../b.png`  | Resolved against `base` with olah's `resolveReference`, then `assets(path)`.                                              |
| A path that leaves the package, starts with `/`, or is empty         | Refused.                                                                                                                  |
| An `http` or `https` URL, or `//host/path` (taken as `https`)        | Kept when its origin is in `origins`; refused otherwise.                                                                  |
| A `data:` URL of `image/png`, `jpeg`, `gif`, `webp`, `avif` or `bmp` | Kept for a resource that loads (`img`, `source`, `poster`); refused for a link. `image/svg+xml` and the rest are refused. |
| `javascript:`, `vbscript:`, `blob:`, `file:`, `ftp:` and any other   | Refused, whatever the spelling: tabs, entities, case and leading white space do not hide a scheme.                        |
| `#id`                                                                | Kept for a link, which the root follows; refused for a resource.                                                          |

An element with `xml:base` starts the references below it, its own attributes included, at that base resolved against its
parent's (XML Base §4.2); a base that leaves the package changes nothing. The browser's own URL parser tells the scheme and the
host, so the policy and the page read a reference alike. A refused
reference leaves the attribute off. An `srcset` is parsed as HTML Standard §4.8.4.3.1 reads it, a comma in a URL included;
a candidate with a refused URL or a descriptor that is not a width or a density is left out.

### Embedded files

`object` and the files of a card become the element that fits the media type, and run nothing of the file.

| Media type                           | Element                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `image/*`                            | `img`. Its `alt` is the `alt` that some authors add beside the schema, else the text of the fallback content.                  |
| `audio/*`, `video/*`                 | `audio` or `video` with `controls`, and the fallback content inside.                                                           |
| `text/html`, `application/xhtml+xml` | `iframe` with an empty `sandbox` (no script, no same origin), `referrerpolicy="no-referrer"` and a `title` of the alternative. |
| Anything else                        | A link that opens in a tab of its own, with the fallback content or the message `toolOpenFile` as its text.                    |

The `id`, `class`, `lang`, ARIA and `data-*` attributes of the object go to the element, and its `width` and `height`,
multiplied by `mediaScale` when they are pixels, go to `img`, `video` and `iframe`. A file that the URL policy refuses
leaves the fallback content.

### Links

An `a` keeps `href` when the policy allows it. A link to a file of the package, to an allowed origin or to a printed `uri`
opens in a tab of its own with `rel="noopener noreferrer"`; a link to an `id` does not.

### Printed variables

olah's `resolveContent` replaces a `qti-printed-variable` by its text, and that text is what the renderer draws. A printed
variable that is still in the nodes is formatted with olah's `formatPrintedVariable` from the `variables` option: an
outcome, else a template variable. A `uri` value is a link, and a `file` value is a link to `fileUrl(file)` when the host
gives one. Without `variables` it prints nothing, as NULL does.

### Rubric

A `qti-rubric-block` is drawn when its `view` lists the view of the renderer (`candidate` by default), with
`data-use` set to its `use` when that is `instructions`, `scoring` or `navigation`. An `ext:` use is ignored, so the block
has no `data-use`. The check repeats olah's, so that a view that carried the rubric of a scorer shows it to no candidate.

### Hazards

When `hazards` has an entry with `avoided: true`, the root withholds what plays or can move: `audio`, `video`, an object of
a page, and an image that can animate (`image/gif`, `apng`, `webp`, `avif`, `svg+xml`, or those extensions when no type is
given). Their text alternative stays, and a notice (`div.tempuh-hazards`) names the hazards. olah's engine chooses a
variant without the hazard where it can; the notice is the fallback for a hazard that remains.

## Interactions

An interaction is drawn by the renderer registered for its kind in the `interactions` map, and as a placeholder when there is
none. A renderer gets the interaction and the `BodyRenderer`, and returns the element:

```ts
import type { InteractionRenderers } from "@luthfanwakan/tempuh/player";

const interactions: InteractionRenderers = new Map([
  [
    "choice-interaction",
    (interaction, body) =>
      body.element("qti-choice-interaction", interaction, [
        ...body.nodes(interaction.kind === "choice-interaction" ? (interaction.prompt?.children ?? []) : []),
      ]),
  ],
]);
```

`body.element` sets the attributes the player keeps, and `body.nodes` renders the content of a prompt or a choice with the
same rules, so an interaction needs no code of its own for URLs, languages or media.

## Stylesheets

An item's stylesheet is fetched through the `fetch` option, parsed into a constructed `CSSStyleSheet`, and cleaned on the
parsed rules, which the browser has normalized: a CSS escape cannot hide a function there.

| Removed                                                                                              | Why                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@import`                                                                                            | A constructed sheet ignores it in Chromium, Firefox and WebKit; a test checks that none is left.                                                                                                                                                        |
| Every at-rule besides style, media, supports, keyframes, layer and container rules                   | `@property` can name a resource, `@scope` is outside the baseline, and Firefox does not let a script change `@font-face` and `@page`, so a URL in them could be neither rewritten nor removed. The host declares the fonts of its packages in the page. |
| A rule whose selector names `:host`, `:host()`, `:host-context()` or `::slotted()`                   | It would restyle the host and so escape the containment.                                                                                                                                                                                                |
| A declaration with a `url()` outside the origin of the stylesheet, `origins` and raster `data:` URLs | The page would ask another origin.                                                                                                                                                                                                                      |
| A declaration with `image-set()`, `image()`, `cross-fade()`, `src()`, `element()` or `paint()`       | They load a resource by another name.                                                                                                                                                                                                                   |
| A declaration with a backslash in a value that the browser keeps as written, or a `var()` with one   | `u\72l(` is `url(` in a custom property or a fallback, so the block goes.                                                                                                                                                                               |

A relative `url()` that stays is written as an absolute URL resolved against the stylesheet's URL. A constructed sheet's
`baseURL` option does that in Firefox and WebKit but not in Chromium, which resolves against the page, so the sanitizer
does not rely on it.

## Catalogs and cards

A catalog is not drawn with the item. `root.card(idref, support, language)` renders the card of the catalog whose `id` is
`idref`, for a support, with olah's `selectCard`: the card entry whose `xml:lang` is the language, ignoring case; else the
first with the same primary language; else the entry marked `default`. The result is a `DocumentFragment` of the card's HTML
content, rendered like any content with its `lang`, and of its files, each embedded like an `object` of the file's media
type. It is `undefined` when no catalog has the id, or its card has no entry that fits. The element that asks keeps
`data-catalog-idref`, which the accessibility support reads to find the cards on demand.

## Feedback

`root.showFeedback(feedback)` takes the `ModalFeedback` that olah's `visibleModalFeedback` gives and opens one modal
`<dialog>` named Feedback, with a heading for each title and the content of each. A modal dialog is in the top layer, so the
containment of the root does not clip it; it makes the rest of the page inert, closes with Escape or the Close button, and
gives the focus back to where it was. The focus starts on the heading, so a screen reader reads the dialog from its name.
The promise resolves when the candidate closes it.

Test feedback is a field of `show`: the entries from olah's `visibleTestFeedback` are drawn after the item in a region.

## Where the sources differ

| Case                                                                        | Reading                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The design adopts item sheets with the constructed sheet's `baseURL`        | Chromium ignores it for `url()`; the sanitizer writes the URLs as absolute ones.                                           |
| The design has `style` in no list, and the schema lets any element carry it | `style` is not kept. A class of the shared vocabulary does what an author needs, and an inline style could cover the page. |
| T24 puts test feedback in the chrome (TB9)                                  | The root draws the entries it is given; the chrome decides when.                                                           |
| T7 opens package files "in a viewer"                                        | A link opens the file in a tab of its own. The tools' viewer shows the files of companion materials.                       |
| T19 draws file and uri values "as controls"                                 | Links, from the `variables` option; olah's `resolveContent` leaves only text, which is drawn as it is.                     |
| The parameters of an `object`                                               | Not drawn: they are for plug-ins. olah has already put the values of `param-variable` in them.                             |

## Evidence

`pnpm test:browser` renders every body and stimulus of the 1EdTech examples in Chromium, Firefox and WebKit and compares the
HTML elements with the XML, runs axe at WCAG 2.2 A and AA on the rendered content, tries hostile markup, nodes no reader
would give and hostile stylesheets, and checks that the browser asks no other origin. It needs `pnpm corpus`.
