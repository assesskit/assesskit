/**
 * Helpers of the interaction elements that its tests use. The package does not export them.
 *
 * @module
 */
export { Board } from "./board/model.js";
export { centerOf, clampPoint, parseArea, pointAt } from "./graphic/geometry.js";
export { fillRuns, type Pixels } from "./graphic/operations.js";
export { instructionText, violationText } from "./hints.js";
export { readInteractionOptions } from "./options.js";
export { cardinalityOf, pairsOf, pointsOf, responseOf, stringsOf } from "./values.js";
