import * as v from "valibot";
import { checkArray, describe, objectSchema, parseWith, strictRecord } from "../checks.js";
import { DataError } from "../errors.js";
import type { DrdHazard } from "../metadata/index.js";
import type { PersonalNeedsProfile, PnpHazard } from "../pnp/index.js";

/**
 * The term that a PNP uses for each hazard term of the DRD: `flashing` and `sound` are the same, `olfactoryHazard` is
 * `olfactory-hazard` and `motionSimulation` is `motion-simulation`.
 *
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export const HAZARD_TERMS: ReadonlyMap<DrdHazard, PnpHazard> = new Map<DrdHazard, PnpHazard>([
  ["flashing", "flashing"],
  ["motionSimulation", "motion-simulation"],
  ["olfactoryHazard", "olfactory-hazard"],
  ["sound", "sound"],
]);

/** A hazard that content has, with whether the candidate avoids it. */
export interface HazardExposure {
  /** The hazard, in the terms of the PNP. */
  readonly hazard: PnpHazard;
  /** Whether the profile lists the hazard under `hazard-avoidance`, so that the candidate should not be exposed to it. */
  readonly avoided: boolean;
}

const deriveHazardExposureOptionsSchema = strictRecord({ profile: v.optional(objectSchema<PersonalNeedsProfile>()) });

/** The options of {@link deriveHazardExposure}. */
export interface DeriveHazardExposureOptions {
  /**
   * The candidate's profile.
   *
   * @defaultValue none, and then nothing is avoided
   */
  readonly profile?: PersonalNeedsProfile;
}

/**
 * Maps the hazards of a resource, in the terms of the DRD, to the terms of a PNP and marks those the candidate avoids.
 *
 * @remarks
 * A candidate who avoids a hazard should not be exposed to content that has it, so a delivery engine prefers a variant
 * without the avoided hazards and flags the hazards it cannot avoid.
 *
 * @param hazards - The `hazard` terms of the resource's DRD.
 * @param options - See {@link DeriveHazardExposureOptions}.
 * @returns One entry for each hazard, in the order given and each once.
 * @throws `DataError` when `hazards` holds anything but terms of the DRD, or `profile` is not a profile.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide}
 */
export function deriveHazardExposure(
  hazards: readonly DrdHazard[],
  options: DeriveHazardExposureOptions = {},
): readonly HazardExposure[] {
  checkArray(hazards, "The hazards must be an array");
  const { profile } = parseWith(deriveHazardExposureOptionsSchema, options, "The options object");
  const setting = profile?.supports.get("hazard-avoidance");
  const avoided = new Set(setting?.name === "hazard-avoidance" ? setting.hazards : []);
  return [...new Set(hazards)].map((hazard) => {
    const term = HAZARD_TERMS.get(hazard);
    if (term === undefined) {
      const expected = [...HAZARD_TERMS.keys()].join(", ");
      throw new DataError(`A hazard must be one of ${expected}, found ${describe(hazard)}.`);
    }
    return { hazard: term, avoided: avoided.has(term) };
  });
}
