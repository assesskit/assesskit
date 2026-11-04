/**
 * The AMD module of the stroke writing interaction, which `pnpm build` bundles with Hanzi Writer into
 * `modules/stroke-writing.js`. It runs in the frame of a portable custom interaction, loads the character that the item's
 * module resolution names `stroke-writing-character`, and registers the interaction with the communication bridge.
 */
import { defineInteraction } from "../frame/internal.js";
import { PCI_TYPE_IDENTIFIERS } from "../interaction-types.js";
import { createStrokeWriting } from "./interaction.js";

defineInteraction(PCI_TYPE_IDENTIFIERS["stroke-writing"], ["stroke-writing-character"], createStrokeWriting);
