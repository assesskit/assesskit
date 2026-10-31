import type { CandidateView } from "@assesskit/runtime/delivery";
import type { SupportName } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import type { ContentRoot } from "../roots/index.js";
import type { Lexicon, SpeechHook } from "../speech/index.js";
import {
  applyPresentation,
  mediaScaleOf,
  mountContentSupports,
  mountSpoken,
  mountSupportPanel,
  mountVariantNotice,
  presentationOf,
} from "../supports/index.js";
import type { PciHost } from "./pci.js";

/** What the supports of the shell need of the player. */
export interface SupportsContext {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag. */
  readonly language: string;
  /** The element in the chrome that gets the notice of the variant, the panel and the controls of reading aloud. */
  readonly slot: HTMLElement;
  /** The host of the content root, which takes the look of the supports. */
  readonly contentHost: HTMLElement;
  /** The content the supports change. */
  readonly content: ContentRoot;
  /** The frames of portable custom interactions, which take the look too. */
  readonly pci: PciHost;
  /** The voice that reads aloud. */
  readonly voice: SpeechHook;
  /** Asks to turn a support on or off; without it the panel of options is not drawn. */
  readonly request?: (name: SupportName, active: boolean) => void;
}

/** The supports of the candidate, applied to the chrome and the content of the views the player shows. */
export interface DeliverySupports {
  /**
   * Applies what the supports of a view change outside the content: the look, the scale of media sized in pixels, the
   * panel and the notice of the variant.
   *
   * @remarks
   * The content is not drawn again.
   *
   * @param view - The view.
   */
  update(view: CandidateView): void;
  /**
   * Gives reading aloud the pronunciation lexicons of the item shown, in order of preference.
   *
   * @param lexicons - The lexicons.
   */
  setLexicons(lexicons: readonly Lexicon[]): void;
  /**
   * Applies what the supports change inside the content: the cards, the text tracks, the alternative text and reading aloud.
   *
   * @remarks
   * Call it once the content of the view is shown. Nothing is applied again for a view with the same supports over the same
   * content, so that a popup the candidate opened stays open while answers are saved.
   *
   * @param view - The view.
   * @param drawn - Whether the content was drawn again.
   */
  applyToContent(view: CandidateView, drawn: boolean): void;
  /** Takes the parts away and gives the content back as the root drew it. */
  destroy(): void;
}

/**
 * Mounts the parts of the supports in the chrome and the content: the panel of the supports, with a button for each option
 * that sends the `support` action through `request`, and the notice of the variant; the look, the scale of media, the
 * cards and the reading aloud that the supports that are on ask for.
 *
 * @remarks
 * The parts decide nothing: they follow `CandidateView.supports`.
 *
 * @param context - See {@link SupportsContext}.
 * @returns The supports.
 */
export function mountDeliverySupports(context: SupportsContext): DeliverySupports {
  const { messages, language, slot, contentHost, content, pci, voice, request } = context;
  const variant = mountVariantNotice(slot, { messages, language });
  const panel = request === undefined ? undefined : mountSupportPanel(slot, { messages, onSupport: request });
  const spoken = mountSpoken(slot, content, { messages, language, voice });
  const cards = mountContentSupports(content, { messages });
  let look: string | undefined;
  let applied: string | undefined;

  return {
    update: (view) => {
      const key = JSON.stringify(view.supports);
      if (key !== look) {
        look = key;
        const presentation = presentationOf(view.supports);
        applyPresentation(contentHost, presentation);
        pci.setPresentation(presentation);
        content.setMediaScale(mediaScaleOf(view.supports));
      }
      panel?.update(view.supports);
      variant.update(view.current?.variant);
    },
    setLexicons: (lexicons) => spoken.setLexicons(lexicons),
    applyToContent: (view, drawn) => {
      const key = JSON.stringify(view.supports);
      if (!drawn && key === applied) return;
      applied = key;
      try {
        cards.update(view.supports);
        spoken.update(view.supports);
      } catch (error) {
        // Settings that reading aloud cannot use must not keep the candidate from the question.
        reportError(error);
      }
    },
    destroy: () => {
      spoken.destroy();
      cards.destroy();
      panel?.destroy();
      variant.destroy();
    },
  };
}
