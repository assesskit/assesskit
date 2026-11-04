import type { HazardExposure } from "@assesskit/runtime/content";
import type { PnpHazard } from "@assesskit/runtime/pnp";
import type { Messages } from "../../messages/index.js";
import { html } from "../internal.js";

/**
 * The message that names each hazard of a PNP.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, hazards}
 */
const HAZARD_NAMES: Readonly<Record<PnpHazard, keyof Messages>> = {
  flashing: "hazardFlashing",
  sound: "hazardSound",
  "olfactory-hazard": "hazardOlfactory",
  "motion-simulation": "hazardMotionSimulation",
};

/**
 * Returns the hazards that remain: those of the delivered content that the candidate avoids.
 *
 * @remarks
 * The runtime chooses the variant without them where it can, and flags `avoided` the ones it could not leave out.
 *
 * @param hazards - The hazards of the delivered content.
 * @returns The terms of the hazards that remain.
 */
export function remainingHazards(hazards: readonly HazardExposure[]): readonly PnpHazard[] {
  return hazards.filter(({ avoided }) => avoided).map(({ hazard }) => hazard);
}

/**
 * Builds the notice that names the hazards that remain, which the player shows in place of the media it withholds.
 *
 * @param hazards - The hazards that remain.
 * @param messages - The interface messages.
 * @returns The notice.
 */
export function hazardNotice(hazards: readonly PnpHazard[], messages: Messages): HTMLElement {
  const names = hazards.map((hazard) => messages[HAZARD_NAMES[hazard]]);
  return html(
    "div",
    { class: "ak-hazards", role: "note" },
    html("p", {}, messages.hazardNotice),
    html("ul", {}, ...names.map((name) => html("li", {}, name))),
  );
}
