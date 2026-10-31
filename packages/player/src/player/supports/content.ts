import { checkProperties, checkRecord, describe } from "@assesskit/runtime/checks";
import type { SupportView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../../messages/internal.js";
import { showTracks } from "../media/index.js";
import type { ContentRoot } from "../roots/index.js";
import { CARD_KIND_ORDER, cardKindOf, showCard } from "./cards.js";
import { activeSupport, checkSupportViews } from "./check.js";
import { showAlternativeText, trackKindsOf } from "./media.js";

/** The options of {@link mountContentSupports}. */
export interface ContentSupportsOptions {
  /** The text of the interface. */
  readonly messages: Messages;
}

/** The supports that change the content of a content root: cards, text tracks and the alternative text of images. */
export interface ContentSupports {
  /**
   * Applies the supports that are on to the content that the root shows, in place of what an earlier call applied.
   *
   * @remarks
   * Call it after `show` of the root resolves, and again when the supports change.
   *
   * @param supports - The supports of the view.
   * @throws `DataError` when `supports` is not a list of the runtime's `SupportView`s.
   */
  update(supports: readonly SupportView[]): void;
  /** Gives the content back as the root drew it. */
  destroy(): void;
}

/**
 * Returns the language of the cards of a support: its own for a translation or sign language, else that of the
 * translation of the question when that is on, else none, which gives the default entry.
 */
function languageFor(supports: readonly SupportView[], { settings }: SupportView): string | undefined {
  if (settings?.name === "keyword-translation" || settings?.name === "sign-language") return settings.language;
  const translation = activeSupport(supports, "item-translation")?.settings;
  return translation?.name === "item-translation" ? translation.language : undefined;
}

function checkRoot(root: unknown, options: unknown): asserts options is ContentSupportsOptions {
  checkRecord(root, "The content root must be an object");
  if (!(root.root instanceof ShadowRoot)) {
    throw new DataError(`The root of the content root must be a shadow root, found ${describe(root.root)}.`);
  }
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", ["messages"]);
  checkMessages(options.messages);
}

/**
 * Mounts the supports that change the content of a content root.
 *
 * @remarks
 * For each element that asks for a card with `data-catalog-idref`, and each support that is on and has a card there, it
 * shows the card the way the support asks for: the glossary, the translation of keywords, the guidance and the directions
 * in a popup that opens on request and stays until dismissed; high contrast and the simplified graphics and language in
 * place of the content; sign language, audio description, captions, transcript, alternative text, long description,
 * braille and tactile beside it. It also shows the caption and description tracks of the media, and the `alt` of images
 * as text when the alternative text is on. The card is chosen by `ContentRoot.card`, in the language of the support.
 *
 * @param root - The content root whose content the supports change.
 * @param options - See {@link ContentSupportsOptions}.
 * @returns The handle that applies the supports and takes them away.
 * @throws `DataError` when `root` or an option is not valid.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, catalogs and cards}
 * @see {@link https://www.w3.org/TR/WCAG22/#content-on-hover-or-focus | WCAG 2.2, content on hover or focus}
 */
export function mountContentSupports(root: ContentRoot, options: ContentSupportsOptions): ContentSupports {
  checkRoot(root, options);
  const { messages } = options;
  const scope = root.root;
  let undo: (() => void)[] = [];

  const clear = (): void => {
    for (const restore of undo.reverse()) restore();
    undo = [];
  };

  return {
    update(supports) {
      checkSupportViews(supports, "The list of supports");
      clear();
      const on = supports.filter(({ active }) => active);
      const boundary = (): DOMRect => scope.host.getBoundingClientRect();
      for (const element of scope.querySelectorAll("[data-catalog-idref]")) {
        const idref = element.getAttribute("data-catalog-idref") ?? "";
        for (const kind of CARD_KIND_ORDER) {
          for (const support of on.filter(({ name }) => cardKindOf(name) === kind)) {
            const content = root.card(idref, support.name, languageFor(supports, support));
            if (content !== undefined) undo.push(showCard(kind, { messages, element, support, content, boundary }));
          }
        }
      }
      undo.push(showTracks(scope, trackKindsOf(supports)), showAlternativeText(scope, supports));
    },
    destroy: clear,
  };
}
