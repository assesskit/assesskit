import type { PersonalNeedsProfile, SupportState } from "./model.js";
import { checkProfile } from "./profile-checks.js";
import { deriveExtensionName, type SupportName } from "./support-names.js";

/**
 * Resolves what a profile says about each support it mentions.
 *
 * @remarks
 * The sets decide: a support in `prohibited` is `prohibited`, even if the profile also assigns it; otherwise one in
 * `activateAtInitialization` is `active`, one in `activateAsOption` is `option`, and a support the profile assigns
 * outside the sets is `assigned`. The name of a custom support is `ext:` and the local name of its element, and it is
 * `assigned`. A support the profile does not mention is not in the result; a delivery system treats it as not requested.
 *
 * @param profile - The profile; its structure is checked.
 * @returns The state of each support, assigned ones first in the order of the profile, then custom ones, then the ones
 * that only a set lists.
 * @throws `DataError` when `profile` is not a profile.
 * @see {@link https://www.imsglobal.org/spec/qti/v3p0/impl/ | QTI 3.0 Best Practices and Implementation Guide, PNP}
 */
export function resolveSupports(profile: PersonalNeedsProfile): ReadonlyMap<SupportName, SupportState> {
  checkProfile(profile);
  const states = new Map<SupportName, SupportState>();
  for (const name of profile.supports.keys()) states.set(name, "assigned");
  for (const extension of profile.extensions) states.set(deriveExtensionName(extension.name), "assigned");
  for (const name of profile.activateAsOption) states.set(name, "option");
  for (const name of profile.activateAtInitialization) states.set(name, "active");
  for (const name of profile.prohibited) states.set(name, "prohibited");
  return states;
}
