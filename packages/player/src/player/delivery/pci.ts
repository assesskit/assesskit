import type { Interaction, PortableCustomInteraction } from "@assesskit/runtime/asi";
import type { ItemKey } from "@assesskit/runtime/delivery";
import type { CandidateItem, PciView } from "@assesskit/runtime/delivery/wire";
import { DataError, SecurityError } from "@assesskit/runtime/errors";
import {
  type PciModuleConfiguration,
  readModuleResolution,
  resolveModuleConfigurationPaths,
} from "@assesskit/runtime/pci";
import type { Value, ValueDeclaration } from "@assesskit/runtime/values";
import type { Messages } from "../../messages/index.js";
import type { BodyRenderer, InteractionRenderer } from "../content/index.js";
import { html } from "../internal.js";
import {
  mountPciFrame,
  type PciFiles,
  type PciFrame,
  type PciFrameOptions,
  type PciStatus,
  type PciVariable,
} from "../pci/internal.js";
import type { StylesheetFetch } from "../roots/index.js";
import type { Presentation } from "../supports/index.js";

/** What the PCI host needs of the player. */
export interface PciContext {
  /** Reports an error that the host of the interaction can only report. */
  readonly report: (error: unknown) => void;
  /** The text of the interface. */
  readonly messages: Messages;
  /** The language of the interface, a BCP 47 tag, for the document of the frame. */
  readonly language: string;
  /** The base URL of the player's static files, with the frame. */
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
  /** Returns the package paths of the stylesheets of the test, which apply in the frame before those of the item. */
  readonly testStylesheets: () => readonly string[];
  /** Receives the response and the state of an interaction when they change, for the item instance the frame shows. */
  readonly respond: (item: ItemKey, identifier: string, value: Value | null, state: string) => void;
}

/** The interactions in the frames of portable custom interactions that a view shows. */
export interface PciHost {
  /** Draws a `qti-portable-custom-interaction` as a container whose frame starts when its configuration is loaded. */
  readonly render: InteractionRenderer;
  /**
   * Sets the look that the candidate's supports ask for in the frames that run and in those that start later.
   *
   * @param presentation - The look.
   */
  setPresentation(presentation: Presentation): void;
  /**
   * Has the interactions of an item that is interacting hand over their responses, which go to the player as responses.
   *
   * @remarks
   * Called before an action that submits or leaves the item, so that the response of an interaction that fires no
   * `qti-interaction-changed` goes too. A frame that has not started yet holds no interaction and is not waited for.
   *
   * @returns A promise that resolves when the responses are on their way to the session.
   */
  settled(): Promise<void>;
  /**
   * Closes the frames.
   *
   * @remarks
   * Called before the content changes, once the view has moved on, so what the frames hand over as they close is dropped:
   * `settled` collects the responses before an action leaves the item.
   *
   * @returns A promise that resolves when the frames are closed.
   */
  reset(): Promise<void>;
}

const isPortable = (interaction: Interaction): interaction is PortableCustomInteraction =>
  interaction.kind === "portable-custom-interaction";

/** Returns the variable that a template or context value is for the interaction. NULL has no base type of its own, so a string stands in. */
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
    return readModuleResolution(await response.text());
  } catch (error) {
    if (error instanceof DataError || error instanceof SecurityError) return undefined;
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
 * Creates the host of the portable custom interactions of the content.
 *
 * @remarks
 * The renderer it gives the content root draws each interaction as a container, loads the module resolution files through
 * the gate and mounts the frame in it with the state of the session: the response, the state `getState` gave before, the
 * template and context values, and the status of the item. What the interaction does reaches the player as `respond`: a
 * `changed` event is a response with its state, which the session stores so that the interaction restores on any device.
 * A `done` event is a response too; it does not submit, since the candidate decides that. `settled` reads the response of
 * an interaction that fires no event, before an action leaves the item; the `completed` event of a frame that closes comes
 * after the view has moved on, and is dropped.
 *
 * @param context - See {@link PciContext}.
 * @returns The host.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, portable custom interactions}
 */
export function createPciHost(context: PciContext): PciHost {
  let frames: Promise<PciFrame | undefined>[] = [];
  // The frames of an item that is interacting, whose responses `settled` collects.
  const interacting = new Set<PciFrame>();
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
    const paths = resolveModuleConfigurationPaths(interaction);
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
      stylesheets: [...new Set([...context.testStylesheets(), ...item.stylesheets])].map(
        (path) => new URL(context.assets(path), document.baseURI).href,
      ),
      status: statusOf(item),
      state: view?.state ?? null,
      presentation,
      response: { value: item.responses.get(identifier) ?? null, declaration },
      templateVariables: variablesOf(view?.templateValues ?? new Map()),
      contextVariables: variablesOf(view?.contextValues ?? new Map()),
      files: context.files,
      onError: context.report,
      onEvent: (event) => {
        if (mine !== generation) return;
        if (event.type === "changed" || event.type === "done") {
          context.respond(item.key, identifier, event.response, event.state);
        } else if (event.type === "failed") {
          container.replaceChildren(html("p", { class: "ak-notice", role: "note" }, context.messages.pciFailed));
        }
      },
    };
    const frame = mountPciFrame(container, options);
    if (options.status === "interacting") interacting.add(frame);
    return frame;
  };

  return {
    render: (interaction, renderer) => {
      if (!isPortable(interaction)) return renderer.element("qti-portable-custom-interaction", interaction, []);
      const container = renderer.element("qti-portable-custom-interaction", interaction, []);
      const item = context.item();
      if (item === undefined) return container;
      const mine = generation;
      const frame = start(container, interaction, renderer, item, mine).catch((error: unknown) => {
        context.report(error);
        container.replaceChildren(html("p", { class: "ak-notice", role: "note" }, context.messages.pciFailed));
        return undefined;
      });
      frames.push(frame);
      return container;
    },
    setPresentation: (next) => {
      presentation = next;
      for (const frame of frames) void frame.then((open) => open?.setPresentation(next));
    },
    settled: async () => {
      await Promise.all([...interacting].map((frame) => frame.settled()));
    },
    reset: async () => {
      generation += 1;
      interacting.clear();
      const closing = frames;
      frames = [];
      await Promise.all(closing.map(async (frame) => (await frame)?.destroy()));
    },
  };
}
