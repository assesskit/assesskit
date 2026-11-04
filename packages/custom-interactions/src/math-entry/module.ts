/**
 * The AMD module of the math entry interaction, which `pnpm build` bundles with MathLive into `modules/math-entry.js`. It
 * runs in the frame of a portable custom interaction and registers the interaction with the communication bridge.
 */
import { defineInteraction } from "../frame/internal.js";
import { INTERACTION_TYPES } from "../interaction-types.js";
import { createMathEntry } from "./interaction.js";

defineInteraction(INTERACTION_TYPES["math-entry"], [], createMathEntry);
