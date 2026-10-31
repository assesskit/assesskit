import type { XmlElement } from "../xml/index.js";
import type { SupportSetting } from "./settings.js";
import type { PredefinedSupportName, SetSupportName } from "./support-names.js";

/** A candidate's personal needs and preferences in the QTI profile of PNP 3.0 (BPIG §5, PNP XSD `access-for-all-pnp`). */
export interface PersonalNeedsProfile {
  /**
   * The supports the profile assigns, with their settings, in document order. Each key is the `name` of its setting.
   * A support that a set lists but the profile does not assign is not here.
   */
  readonly supports: ReadonlyMap<PredefinedSupportName, SupportSetting>;
  /** The supports to offer as options, which the candidate turns on (BPIG §5.3.1). */
  readonly activateAsOption: ReadonlySet<SetSupportName>;
  /** The supports to have on from the start of the session (BPIG §5.3.2). */
  readonly activateAtInitialization: ReadonlySet<SetSupportName>;
  /** The supports the candidate must not have (BPIG §5.3.3). */
  readonly prohibited: ReadonlySet<SetSupportName>;
  /**
   * Custom supports (BPIG §5.4): the elements of other namespaces that the profile holds, kept as they are. The name of
   * a custom support for catalogs and for the engine is `ext:` and the local name of its element.
   */
  readonly extensions: readonly XmlElement[];
}

/** A person as the system that holds the profile knows them (PNP XSD `person-sourced-id`). */
export interface PersonSourcedId {
  /** The system that issued the identifier (`source-system`). */
  readonly sourceSystem: string;
  /** The identifier of the person in that system. */
  readonly id: string;
}

/** A profile in a bulk file, with the candidate and the assessment assignments it is for (BPIG §5.5). */
export interface PnpRecord {
  /** The candidate. */
  readonly personSourcedId: PersonSourcedId;
  /** The assessment assignments the profile is for; none means every assignment of the candidate. */
  readonly appointmentIds: readonly string[];
  /** The profile. */
  readonly profile: PersonalNeedsProfile;
}

/**
 * How a profile treats a support (BPIG §5.3): `prohibited` is not available; `active` is on from the start; `option` is
 * available and off until the candidate turns it on; `assigned` is requested by the profile outside the sets, so the
 * delivery system provides it.
 */
export type SupportState = "prohibited" | "active" | "option" | "assigned";
