import type { CandidateView, SupportView } from "@assesskit/runtime/delivery";
import type { ColorTheme } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import type { ContentRoot } from "../roots/index.js";
import type { Lexicon, SpeechHook } from "../speech/index.js";
import {
  applyPresentation,
  mediaScaleOf,
  mountContentSupports,
  mountSpoken,
  mountVariantNotice,
  presentationOf,
  type SupportPanel,
} from "../supports/index.js";
import { checkColorTheme } from "../supports/internal.js";
import type { PciHost } from "./pci.js";

/** What the supports of the shell need of the player. */
export interface SupportsContext {
  /** Reports settings that reading aloud cannot use. */
  readonly report: (error: unknown) => void;
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag. */
  readonly language: string;
  /** The element that gets the notice of the variant, the panel and the controls of reading aloud. */
  readonly slot: HTMLElement;
  /** The host of the content root, which takes the look of the supports. */
  readonly contentHost: HTMLElement;
  /** The content the supports change. */
  readonly content: ContentRoot;
  /** The frames of portable custom interactions, which take the look too. */
  readonly pci: PciHost;
  /** The voice that reads aloud. */
  readonly voice: SpeechHook;
  /** Mounts the panel of the options in the slot, which reports the color theme the candidate chooses; without it the panel is not drawn. */
  readonly panel?: (slot: HTMLElement, onColorTheme: (theme: ColorTheme) => void) => SupportPanel;
}

/** The supports of the candidate, applied to the content of the views the player shows and to the player around it. */
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
   * Shows the content in the color theme that the candidate chose, for as long as the supports stay mounted.
   *
   * @param theme - The theme.
   */
  setColorTheme(theme: ColorTheme): void;
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
 * Mounts the parts of the supports in the player and the content: the panel of the supports where the caller gives one, and the
 * notice of the variant; the look, the scale of media, the cards and the reading aloud that the supports that are on ask for.
 *
 * @remarks
 * The parts decide nothing: they follow `CandidateView.supports`.
 *
 * @param context - See {@link SupportsContext}.
 * @returns The supports.
 */
export function mountDeliverySupports(context: SupportsContext): DeliverySupports {
  const { messages, language, slot, contentHost, content, pci, voice } = context;
  const variant = mountVariantNotice(slot, { messages, language });
  let supports: readonly SupportView[] = [];
  let chosen: ColorTheme | undefined;
  const applyLook = (theme: ColorTheme | undefined): void => {
    const presentation = presentationOf(supports, theme === undefined ? {} : { colorTheme: theme });
    chosen = theme;
    applyPresentation(contentHost, presentation);
    pci.setPresentation(presentation);
  };
  const setColorTheme = (theme: ColorTheme): void => {
    checkColorTheme(theme, "The color theme");
    applyLook(theme);
    panel?.update(supports, theme);
  };
  const panel = context.panel?.(slot, setColorTheme);
  const spoken = mountSpoken(slot, content, { messages, language, voice, onError: context.report });
  const cards = mountContentSupports(content, { messages });
  let look: string | undefined;
  let applied: string | undefined;

  return {
    update: (view) => {
      const key = JSON.stringify(view.supports);
      supports = view.supports;
      if (key !== look) {
        look = key;
        applyLook(chosen);
        content.setMediaScale(mediaScaleOf(view.supports));
      }
      panel?.update(view.supports, chosen);
      variant.update(view.current?.variant);
    },
    setColorTheme,
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
        context.report(error);
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
