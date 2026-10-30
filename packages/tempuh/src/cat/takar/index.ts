/**
 * Engines of computer adaptive testing that run in process over takar: item-level adaptive sections and calibrated
 * multistage panels, both as implementations of olah's `CatPort`, and the store of the sections they parse. takar is an
 * optional peer dependency of tempuh, and only this subpath loads it.
 *
 * @module @luthfanwakan/tempuh/cat/takar
 */
export type { CategoryOfOutcomes } from "./response.js";
export type {
  SectionStore,
  StoredAdaptiveSection,
  StoredItem,
  StoredModule,
  StoredPanelSection,
  StoredSection,
} from "./section-store.js";
export { type TakarCatPortOptions, takarCatPort } from "./takar-cat-port.js";
export { type PanelParameters, type TakarPanelPortOptions, takarPanelPort } from "./takar-panel-port.js";
