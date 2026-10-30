import type { Catalog, ModalFeedback } from "@luthfanwakan/olah/asi";
import type { SupportName } from "@luthfanwakan/olah/pnp";
import { checkArray, checkFunction, checkProperties, checkRecord, describe } from "../../checks.js";
import { DataError } from "../../errors.js";
import { renderCard } from "../catalogs/index.js";
import { type BodyRenderer, type BodyRendererOptions, createBodyRenderer } from "../content/index.js";
import { readRenderOptions } from "../content/options.js";
import { showFeedbackDialog } from "../feedback/index.js";
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
   * The stylesheet of the player, built from `player.css` (see the styling guide). Every root adopts it before the
   * stylesheets of the item, and a root that lives as long as the player keeps it, so that WebKit applies a change of the
   * viewport to the media queries of every root.
   */
  readonly stylesheet: CSSStyleSheet;
  /** Typesets the MathML of the root with MathJax. Default: none, so that MathML Core renders the expressions. */
  readonly typesetter?: MathTypesetter;
}

/** A content root: an open shadow root in a host element that shows content. */
export interface ContentRoot {
  /** The shadow root, which holds the content and adopts the stylesheets. */
  readonly root: ShadowRoot;
  /**
   * Shows content in place of what the root showed. The DOM is built before the promise settles; the promise settles
   * when the item's stylesheets are adopted and the expressions are typeset.
   *
   * @throws `DataError` when `content` is not valid.
   * @throws `TempuhError` when a stylesheet cannot be fetched or MathJax cannot be loaded; the content is shown, the
   * stylesheets that loaded are adopted, and the expressions stay MathML.
   */
  show(content: RootContent): Promise<void>;
  /**
   * Renders the card that the catalogs of the shown content have for a support (BPIG §3.7.10).
   *
   * @param idref - The `data-catalog-idref` of the element that the candidate asks about.
   * @param support - The support that the candidate turned on.
   * @param language - The language of the candidate's PNP. Default: none, so that the card gives its default entry.
   * @returns The content, or `undefined` when no catalog has the id or no card fits.
   */
  card(idref: string, support: SupportName, language?: string): DocumentFragment | undefined;
  /**
   * Shows modal feedback in a dialog and resolves when the candidate closes it.
   *
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
 * Creates a content root in a host element: one open shadow root per item together with its stimuli (tempuh design
 * §2.5). Item stylesheets and the markup of the item stay inside it, and neither leaks into nor is restyled by the page.
 * The host is contained by `player.css` (`contain: layout paint`, `isolation: isolate`), so that fixed-position item CSS
 * cannot cover the chrome and a modal dialog is not clipped, because the top layer is outside it.
 *
 * The root builds the DOM with the renderer (`createBodyRenderer`): it refuses what the renderer refuses, loads each item
 * stylesheet through `fetch` and sanitizes it, withholds media where a hazard remains and says so in a notice, and
 * typesets MathML. It decides nothing of QTI: it shows the content that the view resolved.
 *
 * @param host - An element in the page that has no shadow root.
 * @param options - See {@link ContentRootOptions}.
 * @throws `DataError` when `host` is not an element that can have a shadow root and has none, or an option is not of
 * its type.
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
  const { assets, origins } = readRenderOptions({ ...rendererOptions, base: "" });
  let shadow: ShadowRoot;
  try {
    shadow = host.attachShadow({ mode: "open" });
  } catch {
    throw new DataError("The host must be an element that can have a shadow root and has none.");
  }
  shadow.adoptedStyleSheets = [stylesheet];
  const sheets = new Map<string, Promise<CSSStyleSheet>>();
  const stopLinks = followFragmentLinks(shadow);
  let generation = 0;
  let current: HTMLElement | undefined;
  let catalogs: readonly Catalog[] = [];
  let itemRenderer: BodyRenderer = createBodyRenderer(rendererOptions);

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
    show: async (content) => {
      checkContent(content);
      const built = buildContent(content, rendererOptions);
      itemRenderer = built.renderer;
      catalogs = content.catalogs ?? [];
      current?.remove();
      current = built.container;
      shadow.prepend(built.container);
      generation += 1;
      const mine = generation;
      shadow.adoptedStyleSheets = [stylesheet];
      const loaded = await Promise.allSettled((content.stylesheets ?? []).map(sheetFor));
      if (mine === generation) {
        shadow.adoptedStyleSheets = [
          stylesheet,
          ...loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
        ];
        await typesetter?.typeset(shadow);
      }
      const failed = loaded.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    },
    card: (idref, support, language) => renderCard(catalogs, idref, support, language, itemRenderer),
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
