import type { PortableCustomInteraction } from "@assesskit/runtime/asi";
import type { PciModuleConfiguration } from "@assesskit/runtime/pci";
import type { Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { Presentation } from "../presentation/index.js";
import type { PciFiles, PciVariable } from "./files.js";
import type { PciFailure, PciRequestedStatus, PciStatus } from "./protocol.js";

/**
 * What a portable custom interaction does that the player acts on.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export type PciEvent =
  /** The interaction is built and ready for the candidate. */
  | {
      /** The kind of event. */
      readonly type: "ready";
      /** The state of the interaction. */
      readonly state: string;
    }
  /**
   * The response changed: the interaction fired `qti-interaction-changed`, and the frame read `getResponse()` and
   * `getState()`. The player sets the response variable to `response` and stores `state` with it.
   */
  | {
      /** The kind of event. */
      readonly type: "changed";
      /** The value of `getResponse()`, or `null` when the interaction has no response. */
      readonly response: Value | null;
      /** The result of `getState()`. */
      readonly state: string;
      /** What the interaction says of its validity, if it says. */
      readonly valid: boolean | undefined;
    }
  /**
   * The candidate is done, and the interaction asks for the item to move to `status`, which the player may refuse.
   */
  | {
      /** The kind of event. */
      readonly type: "done";
      /** The response that the interaction passed, or `null` for NULL. */
      readonly response: Value | null;
      /** The state that the interaction passed. */
      readonly state: string;
      /** The status asked for; `interacting` when the interaction gives none. */
      readonly status: PciRequestedStatus;
    }
  /** Sent by `destroy` before the frame goes: the final response and state, which the player flushes. */
  | {
      /** The kind of event. */
      readonly type: "completed";
      /** The value of `getResponse()`, or `null` when the interaction has no response. */
      readonly response: Value | null;
      /** The result of `getState()`. */
      readonly state: string;
    }
  /** The interaction did not start. */
  | {
      /** The kind of event. */
      readonly type: "failed";
      /** Why. */
      readonly reason: PciFailure;
    };

/** The options of {@link mountPciFrame}. */
export interface PciFrameOptions {
  /** The base URL of the player's static files on the asset origin, ending in `/`: `pci-frame/frame.html` and `player.css` are under it. */
  readonly staticUrl: string;
  /**
   * The origins, besides the asset origin, that scripts, styles, images, media and fonts of the frame may come from.
   *
   * @defaultValue `[]`
   */
  readonly origins?: readonly string[];
  /** The text of the interface; the frame's title is `interactiveQuestion` when the interaction has no prompt. */
  readonly messages: Pick<Messages, "interactiveQuestion">;
  /** The language of the item, a BCP 47 tag. */
  readonly language: string;
  /**
   * The interaction, as the runtime reads it.
   *
   * @remarks
   * Its type identifier, response identifier, `class`, `data-*` attributes and modules come from it.
   */
  readonly interaction: PortableCustomInteraction;
  /** The module resolution files of the interaction, parsed; a file that the package lacks is left out. */
  readonly configuration: PciModuleConfiguration;
  /** Gives the URL, under the asset prefix of the package, of a path in the package. */
  readonly assets: (path: string) => string;
  /** The text of the interaction's prompt, which names the frame, or `null` for none. */
  readonly prompt: string | null;
  /** The HTML of `qti-interaction-markup`, with the URLs in it resolved. The frame parses it, under its policy. */
  readonly markup: string;
  /** The URLs of the item's stylesheets, loaded after `player.css` from `staticUrl`. */
  readonly stylesheets: readonly string[];
  /** The status of the item session. */
  readonly status: PciStatus;
  /**
   * The state that `getState` gave before, to restore, or `null` for a new interaction.
   *
   * @defaultValue `null`
   */
  readonly state?: string | null;
  /**
   * The look that the candidate's supports ask for, from `presentationOf`; `setPresentation` changes it later.
   *
   * @defaultValue None
   */
  readonly presentation?: Presentation;
  /** The response variable the interaction is bound to, with its value. */
  readonly response: PciVariable;
  /**
   * The template variables bound to the interaction, by identifier.
   *
   * @defaultValue An empty map
   */
  readonly templateVariables?: ReadonlyMap<string, PciVariable>;
  /**
   * The context variables bound to the interaction, by identifier.
   *
   * @defaultValue An empty map
   */
  readonly contextVariables?: ReadonlyMap<string, PciVariable>;
  /** The host's storage of files. */
  readonly files: PciFiles;
  /** Receives what the interaction does, in order. */
  readonly onEvent: (event: PciEvent) => void;
}
