import type { Interaction, PortableCustomInteraction } from "@luthfanwakan/olah/asi";
import type { CandidateItem, PciView } from "@luthfanwakan/olah/delivery";
import { moduleConfigurationPaths, type PciModuleConfiguration, parseModuleResolution } from "@luthfanwakan/olah/pci";
import type { Value, ValueDeclaration } from "@luthfanwakan/olah/values";
import { isDataError } from "../../errors.js";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer, InteractionRenderer } from "../content/index.js";
import { html } from "../dom.js";
import {
  mountPciFrame,
  type PciFiles,
  type PciFrame,
  type PciFrameOptions,
  type PciStatus,
  type PciVariable,
} from "../pci/index.js";
import type { StylesheetFetch } from "../roots/index.js";
import type { Presentation } from "../supports/index.js";

/** What the PCI host needs of the player. */
export interface PciContext {
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag, for the document of the frame. */
  readonly language: string;
  /** The base URL of tempuh's static files, with the frame. */
  readonly staticUrl: string;
  /** The origins besides the asset origin that the frame may load from. */
  readonly origins: readonly string[];
  /** The host's storage of the files that interactions read and write. */
  readonly files: PciFiles;
  /** Loads the module resolution files. */
  readonly fetch: StylesheetFetch;
  /** Turns the path of a file in the package into a URL under a signed prefix. */
  readonly assets: (path: string) => string;
  /** Returns the item presented, which the interaction belongs to. */
  readonly item: () => CandidateItem | undefined;
  /** Receives the response and the state of an interaction when they change. */
  readonly respond: (identifier: string, value: Value | null, state: string) => void;
}

/** The interactions in the frames of portable custom interactions that a view shows. */
export interface PciHost {
  /** Draws a `qti-portable-custom-interaction` as a container whose frame starts when its configuration is loaded. */
  readonly render: InteractionRenderer;
  /** Sets the look that the candidate's supports ask for in the frames that run and in those that start later. Default: none. */
  setPresentation(presentation: Presentation): void;
  /** Closes the frames: each one hands over its final response and state first. Called before the content changes. */
  reset(): Promise<void>;
}

const isPortable = (interaction: Interaction): interaction is PortableCustomInteraction =>
  interaction.kind === "portable-custom-interaction";

/** The variable that a template or context value is for the interaction. NULL has no base type of its own, so a string stands in. */
function variableOf(value: Value | null): PciVariable {
  const declaration: ValueDeclaration =
    value === null
      ? { cardinality: "single", baseType: "string" }
      : value.cardinality === "record"
        ? { cardinality: "record" }
        : { cardinality: value.cardinality, baseType: value.baseType };
  return { value, declaration };
}

const variablesOf = (values: ReadonlyMap<string, Value | null>): ReadonlyMap<string, PciVariable> =>
  new Map([...values].map(([identifier, value]) => [identifier, variableOf(value)]));

/** The status of the item session, as the frame knows it: an item not yet presented is interacting. */
const statusOf = (item: CandidateItem): PciStatus => (item.status === "initial" ? "interacting" : item.status);

/** Reads a module resolution file of the package through the gate; a file that is missing or is not one is left out. */
async function loadConfiguration(context: PciContext, path: string): Promise<PciModuleConfiguration["primary"]> {
  const response = await context.fetch(context.assets(path), { credentials: "omit", referrerPolicy: "no-referrer" });
  if (!response.ok) return undefined;
  try {
    return parseModuleResolution(await response.text());
  } catch (error) {
    if (isDataError(error)) return undefined;
    throw error;
  }
}

/** Renders the markup of the interaction with the renderer, so that its URLs resolve through the gate, and writes it as HTML for the frame. */
function markupOf(interaction: PortableCustomInteraction, renderer: BodyRenderer): string {
  const holder = html("div", {}, ...renderer.nodes(interaction.interactionMarkup?.children ?? []));
  return holder.innerHTML;
}

/** Returns the text of the prompt of the interaction, which names its frame. */
function promptOf(interaction: PortableCustomInteraction, renderer: BodyRenderer): string | null {
  if (interaction.prompt === undefined) return null;
  const text = html("div", {}, ...renderer.nodes(interaction.prompt.children)).textContent?.trim() ?? "";
  return text === "" ? null : text;
}

/**
 * Creates the host of the portable custom interactions of the content (tempuh design §2.6, T49 to T53). The renderer it
 * gives the content root draws each interaction as a container, loads the module resolution files through the gate and
 * mounts the frame of TB4 in it with the state of the session: the response, the state `getState` gave before, the
 * template and context values, and the status of the item. What the interaction does reaches the player as `respond`: a
 * `changed` or `completed` event is a response with its state, which the session stores so that the interaction restores
 * on any device. A `done` event is a response too; it does not submit, since the candidate decides that.
 *
 * @param context - See {@link PciContext}.
 */
export function createPciHost(context: PciContext): PciHost {
  let frames: Promise<PciFrame | undefined>[] = [];
  let generation = 0;
  let presentation: Presentation = { attributes: new Map(), properties: new Map() };

  const start = async (
    container: Element,
    interaction: PortableCustomInteraction,
    renderer: BodyRenderer,
    item: CandidateItem,
    mine: number,
  ): Promise<PciFrame | undefined> => {
    const descriptor = item.interactions.find(
      ({ responseIdentifier }) => responseIdentifier === interaction.responseIdentifier,
    );
    const declaration = descriptor?.declaration;
    const paths = moduleConfigurationPaths(interaction);
    const [primary, fallback] = await Promise.all([
      loadConfiguration(context, paths.primary),
      loadConfiguration(context, paths.fallback),
    ]);
    if (mine !== generation || declaration === undefined || !(container instanceof HTMLElement)) return undefined;
    const view: PciView | undefined = item.pci.get(interaction.responseIdentifier);
    const identifier = interaction.responseIdentifier;
    const options: PciFrameOptions = {
      staticUrl: context.staticUrl,
      origins: context.origins,
      messages: context.messages,
      language: context.language,
      interaction,
      configuration: {
        ...(primary === undefined ? {} : { primary }),
        ...(fallback === undefined ? {} : { fallback }),
      },
      assets: context.assets,
      prompt: promptOf(interaction, renderer),
      markup: markupOf(interaction, renderer),
      stylesheets: item.stylesheets.map((path) => new URL(context.assets(path), document.baseURI).href),
      status: statusOf(item),
      state: view?.state ?? null,
      presentation,
      response: { value: item.responses.get(identifier) ?? null, declaration },
      templateVariables: variablesOf(view?.templateValues ?? new Map()),
      contextVariables: variablesOf(view?.contextValues ?? new Map()),
      files: context.files,
      onEvent: (event) => {
        if (mine !== generation) return;
        if (event.type === "changed" || event.type === "done" || event.type === "completed") {
          context.respond(identifier, event.response, event.state);
        } else if (event.type === "failed") {
          container.replaceChildren(html("p", { class: "tempuh-notice", role: "note" }, context.messages.pciFailed));
        }
      },
    };
    return mountPciFrame(container, options);
  };

  return {
    render: (interaction, renderer) => {
      if (!isPortable(interaction)) return renderer.element("qti-portable-custom-interaction", interaction, []);
      const container = renderer.element("qti-portable-custom-interaction", interaction, []);
      const item = context.item();
      if (item === undefined) return container;
      const mine = generation;
      const frame = start(container, interaction, renderer, item, mine).catch((error: unknown) => {
        reportError(error);
        container.replaceChildren(html("p", { class: "tempuh-notice", role: "note" }, context.messages.pciFailed));
        return undefined;
      });
      frames.push(frame);
      return container;
    },
    setPresentation: (next) => {
      presentation = next;
      for (const frame of frames) void frame.then((open) => open?.setPresentation(next));
    },
    reset: async () => {
      generation += 1;
      const closing = frames;
      frames = [];
      await Promise.all(closing.map(async (frame) => (await frame)?.destroy()));
    },
  };
}
