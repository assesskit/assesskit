import type { HazardExposure, PnpHazardTerm } from "@assesskit/runtime/content";
import type { Messages } from "../../messages/index.js";
import { html } from "../dom.js";

/** The message that names each hazard of a PNP (BPIG §5.2.5). */
const HAZARD_NAMES: Readonly<Record<PnpHazardTerm, keyof Messages>> = {
  flashing: "hazardFlashing",
  sound: "hazardSound",
  "olfactory-hazard": "hazardOlfactory",
  "motion-simulation": "hazardMotionSimulation",
};

/**
 * Returns the hazards that remain: those of the delivered content that the candidate avoids. The runtime chooses the variant
 * without them where it can (B100), and flags `avoided` the ones it could not leave out.
 */
export function remainingHazards(hazards: readonly HazardExposure[]): readonly PnpHazardTerm[] {
  return hazards.filter(({ avoided }) => avoided).map(({ hazard }) => hazard);
}

/** Builds the notice that names the hazards that remain, which the player shows in place of the media it withholds (T95). */
export function hazardNotice(hazards: readonly PnpHazardTerm[], messages: Messages): HTMLElement {
  const names = hazards.map((hazard) => messages[HAZARD_NAMES[hazard]]);
  return html(
    "div",
    { class: "ak-hazards", role: "note" },
    html("p", {}, messages.hazardNotice),
    html("ul", {}, ...names.map((name) => html("li", {}, name))),
  );
}
