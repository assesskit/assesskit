import { type ContentVariables, VIEWS, type View } from "@luthfanwakan/olah/content";
import type { FileValue } from "@luthfanwakan/olah/values";
import {
  checkChoice,
  checkFunction,
  checkPositive,
  checkProperties,
  checkRecord,
  checkString,
  describe,
} from "../../checks.js";
import { DataError } from "../../errors.js";
import { EN_MESSAGES, type Messages } from "../../messages/index.js";
import type { InteractionRenderers } from "./context.js";
import { readOrigins } from "./urls.js";

/** The options of {@link createBodyRenderer}. */
export interface BodyRendererOptions {
  /** The text of the interface. */
  readonly messages: Messages;
  /**
   * Turns the path of a file in the package into the URL to load it from; the session client's `assets` fits. Every
   * reference of content to a package file goes through it.
   */
  readonly assets: (path: string) => string;
  /**
   * The path in the package of the document the content comes from, such as `items/q1/item.xml`: relative references
   * resolve against it. Default: `""`, so that references are paths from the root of the package.
   */
  readonly base?: string;
  /** The origins besides the package's that content may reference, such as `https://media.example`. Default: none. */
  readonly origins?: readonly string[];
  /** The renderers of interactions by `kind`; an interaction without one is drawn as a placeholder. Default: none. */
  readonly interactions?: InteractionRenderers;
  /** The view whose rubric blocks stay. Default: `candidate`. */
  readonly view?: View;
  /** Whether media and animation are withheld because a hazard remains. Default: `false`. */
  readonly withholdMedia?: boolean;
  /** The factor for the pixel sizes of media, which the magnification of non-text content sets. Default: `1`. */
  readonly mediaScale?: number;
  /** The variables that printed variables still in the content read. Default: none, so that they print nothing. */
  readonly variables?: ContentVariables;
  /** Returns the URL of a file value, such as an upload to review. Default: none, so that a file prints as its name. */
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

const OPTION_NAMES = [
  "messages",
  "assets",
  "base",
  "origins",
  "interactions",
  "view",
  "withholdMedia",
  "mediaScale",
  "variables",
  "fileUrl",
];

/** Checks that a value is the messages of the interface: an object with a string for every message of the catalog. */
export function checkMessages(messages: unknown): asserts messages is Messages {
  checkRecord(messages, "The option messages must be an object");
  for (const key of Object.keys(EN_MESSAGES)) checkString(messages[key], `The message ${key} of the option messages`);
}

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
 * @throws `DataError` when an option is not of its type.
 */
export function readRenderOptions(options: unknown): RenderSettings {
  checkRecord(options, "The options must be an object");
  checkProperties(options, "The options", OPTION_NAMES);
  const { messages, assets, base = "", origins = [], interactions = new Map(), view = "candidate" } = options;
  const { withholdMedia = false, mediaScale = 1, variables, fileUrl } = options;
  checkMessages(messages);
  checkFunction(assets, "The option assets must be a function");
  checkString(base, "The option base");
  checkInteractions(interactions);
  checkChoice(view, "The option view", VIEWS);
  if (typeof withholdMedia !== "boolean") {
    throw new DataError(`The option withholdMedia must be true or false, found ${describe(withholdMedia)}.`);
  }
  checkPositive(mediaScale, "The option mediaScale");
  if (variables !== undefined) checkVariables(variables);
  if (fileUrl !== undefined) checkFunction(fileUrl, "The option fileUrl must be a function");
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
