import type { Catalog, ModalFeedback } from "@assesskit/runtime/asi";
import {
  checkArray,
  checkFunction,
  checkPositive,
  checkProperties,
  checkRecord,
  describe,
} from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import type { SupportName } from "@assesskit/runtime/pnp";
import { renderCard } from "../catalogs/index.js";
import {
  type BodyRenderer,
  type BodyRendererOptions,
  createBodyRenderer,
  scaleDeclaredSizes,
} from "../content/index.js";
import { readRenderOptions } from "../content/internal.js";
import { showFeedbackDialog } from "../feedback/index.js";
import { html, shadowRootOf } from "../internal.js";
import type { MathTypesetter } from "../math/index.js";
import { buildContent } from "./build.js";
import { checkContent, type RootContent } from "./content.js";
import { followFragmentLinks } from "./links.js";
import { loadStylesheet, type StylesheetFetch } from "./stylesheet.js";

/** The options of {@link createContentRoot}: those of the renderer, but for what each content brings, and the root's own. */
export interface ContentRootOptions extends Omit<BodyRendererOptions, "base" | "withholdMedia" | "variables"> {
  /** The fetch that loads item stylesheets from the URLs that `assets` gives. */
  readonly fetch: StylesheetFetch;
  /**
   * The stylesheet of the player, built from `player.css` (see the styling guide).
   *
   * @remarks
   * Every root adopts it before the stylesheets of the item, and a root that lives as long as the player keeps it, so
   * that WebKit applies a change of the viewport to the media queries of every root.
   */
  readonly stylesheet: CSSStyleSheet;
  /**
   * Typesets the MathML of the root with MathJax.
   *
   * @defaultValue None, so that MathML Core renders the expressions
   */
  readonly typesetter?: MathTypesetter;
}

/** A content root: an open shadow root in a host element that shows content. */
export interface ContentRoot {
  /** The shadow root, which holds the content and adopts the stylesheets. */
  readonly root: ShadowRoot;
  /**
   * The positioned element that holds the content and stays when the content is replaced, for what lies over the item,
   * such as the tools.
   *
   * @remarks
   * Its content is the item, so a tool that reads the text of the item reads it here.
   */
  readonly stage: HTMLElement;
  /**
   * Shows content in place of what the root showed.
   *
   * @remarks
   * The DOM is built before the promise settles; the promise settles when the item's stylesheets are adopted and the
   * expressions are typeset.
   *
   * @param content - What to show.
   * @returns A promise that resolves when the content is complete.
   * @throws `DataError` when `content` is not valid.
   * @throws `AssesskitError` when a stylesheet cannot be fetched or MathJax cannot be loaded; the content is shown, the
   * stylesheets that loaded are adopted, and the expressions stay MathML.
   */
  show(content: RootContent): Promise<void>;
  /**
   * Renders the card that the catalogs of the shown content have for a support.
   *
   * @param idref - The `data-catalog-idref` of the element that the candidate asks about.
   * @param support - The support that the candidate turned on.
   * @param language - The language of the candidate's PNP; without it the card gives its default entry.
   * @returns The content, or `undefined` when no catalog has the id or no card fits.
   * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, catalogs and cards}
   */
  card(idref: string, support: SupportName, language?: string): DocumentFragment | undefined;
  /**
   * Sets the factor for the pixel sizes of media, which the magnification of non-text content gives.
   *
   * @remarks
   * It applies to the content that is shown and to the cards drawn later. The content is not drawn again, so the focus, the
   * caret and the responses stay.
   *
   * @param scale - A positive number: 1 is the size the author gave, 2 is twice that.
   * @throws `DataError` when `scale` is not a positive number.
   */
  setMediaScale(scale: number): void;
  /**
   * Shows modal feedback in a dialog and resolves when the candidate closes it.
   *
   * @param feedback - The feedback to show, in order.
   * @returns A promise that resolves when the candidate has closed the dialog.
   * @throws `DataError` when `feedback` is not an array.
   */
  showFeedback(feedback: readonly ModalFeedback[]): Promise<void>;
  /** Takes the content and the listeners away, and leaves the shadow root empty. */
  destroy(): void;
}

const ROOT_OPTION_NAMES = [
  "messages",
  "assets",
  "origins",
  "interactions",
  "view",
  "mediaScale",
  "fileUrl",
  "fetch",
  "stylesheet",
  "typesetter",
];

/**
 * Creates a content root in a host element: one open shadow root per item together with its stimuli.
 *
 * @remarks
 * Item stylesheets and the markup of the item stay inside it, and neither leaks into nor is restyled by the page. The
 * host is contained by `player.css` (`contain: layout paint`, `isolation: isolate`), so that fixed-position item CSS
 * cannot cover the chrome and a modal dialog is not clipped, because the top layer is outside it.
 *
 * The root builds the DOM with the renderer (`createBodyRenderer`): it refuses what the renderer refuses, loads each item
 * stylesheet through `fetch` and sanitizes it, withholds media where a hazard remains and says so in a notice, and
 * typesets MathML. It decides nothing of QTI: it shows the content that the view resolved.
 *
 * @param host - An element in the page that has no shadow root, or one that an earlier mount of the player left empty.
 * @param options - See {@link ContentRootOptions}.
 * @returns The content root.
 * @throws `DataError` when `host` is not an element that can have a shadow root and has none, or has one that an earlier mount of the player left empty, or an option is not of its
 * type.
 */
export function createContentRoot(host: HTMLElement, options: ContentRootOptions): ContentRoot {
  if (!(host instanceof HTMLElement)) throw new DataError(`The host must be an element, found ${describe(host)}.`);
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ROOT_OPTION_NAMES);
  checkFunction(options.fetch, "The option fetch must be a function");
  const { stylesheet, typesetter, fetch: fetcher, ...rendererOptions } = options;
  if (!(stylesheet instanceof CSSStyleSheet)) {
    throw new DataError(`The option stylesheet must be a CSSStyleSheet, found ${describe(stylesheet)}.`);
  }
  if (typesetter !== undefined)
    checkFunction(typesetter.typeset, "The typeset method of the option typesetter must be a function");
  const { assets, origins, mediaScale: initialScale } = readRenderOptions({ ...rendererOptions, base: "" });
  const shadow = shadowRootOf(host);
  shadow.adoptedStyleSheets = [stylesheet];
  let itemSheets: readonly CSSStyleSheet[] = [];
  /** Adopts the stylesheets of the item after the player's, and leaves the sheets that others adopted, such as the tools. */
  const adoptItemSheets = (next: readonly CSSStyleSheet[]): void => {
    const others = shadow.adoptedStyleSheets.filter((sheet) => sheet !== stylesheet && !itemSheets.includes(sheet));
    itemSheets = next;
    shadow.adoptedStyleSheets = [stylesheet, ...others, ...next];
  };
  const sheets = new Map<string, Promise<CSSStyleSheet>>();
  const stopLinks = followFragmentLinks(shadow);
  let generation = 0;
  let current: HTMLElement | undefined;
  let catalogs: readonly Catalog[] = [];
  let itemRenderer: BodyRenderer = createBodyRenderer(rendererOptions);
  let mediaScale = initialScale;
  const stage = html("div", { class: "ak-root-stage" });
  shadow.append(stage);

  const sheetFor = (path: string): Promise<CSSStyleSheet> => {
    const url = new URL(assets(path), document.baseURI).href;
    let loading = sheets.get(url);
    if (loading === undefined) {
      loading = loadStylesheet({ url, origins }, fetcher);
      loading.catch(() => sheets.delete(url));
      sheets.set(url, loading);
    }
    return loading;
  };

  return {
    root: shadow,
    stage,
    show: async (content) => {
      checkContent(content);
      const built = buildContent(content, { ...rendererOptions, mediaScale });
      itemRenderer = built.renderer;
      catalogs = content.catalogs ?? [];
      current?.remove();
      current = built.container;
      stage.prepend(built.container);
      generation += 1;
      const mine = generation;
      adoptItemSheets([]);
      const loaded = await Promise.allSettled((content.stylesheets ?? []).map(sheetFor));
      if (mine === generation) {
        adoptItemSheets(loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])));
        await typesetter?.typeset(shadow);
      }
      const failed = loaded.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
    card: (idref, support, language) => {
      const card = renderCard(catalogs, idref, support, language, itemRenderer);
      if (card !== undefined) scaleDeclaredSizes(card, mediaScale);
      return card;
    },
    setMediaScale: (scale) => {
      checkPositive(scale, "The media scale");
      mediaScale = scale;
      scaleDeclaredSizes(shadow, scale);
    },
    showFeedback: (feedback) => {
      checkArray(feedback, "The feedback must be an array");
      return showFeedbackDialog(shadow, feedback, itemRenderer, options.messages);
    },
    destroy: () => {
      generation += 1;
      stopLinks();
      catalogs = [];
      // An open dialog is closed, not just removed, so that the promise of `showFeedback` resolves.
      for (const dialog of shadow.querySelectorAll("dialog")) dialog.close();
      shadow.replaceChildren();
      shadow.adoptedStyleSheets = [];
    },
  };
}
