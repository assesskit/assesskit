/**
 * The seeded random number generator that the modules of the runtime share. Each module of the runtime has its own
 * subpath, such as `@assesskit/runtime/delivery`; the root holds only what no module owns.
 *
 * @module @assesskit/runtime
 */

export { createRandom, type Random, type RandomState, restoreRandom, type SeededRandom } from "./random.js";
