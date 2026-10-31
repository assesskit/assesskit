/**
 * Engines of computer adaptive testing that run in process over measurekit: item-level adaptive sections and calibrated
 * multistage panels, both as implementations of the runtime's `CatPort`, and the store of the sections they parse. measurekit is an
 * optional peer dependency of the player, and only this subpath loads it.
 *
 * @module @assesskit/player/cat/measurekit
 */

export { type MeasurekitCatPortOptions, measurekitCatPort } from "./measurekit-cat-port.js";
export { type MeasurekitPanelPortOptions, measurekitPanelPort, type PanelParameters } from "./measurekit-panel-port.js";
export type { CategoryOfOutcomes } from "./response.js";
export type {
  SectionStore,
  StoredAdaptiveSection,
  StoredItem,
  StoredModule,
  StoredPanelSection,
  StoredSection,
} from "./section-store.js";
