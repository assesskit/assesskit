import {
  checkString,
  describe,
  functionSchema,
  methodsSchema,
  objectSchema,
  parseWith,
  strictRecord,
} from "@assesskit/runtime/checks";
import type { ItemKey } from "@assesskit/runtime/delivery";
import { DataError } from "@assesskit/runtime/errors";
import type { FileValue } from "@assesskit/runtime/values";
import * as v from "valibot";
import { type Messages, selectMessages } from "../../messages/index.js";
import { readRenderOptions, stylesheetSchema } from "../content/internal.js";
import type { MountFiles, MountOptions } from "../delivery/index.js";
import { createMathTypesetter, type MathTypesetter } from "../math/index.js";

/** What the display needs of the host's files: the `url` of {@link MountFiles}, which must give an `http` or `https` URL. */
export type SubmissionFiles = Pick<MountFiles, "url">;

/**
 * The options of {@link mountSubmission}.
 *
 * @remarks
 * `stylesheet`, `language`, `catalogs`, `origins` and `mathjax` mean what they do for the player, so a host passes the
 * same values to both.
 */
export interface SubmissionOptions
  extends Pick<MountOptions, "stylesheet" | "language" | "catalogs" | "origins" | "mathjax"> {
  /**
   * Turns the path of a file in the package into the URL to load it from: the images and media in the content of the
   * items and the rubric.
   */
  readonly assets: (path: string) => string;
  /**
   * The files of the host.
   *
   * @defaultValue None, so that a file shows as its name
   */
  readonly files?: SubmissionFiles;
  /**
   * Returns the path in the package of the document of an item instance, such as `items/q1/item.xml`, against which the
   * relative references of its content resolve.
   *
   * @defaultValue Every item starts at `""`, the root of the package
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
  /** The path of the document of an item instance. */
  readonly itemPath: (item: ItemKey) => string;
}

const submissionOptionsSchema = strictRecord({
  assets: functionSchema<(path: string) => string>(),
  stylesheet: stylesheetSchema,
  language: v.optional(v.string(), "en"),
  catalogs: v.optional(objectSchema<Readonly<Record<string, Partial<Messages>>>>(), () => ({})),
  files: v.optional(methodsSchema<SubmissionFiles>("url")),
  origins: v.optional(v.array(v.string())),
  mathjax: v.optional(v.string()),
  itemPath: v.optional(functionSchema<(item: ItemKey) => unknown>(), () => () => ""),
});

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
 * @param options - The options.
 * @returns The settings.
 * @throws `DataError` when an option is not of its type.
 */
export function readSubmissionOptions(options: unknown): SubmissionSettings {
  const { assets, stylesheet, language, catalogs, files, origins, mathjax, itemPath } = parseWith(
    submissionOptionsSchema,
    options,
    "The options object",
  );
  const fileUrl = files === undefined ? undefined : returningHttpUrl((file) => files.url(file));
  // `selectMessages` checks the catalogs, language by language, down to each message.
  const text = selectMessages(language, { catalogs });
  const { assets: readAssets, origins: readOrigins } = readRenderOptions({ messages: text, assets, origins });
  return {
    messages: text,
    language,
    assets: readAssets,
    stylesheet,
    fileUrl,
    origins: [...readOrigins],
    typesetter: mathjax === undefined ? undefined : createMathTypesetter(mathjax),
    itemPath: (item) => {
      const path: unknown = Reflect.apply(itemPath, undefined, [item]);
      checkString(path, "The path that itemPath returned");
      return path;
    },
  };
}
