import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { FileValue } from "@assesskit/runtime/values";
import { checkFunction, checkProperties, checkRecord, checkString, describe } from "../../checks.js";
import { type Messages, selectMessages } from "../../messages/index.js";
import type { InteractionRenderers } from "../content/index.js";
import { readRenderOptions } from "../content/options.js";
import type { MountFiles, MountOptions } from "../delivery/index.js";
import { createMathTypesetter, type MathTypesetter } from "../math/index.js";

/** What the display needs of the host's files: the `url` of {@link MountFiles}, which must give an `http` or `https` URL. */
export type SubmissionFiles = Pick<MountFiles, "url">;

/**
 * The options of {@link mountSubmission}. `stylesheet`, `language`, `messages`, `origins` and `mathjax` mean what they do
 * for the player, so a host passes the same values to both.
 */
export interface SubmissionOptions
  extends Pick<MountOptions, "stylesheet" | "language" | "messages" | "origins" | "mathjax"> {
  /**
   * Turns the path of a file in the package into the URL to load it from: the images and media in the content of the
   * items and the rubric.
   */
  readonly assets: (path: string) => string;
  /** The files of the host. Default: none, so that a file shows as its name. */
  readonly files?: SubmissionFiles;
  /** The renderers of interactions by kind. Default: none, so that each interaction is a placeholder. */
  readonly interactions?: InteractionRenderers;
  /**
   * Returns the path in the package of the document of an item instance, such as `items/q1/item.xml`, against which the
   * relative references of its content resolve. Default: every item starts at `""`, the root of the package.
   */
  readonly itemPath?: (item: ItemKey) => string;
}

/** The options of a display, checked and with their defaults. */
export interface SubmissionSettings {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface. */
  readonly language: string;
  /** Turns a package path into a URL. */
  readonly assets: (path: string) => string;
  /** The player's stylesheet. */
  readonly stylesheet: CSSStyleSheet;
  /** The URL of a file value, when the host gives a way to. */
  readonly fileUrl: ((file: FileValue) => string) | undefined;
  /** The origins besides the package's. */
  readonly origins: readonly string[];
  /** Typesets the expressions, when the host gave MathJax. */
  readonly typesetter: MathTypesetter | undefined;
  /** The renderers of interactions. */
  readonly interactions: InteractionRenderers;
  /** The path of the document of an item instance. */
  readonly itemPath: (item: ItemKey) => string;
}

const OPTION_NAMES = [
  "assets",
  "stylesheet",
  "language",
  "messages",
  "files",
  "origins",
  "mathjax",
  "interactions",
  "itemPath",
];

/** The schemes that the page may load a file of a candidate from. */
const FILE_PROTOCOLS: readonly string[] = ["http:", "https:"];

/** Wraps the host's function so that what it returns is checked to be an `http` or `https` URL, which the page will load. */
function returningHttpUrl(url: (file: FileValue) => unknown): (file: FileValue) => string {
  return (file) => {
    const result = url(file);
    checkString(result, "The URL that files.url returned");
    if (!FILE_PROTOCOLS.includes(new URL(result, document.baseURI).protocol)) {
      throw new DataError(`The URL that files.url returned must be an http or https URL, found ${describe(result)}.`);
    }
    return result;
  };
}

/**
 * Checks the options of a display and fills in their defaults.
 *
 * @throws `DataError` when an option is not of its type.
 */
export function readSubmissionOptions(options: unknown): SubmissionSettings {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTION_NAMES);
  const { language = "en", messages = {}, files, mathjax, itemPath = () => "" } = options;
  checkString(language, "The option language");
  checkRecord(messages, "The option messages must be an object");
  checkFunction(itemPath, "The option itemPath must be a function");
  if (mathjax !== undefined) checkString(mathjax, "The option mathjax");
  let fileUrl: SubmissionSettings["fileUrl"];
  if (files !== undefined) {
    checkRecord(files, "The option files must be an object with a function url");
    const { url } = files;
    checkFunction(url, "The url of the option files must be a function");
    fileUrl = returningHttpUrl((file) => Reflect.apply(url, files, [file]));
  }
  // `selectMessages` checks the overrides, language by language, down to each message.
  const text = selectMessages(language, messages as Readonly<Record<string, Partial<Messages>>>);
  const { assets, origins, interactions } = readRenderOptions({
    messages: text,
    assets: options.assets,
    origins: options.origins,
    interactions: options.interactions,
  });
  if (!(options.stylesheet instanceof CSSStyleSheet)) {
    throw new DataError(`The option stylesheet must be a CSSStyleSheet, found ${describe(options.stylesheet)}.`);
  }
  return {
    messages: text,
    language,
    assets,
    stylesheet: options.stylesheet,
    fileUrl,
    origins: [...origins],
    typesetter: mathjax === undefined ? undefined : createMathTypesetter(mathjax),
    interactions,
    itemPath: (item) => {
      const path: unknown = Reflect.apply(itemPath, undefined, [item]);
      checkString(path, "The path that itemPath returned");
      return path;
    },
  };
}
