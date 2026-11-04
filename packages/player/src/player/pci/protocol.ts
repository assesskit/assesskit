import type { JsonValue } from "@assesskit/runtime/values";
import type { Presentation } from "../presentation/index.js";

/**
 * The status that the player tells a portable custom interaction, from the item session.
 *
 * @remarks
 * An interaction in `closed`, `solution` or `review` is not to accept input.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export type PciStatus = "interacting" | "suspended" | "closed" | "solution" | "review";

/**
 * The status that an interaction may ask the player to move the item to when the candidate is done.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export type PciRequestedStatus = Exclude<PciStatus, "suspended">;

const REQUESTED_STATUSES: readonly PciRequestedStatus[] = ["interacting", "closed", "solution", "review"];

/**
 * Tells whether a value is one of the statuses that an interaction may ask for.
 *
 * @param value - The value.
 * @returns `true` for `interacting`, `closed`, `solution` and `review`.
 */
export function isRequestedStatus(value: unknown): value is PciRequestedStatus {
  return REQUESTED_STATUSES.some((status) => status === value);
}

/** Why an interaction did not start. */
export type PciFailure =
  /** The frame is not under its content security policy, so nothing was loaded. */
  | "csp"
  /** A module did not load from its primary or its fallback location, or took longer than `waitSeconds`. */
  | "modules"
  /** The modules loaded, but none registered the type identifier of the interaction. */
  | "register"
  /** The factory of the interaction threw. */
  | "instance"
  /** The host's storage could not give the bytes of a file that the interaction is to receive. */
  | "files";

/**
 * The optional methods of an interaction that report whether its response is valid.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, validity of a portable custom interaction}
 */
export type PciValidityMethod = "checkValidity" | "reportValidity" | "setCustomValidity" | "getCustomValidity";

/** The values that a validity method gives: a verdict, a message, or `undefined` for no verdict. */
export type PciValidityResult = boolean | string | undefined;

/**
 * The modules of a portable custom interaction and where RequireJS loads them from.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, module resolution}
 */
export interface PciModules {
  /**
   * The URL that RequireJS resolves a module name against, ending in `/`.
   *
   * @remarks
   * A dependency such as `./renderer` resolves against the directory of the interaction's primary module, so this is
   * that directory under the base URL of the interaction's asset prefix.
   */
  readonly baseUrl: string;
  /**
   * Where each module is, by module name: absolute URLs without the `.js` extension, tried in order, so the primary
   * location comes first and the fallback after it.
   */
  readonly paths: ReadonlyMap<string, readonly string[]>;
  /** How long RequireJS waits for a script before it tries the next location, in seconds; 0 waits for ever. */
  readonly waitSeconds: number;
  /** The names of the modules to load, which register the interaction. */
  readonly load: readonly string[];
}

/**
 * What the player sends the frame to start the interaction.
 *
 * @remarks
 * The frame builds its document from it, restricts itself with {@link buildFrameCsp}, and loads the modules.
 */
export interface PciStart {
  /** The kind of message. */
  readonly type: "start";
  /** The name of the frame's document. */
  readonly title: string;
  /** The language of the item, a BCP 47 tag. */
  readonly language: string;
  /** The `class` of the element that holds the markup, as on the interaction in the item. */
  readonly className: string;
  /** The origins, besides the frame's own, that scripts, styles, images, media and fonts may come from. */
  readonly origins: readonly string[];
  /** The stylesheets to load, in order. */
  readonly stylesheets: readonly string[];
  /** The HTML of `qti-interaction-markup`, with its URLs resolved. */
  readonly markup: string;
  /** The modules to load. */
  readonly modules: PciModules;
  /** The `custom-interaction-type-identifier` of the interaction. */
  readonly typeIdentifier: string;
  /** The `response-identifier` of the interaction. */
  readonly responseIdentifier: string;
  /** The status of the item session. */
  readonly status: PciStatus;
  /** The `data-*` attributes of the interaction. */
  readonly properties: ReadonlyMap<string, string>;
  /** The template variables bound to the interaction, as JSON. */
  readonly templateVariables: ReadonlyMap<string, JsonValue>;
  /** The context variables bound to the interaction, as JSON. */
  readonly contextVariables: ReadonlyMap<string, JsonValue>;
  /** The value of the response variable, as JSON. */
  readonly boundTo: JsonValue;
  /** The look that the candidate's supports ask for, which the frame sets on its `html` element. */
  readonly presentation: Presentation;
  /** The state to restore, or `null` for a new interaction. */
  readonly state: string | null;
}

/** A message from the player to the frame. */
export type PciCommand =
  | PciStart
  /** Asks for a validity method; the frame answers with a `validity` message of the same `id`. */
  | {
      readonly type: "validity";
      /** Pairs the answer with the request. */
      readonly id: number;
      /** The method to call. */
      readonly method: PciValidityMethod;
      /** The argument of `setCustomValidity`. */
      readonly message?: string;
    }
  /** Sets the look that the candidate's supports ask for on the frame's `html` element, in place of the earlier one. */
  | { readonly type: "presentation"; readonly presentation: Presentation }
  /** Asks for the response and the state; the frame answers with a `snapshot` message of the same `id`. */
  | {
      readonly type: "snapshot";
      /** Pairs the answer with the request. */
      readonly id: number;
    }
  /** Asks the frame to hand over the response and state and to call `oncompleted`. */
  | { readonly type: "complete" };

/** A message from the frame to the player, read and checked by {@link readFrameMessage}. */
export type PciFrameMessage =
  /** The frame's script runs and waits for `start`. */
  | { readonly type: "loaded" }
  /** The interaction called `onready`. */
  | { readonly type: "ready"; readonly state: string }
  /** The interaction fired `qti-interaction-changed`. */
  | {
      readonly type: "changed";
      readonly response: unknown;
      readonly state: string;
      readonly valid: boolean | undefined;
    }
  /** The interaction called `ondone`. */
  | {
      readonly type: "done";
      readonly response: unknown;
      readonly state: string;
      readonly status: PciRequestedStatus;
    }
  /** The height of the frame's content in CSS pixels. */
  | { readonly type: "height"; readonly height: number }
  /** The answer to a `validity` command. */
  | { readonly type: "validity"; readonly id: number; readonly value: PciValidityResult }
  /** The answer to a `snapshot` command: the response and the state, or `null` when no interaction runs. */
  | {
      readonly type: "snapshot";
      readonly id: number;
      readonly flushed: { readonly response: unknown; readonly state: string } | null;
    }
  /** The answer to `complete`: the final response and state, or `null` when no interaction existed. */
  | {
      readonly type: "completed";
      readonly flushed: { readonly response: unknown; readonly state: string } | null;
    }
  /** The interaction did not start. */
  | { readonly type: "failed"; readonly reason: PciFailure };
