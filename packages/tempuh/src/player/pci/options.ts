import type { PortableCustomInteraction } from "@luthfanwakan/olah/asi";
import { type PciJson, type PciModuleConfiguration, pciProperties } from "@luthfanwakan/olah/pci";
import type { Value } from "@luthfanwakan/olah/values";
import {
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../../checks.js";
import { DataError } from "../../errors.js";
import type { Messages } from "../../messages/index.js";
import { checkVariable, encodeVariable, type PciFiles, type PciVariable } from "./files.js";
import { pciModules } from "./modules.js";
import type { PciFailure, PciRequestedStatus, PciStart, PciStatus } from "./protocol.js";

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
   * `getState()` ([BPIG] §3.7.12.7.5). The player sets the response variable to `response` and stores `state` with it.
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
   * The candidate is done, and the interaction asks for the item to move to `status`, which the player may refuse
   * ([BPIG] §3.7.12.7.2).
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
  /** The base URL of tempuh's static files on the asset origin, ending in `/`: `pci-frame/frame.html` and `player.css` are under it. */
  readonly staticUrl: string;
  /**
   * The origins, besides the asset origin, that scripts, styles, images, media and fonts of the frame may come from.
   * Default: `[]`.
   */
  readonly origins?: readonly string[];
  /** The text of the interface; the frame's title is `interactiveQuestion` when the interaction has no prompt. */
  readonly messages: Pick<Messages, "interactiveQuestion">;
  /** The language of the item, a BCP 47 tag. */
  readonly language: string;
  /**
   * The interaction, as olah reads it. Its type identifier, response identifier, `class`, `data-*` attributes and
   * modules come from it.
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
  /** The state that `getState` gave before, to restore, or `null` for a new interaction. Default: `null`. */
  readonly state?: string | null;
  /** The response variable the interaction is bound to, with its value. */
  readonly response: PciVariable;
  /** The template variables bound to the interaction, by identifier. Default: empty. */
  readonly templateVariables?: ReadonlyMap<string, PciVariable>;
  /** The context variables bound to the interaction, by identifier. Default: empty. */
  readonly contextVariables?: ReadonlyMap<string, PciVariable>;
  /** The host's storage of files. */
  readonly files: PciFiles;
  /** Receives what the interaction does, in order. */
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

function checkVariables(value: unknown, label: string): asserts value is ReadonlyMap<string, PciVariable> {
  checkMap(value, `${label} must be a Map`);
  for (const [name, variable] of value) {
    checkNonEmptyString(name, `A name in ${label}`);
    checkVariable(variable);
  }
}

function checkInteraction(value: unknown): asserts value is PortableCustomInteraction {
  checkRecord(value, "The option interaction must be an object");
  if (value.kind !== "portable-custom-interaction") {
    throw new DataError(
      `The option interaction must be a qti-portable-custom-interaction, found the kind ${describe(value.kind)}.`,
    );
  }
  checkNonEmptyString(
    value.customInteractionTypeIdentifier,
    "The custom-interaction-type-identifier of the interaction",
  );
  checkNonEmptyString(value.responseIdentifier, "The response-identifier of the interaction");
}

/**
 * Checks the options of {@link mountPciFrame}, as a host passes them from JavaScript.
 *
 * @throws `DataError` when an option is missing, has the wrong type, or is a URL or an origin that is not one, or a
 * variable does not have its declared cardinality and base type.
 */
export function checkPciFrameOptions(options: unknown): asserts options is PciFrameOptions {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", [
    "staticUrl",
    "origins",
    "messages",
    "language",
    "interaction",
    "configuration",
    "assets",
    "prompt",
    "markup",
    "stylesheets",
    "status",
    "state",
    "response",
    "templateVariables",
    "contextVariables",
    "files",
    "onEvent",
  ]);
  const { staticUrl, origins = [], messages, language, prompt, markup, stylesheets, state = null } = options;
  const { templateVariables = new Map(), contextVariables = new Map() } = options;
  checkBaseUrl(staticUrl, "The option staticUrl");
  checkEach(origins, "The option origins must be an array", checkOrigin);
  checkRecord(messages, "The option messages must be an object");
  checkNonEmptyString(messages.interactiveQuestion, "The message interactiveQuestion");
  checkNonEmptyString(language, "The option language");
  checkInteraction(options.interaction);
  checkRecord(options.configuration, "The option configuration must be an object");
  checkFunction(options.assets, "The option assets must be a function");
  if (prompt !== null) checkString(prompt, "The option prompt");
  checkString(markup, "The option markup");
  checkEach(stylesheets, "The option stylesheets must be an array", (url) =>
    checkHttpUrl(url, "A stylesheet of the option stylesheets"),
  );
  if (!STATUSES.some((status) => status === options.status)) {
    throw new DataError(
      `The option status must be "interacting", "suspended", "closed", "solution" or "review", found ${describe(options.status)}.`,
    );
  }
  if (state !== null) checkString(state, "The option state");
  checkVariable(options.response);
  checkVariables(templateVariables, "The option templateVariables");
  checkVariables(contextVariables, "The option contextVariables");
  checkRecord(options.files, "The option files must be an object with the functions read and upload");
  checkFunction(options.files.read, "The function read of the option files must be a function");
  checkFunction(options.files.upload, "The function upload of the option files must be a function");
  checkFunction(options.onEvent, "The option onEvent must be a function");
}

/** Collapses the white space of a prompt, which was text in a block, into the one line of a title. */
const oneLine = (text: string): string => text.split(/\s+/u).filter(Boolean).join(" ");

/** What a frame needs to be created, and the means to build the message that starts it. */
export interface FrameDescription {
  /** The name of the frame: the prompt with its white space collapsed, else the message `interactiveQuestion`. */
  readonly title: string;
  /** Reads the files that go to the interaction and builds the message that starts the frame. */
  readonly prepare: () => Promise<PciStart>;
}

async function encodeAll(
  variables: ReadonlyMap<string, PciVariable>,
  files: PciFiles,
): Promise<ReadonlyMap<string, PciJson>> {
  const encoded = await Promise.all(
    [...variables].map(async ([name, variable]) => [name, await encodeVariable(variable, files)] as const),
  );
  return new Map(encoded);
}

/**
 * Derives from the options what the frame needs: its title now, and the message that starts it once the bytes of the
 * files that go to the interaction are read.
 *
 * @param options - Options that {@link checkPciFrameOptions} accepted.
 * @throws `DataError` when the interaction names no module to load, or a module has no location.
 */
export function describeFrame(options: PciFrameOptions): FrameDescription {
  const { messages, prompt, interaction, configuration, assets, files, state = null } = options;
  const { origins = [], templateVariables = new Map(), contextVariables = new Map() } = options;
  const title = oneLine(prompt ?? "") || messages.interactiveQuestion;
  const modules = pciModules(interaction, configuration, assets);
  const properties = pciProperties(interaction);
  return {
    title,
    prepare: async () => {
      const [boundTo, templates, contexts] = await Promise.all([
        encodeVariable(options.response, files),
        encodeAll(templateVariables, files),
        encodeAll(contextVariables, files),
      ]);
      return {
        type: "start",
        title,
        language: options.language,
        className: (interaction.class ?? []).join(" "),
        origins,
        stylesheets: [new URL(PLAYER_CSS, options.staticUrl).href, ...options.stylesheets],
        markup: options.markup,
        modules,
        typeIdentifier: interaction.customInteractionTypeIdentifier,
        responseIdentifier: interaction.responseIdentifier,
        status: options.status,
        properties,
        templateVariables: templates,
        contextVariables: contexts,
        boundTo,
        state,
      };
    },
  };
}
