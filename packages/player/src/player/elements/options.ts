import type { CustomInteraction } from "@assesskit/runtime/asi";
import { DataError } from "@assesskit/runtime/errors";
import type { FileValue, Value } from "@assesskit/runtime/values";
import {
  checkBoolean,
  checkFunction,
  checkProperties,
  checkRecord,
  checkString,
  describe,
  isRecord,
} from "../../checks.js";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../content/options.js";

/** Where uploads, recordings and drawings are kept: the host's storage, which values refer to (the runtime D7). */
export interface InteractionFiles {
  /** Stores the bytes and returns the reference that the response holds. */
  upload(bytes: Blob, mimeType: string, fileName?: string): Promise<FileValue>;
  /** Returns the URL to play or show a stored file from. */
  url(file: FileValue): string;
}

/** The state of a custom interaction when the hook mounts it; later changes of the host do not reach the hook. */
export interface CustomInteractionState {
  /** The response that the interaction holds, `null` for NULL. */
  readonly value: Value | null;
  /** Whether the candidate cannot respond. */
  readonly disabled: boolean;
}

/**
 * Mounts a custom interaction (`qti-custom-interaction`, deprecated in favor of the portable custom interaction): it
 * draws into `host`, calls `set` with the response the candidate gives, and returns the function that takes it away.
 */
export type CustomInteractionHook = (
  interaction: CustomInteraction,
  host: HTMLElement,
  set: (value: Value | null) => void,
  state: CustomInteractionState,
) => () => void;

/** The options of {@link createInteractionRenderers}. */
export interface InteractionOptions {
  /** The text of the interface; the same as that of the content root. */
  readonly messages: Messages;
  /** Where uploads and recordings are kept. */
  readonly files: InteractionFiles;
  /**
   * The base URL of the static files of the player on the asset origin, ending in `/`: `recorder-worklet.js` is under it.
   * The page's policy must allow that origin in `script-src`, which governs worklets.
   */
  readonly staticUrl: string;
  /** Whether an upload of audio offers a recording. Default: `true`. */
  readonly record?: boolean;
  /** Mounts custom interactions. Default: none, so that a custom interaction says it is not supported. */
  readonly customInteraction?: CustomInteractionHook;
}

/** The options, checked and with their defaults. */
export interface InteractionSettings {
  readonly messages: Messages;
  readonly files: InteractionFiles;
  /** The URL of the recording worklet. */
  readonly workletUrl: string;
  readonly record: boolean;
  readonly customInteraction: CustomInteractionHook | undefined;
}

const OPTION_NAMES = ["messages", "files", "staticUrl", "record", "customInteraction"];

/** Returns whether a value is a file value: a reference, a content type and optionally a name, all strings. */
function isFileValue(value: unknown): value is FileValue {
  return (
    isRecord(value) &&
    typeof value.reference === "string" &&
    typeof value.mimeType === "string" &&
    (value.fileName === undefined || typeof value.fileName === "string")
  );
}

/** Wraps the files of the host so that what they return is checked: a file value, and a URL. */
function checkedFiles(files: Readonly<Record<string, unknown>>): InteractionFiles {
  checkFunction(files.upload, "The method upload of the option files must be a function");
  checkFunction(files.url, "The method url of the option files must be a function");
  const { upload, url } = files;
  return {
    upload: async (bytes, mimeType, fileName) => {
      const file: unknown = await Reflect.apply(upload, files, [bytes, mimeType, fileName]);
      if (!isFileValue(file)) {
        throw new DataError(`The method upload of the option files must give a file value, found ${describe(file)}.`);
      }
      return file;
    },
    url: (file) => {
      const found: unknown = Reflect.apply(url, files, [file]);
      checkString(found, "The URL that the method url of the option files returned");
      return found;
    },
  };
}

/** Returns the URL of the recording worklet below the base of the static files. */
function readWorkletUrl(staticUrl: unknown): string {
  checkString(staticUrl, "The option staticUrl");
  let base: URL | undefined;
  try {
    base = new URL(staticUrl);
  } catch {
    // The error below says what to give.
  }
  if (base === undefined || !(base.protocol === "https:" || base.protocol === "http:") || !staticUrl.endsWith("/")) {
    throw new DataError(
      `The option staticUrl must be an absolute http or https URL that ends in "/", found ${describe(staticUrl)}.`,
    );
  }
  return new URL("recorder-worklet.js", base).href;
}

/** Wraps the hook of the host so that what it returns is checked: the function that takes the interaction away. */
function checkedHook(hook: (...args: never[]) => unknown): CustomInteractionHook {
  return (interaction, host, set, state) => {
    const stop: unknown = Reflect.apply(hook, undefined, [interaction, host, set, state]);
    checkFunction(stop, "The value that the option customInteraction returned must be a function");
    return () => {
      Reflect.apply(stop, undefined, []);
    };
  };
}

/**
 * Checks the options of the renderers and fills in their defaults.
 *
 * @throws `DataError` when an option is not of its type.
 */
export function readInteractionOptions(options: unknown): InteractionSettings {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTION_NAMES);
  const { messages, files, staticUrl, record = true, customInteraction } = options;
  checkMessages(messages);
  checkRecord(files, "The option files must be an object");
  checkBoolean(record, "The option record");
  if (customInteraction !== undefined)
    checkFunction(customInteraction, "The option customInteraction must be a function");
  return {
    messages,
    files: checkedFiles(files),
    workletUrl: readWorkletUrl(staticUrl),
    record,
    customInteraction: customInteraction === undefined ? undefined : checkedHook(customInteraction),
  };
}
