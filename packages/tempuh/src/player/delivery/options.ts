import type { CandidateView } from "@luthfanwakan/olah/delivery";
import type { FileValue } from "@luthfanwakan/olah/values";
import {
  checkBoolean,
  checkFunction,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../../checks.js";
import { DataError } from "../../errors.js";
import type { Messages } from "../../messages/index.js";
import type { SessionClient } from "../../protocol/index.js";
import { readOrigins } from "../content/urls.js";
import type { CustomInteractionHook } from "../elements/index.js";
import type { LtiLogin } from "../lti-frame/index.js";
import type { StylesheetFetch } from "../roots/index.js";
import type { SpeechHook } from "../speech/index.js";
import { SLOT_TOOLS, type ToolSlots } from "../tools/index.js";

/** The host's storage of files, which interactions and the review of an upload use: file values are references to it (olah D7). */
export interface MountFiles {
  /** Sends the bytes of an upload, a recording or a drawing to the host and resolves with the file value that refers to them. */
  upload(bytes: Blob, mimeType: string, fileName?: string): Promise<FileValue>;
  /** Reads the bytes of a stored file, for a portable custom interaction. */
  read(file: FileValue): Promise<Uint8Array>;
  /** Returns the URL that plays a stored file back, such as a recording in review: a URL of the gate with a short-lived token. */
  url(file: FileValue): string;
}

/** What the player needs of its page, whatever it shows. */
export interface MountOptions {
  /** The host's storage of files. */
  readonly files: MountFiles;
  /** The base URL of tempuh's static files, ending in `/`: `pci-frame/frame.html`, `player.css` and `recorder-worklet.js` are under it. */
  readonly staticUrl: string;
  /** The stylesheet of the content, built from `player.css` (see the styling guide). Keep one root that lives as long as the player. */
  readonly stylesheet: CSSStyleSheet;
  /** Loads item stylesheets and module resolution files from the gate; `fetch` of the page fits. */
  readonly fetch: StylesheetFetch;
  /** The language of the interface, a BCP 47 tag, which chooses the catalog of messages. Default: `"en"`. */
  readonly language?: string;
  /** Messages that replace the shipped ones, by language tag; a catalog may leave messages out. Default: none. */
  readonly messages?: Readonly<Record<string, Partial<Messages>>>;
  /** The origins besides the package's that content and portable custom interactions may load from. Default: none. */
  readonly origins?: readonly string[];
  /** The URL of MathJax 4's `mml-chtml` component on the host's asset origin. Default: none, so that the browser renders MathML. */
  readonly mathjax?: string;
  /** Whether the player draws the navigation, timers, actions and comment box. A host that draws its own sets `false`. Default: `true`. */
  readonly chrome?: boolean;
  /** Hooks of the host. Default: none. */
  readonly hooks?: {
    /** Mounts custom interactions (`qti-custom-interaction`). Default: none, so that a custom interaction says it is not supported. */
    readonly customInteraction?: CustomInteractionHook;
    /** Whether an upload of audio offers a recording. Default: `true`. */
    readonly record?: boolean;
    /**
     * The voice that reads aloud for the candidates whose supports ask for it.
     *
     * @defaultValue The voice of the browser, `webSpeech()`.
     */
    readonly voice?: SpeechHook;
    /**
     * Starts the login of the tool of an LTI item: the host's authenticated route answers with the frame of the item (see
     * `ltiPlatformFrame`).
     *
     * @defaultValue none, so that an LTI item says that its tool is not available
     */
    readonly ltiLogin?: LtiLogin;
    /**
     * The tools that the host provides, by name: the scientific and graphing calculators, the dictionary and the other
     * tools of the supports. A tool without a function says that it is not available.
     *
     * @defaultValue No tools.
     */
    readonly tools?: ToolSlots;
  };
}

/** What `mountDelivery` needs: the options of the page and the session it shows and drives. */
export interface DeliveryOptions extends MountOptions {
  /** The session: the player shows its view, sends its actions, and resolves package paths through it. */
  readonly client: SessionClient;
}

/** A player that is mounted. */
export interface Mounted {
  /** Shows a view in place of the one before. A mount with a session client follows the client by itself. */
  update(view: CandidateView): void;
  /**
   * Resolves when the interactions of the item shown have handed over what the candidate gave, such as a drawing that is
   * still being stored. The player waits for it before an action that submits or leaves the item; a host that draws its own
   * actions (`chrome: false`) waits for it before it sends them.
   */
  settled(): Promise<void>;
  /** Takes the content, the timers and the listeners away. The host element keeps its shadow root, so mount into a new element. */
  destroy(): void;
}

const OPTION_NAMES = [
  "files",
  "staticUrl",
  "stylesheet",
  "fetch",
  "language",
  "messages",
  "origins",
  "mathjax",
  "chrome",
  "hooks",
  "client",
];

/** Checks the hooks of the host. */
function checkHooks(hooks: unknown): void {
  checkRecord(hooks, "The option hooks must be an object");
  checkProperties(hooks, "The option hooks", ["customInteraction", "record", "voice", "ltiLogin", "tools"]);
  if (hooks.customInteraction !== undefined) {
    checkFunction(hooks.customInteraction, "The hook customInteraction must be a function");
  }
  if (hooks.record !== undefined) checkBoolean(hooks.record, "The hook record");
  if (hooks.voice !== undefined) {
    checkRecord(hooks.voice, "The hook voice must be an object");
    checkFunction(hooks.voice.speak, "The method speak of the hook voice must be a function");
    checkFunction(hooks.voice.stop, "The method stop of the hook voice must be a function");
  }
  if (hooks.ltiLogin !== undefined) checkFunction(hooks.ltiLogin, "The hook ltiLogin must be a function");
  if (hooks.tools !== undefined) {
    checkRecord(hooks.tools, "The hook tools must be an object");
    checkProperties(hooks.tools, "The hook tools", SLOT_TOOLS);
    for (const name of SLOT_TOOLS) {
      if (hooks.tools[name] !== undefined)
        checkFunction(hooks.tools[name], `The tool ${name} of the hook tools must be a function`);
    }
  }
}

/**
 * Checks the options of `mountDelivery`.
 *
 * @throws `DataError` when the host is not an element that can have a shadow root and has none, or an option is not of its type.
 */
export function checkDeliveryOptions(host: unknown, options: unknown): asserts options is DeliveryOptions {
  if (!(host instanceof HTMLElement)) throw new DataError(`The host must be an element, found ${describe(host)}.`);
  if (host.shadowRoot !== null) throw new DataError("The host must be an element that has no shadow root.");
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTION_NAMES);
  checkRecord(options.files, "The option files must be an object");
  for (const name of ["upload", "read", "url"]) {
    checkFunction(options.files[name], `The function ${name} of the option files must be a function`);
  }
  checkString(options.staticUrl, "The option staticUrl");
  if (!options.staticUrl.endsWith("/")) {
    throw new DataError(`The option staticUrl must end in "/", found ${describe(options.staticUrl)}.`);
  }
  if (!(options.stylesheet instanceof CSSStyleSheet)) {
    throw new DataError(`The option stylesheet must be a CSSStyleSheet, found ${describe(options.stylesheet)}.`);
  }
  checkFunction(options.fetch, "The option fetch must be a function");
  if (options.language !== undefined) checkNonEmptyString(options.language, "The option language");
  if (options.messages !== undefined) checkRecord(options.messages, "The option messages must be an object");
  if (options.origins !== undefined) readOrigins(options.origins);
  if (options.mathjax !== undefined) checkString(options.mathjax, "The option mathjax");
  if (options.chrome !== undefined) checkBoolean(options.chrome, "The option chrome");
  if (options.hooks !== undefined) checkHooks(options.hooks);
  checkRecord(options.client, "The option client must be a session client");
  for (const name of ["age", "assets", "dispatch", "subscribe", "close"]) {
    checkFunction(options.client[name], `The function ${name} of the option client must be a function`);
  }
}
