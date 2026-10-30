import type { PciJson } from "@luthfanwakan/olah/pci";
import { checkNonNegativeInteger, checkRecord, checkString, describe } from "../../checks.js";
import { DataError } from "../../errors.js";

/**
 * The status that the player tells a portable custom interaction, from the item session ([BPIG] §3.7.12.7.1). An
 * interaction in `closed`, `solution` or `review` is not to accept input.
 */
export type PciStatus = "interacting" | "suspended" | "closed" | "solution" | "review";

/** The status that an interaction may ask the player to move the item to when the candidate is done ([BPIG] §3.7.12.7.2). */
export type PciRequestedStatus = Exclude<PciStatus, "suspended">;

const REQUESTED_STATUSES: readonly PciRequestedStatus[] = ["interacting", "closed", "solution", "review"];

/** Tells whether a value is one of the statuses that an interaction may ask for, in the words of [BPIG] §3.7.12.7.2. */
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

const FAILURES: readonly PciFailure[] = ["csp", "modules", "register", "instance", "files"];

/** The optional methods of an interaction that report whether its response is valid ([BPIG] §3.7.12.7.3). */
export type PciValidityMethod = "checkValidity" | "reportValidity" | "setCustomValidity" | "getCustomValidity";

/** The values that a validity method gives: a verdict, a message, or `undefined` for no verdict. */
export type PciValidityResult = boolean | string | undefined;

/** The modules of a portable custom interaction and where RequireJS loads them from ([BPIG] §3.7.12.1–4). */
export interface PciModules {
  /**
   * The URL that RequireJS resolves a module name against, ending in `/`. A dependency such as `./renderer` resolves
   * against the directory of the interaction's primary module, so this is that directory under the base URL of the
   * interaction's asset prefix.
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
 * What the player sends the frame to start the interaction. The frame builds its document from it, restricts itself
 * with {@link buildFrameCsp}, and loads the modules.
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
  /** The template variables bound to the interaction, as JSON ([BPIG] App. C). */
  readonly templateVariables: ReadonlyMap<string, PciJson>;
  /** The context variables bound to the interaction, as JSON ([BPIG] App. C). */
  readonly contextVariables: ReadonlyMap<string, PciJson>;
  /** The value of the response variable, as JSON ([BPIG] App. C). */
  readonly boundTo: PciJson;
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
  /** The answer to `complete`: the final response and state, or `null` when no interaction existed. */
  | {
      readonly type: "completed";
      readonly flushed: { readonly response: unknown; readonly state: string } | null;
    }
  /** The interaction did not start. */
  | { readonly type: "failed"; readonly reason: PciFailure };

/**
 * Builds the content security policy of the frame (CSP Level 3, §6.1): nothing by default; scripts, styles, images,
 * media and fonts from the frame's own origin and the allowed ones; inline styles, since most interactions set them, and
 * `data:` images, media and fonts, which reach no network; no connection, frame, form or `base`. No script runs inline
 * and no string is evaluated.
 *
 * @param frameOrigin - The origin of the frame's document, which also serves the package files.
 * @param origins - The other origins that may serve scripts, styles, images, media and fonts.
 */
export function buildFrameCsp(frameOrigin: string, origins: readonly string[]): string {
  const sources = [frameOrigin, ...origins].join(" ");
  return [
    "default-src 'none'",
    `script-src ${sources}`,
    `style-src ${sources} 'unsafe-inline'`,
    `img-src ${sources} data:`,
    `media-src ${sources} data:`,
    `font-src ${sources} data:`,
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

/**
 * Turns a value into JSON: `undefined`, which `getResponse` returns for no response, becomes `null`, and what JSON cannot
 * carry, such as an object that only a structured clone can hold, is lost as `JSON.stringify` loses it.
 *
 * @throws `DataError` when the value has a cycle, a BigInt or too many levels.
 */
export function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new DataError("A value must be JSON, found a value with a cycle, a BigInt or too many levels.");
  }
}

function readState(value: unknown): string {
  checkString(value, "The state of an interaction");
  return value;
}

function readValid(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new DataError(`The validity of an interaction must be a boolean or undefined, found ${describe(value)}.`);
  }
  return value;
}

function readStatus(value: unknown): PciRequestedStatus {
  if (!isRequestedStatus(value)) {
    throw new DataError(
      `The status that an interaction asks for must be "interacting", "closed", "solution" or "review", found ${describe(value)}.`,
    );
  }
  return value;
}

function readValidityResult(value: unknown): PciValidityResult {
  if (value === undefined || typeof value === "boolean" || typeof value === "string") return value;
  throw new DataError(`A validity method gives a boolean, a string or undefined, found ${describe(value)}.`);
}

function readFlushed(value: unknown): { readonly response: unknown; readonly state: string } | null {
  if (value === null) return null;
  checkRecord(value, "The final state of an interaction must be an object or null");
  return { response: toJson(value.response), state: readState(value.state) };
}

function readFailure(value: unknown): PciFailure {
  const reason = FAILURES.find((candidate) => candidate === value);
  if (reason === undefined) {
    throw new DataError(
      `A failure must be "csp", "modules", "register", "instance" or "files", found ${describe(value)}.`,
    );
  }
  return reason;
}

/**
 * Reads a message that a frame posted to the player. A frame holds code of the package, so a message is untrusted: it
 * is checked for its shape, and responses become JSON. The caller checks that the message came from the frame's window.
 *
 * @throws `DataError` when the message is not one that the frame sends.
 */
export function readFrameMessage(data: unknown): PciFrameMessage {
  checkRecord(data, "A message from the frame must be an object");
  switch (data.type) {
    case "loaded":
      return { type: "loaded" };
    case "ready":
      return { type: "ready", state: readState(data.state) };
    case "changed":
      return {
        type: "changed",
        response: toJson(data.response),
        state: readState(data.state),
        valid: readValid(data.valid),
      };
    case "done":
      return {
        type: "done",
        response: toJson(data.response),
        state: readState(data.state),
        status: readStatus(data.status),
      };
    case "height":
      checkNonNegativeInteger(data.height, "The height of the frame");
      return { type: "height", height: data.height };
    case "validity":
      checkNonNegativeInteger(data.id, "The identifier of a validity request");
      return { type: "validity", id: data.id, value: readValidityResult(data.value) };
    case "completed":
      return { type: "completed", flushed: readFlushed(data.flushed) };
    case "failed":
      return { type: "failed", reason: readFailure(data.reason) };
    default:
      throw new DataError(
        `A message from the frame has the type "loaded", "ready", "changed", "done", "height", "validity", "completed" or "failed", found ${describe(data.type)}.`,
      );
  }
}
