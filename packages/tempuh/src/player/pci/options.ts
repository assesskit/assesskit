import {
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../../checks.js";
import { DataError } from "../../errors.js";
import type { Messages } from "../../messages/index.js";
import {
  type PciFailure,
  type PciModules,
  type PciRequestedStatus,
  type PciStart,
  type PciStatus,
  toJson,
} from "./protocol.js";

/** The seconds that RequireJS waits for a script when the module resolution says nothing ([BPIG] §3.7.12.2). */
const DEFAULT_WAIT_SECONDS = 7;

/** The shared stylesheet of the player, under `staticUrl`. */
const PLAYER_CSS = "player.css";

const STATUSES: readonly PciStatus[] = ["interacting", "suspended", "closed", "solution", "review"];

/** What a portable custom interaction does that the player acts on. */
export type PciEvent =
  /** The interaction is built and ready for the candidate ([BPIG] §3.7.12.7.2). */
  | {
      /** The kind of event. */
      readonly type: "ready";
      /** The state of the interaction. */
      readonly state: string;
    }
  /**
   * The response changed: the interaction fired `qti-interaction-changed`, and the frame read `getResponse()` and
   * `getState()` ([BPIG] §3.7.12.7.5).
   */
  | {
      /** The kind of event. */
      readonly type: "changed";
      /** The JSON of `getResponse()`, or `null` when the interaction has no response. */
      readonly response: unknown;
      /** The result of `getState()`. */
      readonly state: string;
      /** What the interaction says of its validity, if it says. */
      readonly valid: boolean | undefined;
    }
  /**
   * The candidate is done, and the interaction asks for the item to move to `status`, which the player may refuse
   * ([BPIG] §3.7.12.7.2).
   */
  | {
      /** The kind of event. */
      readonly type: "done";
      /** The JSON of the response that the interaction passed. */
      readonly response: unknown;
      /** The state that the interaction passed. */
      readonly state: string;
      /** The status asked for; `interacting` when the interaction gives none. */
      readonly status: PciRequestedStatus;
    }
  /** Sent by `destroy` before the frame goes: the final response and state, which the player flushes. */
  | {
      /** The kind of event. */
      readonly type: "completed";
      /** The JSON of `getResponse()`, or `null` when the interaction has no response. */
      readonly response: unknown;
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
  /** The base URL of tempuh's static files on the asset origin, ending in `/`: `pci-frame/frame.html` and `player.css` are under it. */
  readonly staticUrl: string;
  /**
   * The origins, besides the asset origin, that scripts, styles, images, media and fonts of the frame may come from.
   * Default: `[]`.
   */
  readonly origins?: readonly string[];
  /** The text of the interface; the frame's title is `interactiveQuestion` when the interaction has no prompt. */
  readonly messages: Pick<Messages, "interactiveQuestion">;
  /** The text of the interaction's prompt, which names the frame, or `null` for none. */
  readonly prompt: string | null;
  /** The language of the item, a BCP 47 tag. */
  readonly language: string;
  /** The `class` of the interaction, so that the stylesheets of the item select its markup as they do in the item. Default: `""`. */
  readonly className?: string;
  /** The URLs of the item's stylesheets, loaded after `player.css` from `staticUrl`. */
  readonly stylesheets: readonly string[];
  /** The HTML of `qti-interaction-markup`, with the URLs in it resolved. The frame parses it, under its policy. */
  readonly markup: string;
  /** The modules to load and where they are. */
  readonly modules: PciModules;
  /** The `custom-interaction-type-identifier` of the interaction. */
  readonly typeIdentifier: string;
  /** The `response-identifier` of the interaction. */
  readonly responseIdentifier: string;
  /** The status of the item session. */
  readonly status: PciStatus;
  /** The `data-*` attributes of the interaction, named as `dataset` names them ([BPIG] §3.7.12.7.1). Default: empty. */
  readonly properties?: ReadonlyMap<string, string>;
  /** The template variables bound to the interaction, by identifier, as JSON ([BPIG] App. C). Default: empty. */
  readonly templateVariables?: ReadonlyMap<string, unknown>;
  /** The context variables bound to the interaction, by identifier, as JSON ([BPIG] App. C). Default: empty. */
  readonly contextVariables?: ReadonlyMap<string, unknown>;
  /** The value of the response variable, as JSON ([BPIG] App. C). */
  readonly boundTo: unknown;
  /** The state that `getState` gave before, to restore, or `null` for a new interaction. Default: `null`. */
  readonly state?: string | null;
  /** Receives what the interaction does. */
  readonly onEvent: (event: PciEvent) => void;
}

/** Parses an absolute URL; `URL.canParse` is outside the browser baseline. */
function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

function checkHttpUrl(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  const url = parseUrl(value);
  if (url === undefined || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new DataError(`${label} must be an absolute http or https URL, found ${describe(value)}.`);
  }
}

function checkBaseUrl(value: unknown, label: string): asserts value is string {
  checkHttpUrl(value, label);
  if (!value.endsWith("/")) throw new DataError(`${label} must end in "/", found ${describe(value)}.`);
}

function checkOrigin(value: unknown): asserts value is string {
  checkHttpUrl(value, "An origin");
  if (new URL(value).origin !== value) {
    throw new DataError(
      `An origin must be a scheme, a host and a port only, such as "https://cdn.example", found ${describe(value)}.`,
    );
  }
}

function checkEach(value: unknown, message: string, check: (item: unknown) => void): void {
  checkArray(value, message);
  for (const item of value) check(item);
}

function checkMap(value: unknown, message: string): asserts value is ReadonlyMap<unknown, unknown> {
  if (!(value instanceof Map)) throw new DataError(`${message}, found ${describe(value)}.`);
}

function checkModules(value: unknown): asserts value is PciModules {
  checkRecord(value, "The option modules must be an object");
  checkProperties(value, "The option modules", ["baseUrl", "paths", "waitSeconds", "load"]);
  const { baseUrl, paths, waitSeconds = DEFAULT_WAIT_SECONDS, load } = value;
  checkBaseUrl(baseUrl, "The base URL of the modules");
  checkMap(paths, "The paths of the modules must be a Map");
  for (const [name, locations] of paths) {
    checkNonEmptyString(name, "The name of a module");
    checkEach(locations, `The locations of the module ${describe(name)} must be an array`, (location) =>
      checkHttpUrl(location, `A location of the module ${describe(name)}`),
    );
  }
  checkNonNegativeInteger(waitSeconds, "The option waitSeconds");
  checkEach(load, "The modules to load must be an array", (name) => checkNonEmptyString(name, "A module to load"));
}

function checkEntries(value: unknown, label: string, checkValue: (item: unknown, name: string) => void): void {
  checkMap(value, `${label} must be a Map`);
  for (const [name, item] of value) {
    checkNonEmptyString(name, `A name in ${label}`);
    checkValue(item, name);
  }
}

/**
 * Checks the options of {@link mountPciFrame}, as a host passes them from JavaScript.
 *
 * @throws `DataError` when an option is missing, has the wrong type, or is a URL or an origin that is not one.
 */
export function checkPciFrameOptions(options: unknown): asserts options is PciFrameOptions {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", [
    "staticUrl",
    "origins",
    "messages",
    "prompt",
    "language",
    "className",
    "stylesheets",
    "markup",
    "modules",
    "typeIdentifier",
    "responseIdentifier",
    "status",
    "properties",
    "templateVariables",
    "contextVariables",
    "boundTo",
    "state",
    "onEvent",
  ]);
  const { staticUrl, origins = [], messages, prompt, language, className = "", stylesheets, markup } = options;
  checkBaseUrl(staticUrl, "The option staticUrl");
  checkEach(origins, "The option origins must be an array", checkOrigin);
  checkRecord(messages, "The option messages must be an object");
  checkNonEmptyString(messages.interactiveQuestion, "The message interactiveQuestion");
  if (prompt !== null) checkString(prompt, "The option prompt");
  checkNonEmptyString(language, "The option language");
  checkString(className, "The option className");
  checkEach(stylesheets, "The option stylesheets must be an array", (url) =>
    checkHttpUrl(url, "A stylesheet of the option stylesheets"),
  );
  checkString(markup, "The option markup");
  checkModules(options.modules);
  checkNonEmptyString(options.typeIdentifier, "The option typeIdentifier");
  checkNonEmptyString(options.responseIdentifier, "The option responseIdentifier");
  if (!STATUSES.some((status) => status === options.status)) {
    throw new DataError(
      `The option status must be "interacting", "suspended", "closed", "solution" or "review", found ${describe(options.status)}.`,
    );
  }
  const { properties = new Map(), templateVariables = new Map(), contextVariables = new Map(), state = null } = options;
  checkEntries(properties, "The option properties", (value, name) =>
    checkString(value, `The property ${describe(name)}`),
  );
  checkEntries(templateVariables, "The option templateVariables", toJson);
  checkEntries(contextVariables, "The option contextVariables", toJson);
  if (state !== null) checkString(state, "The option state");
  checkFunction(options.onEvent, "The option onEvent must be a function");
}

/** Collapses the white space of a prompt, which was text in a block, into the one line of a title. */
const oneLine = (text: string): string => text.split(/\s+/u).filter(Boolean).join(" ");

/**
 * Builds the message that starts the frame: the options with their defaults, and the frame's title.
 *
 * @param options - Options that {@link checkPciFrameOptions} accepted.
 */
export function buildStart(options: PciFrameOptions): PciStart {
  const {
    origins = [],
    messages,
    prompt,
    className = "",
    modules,
    properties = new Map(),
    templateVariables = new Map(),
    contextVariables = new Map(),
    state = null,
  } = options;
  const title = oneLine(prompt ?? "") || messages.interactiveQuestion;
  const entriesOf = (map: ReadonlyMap<string, unknown>) =>
    new Map([...map].map(([name, value]) => [name, toJson(value)] as const));
  return {
    type: "start",
    title,
    language: options.language,
    className,
    origins,
    stylesheets: [new URL(PLAYER_CSS, options.staticUrl).href, ...options.stylesheets],
    markup: options.markup,
    modules: { ...modules, waitSeconds: modules.waitSeconds ?? DEFAULT_WAIT_SECONDS },
    typeIdentifier: options.typeIdentifier,
    responseIdentifier: options.responseIdentifier,
    status: options.status,
    properties,
    templateVariables: entriesOf(templateVariables),
    contextVariables: entriesOf(contextVariables),
    boundTo: toJson(options.boundTo),
    state,
  };
}
