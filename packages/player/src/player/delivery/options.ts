import {
  checkBoolean,
  checkChoice,
  checkFunction,
  checkNonEmptyString,
  checkNonNegativeInteger,
  checkPositiveInteger,
  checkProperties,
  checkRecord,
  checkString,
  describe,
  isRecord,
} from "@assesskit/runtime/checks";
import type { CandidateView } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { FileValue } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { SessionCallOptions, SessionClient } from "../../protocol/index.js";
import { readOrigins } from "../content/internal.js";
import type { CustomInteractionHook } from "../elements/index.js";
import { canMount, HOST_SHADOW_RULE } from "../internal.js";
import type { LtiLogin } from "../lti-frame/index.js";
import type { StylesheetFetch } from "../roots/index.js";
import type { SpeechHook } from "../speech/index.js";
import { SLOT_TOOLS, type ToolSlots } from "../tools/index.js";

/** The host's storage of files, which interactions and the review of an upload use: file values are references to it. */
export interface MountFiles {
  /**
   * Sends the bytes of an upload, a recording or a drawing to the host and resolves with the file value that refers to them.
   *
   * @param bytes - The bytes.
   * @param mimeType - Their media type.
   * @param fileName - The name of the file, if it has one.
   * @param options - Its `signal` aborts when the mount is destroyed; a host that can, stops the upload.
   * @returns The file value.
   */
  upload(bytes: Blob, mimeType: string, fileName?: string, options?: SessionCallOptions): Promise<FileValue>;
  /**
   * Reads the bytes of a stored file, for a portable custom interaction.
   *
   * @param file - The file value.
   * @param options - Its `signal` aborts when the mount is destroyed; a host that can, stops the read.
   * @returns The bytes.
   */
  read(file: FileValue, options?: SessionCallOptions): Promise<Uint8Array>;
  /**
   * Returns the URL that plays a stored file back, such as a recording in review: a URL of the gate with a short-lived token.
   *
   * @param file - The file value.
   * @returns The URL.
   */
  url(file: FileValue): string;
  /**
   * Names a file whose bytes come later, so that the response of a recording refers to it as the recording starts. Required
   * unless `hooks.record` is `false`.
   *
   * @param mimeType - Their media type.
   * @param fileName - The name of the file, if it has one.
   * @param options - Its `signal` aborts when the mount is destroyed.
   * @returns The file value that the response holds until the bytes are stored with `fill`. It exists before its bytes do,
   * so a host that scores holds the request until `fill` ends or times out.
   */
  reserve?(mimeType: string, fileName?: string, options?: SessionCallOptions): Promise<FileValue>;
  /**
   * Stores the bytes of a reserved file, retrying as the host sees fit. The end of the mount does not abort it, because a
   * recording that a time limit, a proctor or a destroy stops still has to arrive; the host's own timeout ends a store that
   * hangs. Required unless `hooks.record` is `false`.
   *
   * @param file - The file value that `reserve` returned.
   * @param bytes - The bytes.
   * @param options - Its `signal` is the caller's alone.
   */
  fill?(file: FileValue, bytes: Blob, options?: SessionCallOptions): Promise<void>;
}

/** What the player needs of its page, whatever it shows. */
export interface MountOptions {
  /** The host's storage of files. */
  readonly files: MountFiles;
  /** The base URL of the player's static files, ending in `/`: `pci-frame/frame.html`, `player.css` and `recorder-worklet.js` are under it. */
  readonly staticUrl: string;
  /** The stylesheet of the content, built from `player.css` (see the styling guide). Keep one root that lives as long as the player. */
  readonly stylesheet: CSSStyleSheet;
  /** Loads item stylesheets and module resolution files from the gate; `fetch` of the page fits. */
  readonly fetch: StylesheetFetch;
  /**
   * The language of the interface, a BCP 47 tag, which chooses the catalog of messages.
   *
   * @defaultValue `"en"`
   */
  readonly language?: string;
  /**
   * The catalogs of the languages the host shows, by language tag, over the English messages; a catalog may leave messages
   * out. The player ships English only: the catalog of Indonesian is `ID_MESSAGES` of `@assesskit/player/messages/id`.
   *
   * @defaultValue None, so that the messages are English
   */
  readonly messages?: Readonly<Record<string, Partial<Messages>>>;
  /**
   * The origins besides the package's that content and portable custom interactions may load from.
   *
   * @defaultValue `[]`
   */
  readonly origins?: readonly string[];
  /**
   * The URL of MathJax 4's `mml-chtml` component on the host's asset origin.
   *
   * @defaultValue None, so that the browser renders MathML
   */
  readonly mathjax?: string;
  /**
   * Whether the player draws the navigation, timers, actions and comment box.
   *
   * @remarks
   * A host that draws its own sets `false`.
   *
   * @defaultValue `true`
   */
  readonly chrome?: boolean;
  /**
   * Hooks of the host.
   *
   * @defaultValue None
   */
  readonly hooks?: {
    /**
     * Mounts custom interactions (`qti-custom-interaction`).
     *
     * @defaultValue None, so that a custom interaction says it is not supported
     */
    readonly customInteraction?: CustomInteractionHook;
    /**
     * Whether an upload of audio offers a recording.
     *
     * @defaultValue `true`
     */
    readonly record?: boolean;
    /**
     * Receives the errors that the player can only report: a stylesheet or a lexicon that failed to load, a tool of the host that
     * threw, a voice that failed. No error is reported after the mount is destroyed.
     *
     * @defaultValue `reportError` of the page, which raises a global `error` event
     */
    readonly onError?: (error: unknown) => void;
    /**
     * The voice that reads aloud for the candidates whose supports ask for it.
     *
     * @defaultValue The voice of the browser, `webSpeech()`.
     */
    readonly voice?: SpeechHook;
    /**
     * Starts the login of the tool of an LTI item: the host's authenticated route answers with the frame of the item, which
     * its LTI library builds. The `signal` aborts when the candidate leaves the item.
     *
     * @defaultValue None, so that an LTI item says that its tool is not available
     */
    readonly ltiLogin?: LtiLogin;
    /**
     * The tools that the host provides, by name: the scientific and graphing calculators, the dictionary and the other
     * tools of the supports.
     *
     * @remarks
     * A tool without a function says that it is not available.
     *
     * @defaultValue No tools
     */
    readonly tools?: ToolSlots;
  };
}

/** What `mountDelivery` needs: the options of the page and the session it shows and drives. */
export interface DeliveryOptions extends MountOptions {
  /** The session: the player shows its view, sends its actions, and resolves package paths through it. */
  readonly client: SessionClient;
  /**
   * How often in milliseconds the player asks the session whether a paused test continues, for as long as the candidate has
   * no action to continue it.
   *
   * @remarks
   * A proctor pauses a test and resumes it; the candidate has no action, so the client learns of the resume only when it
   * asks (`SessionClient.refresh`). The player also asks when the page becomes visible and on a button. A remote client
   * sends one request for each check, so a host with many paused candidates sets a longer time, or 0 for none.
   *
   * @defaultValue `30000`
   */
  readonly resumeCheckMs?: number;
  /**
   * The element that holds the player: `"main"` for a page that is the player, `"region"` for a page that has a `main` of its
   * own, since a page has one main landmark. A region is named by the heading.
   *
   * @defaultValue `"region"`
   */
  readonly landmark?: "main" | "region";
  /**
   * The level of the heading of the item, 1 to 6: the level of the heading under which the host's page puts the player. A
   * page that is the player uses 1.
   *
   * @defaultValue `2`
   */
  readonly headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Whether the chrome offers Mark for review in a nonlinear part: a toggle button for the item presented, which the
   * navigation map shows in words.
   *
   * @remarks
   * The map shows a mark whoever made it. A linear part has no button, since a mark there has nowhere to lead.
   *
   * @defaultValue `false`
   */
  readonly marking?: boolean;
}

/** What `mountItem` needs: the options of `mountDelivery` without the chrome, the tools and the login of an LTI item. */
export interface ItemMountOptions extends Omit<DeliveryOptions, "chrome" | "hooks" | "marking"> {
  /**
   * Hooks of the host.
   *
   * @remarks
   * An item mounted alone draws no tools and refuses an LTI item, so it has neither the `tools` nor the `ltiLogin` hook.
   *
   * @defaultValue None
   */
  readonly hooks?: Omit<NonNullable<MountOptions["hooks"]>, "ltiLogin" | "tools">;
}

/** A player that is mounted. */
export interface Mounted {
  /**
   * Shows a view in place of the one before.
   *
   * @remarks
   * A mount with a session client follows the client by itself.
   *
   * @param view - The view.
   */
  update(view: CandidateView): void;
  /**
   * Resolves when the interactions of the item shown have handed over what the candidate gave, such as a drawing that is
   * still being stored.
   *
   * @remarks
   * The player waits for it before an action that submits or leaves the item; a host that draws its own actions
   * (`chrome: false`) waits for it before it sends them.
   *
   * @returns A promise that resolves when the interactions are settled.
   */
  settled(): Promise<void>;
  /** Takes the content, the timers and the listeners away, and empties the shadow root, so that a later mount can use the host element. */
  destroy(): void;
}

const ITEM_OPTION_NAMES = [
  "files",
  "staticUrl",
  "stylesheet",
  "fetch",
  "language",
  "messages",
  "origins",
  "mathjax",
  "hooks",
  "client",
];

const ITEM_HOOK_NAMES = ["customInteraction", "record", "voice", "onError"];

/** Checks the hooks that every mount has: the custom interaction, the recording and the voice. */
function checkItemHooks(hooks: Readonly<Record<string, unknown>>): void {
  if (hooks.customInteraction !== undefined) {
    checkFunction(hooks.customInteraction, "The hook customInteraction must be a function");
  }
  if (hooks.record !== undefined) checkBoolean(hooks.record, "The hook record");
  if (hooks.onError !== undefined) checkFunction(hooks.onError, "The hook onError must be a function");
  if (hooks.voice !== undefined) {
    checkRecord(hooks.voice, "The hook voice must be an object");
    checkFunction(hooks.voice.speak, "The method speak of the hook voice must be a function");
    checkFunction(hooks.voice.stop, "The method stop of the hook voice must be a function");
  }
}

/** Checks the hooks of the host of a player with chrome: those of every mount, the login of an LTI item and the tools. */
function checkDeliveryHooks(hooks: unknown): void {
  checkRecord(hooks, "The option hooks must be an object");
  checkProperties(hooks, "The option hooks", [...ITEM_HOOK_NAMES, "ltiLogin", "tools"]);
  checkItemHooks(hooks);
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

/** The options that `mountDelivery` and `mountItem` share, with the two that differ not yet checked. */
type SharedOptions = Omit<ItemMountOptions, "hooks"> & {
  readonly hooks?: unknown;
  readonly chrome?: unknown;
  readonly resumeCheckMs?: unknown;
  readonly landmark?: unknown;
  readonly headingLevel?: unknown;
  readonly marking?: unknown;
};

/** The deepest level of a heading in HTML. */
const MAX_HEADING_LEVEL = 6;

/** Checks the host and the options that `mountDelivery` and `mountItem` share. */
function checkSharedOptions(
  host: unknown,
  options: unknown,
  names: readonly string[],
): asserts options is SharedOptions {
  if (!(host instanceof HTMLElement)) throw new DataError(`The host must be an element, found ${describe(host)}.`);
  if (!canMount(host)) throw new DataError(HOST_SHADOW_RULE);
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", names);
  checkRecord(options.files, "The option files must be an object");
  const recording = !(isRecord(options.hooks) && options.hooks.record === false);
  for (const name of recording ? ["upload", "read", "url", "reserve", "fill"] : ["upload", "read", "url"]) {
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
  checkRecord(options.client, "The option client must be a session client");
  for (const name of ["age", "assets", "dispatch", "refresh", "subscribe", "close"]) {
    checkFunction(options.client[name], `The function ${name} of the option client must be a function`);
  }
}

/**
 * Checks the options of `mountDelivery`.
 *
 * @param host - The host element.
 * @param options - The options.
 * @throws `DataError` when the host is not an element that can have a shadow root and has none, or has one that an earlier mount of the player left empty, or an option is not of its
 * type.
 */
export function checkDeliveryOptions(host: unknown, options: unknown): asserts options is DeliveryOptions {
  checkSharedOptions(host, options, [
    ...ITEM_OPTION_NAMES,
    "chrome",
    "resumeCheckMs",
    "landmark",
    "headingLevel",
    "marking",
  ]);
  if (options.landmark !== undefined) checkChoice(options.landmark, "The option landmark", ["main", "region"]);
  if (options.headingLevel !== undefined) {
    checkPositiveInteger(options.headingLevel, "The option headingLevel");
    if (options.headingLevel > MAX_HEADING_LEVEL) {
      throw new DataError(
        `The option headingLevel must be from 1 to ${MAX_HEADING_LEVEL}, found ${options.headingLevel}.`,
      );
    }
  }
  if (options.chrome !== undefined) checkBoolean(options.chrome, "The option chrome");
  if (options.marking !== undefined) checkBoolean(options.marking, "The option marking");
  if (options.resumeCheckMs !== undefined) {
    checkNonNegativeInteger(options.resumeCheckMs, "The option resumeCheckMs");
  }
  if (options.hooks !== undefined) checkDeliveryHooks(options.hooks);
}

/**
 * Checks the options of `mountItem`.
 *
 * @param host - The host element.
 * @param options - The options.
 * @throws `DataError` when the host is not an element that can have a shadow root and has none, or has one that an earlier mount of the player left empty, or an option is not of its
 * type.
 */
export function checkItemOptions(host: unknown, options: unknown): asserts options is ItemMountOptions {
  checkSharedOptions(host, options, ITEM_OPTION_NAMES);
  if (options.hooks === undefined) return;
  checkRecord(options.hooks, "The option hooks must be an object");
  checkProperties(options.hooks, "The option hooks", ITEM_HOOK_NAMES);
  checkItemHooks(options.hooks);
}
