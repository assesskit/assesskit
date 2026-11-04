import { derivePciProperties } from "@assesskit/runtime/pci";
import type { JsonValue } from "@assesskit/runtime/values";
import { encodeVariable, type PciFiles, type PciVariable } from "./files.js";
import { pciModules } from "./modules.js";
import type { PciFrameOptions } from "./options.js";
import type { PciStart } from "./protocol.js";

/** The shared stylesheet of the player, under `staticUrl`. */
const PLAYER_CSS = "player.css";
/** Collapses the white space of a prompt, which was text in a block, into the one line of a title. */
const oneLine = (text: string): string => text.split(/\s+/u).filter(Boolean).join(" ");
/** What a frame needs to be created, and the means to build the message that starts it. */
export interface FrameDescription {
  /** The name of the frame: the prompt with its white space collapsed, else the message `interactiveQuestion`. */
  readonly title: string;
  /** Reads the files that go to the interaction and builds the message that starts the frame, but for the look, which the host adds when it sends it. */
  readonly prepare: () => Promise<Omit<PciStart, "presentation">>;
}
async function encodeAll(
  variables: ReadonlyMap<string, PciVariable>,
  files: PciFiles,
): Promise<ReadonlyMap<string, JsonValue>> {
  const encoded = await Promise.all(
    [...variables].map(async ([name, variable]) => [name, await encodeVariable(variable, files)] as const),
  );
  return new Map(encoded);
}
/**
 * Derives from the options what the frame needs: its title, and the message that starts it once the bytes of the files that
 * go to the interaction are read.
 *
 * @param options - The options that the mounts build from the view.
 * @returns The title and the means to build the start message.
 * @throws `DataError` when the interaction names no module to load, a module has no location, or a location in the package
 * is on an origin that the frame loads no scripts from.
 */
export function describeFrame(options: PciFrameOptions): FrameDescription {
  const { messages, prompt, interaction, configuration, assets, files, state = null } = options;
  const { origins = [], templateVariables = new Map(), contextVariables = new Map() } = options;
  const title = oneLine(prompt ?? "") || messages.interactiveQuestion;
  const modules = pciModules(interaction, configuration, assets, [new URL(options.staticUrl).origin, ...origins]);
  const properties = derivePciProperties(interaction);
  return {
    title,
    prepare: async () => {
      const [boundTo, templates, contexts] = await Promise.all([
        encodeVariable(options.response, files),
        encodeAll(templateVariables, files),
        encodeAll(contextVariables, files),
      ]);
      return {
        type: "start",
        title,
        language: options.language,
        className: (interaction.class ?? []).join(" "),
        origins,
        stylesheets: [new URL(PLAYER_CSS, options.staticUrl).href, ...options.stylesheets],
        markup: options.markup,
        modules,
        typeIdentifier: interaction.customInteractionTypeIdentifier,
        responseIdentifier: interaction.responseIdentifier,
        status: options.status,
        properties,
        templateVariables: templates,
        contextVariables: contexts,
        boundTo,
        state,
      };
    },
  };
}
