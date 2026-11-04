/**
 * The AMD module of the math entry interaction, which `pnpm build` bundles with MathLive into `modules/math-entry.js`. It
 * runs in the frame of a portable custom interaction and registers the interaction with the communication bridge.
 */
import { defineInteraction } from "../frame/internal.js";
import { PCI_TYPE_IDENTIFIERS } from "../interaction-types.js";
import { createMathEntry } from "./interaction.js";

defineInteraction(PCI_TYPE_IDENTIFIERS["math-entry"], [], createMathEntry);
