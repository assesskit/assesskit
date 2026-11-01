import type { CandidateView } from "@assesskit/runtime/delivery";
import type { SupportName } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import { mountTools, type ToolSlots } from "../tools/index.js";

/** What the tools of the shell need of the player. */
export interface DeliveryToolsContext {
  /** Reports a tool of the host that threw. */
  readonly report: (error: unknown) => void;
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag. */
  readonly language: string;
  /** The element in the chrome that gets the toolbar and the panels. */
  readonly slot: HTMLElement;
  /** The element that holds the item, which the rule, the protractor, the line reader and the masks lie over. */
  readonly stage: HTMLElement;
  /** Turns the path of a file in the package into a URL under a signed prefix. */
  readonly assets: (path: string) => string;
  /** The tools that the host provides. */
  readonly slots: ToolSlots;
  /** Asks to turn a tool of the profile on or off. */
  readonly request: (name: SupportName, active: boolean) => void;
}

/** The tools of the item presented and the candidate's profile, mounted in the chrome. */
export interface DeliveryTools {
  /**
   * Shows the tools that the item and the profile of a view put in force.
   *
   * @remarks
   * A tool that stays in force stays open where the candidate put it, and the others go; with no item presented there are no
   * tools. Call it once the content of the view is shown. A view with the same item and the same supports as the last one
   * changes nothing, unless the content was drawn again.
   *
   * @param view - The view.
   * @param redrawn - Whether the content of the view was drawn again, so that what the tools put on it is drawn again too.
   */
  update(view: CandidateView, redrawn?: boolean): void;
  /** Takes the tools down. */
  destroy(): void;
}

/**
 * Mounts the tools of the shell: the companion materials of the item presented, which the runtime reads, and the supports
 * of the view.
 *
 * @remarks
 * The tools that a support of the profile turns on and off ask for the `support` action through `request`; the others open
 * and close at once.
 *
 * @param context - See {@link DeliveryToolsContext}.
 * @returns The tools.
 */
export function mountDeliveryTools(context: DeliveryToolsContext): DeliveryTools {
  const { messages, language, slot, stage, assets, slots, request } = context;
  const tools = mountTools(slot, { messages, language, stage, assets, slots, onSupport: request });
  let shown: string | undefined;

  return {
    update: (view, redrawn = false) => {
      const { current } = view;
      const key = current === undefined ? "" : JSON.stringify([current.key, view.supports]);
      if (key === shown && !redrawn) return;
      shown = key;
      try {
        tools.update({
          companion: current?.companionMaterials ?? null,
          supports: current === undefined ? [] : view.supports,
          content:
            current === undefined
              ? null
              : { item: JSON.stringify(current.key), stimuli: current.stimuli.map(({ identifier }) => identifier) },
        });
      } catch (error) {
        // A tool of the host that fails must not keep the candidate from the question.
        context.report(error);
      }
    },
    destroy: tools.destroy,
  };
}
