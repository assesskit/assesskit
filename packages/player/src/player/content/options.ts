import {
  checkFunction,
  checkRecord,
  checkString,
  describe,
  functionSchema,
  guardSchema,
  parseWith,
  positiveSchema,
  strictRecord,
} from "@assesskit/runtime/checks";
import { type ContentVariables, VIEWS, type View } from "@assesskit/runtime/content";
import { DataError } from "@assesskit/runtime/errors";
import type { FileValue } from "@assesskit/runtime/values";
import * as v from "valibot";
import type { Messages } from "../../messages/index.js";
import { messagesSchema } from "../../messages/internal.js";
import type { InteractionRenderers } from "./context.js";
import { readOrigins } from "./urls.js";

/** The options of {@link createBodyRenderer}. */
export interface BodyRendererOptions {
  /** The text of the interface. */
  readonly messages: Messages;
  /**
   * Turns the path of a file in the package into the URL to load it from; the session client's `assets` fits.
   *
   * @remarks
   * Every reference of content to a package file goes through it.
   */
  readonly assets: (path: string) => string;
  /**
   * The path in the package of the document the content comes from, such as `items/q1/item.xml`: relative references
   * resolve against it.
   *
   * @defaultValue `""`, so that references are paths from the root of the package
   */
  readonly base?: string;
  /**
   * The origins besides the package's that content may reference, such as `https://media.example`.
   *
   * @defaultValue `[]`
   */
  readonly origins?: readonly string[];
  /**
   * The renderers of interactions by `kind`; an interaction without one is drawn as a placeholder.
   *
   * @defaultValue An empty map
   */
  readonly interactions?: InteractionRenderers;
  /**
   * The view whose rubric blocks stay.
   *
   * @defaultValue `"candidate"`
   */
  readonly view?: View;
  /**
   * Whether media and animation are withheld because a hazard remains.
   *
   * @defaultValue `false`
   */
  readonly withholdMedia?: boolean;
  /**
   * The factor for the pixel sizes of media, which the magnification of non-text content sets.
   *
   * @defaultValue `1`
   */
  readonly mediaScale?: number;
  /**
   * The variables that printed variables still in the content read.
   *
   * @defaultValue None, so that a printed variable prints nothing
   */
  readonly variables?: ContentVariables;
  /**
   * Returns the URL of a file value, such as an upload to review.
   *
   * @defaultValue None, so that a file prints as its name
   */
  readonly fileUrl?: (file: FileValue) => string;
}

/** The options of a renderer, checked and with their defaults. */
export interface RenderSettings {
  /** The text of the interface. */
  readonly messages: Messages;
  /** Turns the path of a file in the package into a URL; it returns a string. */
  readonly assets: (path: string) => string;
  /** The path in the package of the document the nodes come from. */
  readonly base: string;
  /** The origins besides the package's, as `URL.origin` writes them. */
  readonly origins: ReadonlySet<string>;
  /** The renderers of interactions by kind. */
  readonly interactions: InteractionRenderers;
  /** The view whose rubric blocks stay. */
  readonly view: View;
  /** Whether media and animation are withheld. */
  readonly withholdMedia: boolean;
  /** The factor for the pixel sizes of media. */
  readonly mediaScale: number;
  /** The variables that printed variables read, if there are any. */
  readonly variables: ContentVariables | undefined;
  /** Returns the URL of a file value, if the host gives a way to. */
  readonly fileUrl: ((file: FileValue) => string) | undefined;
}

/** The schema of the stylesheet of the content, built from `player.css`. */
export const stylesheetSchema = guardSchema(
  (value): value is CSSStyleSheet => value instanceof CSSStyleSheet,
  "a CSSStyleSheet",
);

/** The options of a renderer, by name: the entries that the options of a content root and of the delivery read as well. */
export const RENDER_OPTION_ENTRIES = {
  messages: messagesSchema,
  assets: functionSchema<(path: string) => string>(),
  base: v.optional(v.string(), ""),
  origins: v.optional(v.array(v.string()), []),
  interactions: v.optional(v.unknown(), () => new Map()),
  view: v.optional(v.picklist(VIEWS), "candidate"),
  withholdMedia: v.optional(v.boolean(), false),
  mediaScale: v.optional(positiveSchema, 1),
  variables: v.optional(v.unknown()),
  fileUrl: v.optional(functionSchema<(file: FileValue) => string>()),
};

const renderOptionsSchema = strictRecord(RENDER_OPTION_ENTRIES);

function checkInteractions(interactions: unknown): asserts interactions is InteractionRenderers {
  if (!(interactions instanceof Map)) {
    throw new DataError(
      `The option interactions must be a Map from kind to function, found ${describe(interactions)}.`,
    );
  }
  for (const [kind, render] of interactions) {
    checkFunction(render, `The renderer of the interaction ${describe(kind)} must be a function`);
  }
}

function checkVariables(variables: unknown): asserts variables is ContentVariables {
  checkRecord(variables, "The option variables must be an object with the maps outcomes and templates");
  for (const name of ["outcomes", "templates"]) {
    if (!(variables[name] instanceof Map)) {
      throw new DataError(`The ${name} of the option variables must be a Map, found ${describe(variables[name])}.`);
    }
  }
}

/** Wraps a function of the host so that what it returns is checked to be a URL, the text the page will load. */
function returningUrl<TArgs extends readonly unknown[]>(
  call: (...args: never[]) => unknown,
  label: string,
): (...args: TArgs) => string {
  return (...args) => {
    const url = Reflect.apply(call, undefined, args);
    checkString(url, `The URL that ${label} returned`);
    return url;
  };
}

/**
 * Checks the options of a renderer and fills in their defaults.
 *
 * @param options - The options.
 * @returns The settings.
 * @throws `DataError` when an option is not of its type.
 */
export function readRenderOptions(options: unknown): RenderSettings {
  const { messages, assets, base, origins, interactions, view, withholdMedia, mediaScale, variables, fileUrl } =
    parseWith(renderOptionsSchema, options, "The options object");
  checkInteractions(interactions);
  if (variables !== undefined) checkVariables(variables);
  return {
    messages,
    assets: returningUrl<[path: string]>(assets, "the option assets"),
    base,
    origins: readOrigins(origins),
    interactions,
    view,
    withholdMedia,
    mediaScale,
    variables,
    fileUrl: fileUrl === undefined ? undefined : returningUrl<[file: FileValue]>(fileUrl, "the option fileUrl"),
  };
}
