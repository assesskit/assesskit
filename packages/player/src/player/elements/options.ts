import type { CustomInteraction } from "@assesskit/runtime/asi";
import {
  checkBoolean,
  checkFunction,
  checkProperties,
  checkRecord,
  checkString,
  describe,
  isRecord,
} from "@assesskit/runtime/checks";
import { DataError } from "@assesskit/runtime/errors";
import type { FileValue, Value } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import { checkMessages } from "../../messages/internal.js";
import type { CallOptions } from "../../protocol/index.js";

/** Where uploads, recordings and drawings are kept: the host's storage, which values refer to. */
export interface InteractionFiles {
  /**
   * Stores the bytes and returns the reference that the response holds.
   *
   * @param bytes - The bytes.
   * @param mimeType - Their media type.
   * @param fileName - The name of the file, if it has one.
   * @returns The file value.
   */
  upload(bytes: Blob, mimeType: string, fileName?: string): Promise<FileValue>;
  /**
   * Returns the URL to play or show a stored file from.
   *
   * @param file - The file value.
   * @returns The URL.
   */
  url(file: FileValue): string;
  /**
   * Names a file whose bytes come later, so that the response can refer to a recording as it starts. Required unless the
   * option `record` is `false`.
   *
   * @param mimeType - Their media type.
   * @param fileName - The name of the file, if it has one.
   * @param options - Its `signal` aborts when the mount is destroyed.
   * @returns The file value, which the response holds until the bytes are stored with {@link InteractionFiles.fill}.
   */
  reserve?(mimeType: string, fileName?: string, options?: CallOptions): Promise<FileValue>;
  /**
   * Stores the bytes of a reserved file, retrying as the host sees fit. The end of the mount does not abort it, because a
   * recording that a time limit or a destroy stops still has to arrive. Required unless the option `record` is `false`.
   *
   * @param file - The file value that `reserve` returned.
   * @param bytes - The bytes.
   * @param options - Its `signal` is the caller's alone.
   */
  fill?(file: FileValue, bytes: Blob, options?: CallOptions): Promise<void>;
}

/** The state of a custom interaction when the hook mounts it; later changes of the host do not reach the hook. */
export interface CustomInteractionState {
  /** The response that the interaction holds, `null` for NULL. */
  readonly value: Value | null;
  /** Whether the candidate cannot respond. */
  readonly disabled: boolean;
}

/**
 * Mounts a custom interaction (`qti-custom-interaction`, deprecated in favor of the portable custom interaction): it draws
 * into `host`, calls `set` with the response the candidate gives, and returns the function that takes it away.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/info/ | QTI 3.0 ASI Information Model, custom interaction}
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
   * The base URL of the static files of the player on the asset origin, ending in `/`: `recorder-worklet.js` is under
   * it.
   *
   * @remarks
   * The page's policy must allow that origin in `script-src`, which governs worklets.
   */
  readonly staticUrl: string;
  /**
   * Whether an upload of audio offers a recording. With a recording, `files` needs `reserve` and `fill`.
   *
   * @defaultValue `true`
   */
  readonly record?: boolean;
  /**
   * Mounts custom interactions.
   *
   * @defaultValue None, so that a custom interaction says it is not supported
   */
  readonly customInteraction?: CustomInteractionHook;
  /**
   * Receives the errors that a recording can only report: the storage of its bytes failed, or the host could not name its file.
   *
   * @defaultValue `reportError` of the page, which raises a global `error` event
   */
  readonly onError?: (error: unknown) => void;
}

/** The options of the renderers, checked and with their defaults. */
export interface InteractionSettings {
  /** The text of the interface. */
  readonly messages: Messages;
  /** Where uploads and recordings are kept. */
  readonly files: InteractionFiles;
  /** The URL of the recording worklet. */
  readonly workletUrl: string;
  /** Whether an upload of audio offers a recording. */
  readonly record: boolean;
  /** The hook that mounts custom interactions, when the host gave one. */
  readonly customInteraction: CustomInteractionHook | undefined;
  /** Reports an error that a recording can only report. */
  readonly report: (error: unknown) => void;
}

const OPTION_NAMES = ["messages", "files", "staticUrl", "record", "customInteraction", "onError"];

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
function checkedFiles(files: Readonly<Record<string, unknown>>, record: boolean): InteractionFiles {
  checkFunction(files.upload, "The method upload of the option files must be a function");
  checkFunction(files.url, "The method url of the option files must be a function");
  const { upload, url, reserve, fill } = files;
  if (record) {
    checkFunction(
      reserve,
      "The method reserve of the option files must be a function unless the option record is false",
    );
    checkFunction(fill, "The method fill of the option files must be a function unless the option record is false");
  }
  const named = async (name: string, method: unknown, args: readonly unknown[]): Promise<FileValue> => {
    const file: unknown = await Reflect.apply(method as (...values: never[]) => unknown, files, args);
    if (!isFileValue(file)) {
      throw new DataError(`The method ${name} of the option files must give a file value, found ${describe(file)}.`);
    }
    return file;
  };
  return {
    upload: (bytes, mimeType, fileName) => named("upload", upload, [bytes, mimeType, fileName]),
    url: (file) => {
      const found: unknown = Reflect.apply(url, files, [file]);
      checkString(found, "The URL that the method url of the option files returned");
      return found;
    },
    ...(typeof reserve === "function"
      ? {
          reserve: (mimeType: string, fileName?: string, options?: CallOptions) =>
            named("reserve", reserve, [mimeType, fileName, options]),
        }
      : {}),
    ...(typeof fill === "function"
      ? {
          fill: async (file: FileValue, bytes: Blob, options?: CallOptions) => {
            await Reflect.apply(fill, files, [file, bytes, options]);
          },
        }
      : {}),
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
 * @param options - The options.
 * @returns The settings.
 * @throws `DataError` when an option is not of its type.
 */
export function readInteractionOptions(options: unknown): InteractionSettings {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTION_NAMES);
  const { messages, files, staticUrl, record = true, customInteraction, onError } = options;
  checkMessages(messages);
  checkRecord(files, "The option files must be an object");
  checkBoolean(record, "The option record");
  if (customInteraction !== undefined)
    checkFunction(customInteraction, "The option customInteraction must be a function");
  if (onError !== undefined) checkFunction(onError, "The option onError must be a function");
  return {
    messages,
    files: checkedFiles(files, record),
    workletUrl: readWorkletUrl(staticUrl),
    record,
    customInteraction: customInteraction === undefined ? undefined : checkedHook(customInteraction),
    report:
      onError === undefined ? (error) => reportError(error) : (error) => Reflect.apply(onError, undefined, [error]),
  };
}
